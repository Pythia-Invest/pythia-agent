"""DefiLlama's one native operation: the bulk catalogue core's identity sync pages."""
import json

SCOPES = ('protocols', 'pools')
TOOLS = {'catalogue': 'pythia_defillama_catalogue'}


def schemas(_wire):
    parameters = {
        'type': 'object', 'additionalProperties': False, 'required': ['scope'],
        'properties': {'scope': {'type': 'string', 'enum': list(SCOPES)},
                       'cursor': {'type': 'string', 'pattern': '^[0-9]{1,6}$'}},
        '$comment': json.dumps({'pythia_http_operation': {
            'plugin': 'pythia-defillama', 'operation': 'catalogue',
            'read_only': True, 'updates': False, 'cache_seconds': 0}}),
    }
    return {'catalogue': {
        'name': TOOLS['catalogue'], 'parameters': parameters,
        'description': 'Read one page of a DefiLlama catalogue scope as an identity claim batch for Pythia\'s '
                       'core: `protocols` (DeFi protocols, keyed by DefiLlama\'s protocol id) or `pools` (yield '
                       'pools as markets, keyed by pool id, each part of its protocol and linked to the Sui coin '
                       'types it holds). Covers the chains in the `defillama_chains` setting. Pass the returned '
                       '`next_cursor` for the next page. Names and symbols never join tokens.'}}
