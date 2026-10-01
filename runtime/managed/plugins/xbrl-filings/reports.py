"""Filing metadata keeps reporting dates separate from repository ingestion."""
from collections import Counter
from datetime import date
import json
from pathlib import Path
import re

from .identity import ORIGIN, PROVIDER, entity_url, reference, report_url, reports_url

# The mechanisms this plugin declares (contract.json): GB is the FCA's, every other country its `oam-<cc>`.
DECLARED = frozenset(json.loads((Path(__file__).parent / 'contract.json').read_text())
                     ['concepts']['filings']['authorities'])
ANNUAL_FORMS = ('ESEF', 'UKSEF')  # the EU and UK annual financial report formats
LINKS = (('viewer', 'viewer_url'), ('report', 'report_url'), ('package', 'package_url'), ('json', 'json_url'))


class AmbiguousReport(ValueError):
    """Several report variants share the latest period; the caller must pick one."""

    def __init__(self, candidates):
        super().__init__('ambiguous_report')
        self.candidates = candidates


def checked_date(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        raise ValueError('invalid_response')
    date.fromisoformat(value)
    return value


def owned(item, identifier):
    """Whether the repository links this filing to the requested entity."""
    related = item.get('relationships', {}).get('entity', {}).get('links', {}).get('related')
    return related == entity_url(identifier).removeprefix(ORIGIN)


def records(raw, identifier):
    if not isinstance(raw, dict) or not isinstance(raw.get('data'), list):
        raise ValueError('invalid_response')
    result = []
    for item in raw['data']:
        attrs = item.get('attributes', {})
        if item.get('type') != 'filing' or not owned(item, identifier):
            raise ValueError('invalid_response')
        report_id, digest = str(item.get('id', '')), attrs.get('sha256')
        if not re.fullmatch(r'[0-9]{1,16}', report_id) or not isinstance(digest, str) or not re.fullmatch(r'[a-f0-9]{64}', digest):
            raise ValueError('invalid_response')
        period_end = checked_date(attrs.get('period_end'))
        fxo_id = attrs.get('fxo_id', '')
        match = re.fullmatch(re.escape(identifier + '-' + period_end) + r'-([A-Za-z0-9]+)-([A-Z]{2})-[0-9]+', fxo_id)
        if not match:
            raise ValueError('invalid_response')
        errors = attrs.get('error_count')
        if type(errors) is not int or errors < 0:
            raise ValueError('invalid_response')
        quality = {target: attrs[source] for source, target in
            (('warning_count', 'warnings'), ('inconsistency_count', 'inconsistencies')) if source in attrs}
        if any(type(value) is not int or value < 0 for value in quality.values()):
            raise ValueError('invalid_response')
        links = {key: report_url(attrs[source], identifier) for key, source in LINKS if attrs.get(source)}
        if not links.keys() & {'viewer', 'report', 'package'}:
            raise ValueError('invalid_response')
        result.append({'id': report_id, 'hash': digest, 'period_end': period_end, 'form': match[1],
            'country': match[2], 'links': links,
            'url': links.get('viewer') or links.get('report') or links['package'],
            'json_url': links.get('json'), 'added_raw': attrs.get('date_added'), 'errors': errors,
            'fxo_id': fxo_id, **quality})
    total = raw.get('meta', {}).get('count')
    if type(total) is not int or total < len(result):
        raise ValueError('invalid_response')
    return result, total


def filings(raw, identifier, observed_at, limit):
    rows, total = records(raw, identifier)
    year_end = fiscal_year_end(rows)
    undeclared = Counter(row['country'] for row in rows if mechanism(row['country']) not in DECLARED)
    result = {'dataset': 'filings', 'provider': PROVIDER, 'provider_ref': reference(identifier),
        'observed_at': observed_at, 'source_url': reports_url(identifier),
        'source': {'label': 'filings.xbrl.org', 'url': ORIGIN},
        # The repository indexes neither a regulator filing date (date_added is its own ingestion) nor a language.
        'filings': [{'accession': row['hash'], 'report_id': row['id'], 'form': row['form'],
            'country': row['country'], 'title': row['form'] + ' report', 'period_end': row['period_end'],
            # Not a filing date: the day filings.xbrl.org indexed the report, a documented proxy for ordering.
            'filed_at': None, 'indexed_at': indexed(row['added_raw']), 'language': None,
            # Inline XBRL filed by the entity. The accounting basis is not in the index (ESEF can use a national
            # taxonomy for issuers without consolidated statements), so it is not stated.
            'kind': kind(row, year_end), 'format': 'ixbrl', 'basis': None,
            'parties': [{'role': 'filer', 'scheme': 'lei', 'id': identifier}],
            'url': row['url'], 'links': row['links'], 'machine_readable': available(row),
            'source_detail': detail(row)} for row in rows[:limit]],
        'latest': latest(rows, total),
        'coverage': {'scope': 'indexed_reports', 'returned': min(limit, len(rows)),
                     'total_available': total, 'complete': total <= limit}}
    if undeclared:  # rows of a mechanism the contract does not declare are left out by core: counted, never absorbed
        result['drift'] = {'undeclared_country': dict(undeclared)}
    return result


def mechanism(country):
    return 'fca' if country == 'GB' else 'oam-' + country.lower()


def fiscal_year_end(rows):
    """The entity's most frequent annual-report period end (MM-DD), or None when there is no single one."""
    ends = Counter(row['period_end'][5:] for row in rows if row['form'] in ANNUAL_FORMS).most_common(2)
    return ends[0][0] if ends and (len(ends) == 1 or ends[0][1] > ends[1][1]) else None


def kind(row, year_end):
    """annual, or half_year for a report ending six months from the entity's fiscal year end.

    The index has no period start or report type, so the period-end pattern is the evidence: a December filer's
    June report is its half-year report. With one report, or no single year end, a report stays annual."""
    if row['form'] not in ANNUAL_FORMS:
        return 'other'
    half = year_end and (int(row['period_end'][5:7]) - int(year_end[:2])) % 12 == 6
    return 'half_year' if half else 'annual'


def indexed(value):
    """The date part of the repository's `date_added` ("2026-03-04 13:55:19.06"), or None when absent or malformed."""
    day = value[:10] if isinstance(value, str) else None
    try:
        return day if day and checked_date(day) else None
    except ValueError:
        return None


def available(row):
    return not row['errors'] and bool(row['json_url'])


def latest(rows, total):
    """Whether the latest reporting period has one report or variants to choose from."""
    if not rows:
        return None
    period = max(row['period_end'] for row in rows)
    selected = [row for row in rows if row['period_end'] == period]
    # Neither numbered directories nor ingestion order prove amendment order.
    unique = len({row['hash'] for row in selected}) == 1 and not (len(selected) == len(rows) and total > len(rows))
    return {'period_end': period, 'report_ids': [row['id'] for row in selected],
            'status': 'unique' if unique else 'ambiguous'}


def candidate(row):
    return {'report_id': row['id'], 'period_end': row['period_end'], 'form': row['form'],
            'country': row['country'], 'url': row['url'], 'machine_readable': available(row)}


def detail(row):
    values = {'report_id': row['id'], 'sha256': row['hash'], 'repository_id': row['fxo_id'],
              'validation_errors': str(row['errors'])}
    if isinstance(row['added_raw'], str):
        values['added_raw'] = row['added_raw']
    for key in ('warnings', 'inconsistencies'):
        if key in row:
            values['validation_' + key] = str(row[key])
    return {'namespace': PROVIDER, 'values': values}


def select(raw, identifier, report_id=None):
    rows, total = records(raw, identifier)
    if not rows:
        raise ValueError('missing_observation')
    if report_id:
        selected = [row for row in rows if row['id'] == report_id]
        if not selected:
            raise ValueError('missing_observation')
    else:
        state = latest(rows, total)
        selected = [row for row in rows if row['id'] in state['report_ids']]
        if state['status'] != 'unique':
            raise AmbiguousReport([candidate(row) for row in selected])
    result = selected[0]
    if not available(result):
        raise ValueError('unavailable_report')
    return result
