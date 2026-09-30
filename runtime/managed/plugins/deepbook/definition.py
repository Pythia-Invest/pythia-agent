"""DeepBook's one native operation: the bulk catalogue core's identity sync reads."""
import json

SCOPES = ('protocols', 'pools')
TOOLS = {'catalogue': 'pythia_deepbook_catalogue'}


def schemas(_wire):
    parameters = {
        'type': 'object', 'additionalProperties': False, 'required': ['scope'],
        'properties': {'scope': {'type': 'string', 'enum': list(SCOPES)}},
        '$comment': json.dumps({'pythia_http_operation': {
            'plugin': 'pythia-deepbook', 'operation': 'catalogue',
            'read_only': True, 'updates': False, 'cache_seconds': 0}}),
    }
    return {'catalogue': {
        'name': TOOLS['catalogue'], 'parameters': parameters,
        'description': 'Read a DeepBook V3 catalogue scope as an identity claim batch for Pythia\'s core: `protocols` '
                       '(DeepBook V3, keyed by its original package id) or `pools` (the order books the Mysten Labs '
                       'indexer lists, keyed by the pool object id, each part of the protocol with its base and quote '
                       'token). Names and symbols never join tokens.'}}
