"""Cboe feed observations keep their venue, interval and uncertain coverage."""
from datetime import datetime, timezone, timedelta
from decimal import Decimal
import copy
from zoneinfo import ZoneInfo

from .results import base, issue, instant
from .session_context import enrich


def read(request, series, mode, message):
    result = base(request)
    result['series'] = series
    result['selection']['reason'] = 'pinned'
    now = datetime.now(timezone.utc)
    observations = []
    for row in message['rows']:
        point = datetime.fromtimestamp(row['t'] / 1000, timezone.utc)
        if any(edge and (point < instant(edge['value']) if key == 'start' else point > instant(edge['value'])) for key, edge in request['window'].items()):
            continue
        time = {'kind': 'instant', 'value': point.isoformat()}
        observation = {'shape': series['shape'], 'time': time, 'interval': None,
                       'completion': {'state': 'unknown', 'basis': 'unknown'}}
        if mode == 'edgx_latest':
            observation['value'] = format(Decimal(row['p']), 'f')
        else:
            end = point + timedelta(minutes=1)
            observation['interval'] = {'start': time, 'end': {'kind': 'instant', 'value': end.isoformat()}}
            observation['completion'] = {'state': 'completed' if end <= now else 'open', 'basis': 'calendar'}
            for field, native in [('open', 'o'), ('high', 'h'), ('low', 'l'), ('close', 'c'), ('volume', 'v')]:
                observation[field] = format(Decimal(row[native]), 'f')
        observations.append(observation)
    requirements = request['requirements']
    if requirements['completion'] == 'completed':
        observations = [row for row in observations if row['completion']['state'] == 'completed']
    truncated = len(observations) > request['limit']
    observations = observations[-request['limit']:]
    result['observations'] = observations
    result['coverage'].update(status='unknown', truncated=truncated)
    if observations:
        result['returned_window'] = {'start': observations[0]['time'], 'end': observations[-1]['time']}
    observed = observations[-1]['time']['value'] if observations else None
    result['freshness'].update(as_of=observed, basis='source_time' if observed else 'unknown', market_data_type='realtime')
    if observed:
        result['freshness']['status'] = 'fresh' if (now - instant(observed)).total_seconds() <= 180 else 'stale'
    if mode == 'edgx_latest' and observations:
        result['price_context'] = context(message['rows'][-1])
    result['provenance'] = {'provider': 'eodhd', 'native_ref': series['provider_ref'], 'adapter_version': '1',
        'retrieved_at': result['retrieved_at'], 'source_time': observed, 'revision_vintage': None, 'mapping_revision': None,
        'source_detail': {'namespace': 'eodhd', 'values': {'feed': message['feed'], 'venue': 'XEDX',
            'numeric_basis': 'sdk_parsed_js_number', 'session': str(message['rows'][-1].get('ms', 'unknown')) if message['rows'] else 'unknown'}}}
    issues = []
    if observations and 'reference' in message:
        result['price_context'], issues = enrich(result.get('price_context', {}), message['reference'], series, observations[-1])
    if message.get('gap'):
        issues.append({'code': 'stream_gap', 'severity': 'warning', 'message': 'The stream restarted. Returned bars do not establish complete coverage across the interruption.'})
    if truncated: issues.append(issue('truncated', 'warning'))
    result['requirements_satisfied'] = (requirements['freshness'] == 'any' or result['freshness']['status'] == 'fresh') and requirements['coverage'] == 'any' and (
        requirements['completion'] == 'any' or all(row['completion']['state'] == 'completed' for row in observations))
    if not result['requirements_satisfied'] and any(value != 'any' for value in requirements.values()):
        issues.append(issue('requirements_unmet'))
    result['issues'] = issues
    result['outcome'] = ('partial' if issues else 'ok') if observations else ('error' if issues else 'empty')
    return result


def context(row):
    """Optional source-qualified book and venue status keep their own times.

    Cboe's last trade does not supply a previous-close change. Never substitute
    the delayed REST or another venue's baseline. Sizes are shares, not volume
    across the market. Unrecognized venue status codes remain unclassified.
    """
    def time(value):
        return {'kind': 'instant', 'value': datetime.fromtimestamp(value / 1000, timezone.utc).isoformat()}
    shares = {'kind': 'shares', 'scale': '1'}
    state = {'open': 'regular', 'closed': 'closed'}.get(row.get('ms'), 'unknown')
    if row.get('ms') == 'extended-hours':
        local = datetime.fromtimestamp(row['t'] / 1000, ZoneInfo('America/New_York'))
        state = 'pre' if local.hour * 60 + local.minute < 570 else 'post'
    status = row.get('venue_status')
    if status and status['t'] >= row['t']:
        if status['h'] == 'C': state = 'closed'
        elif status['h'] != 'T': state = 'unknown'
    value = {'delay_seconds': 0, 'session': {'state': state, 'basis': 'unknown' if state == 'unknown' else 'source'},
             'trade_size': {'value': row['v'], 'unit': shares}}
    book = row.get('book')
    if book:
        value['top_of_book'] = {**{key: format(Decimal(str(book[native])), 'f') for key, native in
            [('bid', 'bp'), ('ask', 'ap'), ('bid_size', 'bs'), ('ask_size', 'as')]},
            'size_unit': shares, 'time': time(book['t'])}
    if status:
        value['venue_status'] = {'code': status['h'], 'reason': str(status.get('r', '')), 'time': time(status['t'])}
    return value


def moving_request(request, window):
    if not window:
        return request
    request = copy.deepcopy(request)
    end = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    request['window'] = {'start': {'kind': 'instant', 'value': (end - timedelta(days=window['days'])).isoformat()},
                         'end': {'kind': 'instant', 'value': end.isoformat()}}
    return request
