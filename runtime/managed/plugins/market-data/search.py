"""Investment-first search across native capabilities and retained identities.

Names rank results, never associate investments. Search does not ingest evidence;
selection re-fetches details through the existing explicit identity mutation.
"""
import hashlib
import re

from . import catalogue
from .cache import ReadCancelled
from .coordinated import parallel
from .identity_db import native_key
from .identity_matching import compare
from .identity_repair import evidence_current
from .request_context import cancelled
from .selection import available, compatible_ref
from .search_ranking import arguments, rank
from .wire import WireError, require, validate

SCOPES = ('company', 'instrument', 'listing', 'crypto')
MAX_CANDIDATES_PER_SOURCE = 200
MAX_COMPARISONS = 4096


def text(value):
    return value if type(value) is str and 0 < len(value) <= 512 else None


def candidate(value, provider, kinds=()):
    require(type(value) is dict, 'search', 'invalid candidate')
    native = validate('provider_ref', value.get('provider_ref'))
    require(native['provider'] == provider, 'search', 'candidate provider differs')
    evidence = value.get('evidence', [])
    require(type(evidence) is list and len(evidence) <= 100, 'search', 'invalid candidate evidence')
    # Evidence is read for presentation/scope only. No assertion is persisted or
    # promoted into cross-provider authority by search.
    records = [validate('evidence', item) for item in evidence]
    require(all(item['provider_ref'] == native for item in records), 'search', 'candidate evidence differs')
    kind = value.get('kind', value.get('scope'))
    if kind not in SCOPES:
        asserted = {item['scope'] for item in records if item['authority'] == 'source_asserted'}
        kind = next((scope for scope in ('listing', 'instrument', 'crypto', 'company') if scope in asserted), None)
        if kind is None and len(kinds) == 1 and kinds[0] in SCOPES:
            kind = kinds[0]
    def named(scheme):
        values = {item['value'] for item in records if item['scheme'] == scheme}
        return text(next(iter(values))) if len(values) == 1 else None
    qualifiers = native.get('qualifiers', {})
    def listing_fact(key):
        values = {item['qualifiers'][key] for item in records if item['scope'] == 'listing'
                  and item['authority'] == 'source_asserted' and key in item['qualifiers']}
        return next(iter(values)) if len(values) == 1 else None
    metadata = value.get('metadata', {})
    require(type(metadata) is dict and len(metadata) <= 32, 'search', 'invalid display metadata')
    require(all(text(key) and (item is None or type(item) is bool or text(item)) for key, item in metadata.items()),
            'search', 'invalid display metadata value')
    # Existing adapters can retain useful optional display facts without exposing
    # their whole native payload or interpreting provider-specific type labels.
    metadata = dict(metadata)
    for key in ('provider_type', 'description', 'exchange', 'country'):
        if text(value.get(key)) and key not in metadata and len(metadata) < 32:
            metadata[key] = value[key]
    return {'native_ref': native, 'name': text(value.get('name')) or named('name'),
            'symbol': text(value.get('symbol')) or named('ticker'), 'kind': kind,
            'currency': text(value.get('currency')) or qualifiers.get('currency') or listing_fact('currency'),
            'venue': text(value.get('venue')) or qualifiers.get('venue') or listing_fact('venue'), 'metadata': metadata}


def status(value):
    return 'confirmed' if value == 'confirmed' else 'conflicting' if value in ('conflicting', 'rejected') else 'unresolved'


def issue(code, message):
    return {'code': code, 'message': message, 'severity': 'warning'}


