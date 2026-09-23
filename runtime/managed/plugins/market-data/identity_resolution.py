"""Optional, bounded reference qualification through enabled native operations.

Provider identifiers are inputs to a reference lookup, not proof themselves.
Only a unique returned common-share identity establishes instrument evidence;
listing and source-series identity remain unchanged. No durable state is written.
"""
import copy
from datetime import datetime, timezone
import re

from .cache import ReadCancelled
from .coordinated import parallel
from .diagnostics import emit
from .request_context import cancelled
from .selection import available, fingerprint

MAX_CANDIDATES = 8
# Qualified Yahoo exchange code -> ISO segment MIC. Do not infer venue from a
# ticker suffix, translate ticker spellings, or default an absent currency.
YAHOO_VENUES = {'NMS': ('XNGS', 'UW')}
FIGI = re.compile(r'BBG[A-Z0-9]{9}')


def _issue(row, code):
    row.setdefault('identity_issues', []).append({
        'code': code, 'severity': 'warning',
        'message': 'Reference identity could not be qualified; this source remains separate.'})
    if code in ('identity_reference_unavailable', 'identity_reference_invalid'):
        native = row.get('provider_ref', row.get('native_ref', {}))
        emit('identity_qualification_failed', level='warning', provider=native.get('provider'),
             operation='identify', code=code, origin='reference_resolution')


def _cached(backend, provider, operation, arguments, access):
    sources, current = backend.context()
    if current != access or not available(sources, provider, operation):
        return {'outcome': 'unavailable', 'data': None}
    key = fingerprint({'identity_reference': provider, 'operation': operation,
                       'arguments': arguments, 'access': access})
    def fetch():
        found = backend.metadata_cache.get(key) if access.get('cacheable') else None
        if found is not None:
            return found
        result = backend.source(provider, operation, arguments)
        data = result.get('data')
        failed_items = provider == 'openfigi' and isinstance(data, list) and any(
            isinstance(item, dict) and item.get('error') for item in data)
        if result.get('outcome') in ('ok', 'empty') and not failed_items and backend.context()[1] == access and access.get('cacheable'):
            backend.metadata_cache.put(key, result, ttl_seconds=300)
        return result
    return backend.metadata_cache.coalesce(key, fetch)


def _job(backend, row, access):
    native = row.get('provider_ref', row.get('native_ref', {}))
    if row.get('category') != 'equity':
        return None
    provider = native.get('provider')
    if provider == 'yahoo' and native.get('native_scope') == 'symbol':
        qualifiers = native.get('qualifiers', {})
        venue = YAHOO_VENUES.get(qualifiers.get('venue'))
        if venue is None:
            return None
        job = {'idType': 'TICKER', 'idValue': native['native_id'], 'micCode': venue[0], 'marketSecDes': 'Equity'}
        currency = qualifiers.get('currency') or row.get('currency') or row.get('metadata', {}).get('native_currency')
        if currency:
            if not re.fullmatch('[A-Z]{3}', currency):
                return None
            job['currency'] = currency
        return job
    if provider == 'eodhd' and native.get('native_scope') == 'catalogue':
        result = _cached(backend, 'eodhd', 'identifiers', {'native_ref': native}, access)
        data = result.get('data')
        if result.get('outcome') != 'ok' or not isinstance(data, dict) or data.get('complete') is not True:
            _issue(row, 'identity_reference_unavailable')
            return None
        records = data.get('records')
        if not isinstance(records, list) or not records or any(not isinstance(item, dict) or item.get('symbol') != native['native_id'] for item in records):
            _issue(row, 'identity_reference_invalid')
            return None
        identifiers = {item.get('figi') for item in records}
        if len(identifiers) == 1 and all(isinstance(value, str) and FIGI.fullmatch(value) for value in identifiers):
            return {'idType': 'ID_BB_GLOBAL', 'idValue': next(iter(identifiers))}
    return None


