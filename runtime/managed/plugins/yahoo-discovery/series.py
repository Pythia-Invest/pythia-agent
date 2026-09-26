"""Stable Yahoo source semantics, independently selectable from other feeds."""
import hashlib
import json
from .identity import reference

MODES = ('latest', 'daily', 'adjusted', 'minute', 'five_minute', 'five_minute_extended', 'hour')


def definition(native, mode, metadata):
    reference(native)
    if mode not in MODES:
        raise ValueError('invalid_request')
    scalar, daily = mode in ('latest', 'adjusted'), mode in ('daily', 'adjusted')
    # Do not mistake index points for currency or infer pence scaling from GBP.
    currency = native.get('qualifiers', {}).get('currency')
    known = metadata.get('type') in ('EQUITY', 'ETF', 'MUTUALFUND', 'CRYPTOCURRENCY') and currency and currency != 'GBP'
    unit = {'kind': 'currency', 'code': currency, 'scale': '1'} if known else {'kind': 'unknown', 'scale': '1'}
    field = {'unit': unit, 'adjustment': {'kind': 'split_dividend' if mode == 'adjusted' else 'unknown', 'anchor': None}}
    fields = {'value': field} if scalar else {key: field for key in ('open', 'high', 'low', 'close')}
    value = {'schema_version': 1, 'subject': native, 'provider_ref': native,
        'measurement': 'aggregate_price' if mode == 'latest' else 'close' if scalar else 'ohlc', 'shape': 'scalar' if scalar else 'ohlc',
        'fields': fields, 'interval': {'kind': 'tick' if mode == 'latest' else 'day' if daily else 'hour' if mode == 'hour' else 'minute', 'count': 5 if mode.startswith('five_minute') else 1},
        'calendar': None, 'timezone': None if daily else 'UTC', 'session': 'extended' if mode == 'five_minute_extended' else 'regular', 'time_anchor': 'session_date' if daily else 'instant' if mode == 'latest' else 'interval_start',
        'dataset': 'Yahoo:' + mode, 'market_data_type': 'unknown', 'venue': native.get('qualifiers', {}).get('venue'), 'route': None, 'methodology': None,
        'source_detail': {'namespace': 'yahoo', 'values': {'numeric_basis': 'sdk_parsed_js_number', 'quote_type': str(metadata.get('type') or 'unknown'), 'units': 'native currency' if known else 'unqualified; inspect native metadata', 'adapter': 'yahoo-finance2:4.0.2'}}}
    semantics = {k: v for k, v in value.items() if k != 'source_detail'}
    semantics['quote_type'] = metadata.get('type')
    value['id'] = 'series:yahoo:' + hashlib.sha256(json.dumps(semantics, sort_keys=True, separators=(',', ':')).encode()).hexdigest()[:32]
    value['source_detail']['values']['read_selector'] = json.dumps({'version': 1, 'native_ref': native, 'mode': mode}, sort_keys=True, separators=(',', ':'))
    value['read_support'] = {'operations': ['latest' if mode == 'latest' else 'history'], 'window_kind': 'session_date' if daily else 'instant',
                            'max_span_seconds': (3660 if daily else 7) * 86400}
    return value


def selector(value):
    decoded = json.loads(value)
    if not isinstance(decoded, dict) or set(decoded) != {'version', 'native_ref', 'mode'} or decoded['version'] != 1 or decoded['mode'] not in MODES:
        raise ValueError('invalid_request')
    reference(decoded['native_ref'])
    return decoded['native_ref'], decoded['mode']
