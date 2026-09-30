"""DefiLlama's native operations: the bulk catalogue core's identity sync pages, and a protocol's metrics."""
import json

SCOPES = ('protocols', 'pools')
TOOLS = {'catalogue': 'pythia_defillama_catalogue', 'metrics': 'pythia_defillama_metrics'}


def _parameters(operation, properties, required):
    return {'type': 'object', 'additionalProperties': False, 'required': required, 'properties': properties,
            '$comment': json.dumps({'pythia_http_operation': {
                'plugin': 'pythia-defillama', 'operation': operation,
                'read_only': True, 'updates': False, 'cache_seconds': 0}})}


def schemas(wire):
    return {
        'catalogue': {
            'name': TOOLS['catalogue'],
            'parameters': _parameters('catalogue', {'scope': {'type': 'string', 'enum': list(SCOPES)},
                                                    'cursor': {'type': 'string', 'minLength': 1, 'maxLength': 120}},
                                      ['scope']),
            'description': 'Read one page of a DefiLlama catalogue scope as an identity claim batch for Pythia\'s '
                           'core: `protocols` (DeFi protocols, keyed by DefiLlama\'s protocol id) or `pools` (yield '
                           'pools as markets, keyed by pool id, each part of its protocol and linked to the Sui coin '
                           'types it holds). Covers the chains in the `defillama_chains` setting (Sui unless set; '
                           '`all` for every chain). Pass the returned `next_cursor` for the next page. Names and '
                           'symbols never join tokens.'},
        'metrics': {
            'name': TOOLS['metrics'],
            'parameters': _parameters('metrics', {'native_ref': wire.parameter_schema('provider_ref')}, ['native_ref']),
            'description': 'Read the TVL, fees, revenue and volume DefiLlama states for one of its protocols '
                           '(`native_scope` protocol), as metric rows: value, unit, period, as-of, basis and the '
                           'definition of the figure. TVL is supplied minus borrowed for a lending protocol and the '
                           'assets held for any other. A metric DefiLlama keeps nothing for has no row.'}}
