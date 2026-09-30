"""OpenFIGI's native tools and their deliberate protected operation exports.

`resolve` is the lookup core dispatches (the contract's `resolve`): one ISIN in, an identity claim batch out.
`mapping` is the agent's evidence read: several jobs, every candidate, nothing decided.
"""
import json

from .mapping import FILTERS, ID_TYPES, MAX_JOBS

OPERATIONS = ('resolve', 'mapping')
TOOLS = {operation: 'pythia_openfigi_' + operation for operation in OPERATIONS}


def _annotation(operation):
    return json.dumps({'pythia_http_operation': {'plugin': 'pythia-openfigi', 'operation': operation,
                                                 'read_only': True, 'updates': False, 'cache_seconds': 0}})


def schemas(_wire):
    """Both operations' native schemas. Every plugin's `schemas` takes core's wire module; these need none of it."""
    fields = {name: {'type': 'string', 'minLength': 1, 'maxLength': limit} for name, limit in FILTERS.items()}
    fields['micCode']['pattern'] = '^[A-Z0-9]{4}$'
    job = {'type': 'object', 'additionalProperties': False, 'required': ['idType', 'idValue'],
           'properties': {'idType': {'type': 'string', 'enum': list(ID_TYPES)},
                          'idValue': {'type': 'string', 'minLength': 1, 'maxLength': 128}, **fields}}
    isin = {'type': 'string', 'pattern': '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'}
    return {
        'resolve': {'name': TOOLS['resolve'], 'description': (
            'Look up one ISIN in OpenFIGI for Pythia\'s core. Answers with an identity claim batch: one listing '
            'claim per FIGI line with its FIGI, composite FIGI, share-class FIGI, the ISIN, ticker and operating MIC '
            'where the exchange code maps to one. Never a pick or a merge.'),
            'parameters': {'type': 'object', 'additionalProperties': False, 'required': ['identifiers'],
                           'properties': {'identifiers': {'type': 'object', 'additionalProperties': False,
                                                          'required': ['isin'], 'properties': {'isin': isin}}},
                           '$comment': _annotation('resolve')}},
        'mapping': {'name': TOOLS['mapping'], 'description': (
            'Resolve ISINs (optionally with micCode or exchCode) or venue-qualified tickers (TICKER with micCode or '
            'exchCode) through OpenFIGI to FIGI, composite FIGI, share-class FIGI, ticker and Bloomberg exchange code. '
            'micCode matches the segment '
            'MIC (for example XNGS for Nasdaq Global Select, not the operating MIC XNAS). Results keep job order and '
            'every candidate; one ISIN usually maps to many venue listings. A match is evidence for Pythia\'s identity '
            'checks, not a decision, and no match does not prove absence. Works without an API key at lower limits.'),
            'parameters': {'type': 'object', 'additionalProperties': False, 'required': ['jobs'],
                           'properties': {'jobs': {'type': 'array', 'minItems': 1, 'maxItems': MAX_JOBS, 'items': job}},
                           '$comment': _annotation('mapping')}},
    }
