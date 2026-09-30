"""NAVI's native operations: the bulk catalogue core's identity sync pages, and a reserve's metrics."""
import json

SCOPES = ('protocols', 'reserves')
TOOLS = {'catalogue': 'pythia_navi_catalogue', 'metrics': 'pythia_navi_metrics'}


def _parameters(operation, properties, required):
    return {'type': 'object', 'additionalProperties': False, 'required': required, 'properties': properties,
            '$comment': json.dumps({'pythia_http_operation': {
                'plugin': 'pythia-navi', 'operation': operation,
                'read_only': True, 'updates': False, 'cache_seconds': 0}})}


def schemas(wire):
    return {
        'catalogue': {
            'name': TOOLS['catalogue'],
            'parameters': _parameters('catalogue', {'scope': {'type': 'string', 'enum': list(SCOPES)},
                                                    'cursor': {'type': 'string', 'minLength': 1, 'maxLength': 120}},
                                      ['scope']),
            'description': 'Read one page of a NAVI Protocol catalogue scope as an identity claim batch for Pythia\'s '
                           'core: `protocols` (the NAVI Lending protocol) or `reserves` (lending reserves on Sui as '
                           'markets, keyed by the reserve\'s Pool object id, each part of the protocol and linked to '
                           'the coin type it holds). Covers the markets in the `navi_markets` setting (every known '
                           'market unless set). Pass the returned `next_cursor` for the next page. Names and symbols '
                           'never join tokens.'},
        'metrics': {
            'name': TOOLS['metrics'],
            'parameters': _parameters('metrics', {'native_ref': wire.parameter_schema('provider_ref')}, ['native_ref']),
            'description': 'Read the supplied and borrowed value (US dollars at NAVI\'s oracle price), utilisation and '
                           'supply and borrow rate NAVI states for one of its reserves (`native_scope` reserve), as '
                           'metric rows: value, unit, period, as-of, basis and the definition of the figure. Rates are '
                           'yearly percentages before incentive rewards. A figure NAVI leaves out has no row.'}}
