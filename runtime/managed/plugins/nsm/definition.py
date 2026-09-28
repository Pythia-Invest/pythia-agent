"""The NSM's native tools and their deliberate protected operation exports, addressed by issuer LEI."""
import json

OPERATIONS = ('resolve', 'filings', 'news')
TOOLS = {operation: 'pythia_nsm_' + operation for operation in OPERATIONS}
# Core's filing kinds (FilingKind).
FILING_KINDS = ('annual', 'half_year', 'quarterly', 'earnings_release', 'event', 'ownership', 'prospectus', 'other')
NOTICE = ('It reads the FCA\'s undocumented NSM search endpoint, which can change or break at any time.')


def schemas(wire):
    native_ref = wire.parameter_schema('provider_ref')
    limit = {'type': 'integer', 'minimum': 1, 'maximum': 100}
    refresh = {'type': 'boolean', 'description': 'Read fresh NSM data, bypassing the retained copy.'}
    fields = {
        'resolve': ({'identifiers': {'type': 'object', 'additionalProperties': False, 'required': ['lei'],
                                     'properties': {'lei': {'type': 'string', 'pattern': '^[A-Z0-9]{18}[0-9]{2}$'}}},
                     'refresh': refresh}, ['identifiers']),
        'filings': ({'native_ref': native_ref, 'limit': limit,
                     'kinds': {'type': 'array', 'minItems': 1, 'maxItems': 8,
                               'items': {'type': 'string', 'enum': list(FILING_KINDS)},
                               'description': 'Only these kinds. annual, half_year, quarterly, earnings_release, '
                                              'ownership and prospectus are searched through the whole archive; '
                                              'event and other filter the newest 100 disclosures.'},
                     'refresh': refresh}, ['native_ref']),
        'news': ({'native_ref': native_ref, 'limit': limit, 'refresh': refresh}, ['native_ref']),
    }
    descriptions = {
        'resolve': 'Check whether the UK FCA National Storage Mechanism lists disclosures of an exact issuer LEI '
                   '(identifiers.lei) and answer with an identity claim batch for Pythia\'s core. ' + NOTICE,
        'filings': 'Read a UK issuer\'s regulated disclosures from the FCA National Storage Mechanism by native LEI '
                   'reference, newest first: disclosure id, headline code as form, kind, category, filing (submission) '
                   'time, publication time, format, filers and document link. Annual and half-year reports sit among '
                   'frequent buy-back and holdings notices; ask for their kinds to find them. ' + NOTICE,
        'news': 'Read a UK issuer\'s regulatory announcements from the FCA National Storage Mechanism by native LEI '
                'reference, newest first, with the time each was made public and the service that disseminated it '
                '(RNS, GNW ...). ' + NOTICE,
    }
    return {operation: {'name': TOOLS[operation], 'description': descriptions[operation],
        'parameters': {'type': 'object', 'properties': properties, 'required': required,
            'additionalProperties': False, '$comment': json.dumps({'pythia_http_operation': {
                'plugin': 'pythia-nsm', 'operation': operation,
                'read_only': True, 'updates': False, 'cache_seconds': 0}})}}
        for operation, (properties, required) in fields.items()}
