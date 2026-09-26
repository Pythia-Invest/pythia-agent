"""Common reads preserve decimals, session dates, bounds and unknown finality."""
from datetime import datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation


def now():
    return datetime.now(timezone.utc).isoformat()


def issue(code, severity='error'):
    messages = {'invalid_request': 'The Yahoo request or native options are invalid.', 'invalid_window': 'Use an explicit bounded window: up to seven days intraday or ten years daily.',
        'binding_mismatch': 'Yahoo returned a different symbol or metadata from the pinned source.', 'source_unavailable': 'Yahoo public data is unavailable for this operation; endpoint access and coverage may change.',
        'unavailable': 'Enable the Yahoo plugin/toolset and prepare its managed worker.', 'rate_limit': 'Yahoo rate limited this read; retry later.', 'timeout': 'Yahoo read timed out.',
        'output_limit': 'Yahoo result exceeded the bound; request fewer symbols/modules or a shorter window.', 'cancelled': 'Yahoo read cancelled.', 'invalid_response': 'Yahoo returned an invalid result.',
        'requirements_unmet': 'The source cannot prove requested freshness, complete coverage or bar completion.', 'truncated': 'The result exceeds the observation limit.',
        'invalid_value': 'Invalid or duplicate source observations were omitted.', 'units_unknown': 'Price units remain unqualified; native currency metadata is available separately.'}
    code = code if code in messages else 'source_unavailable'
    return {'code': code, 'message': messages[code], 'severity': severity}


def envelope(data, issues=()):
    return {'schema_version': 1, 'outcome': ('partial' if issues else 'ok') if data else ('error' if issues else 'empty'), 'data': data, 'issues': list(issues)}


def base(request, issues=()):
    return {'schema_version': 1, 'outcome': 'error', 'request': request, 'series': None, 'observations': [],
        'selection': {'view': request['view'], 'reason': 'unavailable', 'preference_revision': None, 'alternatives': []}, 'provenance': None,
        'retrieved_at': now(), 'returned_window': {'start': None, 'end': None}, 'coverage': {'status': 'unknown', 'gaps': [], 'truncated': False, 'continuation': None},
        'freshness': {'status': 'unknown', 'as_of': None, 'basis': 'unknown', 'market_data_type': 'unknown'}, 'requirements_satisfied': False, 'issues': list(issues)}


