"""NAVI's one native operation: the bulk catalogue core's identity sync pages."""
import json

SCOPES = ('protocols', 'reserves')
TOOLS = {'catalogue': 'pythia_navi_catalogue'}


def schemas(_wire):
    parameters = {
        'type': 'object', 'additionalProperties': False, 'required': ['scope'],
        'properties': {'scope': {'type': 'string', 'enum': list(SCOPES)},
                       'cursor': {'type': 'string', 'minLength': 1, 'maxLength': 120}},
        '$comment': json.dumps({'pythia_http_operation': {
            'plugin': 'pythia-navi', 'operation': 'catalogue',
            'read_only': True, 'updates': False, 'cache_seconds': 0}}),
    }
    return {'catalogue': {
        'name': TOOLS['catalogue'], 'parameters': parameters,
        'description': 'Read one page of a NAVI Protocol catalogue scope as an identity claim batch for Pythia\'s '
                       'core: `protocols` (the NAVI Lending protocol) or `reserves` (lending reserves on Sui as '
                       'markets, keyed by the reserve\'s Pool object id, each part of the protocol and linked to the '
                       'coin type it holds). Covers the markets in the `navi_markets` setting (every known market '
                       'unless set). Pass the returned `next_cursor` for the next page. Names and symbols never '
                       'join tokens.'}}
