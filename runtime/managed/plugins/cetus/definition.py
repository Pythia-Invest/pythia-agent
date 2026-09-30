"""Cetus's one native operation: the bulk catalogue core's identity sync pages."""
import json

SCOPES = ('protocols', 'pools')
TOOLS = {'catalogue': 'pythia_cetus_catalogue'}


def schemas(_wire):
    parameters = {
        'type': 'object', 'additionalProperties': False, 'required': ['scope'],
        'properties': {'scope': {'type': 'string', 'enum': list(SCOPES)},
                       'cursor': {'type': 'string', 'minLength': 1, 'maxLength': 120}},
        '$comment': json.dumps({'pythia_http_operation': {
            'plugin': 'pythia-cetus', 'operation': 'catalogue',
            'read_only': True, 'updates': False, 'cache_seconds': 0}}),
    }
    return {'catalogue': {
        'name': TOOLS['catalogue'], 'parameters': parameters,
        'description': 'Read one page of a Cetus catalogue scope as an identity claim batch for Pythia\'s core: '
                       '`protocols` (Cetus CLMM, keyed by its original package id) or `pools` (CLMM pools with more '
                       'than US$1,000 of liquidity, keyed by the pool object id, each part of the protocol with its '
                       'base and quote token). Pass the returned `next_cursor` for the next page. Names and symbols '
                       'never join tokens.'}}
