"""Hyperliquid's one native operation: a `live_market` snapshot of a perp, pushed while watched."""
import json

TOOLSET = 'pythia-hyperliquid'
TOOLS = {'live_market': 'pythia_hyperliquid_live_market'}


def schemas(_wire=None):
    parameters = {
        'type': 'object', 'additionalProperties': False, 'required': ['subject_id', 'native_ref'],
        'properties': {
            'subject_id': {'type': 'string', 'pattern': '^market:[a-z][a-z0-9_]{0,31}:[A-Za-z0-9._:/%-]{1,300}$'},
            'native_ref': {'type': 'object', 'additionalProperties': False,
                           'required': ['provider', 'native_scope', 'native_id'],
                           'properties': {'provider': {'const': 'hyperliquid'}, 'native_scope': {'const': 'perp'},
                                          'native_id': {'type': 'string', 'pattern': '^[A-Z0-9]{1,20}$'}}}},
        '$comment': json.dumps({'pythia_http_operation': {
            'plugin': 'pythia-hyperliquid', 'operation': 'live_market', 'read_only': True, 'updates': True,
            'cache_seconds': 0, 'cache_overrides': []}}),
    }
    return {'live_market': {
        'name': TOOLS['live_market'],
        'description': 'Read one real-time snapshot of a Hyperliquid perpetual market: the top 5 book levels per '
                       'side, recent trades, the last-trade price at each minute of the past 15 (with first, last, high and '
                       'low in line_summary), and mark, oracle, hourly funding rate and '
                       'open interest (in coins). Hyperliquid data only; it can take up to 10 seconds. Pass the '
                       'arguments of the `live` section request that pythia_identity_subject returns for the market.',
        'parameters': parameters}}
