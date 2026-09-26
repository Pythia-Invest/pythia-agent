"""Preserve source time and field semantics; do not invent coverage or finality."""
from datetime import datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation

MESSAGES = {
    'source_unavailable': 'EODHD data is temporarily unavailable.',
    'connection_lost': 'The EODHD stream connection was lost.',
    'no_recent_observation': 'No recent EODHD observation has arrived.',
    'backfill_unavailable': 'EODHD recent price history could not be loaded.',
    'invalid_request': 'The EODHD request is invalid.', 'invalid_window': 'An explicit bounded window is required: at most 366 days daily or seven days intraday.',
    'invalid_response': 'EODHD returned an unsupported response shape or value.', 'binding_mismatch': 'The returned catalogue metadata differs from the pinned source intent.',
    'authentication_failed': 'EODHD rejected the credential.', 'access_denied': 'EODHD denied access to this endpoint or dataset.',
    'rate_limit': 'EODHD rate limit reached; no automatic retry was made.', 'timeout': 'The EODHD operation reached its deadline.',
    'network_error': 'The EODHD connection failed.', 'provider_error': 'The EODHD endpoint failed.',
    'unavailable': 'The EODHD connector or its managed worker is unavailable.',
    'needs_configuration': 'EODHD needs an API token: add eodhd_api_token to secrets.json in the Pythia config folder.', 'cancelled': 'The EODHD request was cancelled.',
    'output_limit': 'The EODHD response exceeds the supported size; select a smaller catalogue scope.',
    'requirements_unmet': 'The source cannot establish the requested freshness, complete coverage or completed bars.',
    'truncated': 'The bounded result omits observations beyond the requested limit.', 'invalid_value': 'A missing or invalid source observation was omitted.',
    'pagination_interrupted': 'A later mapping page failed; retained records do not establish exhaustive coverage.',
    'pagination_changed': 'Mapping pagination metadata changed or did not match the request.',
    'pagination_repeated': 'A complete mapping page repeated; enumeration stopped.',
    'pagination_incomplete': 'The mapping response did not establish progress or exhaustion.',
    'pagination_limit': 'The mapping page bound was reached before exhaustion.',
    'identifier_conflict': 'A returned mapping identifier differs from the requested identifier.',
    'not_entitled': 'The connected EODHD plan does not include this dataset. Other EODHD data is unaffected; this is not missing data.',
    'identity_unresolved': 'Exact common-stock catalogue metadata could not be resolved uniquely.',
    'price_unit_unknown': 'The source does not establish a qualified price currency scale for this catalogue item.',
}


def issue(code, severity='error', source_code=None):
    code = code if code in MESSAGES else 'invalid_response'
    result = {'code': code, 'message': MESSAGES[code], 'severity': severity}
    if source_code is not None:
        result['source_code'] = str(source_code)
    return result


def now():
    return datetime.now(timezone.utc).isoformat()


def envelope(data, issues=()):
    return {'schema_version': 1, 'outcome': ('partial' if issues else 'ok') if data else ('error' if issues else 'empty'), 'data': data, 'issues': list(issues)}


def base(request, issues=()):
    return {'schema_version': 1, 'outcome': 'error', 'request': request, 'series': None, 'observations': [],
        'selection': {'view': request['view'], 'reason': 'unavailable', 'preference_revision': None, 'alternatives': []},
        'provenance': None, 'retrieved_at': now(), 'returned_window': {'start': None, 'end': None},
        'coverage': {'status': 'unknown', 'gaps': [], 'truncated': False, 'continuation': None},
        'freshness': {'status': 'unknown', 'as_of': None, 'basis': 'unknown', 'market_data_type': 'unknown'},
        'requirements_satisfied': False, 'issues': list(issues)}


