"""The FCA National Storage Mechanism's search, and its answers read defensively.

The search is the JSON endpoint the NSM's own web page calls (found in the page's JavaScript), not a documented
API: the FCA may change or block it at any time. Every answer is checked against the shape measured on 2026-09-28
(docs/sources/nsm.md); what does not fit is counted as drift, never coerced. Pure standard library.
"""
from collections import Counter, defaultdict
from datetime import datetime, timezone
import re

ORIGIN = 'https://api.data.fca.org.uk'
SEARCH_URL = ORIGIN + '/search?index=nsm-search'
ARTEFACTS = 'https://data.fca.org.uk/artefacts/'
PROVIDER = 'nsm'
PAGE = 100  # one request serves filings, news and resolve: the issuer's newest 100 disclosures

# Every `_source` field seen in the audit. The last seven occur only on direct and portal uploads.
FIELDS = frozenset({
    'disclosure_id', 'seq_id', 'hist_seq', 'latest_flag', 'lei', 'company', 'related_org', 'lei_remediation_flag',
    'headline', 'type', 'type_code', 'category_group', 'classifications', 'classifications_code', 'tag_esef',
    'source', 'document_format', 'download_link', 'submitted_date', 'publication_date', 'document_date',
    'last_updated_date',
    'ContentVersionId', 'ProcessType', 'html_link', 'json_link', 'csv_link', 'RegionOfIncorporation',
    'IsTestSubmission'})
REQUIRED = ('disclosure_id', 'latest_flag', 'lei', 'company', 'headline', 'type', 'type_code', 'source',
            'document_format', 'download_link', 'submitted_date', 'publication_date')
# The small vocabularies: a value outside them is reported, and the row kept.
GROUPS = frozenset({'Corporate actions', 'Holdings', 'Financial Results', 'Mergers and acquisitions',
                    'Operational updates', 'Miscellaneous', 'General Meetings', 'Prospectuses',
                    'Regulator announcement'})
SOURCES = frozenset({'RNS', 'GNW', 'PRN', 'BWI', 'MFN', 'EQS', 'FCA', 'Direct Upload', 'Portal'})
FORMATS = {'Plain text': 'text', 'PDF': 'pdf', 'Tagged': 'ixbrl', 'HTML': 'html', 'Other': None}
# Core's filing kind by NSM headline code; any other code is `other`, or `event` when classed inside information.
KINDS = {'ACS': 'annual', 'IR': 'half_year', 'QRF': 'quarterly', 'QRT': 'quarterly', 'FR': 'earnings_release',
         'PRE': 'earnings_release', 'DSH': 'ownership', 'HOL': 'ownership', 'RET': 'ownership', 'FEE': 'ownership',
         'FEO': 'ownership', 'FER': 'ownership', 'DCC': 'ownership', 'PDI': 'prospectus', 'PSP': 'prospectus',
         'PFT': 'prospectus', 'FCA01': 'prospectus'}
INSIDE_INFORMATION = '2.2'  # the class of regulated information the NSM labels "Inside information"
CODE = re.compile(r'[A-Z][A-Z0-9]{1,5}\Z')
LINK = re.compile(r'NSM/[A-Za-z]+/(?:[A-Za-z0-9-]+/)?[A-Za-z0-9_-][A-Za-z0-9._-]*\Z')
IDENTIFIER = re.compile(r'[A-Za-z0-9_-]{1,64}\Z')


def lei(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Z0-9]{18}[0-9]{2}', value):
        raise ValueError('invalid_request')
    if int(''.join(str(int(c, 36)) for c in value)) % 97 != 1:
        raise ValueError('invalid_request')
    return value


def reference(value):
    return {'provider': PROVIDER, 'native_id': lei(value), 'native_scope': 'lei'}


def from_reference(value):
    if not isinstance(value, dict) or value.get('provider') != PROVIDER or value.get('native_scope') != 'lei' \
            or value.get('qualifiers'):
        raise ValueError('invalid_request')
    return lei(value.get('native_id'))


def searches(kinds):
    """The searches that find these filing kinds: the headline codes of the kinds that have them (the whole
    archive), and the newest page (None) for no kinds or for a kind without codes (event, other)."""
    wanted = [code for code, kind in KINDS.items() if kind in kinds]
    return ([wanted] if wanted else []) + ([None] if not kinds or set(kinds) - set(KINDS.values()) else [])


def query(identifier, type_codes=None):
    """The page's own search for disclosures whose disclosing organisation has this LEI, latest versions only,
    newest first, optionally of these headline codes. The four-slot `company_lei` value is the page's: name, LEI,
    `disclose_org`, `related_org`."""
    criteria = [{'name': 'company_lei', 'value': ['', lei(identifier), 'disclose_org', '']},
                {'name': 'latest_flag', 'value': 'Y'}]
    if type_codes:
        criteria.append({'name': 'type_code', 'value': list(type_codes)})
    return {'from': 0, 'size': PAGE, 'sortorder': 'desc', 'sort': 'submitted_date',
            'criteriaObj': {'criteria': criteria, 'dateCriteria': []}}


def _instant(value):
    """An ISO time with its zone, as `...Z`; None for anything else."""
    if not isinstance(value, str) or not value.endswith('Z'):
        return None
    try:
        moment = datetime.fromisoformat(value[:-1] + '+00:00')
    except ValueError:
        return None
    return moment.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def _text(value, limit=1000):
    return value.strip() if isinstance(value, str) and value.strip() and len(value) <= limit else None


