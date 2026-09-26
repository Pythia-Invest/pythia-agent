"""OpenFIGI's native resolve tool and its deliberate protected operation export."""
import json


TOOL = 'pythia_openfigi_resolve'


def schema():
    annotation = {'pythia_http_operation': {'plugin': 'pythia-openfigi', 'operation': 'resolve',
                                            'read_only': True, 'updates': False, 'cache_seconds': 0}}
    isin = {'type': 'string', 'pattern': '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'}
    return {'name': TOOL, 'description': (
        'Resolve one ISIN (identifiers.isin) through OpenFIGI to its venue listings, as an identity claim batch for '
        'Pythia\'s core: one listing claim per OpenFIGI candidate with its FIGI, composite FIGI, share-class FIGI, '
        'ticker and Bloomberg exchange code. One ISIN usually maps to many venue listings; every candidate is kept. '
        'A match is evidence for Pythia\'s identity checks, not a decision, and no match does not prove absence. '
        'Works without an API key at lower limits.'),
        'parameters': {'type': 'object', 'additionalProperties': False, 'required': ['identifiers'],
                       'properties': {'identifiers': {'type': 'object', 'additionalProperties': False,
                                                      'required': ['isin'], 'properties': {'isin': isin}}},
                       '$comment': json.dumps(annotation)}}
