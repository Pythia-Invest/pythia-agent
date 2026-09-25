"""SEC's native tools and their deliberate protected operation exports."""
import json

CHECK = 'check_configuration'
OPERATIONS = ('catalogue', 'resolve', 'filings', 'fundamentals', 'facts', CHECK)
TOOLS = {operation: 'pythia_sec_' + operation for operation in OPERATIONS}
TAXONOMIES = ('us-gaap', 'ifrs-full', 'dei', 'srt')


def schemas(wire):
    native_ref = wire.parameter_schema('provider_ref')
    refresh = {'type': 'boolean', 'description': 'Read fresh SEC data, bypassing the retained copy.'}
    fields = {
        'catalogue': ({'scope': {'type': 'string', 'enum': ['company-tickers-exchange']},
            'cursor': {'type': 'string', 'maxLength': 128},
            'limit': {'type': 'integer', 'minimum': 1, 'maximum': 1000}, 'refresh': refresh}, ['scope']),
        'resolve': ({'cik': {'type': 'string', 'pattern': '^[0-9]{1,10}$'},
            'ticker': {'type': 'string', 'minLength': 1, 'maxLength': 32},
            'mic': {'type': 'string', 'pattern': '^[A-Z0-9]{4}$'}, 'refresh': refresh}, []),
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
        CHECK: ({}, []),
    }
    descriptions = {
        'catalogue': 'Read a bounded page of SEC\'s public ticker file for local reference indexing: one row per '
            'ticker line with the filer CIK, SEC exchange label and its ISO operating MIC. A CIK identifies the filer, '
            'not a security; several lines can share one CIK. Page with the returned cursor.',
        'resolve': 'Resolve SEC filer identity by exact CIK, or by exact ticker with an optional ISO operating MIC '
            '(XNAS, XNYS, XCBO or OTCM). Returns echoed identifiers and listed lines as evidence for Pythia\'s identity '
            'checks, never a merge. Use it for an explicit lookup, not while a query is being typed.',
        'filings': 'Read recent public SEC filings for an SEC CIK reference with accession, form, filing date, '
            'report period and document link. 20-F, 40-F and 6-K forms from foreign issuers are included.',
        'fundamentals': 'Read supported reported annual facts for an SEC CIK reference from US GAAP or IFRS '
            '(foreign private issuers). Income and cash-flow facts use actual annual durations; balance-sheet facts '
            'are instants. Taxonomies and reported currencies stay separate; no TTM, quarterly subtraction or '
            'conversion is inferred.',
        'facts': 'Read bounded native XBRL facts for explicit concepts of one taxonomy (us-gaap, ifrs-full, dei or '
            'srt) for an SEC CIK reference, keeping periods, filing revisions and reported units.',
        CHECK: 'Check whether the configured SEC contact (sec_identity) has the name and email address SEC requires. '
            'Makes no SEC request and never returns the contact.',
    }
    result = {}
    for operation, (properties, required) in fields.items():
        annotation = {'pythia_http_operation': {'plugin': 'pythia-sec', 'operation': operation,
                                                'read_only': True, 'updates': False, 'cache_seconds': 0}}
        result[operation] = {'name': TOOLS[operation], 'description': descriptions[operation],
            'parameters': {'type': 'object', 'properties': properties, 'required': required,
                           'additionalProperties': False, '$comment': json.dumps(annotation)}}
    return result