def disclosures(raw, identifier, type_codes=None):
    """The issuer's disclosures from one search answer (of `query(identifier, type_codes)`): `{total, rows, drift}`.

    A changed envelope raises `ValueError('invalid_response')`. A row that cannot be read safely is left out and
    counted under `drift`; an unknown field or vocabulary value is counted and the row kept."""
    hits = raw.get('hits') if isinstance(raw, dict) else None
    total = hits.get('total') if isinstance(hits, dict) else None
    if not isinstance(total, dict) or type(total.get('value')) is not int or total.get('relation') != 'eq' \
            or not isinstance(hits.get('hits'), list) or raw.get('timed_out') is not False:
        raise ValueError('invalid_response')
    drift, rows = defaultdict(Counter), []
    for hit in hits['hits']:
        item = hit.get('_source') if isinstance(hit, dict) else None
        if not isinstance(item, dict):
            drift['malformed_row']['_source'] += 1
            continue
        for name in set(item) - FIELDS:
            drift['unknown_field'][name[:40]] += 1
        missing = [name for name in REQUIRED if name not in item]
        if missing:
            drift['missing_field'][missing[0]] += 1
            continue
        row = _row(item, identifier, type_codes, drift)
        if row is not None:
            rows.append(row)
    return {'total': total['value'], 'rows': rows, 'drift': {code: dict(values) for code, values in drift.items()}}


def _row(item, identifier, type_codes, drift):
    filers = [part for part in str(item['lei']).split(';') if part]
    if identifier not in filers:  # the search filter did not hold
        drift['foreign_lei']['row'] += 1
        return None
    if item['latest_flag'] != 'Y':
        drift['not_latest']['row'] += 1
        return None
    if type_codes and item['type_code'] not in type_codes:  # nor did the code filter
        drift['foreign_code']['row'] += 1
        return None
    if item.get('IsTestSubmission') not in (None, False):
        drift['test_submission']['row'] += 1
        return None
    submitted, published = _instant(item['submitted_date']), _instant(item['publication_date'])
    identity, code = item['disclosure_id'], item['type_code']
    link = item['download_link']
    checks = (('malformed_time', submitted and published), ('malformed_id', isinstance(identity, str)
              and IDENTIFIER.match(identity)), ('malformed_code', isinstance(code, str) and CODE.match(code)),
              ('malformed_link', isinstance(link, str) and LINK.match(link)),
              ('malformed_text', _text(item['headline']) and _text(item['company'], 2000) and _text(item['type'])))
    for name, good in checks:
        if not good:
            drift[name]['row'] += 1
            return None
    for name, value, known in (('unknown_group', item.get('category_group'), GROUPS),
                               ('unknown_source', item['source'], SOURCES),
                               ('unknown_format', item['document_format'], FORMATS)):
        if value not in known:
            drift[name][str(value)[:40]] += 1
    classes = str(item.get('classifications_code') or '').split(';')  # several, as `2.2;3.1`, or none as `0.0`
    kind = KINDS.get(code) or ('event' if INSIDE_INFORMATION in classes else 'other')
    return {'id': identity, 'headline': _text(item['headline']), 'category': _text(item['type']), 'code': code,
            'kind': kind, 'filers': filers,
            'companies': [part.strip() for part in item['company'].split(';') if part.strip()],
            'submitted': submitted, 'published': published, 'via': item['source'],
            'format': FORMATS.get(item['document_format']), 'url': ARTEFACTS + link}


def source():
    return {'label': 'FCA National Storage Mechanism', 'url': 'https://data.fca.org.uk/#/nsm/nationalstoragemechanism'}


def filings(parsed, limit):
    """Core's filing rows (ADR 0040, filings item v2). The NSM states no report period, accounting basis or
    language; its filing time is the submission time the NSM shows as "Filing Date/Time"."""
    return {'filings': [{
        'accession': row['id'], 'kind': row['kind'], 'form': row['code'], 'title': row['headline'],
        'category': row['category'], 'filed_at': row['submitted'][:10], 'accepted_at': row['submitted'],
        'published_at': row['published'], 'period_end': None, 'items': [], 'basis': None, 'language': None,
        'format': row['format'], 'url': row['url'], 'via': row['via'],
        'parties': [{'role': 'filer', 'scheme': 'lei', 'id': filer} for filer in row['filers']]}
        for row in parsed['rows'][:limit]], 'source': source()}


def news(parsed, limit):
    """Core's news rows: every NSM disclosure is a regulatory announcement, published when the NSM says the
    information was made public. `via` names the service that disseminated it (RNS, GNW, ...)."""
    return {'news': [{
        'id': row['id'], 'title': row['headline'], 'url': row['url'], 'published_at': row['published'],
        'publisher': 'FCA NSM', 'language': None, 'kind': 'regulatory', 'category': row['category'],
        'via': row['via']} for row in parsed['rows'][:limit]], 'source': source()}


def resolve(parsed, identifier, observed_at):
    """The NSM's issuer claim for an LEI it lists disclosures of, named as the newest disclosure it filed alone
    names it. None when the NSM lists none."""
    if not parsed['rows']:
        return None
    name = next((row['companies'][0] for row in parsed['rows'] if row['filers'] == [identifier]
                 and len(row['companies']) == 1), None)
    provenance = {'plugin': 'pythia-nsm', 'source': PROVIDER, 'adapter_version': '1', 'retrieved_at': observed_at,
                  'source_record': SEARCH_URL}
    return {'plugin': 'pythia-nsm', 'provider': PROVIDER, 'adapter_version': '1', 'origin': 'resolve',
            'claims': [{'level': 'issuer', 'identifiers': [{'scheme': 'lei', 'value': identifier}],
                        'native_ref': reference(identifier), 'attributes': {'name': name} if name else {},
                        'provenance': provenance}]}
