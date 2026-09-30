"""The plugin's two native operations: the bulk catalogue core's identity sync pages, and a pool's governance metrics."""
import json

SCOPES = ('protocols', 'tokens', 'markets')
TOOLS = {'catalogue': 'pythia_sui_catalogue', 'metrics': 'pythia_sui_metrics'}


def _marker(operation):
    return json.dumps({'pythia_http_operation': {'plugin': 'pythia-sui', 'operation': operation, 'read_only': True,
                                                 'updates': False, 'cache_seconds': 0}})


def schemas(wire):
    catalogue = {
        'type': 'object', 'additionalProperties': False, 'required': ['scope'],
        'properties': {'scope': {'type': 'string', 'enum': list(SCOPES)},
                       'cursor': {'type': 'string', 'minLength': 1, 'maxLength': 200}},
        '$comment': _marker('catalogue'),
    }
    metrics = {
        'type': 'object', 'additionalProperties': False, 'required': ['native_ref'],
        'properties': {'native_ref': wire.parameter_schema('provider_ref')},
        '$comment': _marker('metrics'),
    }
    return {
        'catalogue': {
            'name': TOOLS['catalogue'], 'parameters': catalogue,
            'description': 'Read one page of a Sui chain catalogue scope as an identity claim batch for Pythia\'s core: '
                           '`protocols` (DeFi protocols keyed by their original package id), `tokens` (coin types named '
                           'from on-chain metadata, with bridge provenance where the chain proves it) or `markets` '
                           '(DeepBook pools, AlphaLend reserves and Bucket vaults keyed by object id, each part of its '
                           'protocol and linked to its coins with their roles). Pass the returned `next_cursor` for the '
                           'next page. Names and symbols never join tokens.'},
        'metrics': {
            'name': TOOLS['metrics'], 'parameters': metrics,
            'description': 'Read the taker and maker fee of a DeepBook V3 pool (a Sui `market`, `native_scope` market) from '
                           'the chain as of now, as metric rows: value in percent, as-of, basis and the definition. The '
                           'stake required and any change voted for the next epoch come as limitations. Other markets '
                           'answer not_covered.'}}
