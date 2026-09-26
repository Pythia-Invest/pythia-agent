"""Aggregate price series, currency pins and shared read-result envelopes."""
import hashlib
import json
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from .identity import PROVIDER, reference

MODES = {'latest': ('tick', 1), 'sample_15m': ('minute', 15), 'sample_hourly': ('hour', 1), 'sample_daily': ('day', 1)}
INTERVALS = {'sample_15m': '15m', 'sample_hourly': 'hourly', 'sample_daily': 'daily'}
CODES = {'unavailable', 'invalid_request', 'invalid_response', 'access_denied', 'authentication_failed', 'unsupported_series',
         'unsupported_window', 'rate_limit', 'timeout', 'network_error', 'provider_error', 'response_limit', 'cancelled',
         'requirements_unmet', 'busy'}


def now():
    return datetime.now(timezone.utc).isoformat()


def issue(code):
    code = code if code in CODES else 'invalid_response'
    return {'code': code, 'severity': 'error', 'message': 'CoinMarketCap ' + code.replace('_', ' ') + '.'}


def envelope(data, issues=()):
    return {'schema_version': 1, 'outcome': ('partial' if issues else 'ok') if data is not None else ('error' if issues else 'empty'),
            'data': data, 'issues': list(issues)}


def timestamp(value):
    try:
        if type(value) is str:
            time = datetime.fromisoformat(value.replace('Z', '+00:00'))
            if time.tzinfo:
                return time.timestamp()
    except (ValueError, TypeError, OverflowError):
        pass
    return None


def currency_quote(row, currency):
    """v3 quotes carry a list of {symbol, ...}; v2/history carry a currency-keyed map."""
    quotes = row.get('quote')
    if isinstance(quotes, dict):
        return quotes.get(currency, {})
    if isinstance(quotes, list):
        matches = [q for q in quotes if isinstance(q, dict) and q.get('symbol') == currency]
        if len(matches) == 1:
            return matches[0]
    raise ValueError('invalid_response')


def coins(data, ids):
    """Bind rows to exactly the requested numeric IDs, list or ID-keyed layout."""
    if isinstance(data, dict):
        rows = [data] if 'id' in data else list(data.values())
    else:
        rows = data
    if not isinstance(rows, list) or len(rows) > len(ids):
        raise ValueError('invalid_response')
    found = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError('invalid_response')
        identifier = str(row.get('id'))
        if identifier not in ids or identifier in found:
            raise ValueError('invalid_response')
        found[identifier] = row
    return found


def samples(row, currency):
    rows = row.get('quotes')
    if not isinstance(rows, list) or len(rows) > 2000:
        raise ValueError('invalid_response')
    result = {}
    for sample in rows:
        quote = currency_quote(sample, currency)
        # The interval-search timestamp is not necessarily the observation time.
        stamp = timestamp(quote.get('timestamp') or quote.get('last_updated'))
        if stamp is None:
            raise ValueError('invalid_response')
        try:
            value = Decimal(str(quote['price']))
            if not value.is_finite() or value <= 0 or abs(value.adjusted()) > 128:
                raise ValueError('invalid_response')
        except (KeyError, InvalidOperation):
            raise ValueError('invalid_response') from None
        if stamp in result and result[stamp] != value:
            raise ValueError('invalid_response')
        result[stamp] = value
    return sorted(result.items())


def definition(native, mode, currency):
    reference(native)
    if mode not in MODES:
        raise ValueError('unsupported_series')
    kind, count = MODES[mode]
    value = {'schema_version': 1, 'subject': native, 'provider_ref': native, 'measurement': 'aggregate_price', 'shape': 'scalar',
             'fields': {'value': {'unit': {'kind': 'currency', 'code': currency, 'scale': '1'}, 'adjustment': {'kind': 'unknown', 'anchor': None}}},
             'interval': {'kind': kind, 'count': count}, 'calendar': None, 'timezone': 'UTC', 'session': 'all', 'time_anchor': 'instant',
             'dataset': 'CoinMarketCap:' + mode, 'market_data_type': 'unknown', 'venue': None, 'route': None,
             'methodology': {'id': 'coinmarketcap:aggregate', 'version': 'unreported'},
             'source_detail': {'namespace': PROVIDER, 'values': {'price_basis': 'source_aggregate'}}}
    value['id'] = 'series:coinmarketcap:' + hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()[:32]
    value['read_support'] = {'operations': ['latest' if mode == 'latest' else 'history'], 'window_kind': 'instant',
                             'max_span_seconds': (90 if mode == 'sample_daily' else 7) * 86400}
    value['source_detail']['values']['read_selector'] = json.dumps(
        {'version': 1, 'native_ref': native, 'mode': mode, 'currency': currency}, separators=(',', ':'))
    return value


def selector(raw, currencies):
    value = json.loads(raw)
    if type(value) is not dict or set(value) != {'version', 'native_ref', 'mode', 'currency'} or value['version'] != 1:
        raise ValueError('unsupported_series')
    if value['currency'] not in currencies:
        raise ValueError('unsupported_series')
    definition(value['native_ref'], value['mode'], value['currency'])
    return value['native_ref'], value['mode'], value['currency']


def read_result(request, series=None, observations=(), issues=()):
    strict = any(v != 'any' for v in request['requirements'].values())
    problems = [*issues, *([issue('requirements_unmet')] if strict else [])]
    values = list(observations) if request['requirements']['completion'] != 'completed' else []
    truncated = len(values) > request['limit']
    values = values[-request['limit']:]
    known = [o['time'] for o in values if o['time']['kind'] == 'instant']
    stamp = now()
    return {'schema_version': 1, 'outcome': ('partial' if problems else 'ok') if values else ('error' if problems else 'empty'),
            'request': request, 'series': series, 'observations': values,
            'selection': {'view': request['view'], 'reason': 'pinned' if series else 'unavailable', 'preference_revision': None, 'alternatives': []},
            'provenance': {'provider': PROVIDER, 'native_ref': series['provider_ref'], 'adapter_version': '1', 'retrieved_at': stamp,
                           'source_time': known[-1]['value'] if known else None, 'revision_vintage': None, 'mapping_revision': None,
                           'source_detail': None} if series else None,
            'retrieved_at': stamp, 'returned_window': {'start': known[0] if known else None, 'end': known[-1] if known else None},
            'coverage': {'status': 'partial' if truncated else 'unknown', 'gaps': [], 'truncated': truncated, 'continuation': None},
            'freshness': {'status': 'unknown', 'as_of': known[-1]['value'] if known else None,
                          'basis': 'source_time' if known else 'unknown', 'market_data_type': 'unknown'},
            'requirements_satisfied': not strict and not issues, 'issues': problems}