def instant(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('invalid_window')
    return result


def window(request, mode):
    daily = mode in ('daily', 'adjusted')
    kind = 'session_date' if daily else 'instant'
    edges = request['window']
    if any(edge and edge['kind'] != kind for edge in edges.values()):
        raise ValueError('invalid_window')
    if mode == 'latest':
        return {}
    if any(not edge for edge in edges.values()):
        raise ValueError('invalid_window')
    start, end = (edges[k]['value'] for k in ('start', 'end'))
    span = ((datetime.fromisoformat(end) - datetime.fromisoformat(start)) if daily else (instant(end) - instant(start))).total_seconds()
    if span < 0 or span > (3660 if daily else 7) * 86400:
        raise ValueError('invalid_window')
    return {'start': start, 'end': end}


def read(request, series, mode, raw):
    issues = [issue(code) for code in raw.get('issues', [])]
    result = base(request, issues)
    result['series'] = series
    result['selection']['reason'] = 'pinned' if request['view']['kind'] == 'source' else 'preference'
    result['provenance'] = {'provider': 'yahoo', 'native_ref': series['provider_ref'], 'adapter_version': '1', 'retrieved_at': result['retrieved_at'], 'source_time': None,
        'revision_vintage': None, 'mapping_revision': None, 'source_detail': {'namespace': 'yahoo', 'values': {'adapter': 'yahoo-finance2:4.0.2'}}}
    observations, seen = [], set()
    daily = mode in ('daily', 'adjusted')
    for row in (raw.get('data') or {}).get('rows', []):
        try:
            value = row['time']
            point = datetime.fromisoformat(value).date().isoformat() if daily else instant(value)
            if daily and point != value:
                raise ValueError()
            time = {'kind': 'session_date' if daily else 'instant', 'value': value}
            if any(edge and (point < (edge['value'] if daily else instant(edge['value'])) if key == 'start' else point > (edge['value'] if daily else instant(edge['value']))) for key, edge in request['window'].items()):
                continue
            if point in seen:
                observations = [o for o in observations if o['time'] != time]
                raise ValueError()
            seen.add(point)
            fields = ['value'] if series['shape'] == 'scalar' else ['open', 'high', 'low', 'close']
            values = {}
            # Yahoo uses all-null OHLC rows as placeholders, not observations.
            # Leave the gap unfilled and coverage unknown.
            if all(row.get(field) is None for field in fields):
                continue
            for field in fields:
                v = row.get(field)
                if type(v) not in (int, float) or not Decimal(str(v)).is_finite() or v < 0:
                    raise ValueError()
                values[field] = format(Decimal(str(v)), 'f')
            volume = row.get('volume')
            # Volume is optional evidence; an absent or invalid count stays absent.
            if len(fields) > 1 and type(volume) in (int, float) and Decimal(str(volume)).is_finite() and volume >= 0:
                values['volume'] = format(Decimal(str(volume)), 'f')
            if len(fields) > 1 and (float(values['low']) > min(float(values['open']), float(values['close'])) or float(values['high']) < max(float(values['open']), float(values['close']))):
                raise ValueError()
            interval = None if daily or mode == 'latest' else {'start': time, 'end': {'kind': 'instant', 'value': (point + timedelta(seconds={'minute': 60, 'five_minute': 300, 'five_minute_extended': 300, 'hour': 3600}[mode])).isoformat()}}
            observations.append({'shape': series['shape'], 'time': time, 'interval': interval, 'completion': {'state': 'unknown', 'basis': 'unknown'}, **values})
        except (ValueError, TypeError, KeyError, InvalidOperation, OverflowError):
            if not any(i['code'] == 'invalid_value' for i in issues): issues.append(issue('invalid_value'))
    observations.sort(key=lambda o: o['time']['value'])
    if len(observations) > request['limit']:
        observations = observations[-request['limit']:]
        result['coverage']['truncated'] = True
        issues.append(issue('truncated', 'warning'))
    if any(v != 'any' for v in request['requirements'].values()):
        issues.append(issue('requirements_unmet'))
        if request['requirements']['completion'] == 'completed': observations = []
    if next(iter(series['fields'].values()))['unit']['kind'] == 'unknown': issues.append(issue('units_unknown', 'warning'))
    result['observations'] = observations
    if observations:
        result['returned_window'] = {'start': observations[0]['time'], 'end': observations[-1]['time']}
        if mode == 'latest':
            result['freshness'].update({'as_of': observations[-1]['time']['value'], 'basis': 'source_time'})
            result['provenance']['source_time'] = observations[-1]['time']['value']
    if mode == 'latest' and observations:
        data = raw.get('data') or {}
        metadata = data.get('metadata') or {}
        context = {key: metadata[key] for key in ('symbol', 'name') if isinstance(metadata.get(key), str) and metadata[key]}
        delay = metadata.get('delay')
        if type(delay) in (int, float) and 0 <= delay <= 10080 and float(delay * 60).is_integer():
            context['delay_seconds'] = int(delay * 60)
        changes = {key: format(Decimal(str(value)), 'f') for key, value in (data.get('change') or {}).items()
                   if key in ('absolute', 'percent') and type(value) in (int, float) and Decimal(str(value)).is_finite()}
        if changes: context['change'] = {**changes, 'baseline': {'kind': 'previous_close', 'time': {'kind': 'unknown'}}}
        close = data.get('previous_close')
        if type(close) in (int, float) and Decimal(str(close)).is_finite() and close > 0:
            context['reference_close'] = {'value': format(Decimal(str(close)), 'f'), 'unit': next(iter(series['fields'].values()))['unit'],
                'time': {'kind': 'unknown'}, 'provider_ref': series['provider_ref'], 'dataset': 'Yahoo:quote:regularMarketPreviousClose',
                'retrieved_at': data.get('retrieved_at') or result['retrieved_at']}
        # The shared latest series measures the regular quote. Extended trading
        # is not implied for cash indices, nor is it this series' observation.
        state = metadata.get('market_state')
        if state in ('REGULAR', 'CLOSED', 'PRE', 'PREPRE', 'POST', 'POSTPOST'):
            context['session'] = {'state': 'regular' if state == 'REGULAR' else 'closed', 'basis': 'source'}
        result['price_context'] = context
    # Intraday history carries the schedule of the current or last session.
    session = (raw.get('data') or {}).get('session')
    if mode not in ('latest', 'daily', 'adjusted') and observations and isinstance(session, dict):
        result['price_context'] = {'session_window': session}
    result['issues'] = issues
    result['outcome'] = ('partial' if issues else 'ok') if observations else ('error' if any(i['severity'] == 'error' for i in issues) else 'empty')
    result['requirements_satisfied'] = result['outcome'] != 'error' and all(v == 'any' for v in request['requirements'].values())
    return result
