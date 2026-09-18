"""Shared safe failure vocabulary for connectors and specialist batch items."""
from . import diagnostics

MESSAGES = {
    'busy': 'Data requests are busy. Retrying shortly.',
    'rate_limit': 'The data connection is rate limited. Retrying after its cooldown.',
    'timeout': 'The data request timed out.',
    'cancelled': 'The data request was cancelled.',
    'network_error': 'The data connection could not be reached.',
    'authentication_failed': 'The data connection needs authentication.',
    'access_denied': 'This data is not available with the current connection.',
    'unavailable': 'The data connection is unavailable.',
    'invalid_response': 'The provider returned data that could not be read.',
    'invalid_request': 'The data request is not supported.',
    'unsupported_window': 'This history window is not supported.',
    'output_limit': 'The data response exceeded the supported size.',
    'missing_observation': 'The provider did not return an observation.',
    'source_unavailable': 'The provider could not supply the requested data.',
}


def detail(error, *, request=None):
    raw = getattr(error, 'raw', {})
    status = getattr(error, 'code', None)
    code = raw.get('error') or next(iter(raw.get('issues') or []), None)
    if isinstance(code, dict): code = code.get('code')
    if not code:
        code = 'rate_limit' if status == 429 else 'authentication_failed' if status == 401 else 'access_denied' if status == 403 else None
    if not code:
        code = 'timeout' if isinstance(error, TimeoutError) else str(error)
    if code not in MESSAGES: code = 'source_unavailable'
    value = {'code': code, 'message': MESSAGES[code], 'diagnostic_id': request or raw.get('diagnostic_id') or diagnostics.identifier()}
    origin = raw.get('limit_origin')
    if origin in ('connector', 'provider'): value['origin'] = origin
    retry = raw.get('retry_after', raw.get('retry_after_seconds'))
    if type(retry) in (int, float) and 0 <= retry <= 86400: value['retry_after_seconds'] = retry
    diagnostics.emit('read_failed', level='warning', request_id=value['diagnostic_id'], code=code, origin=origin)
    return value


def failed_item(identifier, error, **empty):
    failure = detail(error)
    return {**empty, 'symbol': identifier, 'error': failure['message'], 'failure': failure}


def worker_failure(error):
    """Safe per-item envelope for a failed native batch transport."""
    failure = detail(error)
    return {'error': failure['code'], 'issues': [failure['code']], 'data': None,
            'diagnostic_id': failure['diagnostic_id'],
            **({'retry_after': failure['retry_after_seconds']} if 'retry_after_seconds' in failure else {}),
            **({'limit_origin': failure['origin']} if 'origin' in failure else {})}


def item_failures(value):
    """Only recognized result containers; do not recursively inspect provider data."""
    if not isinstance(value, dict): return []
    rows = [row for key in ('charts', 'quotes', 'metrics') if isinstance(value.get(key), list)
            for row in value[key] if isinstance(row, dict)]
    return [row.get('failure') or {'code': 'source_unavailable'} for row in rows if row.get('error') or row.get('failure')]


def cacheable(value):
    return isinstance(value, dict) and not value.get('error') and not value.get('issues') and not item_failures(value.get('data'))


def failure_code(value):
    code = value.get('error') or next(iter(value.get('issues') or item_failures(value.get('data'))), None)
    return code.get('code') if isinstance(code, dict) else code


def qualify_items(result):
    """Specialist display batches retain successes and expose each failure."""
    failures = item_failures(result.get('data'))
    if failures:
        result['outcome'] = 'partial'
        result['issues'] = [*result.get('issues', []), *[
            {'code': failure['code'], 'message': failure.get('message', MESSAGES['source_unavailable']),
             'severity': 'error',
             **({'retry_after_seconds': failure['retry_after_seconds']} if 'retry_after_seconds' in failure else {}),
             **({'limit_origin': failure['origin']} if 'origin' in failure else {})} for failure in failures]]
    return result
