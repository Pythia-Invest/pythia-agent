"""SEC's native tools and their deliberate protected operation exports."""
import json

OPERATIONS = ('resolve', 'filings', 'fundamentals', 'facts')
TOOLS = {operation: 'pythia_sec_' + operation for operation in OPERATIONS}
TAXONOMIES = ('us-gaap', 'ifrs-full', 'dei', 'srt')


def schemas(wire):
    native_ref = wire.parameter_schema('provider_ref')
    refresh = {'type': 'boolean', 'description': 'Read fresh SEC data, bypassing the retained copy.'}
    fields = {
        'resolve': ({'identifiers': {'type': 'object', 'additionalProperties': False, 'properties': {
                'cik': {'type': 'string', 'pattern': '^[0-9]{1,10}$'},
                'ticker_mic': {'type': 'string', 'pattern': '^[A-Z0-9][A-Z0-9.&-]{0,15}@[A-Z0-9]{4}$'}}},
            'refresh': refresh}, ['identifiers']),
        'filings': ({'native_ref': native_ref, 'limit': {'type': 'integer', 'minimum': 1, 'maximum': 50},
                     'refresh': refresh}, ['native_ref']),
        'fundamentals': ({'native_ref': native_ref, 'limit': {'type': 'integer', 'minimum': 1, 'maximum': 30},
                          'refresh': refresh}, ['native_ref']),
        'facts': ({'native_ref': native_ref,
            'taxonomy': {'type': 'string', 'enum': list(TAXONOMIES)},
            'concepts': {'type': 'array', 'minItems': 1, 'maxItems': 8,
                         'items': {'type': 'string', 'pattern': '^[A-Za-z][A-Za-z0-9]{0,199}$'}},
            'limit': {'type': 'integer', 'minimum': 1, 'maximum': 500}, 'refresh': refresh},
            ['native_ref', 'taxonomy', 'concepts']),
    }
    descriptions = {
        'resolve': 'Resolve SEC filer identity by exact identifiers.cik (preferred when both are given), or by identifiers.ticker_mic (TICKER@MIC with '
            'an ISO operating MIC: XNAS, XNYS, XCBO or OTCM). Answers with an identity claim batch for Pythia\'s core: '
            'one issuer claim (name, CIK, native reference) per matching filer, never a pick or a merge.',
        'filings': 'Read recent public SEC filings for an SEC CIK reference with accession, form, filing date, '
            'report period and document link. 20-F, 40-F and 6-K forms from foreign issuers are included.',
        'fundamentals': 'Read supported reported annual facts for an SEC CIK reference from US GAAP or IFRS '
            '(foreign private issuers). Income and cash-flow facts use actual annual durations; balance-sheet facts '
            'are instants. Taxonomies and reported currencies stay separate; no TTM, quarterly subtraction or '
            'conversion is inferred.',
        'facts': 'Read bounded native XBRL facts for explicit concepts of one taxonomy (us-gaap, ifrs-full, dei or '
            'srt) for an SEC CIK reference, keeping periods, filing revisions and reported units.',
    }
    result = {}
    for operation, (properties, required) in fields.items():
        annotation = {'pythia_http_operation': {'plugin': 'pythia-sec', 'operation': operation,
                                                'read_only': True, 'updates': False, 'cache_seconds': 0}}
        result[operation] = {'name': TOOLS[operation], 'description': descriptions[operation],
            'parameters': {'type': 'object', 'properties': properties, 'required': required,
                           'additionalProperties': False, '$comment': json.dumps(annotation)}}
    return result
