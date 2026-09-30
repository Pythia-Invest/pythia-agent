"""Suilend's one native operation: the bulk catalogue core's identity sync reads."""
import json

SCOPES = ('protocols', 'markets')
TOOLS = {'catalogue': 'pythia_suilend_catalogue'}


def schemas(_wire):
    parameters = {
        'type': 'object', 'additionalProperties': False, 'required': ['scope'],
        'properties': {'scope': {'type': 'string', 'enum': list(SCOPES)}},
        '$comment': json.dumps({'pythia_http_operation': {
            'plugin': 'pythia-suilend', 'operation': 'catalogue',
            'read_only': True, 'updates': False, 'cache_seconds': 0}}),
    }
    return {'catalogue': {
        'name': TOOLS['catalogue'], 'parameters': parameters,
        'description': 'Read a Suilend catalogue scope as an identity claim batch for Pythia\'s core: `protocols` '
                       '(Suilend, keyed by its original package id) or `markets` (Main Market and the isolated '
                       'markets, keyed by the LendingMarket object id, each part of the protocol and linked to the '
                       'coins it lists a reserve for). Suilend names no coin, so a token link needs another source '
                       'to hold the token. Names and symbols never join tokens.'}}
