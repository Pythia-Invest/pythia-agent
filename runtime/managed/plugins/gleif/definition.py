"""GLEIF's bounded native operations: issuer resolve and LEI-addressed profile."""
import json

TOOLS = {operation: 'pythia_gleif_' + operation for operation in ('resolve', 'profile')}


def schemas(wire):
    native_ref = wire.parameter_schema('provider_ref')
    fields = {
        'resolve': ({'identifiers': {'type': 'object', 'additionalProperties': False,
                                     'maxProperties': 1, 'properties': {
                         'lei': {'type': 'string', 'pattern': '^[A-Z0-9]{18}[0-9]{2}$'},
                         'isin': {'type': 'string', 'pattern': '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'}}},
                     'refresh': {'type': 'boolean'}}, ['identifiers']),
        'profile': ({'native_ref': native_ref}, ['native_ref']),
    }
    descriptions = {
        'resolve': 'Resolve exactly one identifier, an LEI or an ISIN, to what GLEIF records, as an identity claim batch for Pythia\'s core. An LEI answers with the legal entity (issuer) record and its native reference; an ISIN uses GLEIF\'s incomplete issuer mapping and answers with one security claim per mapped issuer, never a pick. Claims carry the LEI, the requested ISIN, and a CIK only when SEC EDGAR is the registration authority. An LEI identifies a legal entity, not a share class or listing. Use refresh to bypass retained metadata.',
        'profile': 'Read a GLEIF legal-entity profile by native LEI reference: legal, other and transliterated names with their types and languages, jurisdiction, legal form, addresses, registration and entity statuses, declared successors, direct and ultimate accounting-consolidation parents or reporting exceptions, and a branch record\'s head office. Related entities remain distinct; these are not complete beneficial-ownership relationships. See the bundled gleif skill for interpretation.',
    }
    return {operation: {'name': TOOLS[operation], 'description': descriptions[operation],
        'parameters': {'type': 'object', 'additionalProperties': False, 'properties': properties,
            'required': required, '$comment': json.dumps({
                'pythia_http_operation': {'plugin': 'pythia-gleif', 'operation': operation,
                    'read_only': True, 'updates': False, 'cache_seconds': 0}})}}
        for operation, (properties, required) in fields.items()}