def _proof(native, job, result, version, reference_version):
    if not isinstance(result, dict) or result.get('error') or result.get('warning'):
        return None
    rows = result.get('data')
    # A common identifier among several hits cannot resolve which native
    # instrument the provider meant. Retain that ambiguity instead of guessing.
    if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
        return None
    row = rows[0]
    if row.get('marketSector') != 'Equity' or row.get('securityType') != 'Common Stock':
        return None
    if job['idType'] == 'TICKER':
        venue = YAHOO_VENUES.get(native.get('qualifiers', {}).get('venue'))
        if venue is None or row.get('ticker') != job['idValue'] or row.get('exchCode') != venue[1]:
            return None
    if job['idType'] == 'ID_BB_GLOBAL' and job['idValue'] not in (row.get('figi'), row.get('compositeFIGI')):
        return None
    identifier, reference = row.get('shareClassFIGI'), row.get('figi')
    if not all(isinstance(value, str) and FIGI.fullmatch(value) for value in (identifier, reference)):
        return None
    proof = {'schema_version': 1, 'provider_ref': native, 'scope': 'instrument',
            'scheme': 'figi', 'value': identifier, 'qualifiers': {},
            'authority': 'source_asserted', 'adapter_version': version,
            'observed_at': None, 'retrieved_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
            'effective': {'start': None, 'end': None},
            'identifier_context': {'authority': 'openfigi', 'level': 'share_class',
                'security_type': row['securityType'], 'market_sector': row['marketSector'],
                'adapter_version': reference_version, 'reference_id': reference}}
    return {**proof, 'id': 'evidence:reference-' + fingerprint(proof)}


def qualify_candidates(backend, candidates, *, selected=False):
    """Enrich a relevance-ordered bounded slice without changing native references.

    Selected detail calls use the same proof rules, not a weaker adoption path.
    Native enablement/configuration is checked before every cache read and again
    before publication. Failures leave useful discovery results intact.
    """
    output = copy.deepcopy(candidates)
    sources, access = backend.context()
    if not available(sources, 'openfigi', 'identify'):
        return output
    versions = {source['contribution']['provider']: source['contribution']['adapter_version'] for source in sources}
    eligible = [row for row in output if row.get('category') == 'equity'
                and (provider := row.get('provider_ref', row.get('native_ref', {})).get('provider')) in ('yahoo', 'eodhd')
                and (available(sources, provider, 'details') or available(sources, provider, 'search'))]
    # Reserve work fairly across native catalogues without changing visible
    # relevance order. One source's many listings must not exhaust the budget
    # before the other source's strongest candidate can be compared.
    queues = {}
    for row in eligible:
        provider = row.get('provider_ref', row.get('native_ref', {}))['provider']
        queues.setdefault(provider, []).append(row)
    budgeted = []
    while any(queues.values()):
        for queue in queues.values():
            if queue:
                budgeted.append(queue.pop(0))
    for row in budgeted[MAX_CANDIDATES:]:
        _issue(row, 'identity_qualification_limited')
    def prepare(row):
        if cancelled():
            raise ReadCancelled()
        try:
            return row, _job(backend, row, access)
        except ReadCancelled:
            raise
        except Exception:
            _issue(row, 'identity_reference_unavailable')
            return row, None
    pending = [(row, job) for row, job in parallel(prepare, budgeted[:MAX_CANDIDATES]) if job is not None]
    if not pending:
        return output
    jobs = list({fingerprint(job): job for _, job in pending}.values())
    def reference_key(job):
        return fingerprint({'qualified_reference_job': job, 'access': access})
    indexed = {fingerprint(job): backend.metadata_cache.get(reference_key(job)) for job in jobs} if access.get('cacheable') else {}
    missing = [job for job in jobs if indexed.get(fingerprint(job)) is None]
    try:
        response = _cached(backend, 'openfigi', 'identify', {'jobs': missing}, access) if missing else {'outcome': 'ok', 'data': []}
    except ReadCancelled:
        raise
    except Exception:
        emit('identity_qualification_failed', level='warning', provider='openfigi',
             operation='identify', code='unexpected_exception', origin='reference_resolution')
        response = {'outcome': 'error'}
    if cancelled():
        raise ReadCancelled()
    if backend.context()[1] != access:
        return copy.deepcopy(candidates)
    results = response.get('data')
    valid = response.get('outcome') in ('ok', 'partial') and isinstance(results, list) and len(results) == len(missing)
    if valid:
        for job, result in zip(missing, results):
            indexed[fingerprint(job)] = result
            if isinstance(result, dict) and not result.get('error') and access.get('cacheable'):
                backend.metadata_cache.put(reference_key(job), result, ttl_seconds=300)
    for row, job in pending:
        native = row.get('provider_ref', row.get('native_ref'))
        proof = _proof(native, job, indexed.get(fingerprint(job)), versions[native['provider']], versions['openfigi'])
        if proof:
            row.setdefault('evidence', []).append(proof)
        else:
            _issue(row, 'identity_reference_unresolved' if valid else 'identity_reference_unavailable')
    return output
