"""SEC's native tools and their deliberate protected operation exports."""
import json

OPERATIONS = ('resolve', 'filings', 'fundamentals', 'facts', 'document')
TOOLS = {operation: 'pythia_sec_' + operation for operation in OPERATIONS}
TAXONOMIES = ('us-gaap', 'ifrs-full', 'dei', 'srt')


def schemas(wire):
    from pythia_platform import FilingKind  # core's filing kinds, the vocabulary of `filings.KINDS`
    native_ref = wire.parameter_schema('provider_ref')
    refresh = {'type': 'boolean', 'description': 'Read fresh SEC data, bypassing the retained copy.'}
    fields = {
        'resolve': ({'identifiers': {'type': 'object', 'additionalProperties': False, 'properties': {
                'cik': {'type': 'string', 'pattern': '^[0-9]{1,10}$'},
                'ticker_mic': {'type': 'string', 'pattern': '^[A-Z0-9][A-Z0-9.&-]{0,15}( [A-Z])?@[A-Z0-9]{4}$'}}},
            'refresh': refresh}, ['identifiers']),
        'filings': ({'native_ref': native_ref, 'limit': {'type': 'integer', 'minimum': 1, 'maximum': 50},
                     'forms': {'type': 'array', 'minItems': 1, 'maxItems': 8,
                               'items': {'type': 'string', 'pattern': '^[A-Za-z0-9][A-Za-z0-9 ./-]{0,15}$'},
                               'description': 'Only these forms (10-K, 20-F, 8-K ...); an amendment (10-K/A) matches '
                                              'its form. Searches the filer\'s whole recent list and, when needed, '
                                              'older pages back five years.'},
                     'kinds': {'type': 'array', 'minItems': 1, 'maxItems': 8,
                               'items': {'type': 'string', 'enum': [kind.value for kind in FilingKind]},
                               'description': 'Only these kinds of filing (annual, quarterly, earnings_release, event, '
                                              'ownership, prospectus, other), searched like forms. ownership reads '
                                              'the insider and major-holder filings.'},
                     'refresh': refresh}, ['native_ref']),
        'fundamentals': ({'native_ref': native_ref, 'limit': {'type': 'integer', 'minimum': 1, 'maximum': 30},
                          'refresh': refresh}, ['native_ref']),
        'facts': ({'native_ref': native_ref,
            'taxonomy': {'type': 'string', 'enum': list(TAXONOMIES)},
            'concepts': {'type': 'array', 'minItems': 1, 'maxItems': 8,
                         'items': {'type': 'string', 'pattern': '^[A-Za-z][A-Za-z0-9]{0,199}$'}},
            'limit': {'type': 'integer', 'minimum': 1, 'maximum': 500}, 'refresh': refresh},
            ['native_ref', 'taxonomy', 'concepts']),
        'document': ({'native_ref': native_ref, 'id': {'type': 'string', 'pattern': '^[0-9]{10}-[0-9]{2}-[0-9]{6}$'},
                      'url': {'type': 'string', 'maxLength': 1024}}, ['native_ref', 'id', 'url']),
    }
    descriptions = {
        'resolve': 'Resolve SEC filer identity by exact identifiers.cik (preferred when both are given), or by identifiers.ticker_mic (TICKER@MIC with '
            'an ISO operating MIC: XNAS, XNYS, XCBO or OTCM). Answers with an identity claim batch for Pythia\'s core: '
            'one issuer claim (name, CIK, native reference) per matching filer, never a pick or a merge.',
        'filings': 'Read recent public SEC filings for an SEC CIK reference with accession, form, filing date, '
            'acceptance time, report period, kind, 8-K item numbers and document link. 20-F, 40-F and 6-K forms '
            'from foreign issuers are included. Insider and major-holder ownership filings (Forms 3, 4, 5, 144 and '
            'Schedule 13G) are left out unless named in forms or asked for as the ownership kind. With forms or '
            'kinds, only those, searched beyond the most recent filings so an annual report is not crowded out.',
        'fundamentals': 'Read supported reported annual facts for an SEC CIK reference from US GAAP or IFRS '
            '(foreign private issuers). Income and cash-flow facts use actual annual durations; balance-sheet facts '
            'are instants. Taxonomies and reported currencies stay separate; no TTM, quarterly subtraction or '
            'conversion is inferred. freshness is stale when SEC has not yet added the latest 10-K, 10-Q, 20-F or '
            '40-F to these facts.',
        'facts': 'Read bounded native XBRL facts for explicit concepts of one taxonomy (us-gaap, ifrs-full, dei or '
            'srt) for an SEC CIK reference, keeping periods, filing revisions and reported units.',
        'document': 'Read one filing document of an SEC CIK reference: id is its accession and url its document in '
            'the SEC Archives, as the filings read lists them. The document streams through Pythia core\'s reader, '
            'which returns its text and outline.',
    }
    result = {}
    for operation, (properties, required) in fields.items():
        annotation = {'pythia_http_operation': {'plugin': 'pythia-sec', 'operation': operation,
                                                'read_only': True, 'updates': False, 'cache_seconds': 0}}
        result[operation] = {'name': TOOLS[operation], 'description': descriptions[operation],
            'parameters': {'type': 'object', 'properties': properties, 'required': required,
                           'additionalProperties': False, '$comment': json.dumps(annotation)}}
    return result
