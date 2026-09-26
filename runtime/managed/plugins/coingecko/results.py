"""Lossless price values, actual sample/close instants, explicit uncertainty."""
from datetime import datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation
from .series import MODES

CODES = {'invalid_request', 'invalid_response', 'unsupported_series', 'unsupported_window', 'unavailable',
         'authentication_failed', 'access_denied', 'rate_limit', 'timeout', 'network_error', 'provider_error',
         'response_limit', 'cancelled', 'requirements_unmet', 'invalid_value', 'truncated', 'granularity_mismatch'}


def issue(code, severity='error'):
    code = code if code in CODES else 'invalid_response'
    return {'code': code, 'severity': severity, 'message': 'CoinGecko ' + code.replace('_', ' ') + '; no alternate source or access mode was used.'}


def envelope(data, issues=()):
    return {'schema_version': 1, 'outcome': ('partial' if issues else 'ok') if data else ('error' if issues else 'empty'), 'data': data, 'issues': list(issues)}


def base(request, issues):
    now = datetime.now(timezone.utc).isoformat()
    return {'schema_version': 1, 'outcome': 'error', 'request': request, 'series': None, 'observations': [],
            'selection': {'view': request['view'], 'reason': 'unavailable', 'preference_revision': None, 'alternatives': []},
            'provenance': None, 'retrieved_at': now, 'returned_window': {'start': None, 'end': None},
            'coverage': {'status': 'unknown', 'gaps': [], 'truncated': False, 'continuation': None},
            'freshness': {'status': 'unknown', 'as_of': None, 'basis': 'unknown', 'market_data_type': 'unknown'},
            'requirements_satisfied': False, 'issues': list(issues)}


def decimal(value):
    if type(value) not in (str, int, Decimal):
        raise ValueError()
    value = Decimal(value)
    if not value.is_finite() or value < 0 or len(str(value)) > 128 or abs(value.adjusted()) > 128:
        raise ValueError()
    return format(value, 'f')


def instant(stamp, divisor=1000):
    if type(stamp) is not int or stamp < 0:
        raise ValueError()
    return {'kind': 'instant', 'value': (datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(milliseconds=stamp) if divisor == 1000 else datetime.fromtimestamp(stamp, timezone.utc)).isoformat()}