def search(backend, query, limit=30):
    from .backend import envelope
    require(type(query) is str and 1 <= len(query.strip()) <= 512, 'search', 'invalid query')
    require(type(limit) is int and 1 <= limit <= 100, 'search', 'invalid limit')
    query = query.strip()
    sources, access = backend.context()
    generation = backend.identity.cache_token()
    providers = sorted(source['contribution']['provider'] for source in sources
                       if any(op['operation'] == 'search' for op in source['operations']))
    kinds = {source['contribution']['provider']: source['contribution'].get('subject_kinds', []) for source in sources}
    declarations = {source['contribution']['provider']: source['contribution'].get('search') for source in sources}
    parameters = {source['contribution']['provider']: op.get('parameters') for source in sources
                  for op in source['operations'] if op['operation'] == 'search'}
    source_modes = {}

    def fetch(provider):
        if cancelled():
            raise ReadCancelled()
        if not available(sources, provider, 'search'):
            return provider, {'outcome': 'unavailable', 'data': [], 'issues': []}
        try:
            request = arguments(query, declarations[provider], parameters[provider])
        except (TypeError, ValueError, AttributeError, re.error):
            from .execution import failure
            return provider, failure('invalid_contribution')
        if request is None:
            return provider, {'outcome': 'unsupported', 'data': [], 'issues': []}
        source_modes[provider] = request.get('mode')
        try:
            return provider, backend.source(provider, 'search', request)
        except ReadCancelled:
            raise
        except Exception:
            from .execution import failure
            return provider, failure('source_error')

    responses = parallel(fetch, providers)
    if cancelled():
        raise ReadCancelled()
    current, current_access = backend.context()
    if current_access != access:
        # Never publish a result obtained under an obsolete access projection.
        return envelope({'results': [], 'coverage': [], 'truncated': False}, outcome='error',
                        issues=[issue('access_changed', 'Connected source access changed. Search again.')])
    all_labels, proofs, coverage, issues, conflicts = {}, {}, [], [], set()
    source_order, ordering = {}, {}
    for provider, response in responses:
        source_order[provider] = []
        ordering[provider] = response.get('search_ordering')
        raw = response.get('data')
        provider_issues = list(response.get('issues', []))
        outcome = response.get('outcome', 'error')
        truncated = response.get('truncated') is True or any(item.get('code') in ('search_limited', 'truncated') for item in provider_issues)
        if outcome in ('ok', 'partial', 'empty'):
            if type(raw) is not list or len(raw) > 10000:
                raw = []
                provider_issues.append(issue('invalid_response', 'A source returned invalid search candidates.'))
                outcome = 'error'
            if len(raw) > MAX_CANDIDATES_PER_SOURCE:
                truncated = True
            for value in raw[:MAX_CANDIDATES_PER_SOURCE]:
                try:
                    label = candidate(value, provider, kinds.get(provider, []))
                    key = native_key(label['native_ref'])
                    source_order[provider].append(key)
                    if key in all_labels and all_labels[key] != label:
                        conflicts.add(key)
                        # Keep the exact source reference usable for inspection,
                        # but neither conflicting label becomes authoritative.
                        all_labels[key] = {**label, 'name': None, 'symbol': None, 'kind': None,
                                           'currency': None, 'venue': None, 'metadata': {}}
                        raise WireError('search: contradictory candidate labels')
                    if key in conflicts:
                        continue
                    all_labels[key] = label
                    proofs.setdefault(key, []).extend(value.get('evidence', []))
                except (WireError, ValueError, TypeError):
                    if not any(item['code'] == 'invalid_candidate' for item in provider_issues):
                        provider_issues.append(issue('invalid_candidate', 'Some source search candidates could not be interpreted.'))
                    outcome = 'partial'
        coverage.append({'provider': provider, 'status': outcome, 'issues': provider_issues, 'truncated': truncated})
        issues.extend(provider_issues)
    # Preserve the retained identity and its labels even while its connector is
    # unavailable. Such rows are explicitly non-routable, not cached source data.
    saved = catalogue.entries(backend.identity, query, all_labels.keys())
    for key, label in list(all_labels.items()):
        compatible = [row for row in saved if compatible_ref(label['native_ref'], row['native_ref'])
                      and (label['kind'] is None or row['scope'] == label['kind'])]
        refs = {native_key(row['native_ref']): row for row in compatible}
        if key not in refs and len(refs) == 1 and key not in conflicts:
            actual_key, saved_row = next(iter(refs.items()))
            actual = saved_row['native_ref']
            source_order[label['native_ref']['provider']] = [actual_key if item == key else item
                for item in source_order.get(label['native_ref']['provider'], [])]
            all_labels.pop(key)
            proofs.pop(key, None)  # Old assertions bind the original exact ref.
            all_labels.setdefault(actual_key, {**label, 'native_ref': actual,
                'currency': label['currency'] or actual.get('qualifiers', {}).get('currency'),
                'venue': label['venue'] or actual.get('qualifiers', {}).get('venue')})
            proofs.setdefault(actual_key, saved_row['evidence'])
    saved_by_native = {}
    for row in saved:
        key = native_key(row['native_ref'])
        saved_by_native.setdefault(key, []).append(row)
        if key not in all_labels:
            label = row['label'] or {'native_ref': row['native_ref'], 'name': None, 'symbol': None,
                                    'kind': row['scope'], 'currency': row['native_ref'].get('qualifiers', {}).get('currency'),
                                    'venue': row['native_ref'].get('qualifiers', {}).get('venue'), 'metadata': {}}
            if _matches(query, label):
                all_labels[key] = label
                proofs[key] = row['evidence']
    groups, representatives, comparisons = {}, {}, 0
    grouping_limited = False
    for key, label in all_labels.items():
        matches = saved_by_native.get(key, [])
        # Prefer the precise listing where retained. A common instrument ISIN
        # never collapses two venue/currency results into one listing.
        mapping = next((row for row in matches if row['scope'] == label['kind']), None)
        if mapping is None and len(matches) == 1:
            mapping = matches[0]
        identity_status = 'conflicting' if key in conflicts else status(mapping['status']) if mapping else 'unresolved'
        if mapping and proofs.get(key) and compare(label['native_ref'], proofs[key], mapping['native_ref'], mapping['evidence'], mapping['scope']) == 'conflicting':
            identity_status = 'conflicting'
        subject = {'kind': mapping['scope'], 'id': mapping['intent_subject']} if mapping else None
        group_key = 'native:' + hashlib.sha256(key.encode()).hexdigest()
        group_scope = mapping['scope'] if mapping else label['kind']
        if mapping and identity_status == 'confirmed' and mapping['scope'] in ('listing', 'crypto', 'company') and mapping['target'] == mapping['intent_subject']:
            # Only the exact confirmed target is grouping authority; include the
            # selected listing context rather than collapse instrument mappings.
            context = native_key({'target': mapping['target'], 'venue': label['venue'], 'currency': label['currency']})
            group_key = 'subject:' + hashlib.sha256(context.encode()).hexdigest()
        # Pure comparison can group freshly discovered references without
        # writing identities. Instrument equivalence alone is never sufficient
        # for grouping listing/feed search candidates.
        records = proofs.get(key, [])
        if identity_status != 'conflicting' and group_scope in ('listing', 'crypto', 'company'):
            for old_key, members in representatives.items():
                if comparisons + len(members) > MAX_COMPARISONS:
                    grouping_limited = True
                    break
                compatible = True
                for old_label, old_scope, old_records in members:
                    comparisons += 1
                    if (old_scope != group_scope or not evidence_current(records + old_records, backend.identity.evidence_versions)
                            or compare(label['native_ref'], records, old_label['native_ref'], old_records, group_scope) != 'confirmed'):
                        compatible = False
                        break
                if compatible:
                    group_key = old_key
                    break
            representatives.setdefault(group_key, []).append((label, group_scope, records))
        ref = {'native_ref': label['native_ref'], 'name': label['name'], 'symbol': label['symbol'],
               'status': identity_status, 'available': available(current, label['native_ref']['provider'], 'details'),
               'metadata': label['metadata']}
        if mapping:
            ref['mapping_id'] = mapping['id']
        if group_key not in groups:
            groups[group_key] = {'id': group_key, 'subject': subject, 'name': label['name'], 'symbol': label['symbol'],
                                 'kind': mapping['scope'] if mapping else label['kind'], 'currency': label['currency'],
                                 'venue': label['venue'], 'identity_status': identity_status, 'references': []}
        groups[group_key]['references'].append(ref)
        if groups[group_key]['subject'] is None and subject is not None:
            groups[group_key].update(subject=subject, identity_status=identity_status)
    ranked = rank(query, list(groups.values()), source_order, source_modes, ordering)
    truncated = grouping_limited or len(ranked) > limit or any(row['truncated'] for row in coverage)
    failed = any(row['status'] in ('error', 'partial', 'unavailable') for row in coverage)
    outcome = 'partial' if ranked and (failed or truncated) else 'ok' if ranked else 'error' if failed else 'empty'
    if truncated:
        issues.append(issue('search_limited', 'More candidates may exist. Refine your search.'))
    if grouping_limited:
        issues.append(issue('grouping_limited', 'Some identity comparisons exceeded the search budget; separate results may refer to the same investment.'))
    if failed and not issues:
        issues.append(issue('source_unavailable', 'Some connected sources could not be searched.'))
    if backend.identity.cache_token() != generation or backend.context()[1] != access:
        return envelope({'results': [], 'coverage': [], 'truncated': False}, outcome='error',
                        issues=[issue('catalogue_changed', 'Investment identity or source access changed. Search again.')])
    return envelope({'results': ranked[:limit], 'coverage': coverage, 'truncated': truncated}, outcome=outcome, issues=issues)


def _matches(query, label):
    haystack = ' '.join(str(label.get(key) or '') for key in ('name', 'symbol'))
    haystack += ' ' + label['native_ref']['native_id']
    return all(word in haystack.casefold() for word in query.casefold().split())
