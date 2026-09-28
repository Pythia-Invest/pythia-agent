"""Definitions precede reads: each selector fixes interval, shape and source method."""
import hashlib
import json
from datetime import datetime, timezone
from .identity import reference
from .config import CURRENCIES

MODES = {'latest': ('tick', 1), 'sample_5m': ('minute', 5), 'sample_hourly': ('hour', 1), 'sample_daily': ('day', 1),
         'ohlc_30m': ('minute', 30), 'ohlc_4h': ('hour', 4), 'ohlc_4d': ('day', 4),
         'ohlc_hourly': ('hour', 1), 'ohlc_daily': ('day', 1)}
# Fixed lookbacks in days. market_chart returns ~5-minute samples for one day.
ROLLING = {'sample_5m': 1, 'ohlc_30m': 1, 'ohlc_4h': 7, 'ohlc_4d': 90}


def modes(access):
    return list(MODES) if access == 'paid' else [m for m in MODES if m not in ('ohlc_hourly', 'ohlc_daily')]


# Daily samples page through market_chart/range in 90-day requests: the demo
# and keyless plans serve the past 365 days, paid plans the full history.
DAILY_DAYS = {'paid': 36600}
FREE_DAYS = 365
CHUNK_DAYS = 90


def span_days(mode, access):
    if mode == 'sample_daily':
        # One extra day admits a date-to-date year; its start is clipped.
        return DAILY_DAYS.get(access, FREE_DAYS + 1)
    return 31 if mode == 'ohlc_hourly' else ROLLING.get(mode, 90)


def definition(native, mode, currency, access='demo'):
    reference(native)
    if currency not in CURRENCIES:
        raise ValueError("unsupported_series")
    kind, count = MODES[mode]
    scalar = not mode.startswith('ohlc')
    field = {'unit': {'kind': 'currency', 'code': currency, 'scale': '1'}, 'adjustment': {'kind': 'unknown', 'anchor': None}}
    value = {'schema_version': 1, 'subject': native, 'provider_ref': native, 'measurement': 'aggregate_price' if scalar else 'ohlc',
             'shape': 'scalar' if scalar else 'ohlc', 'fields': {'value': field} if scalar else {k: field for k in ('open', 'high', 'low', 'close')},
             'interval': {'kind': kind, 'count': count}, 'calendar': None, 'timezone': 'UTC', 'session': 'all',
             'time_anchor': 'instant' if scalar else 'interval_end', 'dataset': 'CoinGecko:' + mode, 'market_data_type': 'unknown',
             'venue': None, 'route': None, 'methodology': {'id': 'coingecko:aggregate', 'version': 'unreported'},
             'source_detail': {'namespace': 'coingecko', 'values': {'price_basis': 'source_aggregate', 'volume': 'not_candle_volume'}}}
    value['id'] = 'series:coingecko:' + hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()[:32]
    value['source_detail']['values']['read_selector'] = json.dumps({'version': 1, 'native_ref': native, 'mode': mode, 'currency': currency}, sort_keys=True, separators=(',', ':'))
    value['read_support'] = {'operations': ['latest' if mode == 'latest' else 'history'], 'window_kind': 'instant',
                            'max_span_seconds': span_days(mode, access) * 86400}
    return value


def selector(value, access):
    data = json.loads(value)
    if (type(data) is not dict or set(data) != {'version', 'native_ref', 'mode', 'currency'} or type(data['version']) is not int
            or data['version'] != 1 or data['mode'] not in modes(access) or data['currency'] not in CURRENCIES):
        raise ValueError('unsupported_series')
    reference(data['native_ref'])
    return data['native_ref'], data['mode'], data['currency']


def bounds(request, mode, clock=None, access="demo"):
    clock = clock or datetime.now(timezone.utc)
    edges = request['window']
    def parse(edge):
        if not edge or edge['kind'] != 'instant':
            raise ValueError('unsupported_window')
        value = datetime.fromisoformat(edge['value'].replace('Z', '+00:00'))
        if value.tzinfo is None:
            raise ValueError('unsupported_window')
        return value.timestamp()
    if mode == 'latest':
        if any(edge and edge['kind'] != 'instant' for edge in edges.values()):
            raise ValueError('unsupported_window')
        return 'latest', {}
    start, end = parse(edges['start']), parse(edges['end'])
    if not 0 <= end - start <= span_days(mode, access) * 86400 or end > clock.timestamp() + 86400:
        raise ValueError('unsupported_window')
    # A window ending later today reads up to now.
    end = min(end, clock.timestamp())
    if access != "paid" and start < clock.timestamp() - FREE_DAYS * 86400:
        # A request built a moment earlier may reach just past the free
        # history; keep its start within it (the read reports the clip).
        if start < clock.timestamp() - (FREE_DAYS + 1) * 86400:
            raise ValueError('unsupported_window')
        start = clock.timestamp() - FREE_DAYS * 86400 + 60
    if mode in ROLLING:
        days = ROLLING[mode]
        # Fixed lookbacks are anchored at provider execution, not the caller's
        # clock. Admit overlapping windows up to the declared span; retain the
        # original request and report actual coverage, including a missing start.
        if end <= clock.timestamp() - days * 86400 or end - start > days * 86400:
            raise ValueError('unsupported_window')
        return ('recent_chart', {'days': days}) if mode == 'sample_5m' else ('ohlc', {'days': days})
    return ('chart' if mode.startswith('sample') else 'ohlc_range'), {'from': int(start), 'to': int(end), 'interval': 'hourly' if mode.endswith('hourly') else 'daily'}