def read(request, series, mode, raw):
    if raw.get('error'):
        result = base(request, [issue(raw['error'])])
        if raw.get('provider_code', raw.get('http_status')) is not None:
            result['issues'][0]['source_code'] = str(raw.get('provider_code', raw.get('http_status')))
        if raw.get('retry_after') is not None:
            result['issues'][0]['message'] += ' Retry after ' + str(raw['retry_after']) + ' seconds.'
            result['issues'][0]['retry_after_seconds'] = raw['retry_after']
        return result
    result = base(request, [])
    result['series'] = series
    result['selection']['reason'] = 'pinned'
    result['provenance'] = {'provider': 'coingecko', 'native_ref': series['provider_ref'], 'adapter_version': '1',
                            'retrieved_at': result['retrieved_at'], 'source_time': None, 'revision_vintage': None,
                            'mapping_revision': None, 'source_detail': {'namespace': 'coingecko', 'values': {'price_basis': 'source_aggregate'}}}
    data = raw['data']
    if mode == 'latest':
        item = data.get(series['provider_ref']['native_id'], {}) if type(data) is dict else None
        if type(item) is not dict:
            raise ValueError('invalid_response')
        rows = [[item.get('last_updated_at'), item.get(series['fields']['value']['unit']['code'].lower())]] if item else []
        result['price_context'] = {'session': {'state': 'continuous', 'basis': 'source'}}
        change = item.get(series['fields']['value']['unit']['code'].lower() + '_24h_change')
        if type(change) in (str, int, Decimal) and Decimal(change).is_finite():
            stamp = item.get('last_updated_at')
            baseline = instant(stamp - 86400, 1) if type(stamp) is int and stamp >= 86400 else {'kind': 'unknown'}
            result['price_context']['change'] = {'percent': format(Decimal(change), 'f'),
                'baseline': {'kind': 'rolling', 'duration_seconds': 86400, 'time': baseline}}
    elif mode.startswith('sample'):
        if type(data) is not dict or type(data.get('prices')) is not list:
            raise ValueError('invalid_response')
        rows = data['prices']
    else:
        rows = data
    if type(rows) is not list or len(rows) > 10000:
        raise ValueError('response_limit')
    observations, issues = [], []
    seconds = MODES[mode][1] * {'tick': 0, 'minute': 60, 'hour': 3600, 'day': 86400}[MODES[mode][0]]
    for row in rows:
        try:
            if type(row) is not list or len(row) != (2 if series['shape'] == 'scalar' else 5):
                raise ValueError()
            try:
                time = instant(row[0], 1 if mode == 'latest' else 1000)
            except (ValueError, OverflowError, OSError):
                if mode != 'latest':
                    raise
                time = {'kind': 'unknown'}
            point = datetime.fromisoformat(time['value']) if time['kind'] == 'instant' else None
            if point and any(edge and (point < datetime.fromisoformat(edge['value'].replace('Z', '+00:00')) if name == 'start' else point > datetime.fromisoformat(edge['value'].replace('Z', '+00:00'))) for name, edge in request['window'].items()):
                continue
            observation = {'shape': series['shape'], 'time': time, 'interval': None, 'completion': {'state': 'unknown', 'basis': 'unknown'}}
            values = [decimal(v) for v in row[1:]]
            if series['shape'] == 'scalar':
                observation['value'] = values[0]
            else:
                observation.update(zip(('open', 'high', 'low', 'close'), values))
                low, high = Decimal(observation['low']), Decimal(observation['high'])
                if low > min(Decimal(observation['open']), Decimal(observation['close'])) or high < max(Decimal(observation['open']), Decimal(observation['close'])) or low > high:
                    raise ValueError()
                observation['interval'] = {'start': {'kind': 'instant', 'value': (point - timedelta(seconds=seconds)).isoformat()}, 'end': time}
            observations.append(observation)
        except (ValueError, TypeError, InvalidOperation, OverflowError, OSError):
            issues.append(issue('invalid_value', 'warning'))
    observations.sort(key=lambda o: o['time'].get('value', ''))
    known = [datetime.fromisoformat(o['time']['value']) for o in observations if o['time']['kind'] == 'instant']
    # Interval describes the requested source sampling method. Irregular/newest
    # samples and gaps do not independently prove a different method or coverage.
    seen = {}
    for observation in observations:
        key = observation['time'].get('value', 'unknown')
        if key in seen and seen[key] != observation:
            issues.append(issue('invalid_value', 'warning'))
            seen[key] = None
        elif key not in seen:
            seen[key] = observation
    observations = [o for o in seen.values() if o is not None]
    if len(observations) > request['limit']:
        observations = observations[-request['limit']:]
        result['coverage']['truncated'] = True
        issues.append(issue('truncated', 'warning'))
    strict = any(v != 'any' for v in request['requirements'].values())
    if strict:
        issues.append(issue('requirements_unmet'))
        if request['requirements']['completion'] == 'completed':
            observations = []
    result['observations'] = observations
    known = [o['time'] for o in observations if o['time']['kind'] == 'instant']
    if known:
        result['returned_window'] = {'start': known[0], 'end': known[-1]}
        if mode == 'latest':
            result['provenance']['source_time'] = known[-1]['value']
            result['freshness'].update(as_of=known[-1]['value'], basis='source_time')
    result.update(issues=issues, outcome=('partial' if issues else 'ok') if observations else ('error' if issues else 'empty'), requirements_satisfied=not strict)
    result['requirements_satisfied'] = not strict and result['outcome'] != 'error'
    result['coverage']['status'] = 'partial' if issues else 'unknown'
    return result
