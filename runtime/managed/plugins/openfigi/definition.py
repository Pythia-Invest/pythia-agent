"""OpenFIGI's native resolve tool and its deliberate protected operation export."""
import json

from .mapping import FILTERS, ID_TYPES, MAX_JOBS

TOOL = 'pythia_openfigi_resolve'


def schema():
    fields = {name: {'type': 'string', 'minLength': 1, 'maxLength': limit} for name, limit in FILTERS.items()}
    fields['micCode']['pattern'] = '^[A-Z0-9]{4}$'
    fields['currency']['pattern'] = '^[A-Z]{3}$'
    job = {'type': 'object', 'additionalProperties': False, 'required': ['idType', 'idValue'],
           'properties': {'idType': {'type': 'string', 'enum': list(ID_TYPES)},
                          'idValue': {'type': 'string', 'minLength': 1, 'maxLength': 128}, **fields}}
    annotation = {'pythia_http_operation': {'plugin': 'pythia-openfigi', 'operation': 'resolve',
                                            'read_only': True, 'updates': False, 'cache_seconds': 0}}
    return {'name': TOOL, 'description': (
        'Resolve ISINs, CUSIPs, FIGIs or venue-qualified tickers (TICKER with micCode or exchCode) through OpenFIGI '
        'to FIGI, composite FIGI, share-class FIGI, ticker and Bloomberg exchange code. micCode matches the segment '
        'MIC (for example XNGS for Nasdaq Global Select, not the operating MIC XNAS). Results keep job order and '
        'every candidate; one ISIN usually maps to many venue listings. A match is evidence for Pythia\'s identity '
        'checks, not a decision, and no match does not prove absence. Works without an API key at lower limits. '
        'Use it for explicit resolution, not while a query is being typed.'),
        'parameters': {'type': 'object', 'additionalProperties': False, 'required': ['jobs'],
                       'properties': {'jobs': {'type': 'array', 'minItems': 1, 'maxItems': MAX_JOBS, 'items': job}},
                       '$comment': json.dumps(annotation)}}
