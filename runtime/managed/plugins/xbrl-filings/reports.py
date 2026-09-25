"""Filing metadata keeps reporting dates separate from repository ingestion."""
from datetime import date
import re

from .identity import ORIGIN, PROVIDER, entity_url, reference, report_url, reports_url

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
    return {'dataset': 'filings', 'provider': PROVIDER, 'provider_ref': reference(identifier),
        'observed_at': observed_at, 'source_url': reports_url(identifier),
        'filings': [{'accession': row['hash'], 'report_id': row['id'], 'form': row['form'],
            'country': row['country'], 'title': row['form'] + ' report', 'period_end': row['period_end'],
            'url': row['url'], 'links': row['links'], 'machine_readable': available(row),
            'source_detail': detail(row)} for row in rows[:limit]],
        'latest': latest(rows, total),
        'coverage': {'scope': 'indexed_reports', 'returned': min(limit, len(rows)),
                     'total_available': total, 'complete': total <= limit}}


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