def instant(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('invalid_window')
    return result


def window(request, mode):
    if mode == 'latest':
        if any(edge and edge['kind'] != 'instant' for edge in request['window'].values()):
            raise ValueError('invalid_window')
        return {}
    daily = mode.startswith('daily')
    edges = request['window']
    kind = 'session_date' if daily else 'instant'
    if any(not edge or edge['kind'] != kind for edge in edges.values()):
        raise ValueError('invalid_window')
    start, end = edges['start']['value'], edges['end']['value']
    if daily:
        span = (datetime.fromisoformat(end) - datetime.fromisoformat(start)).total_seconds()
    else:
        start, end = int(instant(start).timestamp()), int(instant(end).timestamp())
        span = end - start
    if span < 0 or span > (366 if daily else 7) * 86400:
        raise ValueError('invalid_window')
    return {'from': start, 'to': end, **({'interval': mode.removeprefix('intraday_')} if not daily else {})}


def read(request, series, mode, raw):
    issues = [issue(code, source_code=raw.get('http_status')) for code in raw.get('issues', [])]
    result = base(request, issues)
    result['series'] = series
    result['selection']['reason'] = 'pinned' if request['view']['kind'] == 'source' else 'preference'
    result['provenance'] = {'provider': 'eodhd', 'native_ref': series['provider_ref'], 'adapter_version': '1',
        'retrieved_at': result['retrieved_at'], 'source_time': None, 'revision_vintage': None, 'mapping_revision': None,
        'source_detail': {'namespace': 'eodhd', 'values': {'numeric_basis': 'sdk_parsed_js_number',
            'retry_after_seconds': str(raw['retry_after']) if raw.get('retry_after') is not None else None}}}
    rows = raw.get('data') or []
    if mode == 'latest' and rows:
        changes = {target: format(Decimal(str(rows[0][source])), 'f') for source, target in (('change', 'absolute'), ('change_p', 'percent'))
                   if type(rows[0].get(source)) in (int, float) and Decimal(str(rows[0][source])).is_finite()}
        if changes:
            result['price_context'] = {'change': {**changes, 'baseline': {'kind': 'previous_close', 'time': {'kind': 'unknown'}}}}
    observations = []
    for row in rows:
        try:
            if mode.startswith('daily'):
                value = row['date']
                if datetime.fromisoformat(value).date().isoformat() != value:
                    raise ValueError()
                time = {'kind': 'session_date', 'value': value}
            else:
                stamp = row['timestamp']
                if mode == 'latest' and (type(stamp) is not int or stamp < 0 or row.get('gmtoffset') != 0):
                    time = {'kind': 'unknown'}
                else:
                    if type(stamp) is not int or stamp < 0 or row['gmtoffset'] != 0:
                        raise ValueError()
                    point = datetime.fromtimestamp(stamp, timezone.utc)
                    if mode != 'latest' and instant(row['datetime'].replace(' ', 'T') + 'Z') != point:
                        raise ValueError()
                    time = {'kind': 'instant', 'value': point.isoformat()}
            def comparable(item):
                return instant(item['value']) if item['kind'] == 'instant' else item.get('value', '')
            if any(edge and (time['kind'] != edge['kind'] or (comparable(time) < comparable(edge) if key == 'start' else comparable(time) > comparable(edge))) for key, edge in request['window'].items()):
                continue
            keys = ['close'] if mode == 'latest' else ['adjusted_close'] if mode == 'daily_adjusted_close' else ['open', 'high', 'low', 'close']
            values = {key: row.get(key) for key in keys}
            if any(not isinstance(v, str) or not Decimal(v).is_finite() or Decimal(v) < 0 for v in values.values()):
                raise ValueError()
            if len(keys) > 1 and (Decimal(values['low']) > min(Decimal(values['open']), Decimal(values['close'])) or Decimal(values['high']) < max(Decimal(values['open']), Decimal(values['close'])) or Decimal(values['low']) > Decimal(values['high'])):
                raise ValueError()
            observation = {'shape': series['shape'], 'time': time, 'interval': None, 'completion': {'state': 'unknown', 'basis': 'unknown'}}
            if series['shape'] == 'scalar':
                observation['value'] = values[keys[0]]
            else:
                observation.update(values)
                if row.get('volume') is not None:
                    if not isinstance(row['volume'], str) or not Decimal(row['volume']).is_finite() or Decimal(row['volume']) < 0:
                        raise ValueError()
                    observation['volume'] = row['volume']
                if mode.startswith('intraday'):
                    seconds = 3600 if mode.endswith('1h') else 300 if mode.endswith('5m') else 60
                    observation['interval'] = {'start': time, 'end': {'kind': 'instant', 'value': (point + timedelta(seconds=seconds)).isoformat()}}
            observations.append(observation)
        except (ValueError, TypeError, KeyError, InvalidOperation, OverflowError, OSError):
            issues.append(issue('invalid_value', 'warning'))
    observations.sort(key=lambda row: comparable(row['time']))
    unique = {}
    for observation in observations:
        key = observation['time'].get('value', 'unknown')
        if key in unique and unique[key] != observation:
            issues.append(issue('invalid_value'))
            unique[key] = None
        elif key not in unique:
            unique[key] = observation
    observations = [item for item in unique.values() if item is not None]
    if len(observations) > request['limit']:
        observations = observations[-request['limit']:]
        result['coverage']['truncated'] = True
        issues.append(issue('truncated', 'warning'))
    if series['fields']['value' if series['shape'] == 'scalar' else 'close']['unit']['kind'] == 'unknown':
        issues.append(issue('price_unit_unknown', 'warning'))
    strict = any(value != 'any' for value in request['requirements'].values())
    if strict:
        issues.append(issue('requirements_unmet'))
        if request['requirements']['completion'] == 'completed':
            observations = []
    result['observations'] = observations
    if observations and observations[0]['time']['kind'] != 'unknown':
        result['returned_window'] = {'start': observations[0]['time'], 'end': observations[-1]['time']}
        if mode == 'latest':
            result['freshness'].update({'as_of': observations[-1]['time']['value'], 'basis': 'source_time'})
            result['provenance']['source_time'] = observations[-1]['time']['value']
    result['freshness']['market_data_type'] = series['market_data_type']
    result['issues'] = issues
    result['coverage']['status'] = 'partial' if issues else 'unknown'
    result['outcome'] = ('partial' if issues else 'ok') if observations else ('error' if issues else 'empty')
    requirements = request['requirements']
    result['requirements_satisfied'] = (result['outcome'] != 'error'
        and (requirements['freshness'] == 'any' or result['freshness']['status'] == 'fresh')
        and (requirements['coverage'] == 'any' or result['coverage']['status'] == 'complete')
        and (requirements['completion'] == 'any' or all(item['completion']['state'] == 'completed' for item in observations)))
    return result
