"""Source definitions have no requested time window; opaque selector is intent."""
import hashlib
import json
from .identity import reference

MODES = ('daily_ohlc', 'daily_adjusted_close', 'latest', 'intraday_1m', 'intraday_5m', 'intraday_1h')
STREAM_MODES = ('edgx_latest', 'edgx_1m')


def definition(native, mode):
    reference(native)
    if mode in STREAM_MODES:
        if not reference(native).endswith('.US') or native.get('qualifiers', {}).get('currency') != 'USD':
            raise ValueError('unsupported_series')
        value = definition(native, 'latest' if mode == 'edgx_latest' else 'intraday_1m')
        value.update(dataset='EODHD:Cboe-EDGX:' + mode, venue='XEDX', session='all', market_data_type='realtime', timezone='UTC')
        for field in value['fields'].values():
            field['adjustment'] = {'kind': 'none', 'anchor': None}
        value['read_support'].update(updates='push', max_span_seconds=86400)
        value['source_detail']['values']['feed'] = 'us' if mode == 'edgx_latest' else 'us-candles'
        value['source_detail']['values']['read_selector'] = json.dumps({'version': 1, 'native_ref': native, 'mode': mode}, sort_keys=True, separators=(',', ':'))
        value.pop('id')
        value['id'] = 'series:eodhd:' + hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()[:32]
        return value
    if mode not in MODES:
        raise ValueError('invalid_request')
    daily, latest = mode.startswith('daily'), mode == 'latest'
    scalar = latest or mode == 'daily_adjusted_close'
    currency = native.get('qualifiers', {}).get('currency')
    # Search defines Currency as the trading currency. GBP/GBX needs a
    # separately established pounds/pence scale; no conversion is guessed.
    known_currency = bool(currency) and currency not in ('GBP', 'GBX')
    unit = {'kind': 'currency', 'code': currency, 'scale': '1'} if known_currency else {'kind': 'unknown', 'scale': '1'}
    adjustment = 'split_dividend' if mode == 'daily_adjusted_close' else 'none' if daily else 'unknown'
    field = {'unit': unit, 'adjustment': {'kind': adjustment, 'anchor': None}}
    fields = {'value': field} if scalar else {key: field for key in ('open', 'high', 'low', 'close')}
    if not scalar:
        fields['volume'] = {'unit': {'kind': 'shares', 'scale': '1'},
                            'adjustment': {'kind': 'split' if daily else 'unknown', 'anchor': None}}
    suffix = mode.removeprefix('intraday_')
    interval = {'kind': 'tick' if latest else 'day' if daily else 'hour' if suffix == '1h' else 'minute',
                'count': 5 if suffix == '5m' else 1}
    selector = json.dumps({'version': 1, 'native_ref': native, 'mode': mode}, sort_keys=True, separators=(',', ':'))
    value = {'schema_version': 1, 'subject': native, 'provider_ref': native, 'shape': 'scalar' if scalar else 'ohlc',
        'measurement': 'last_trade' if latest else 'close' if scalar else 'ohlc', 'fields': fields, 'interval': interval,
        'calendar': None, 'timezone': None if daily else 'UTC', 'session': 'unknown',
        'time_anchor': 'session_date' if daily else 'instant' if latest else 'interval_start',
        'dataset': 'EODHD:' + mode, 'market_data_type': 'eod' if daily else 'delayed' if latest else 'unknown',
        'venue': None, 'route': None, 'methodology': None,
        'source_detail': {'namespace': 'eodhd', 'values': {'numeric_basis': 'sdk_parsed_js_number', 'price_unit_basis': 'source_trading_currency' if known_currency else 'unresolved'}}}
    value['id'] = 'series:eodhd:' + hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()[:32]
    value['source_detail']['values']['read_selector'] = selector
    value['read_support'] = {'operations': ['latest' if latest else 'history'], 'window_kind': 'session_date' if daily else 'instant',
                            'max_span_seconds': (366 if daily else 7) * 86400}
    return value


def selector(value):
    decoded = json.loads(value)
    if not isinstance(decoded, dict) or set(decoded) != {'version', 'native_ref', 'mode'} or decoded['version'] != 1:
        raise ValueError('invalid_request')
    reference(decoded['native_ref'])
    if decoded['mode'] not in (*MODES, *STREAM_MODES):
        raise ValueError('invalid_request')
    return decoded['native_ref'], decoded['mode']
