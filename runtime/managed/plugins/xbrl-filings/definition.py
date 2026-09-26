"""Deliberate public read operations addressed by LEI; no search."""
import json

TOOLS = {operation: 'pythia_xbrl_filings_' + operation for operation in
         ('resolve', 'filings', 'fundamentals', 'facts')}


def schemas(wire):
    native = wire.parameter_schema('provider_ref')
    count = {'type': 'integer', 'minimum': 1, 'maximum': 50}
    report_id = {'type': 'string', 'pattern': '^[0-9]{1,16}$'}
    fields = {
        'resolve': ({'lei': {'type': 'string', 'pattern': '^[A-Z0-9]{18}[0-9]{2}$'},
                     'refresh': {'type': 'boolean'}}, ['lei']),
        'filings': ({'native_ref': native, 'limit': count}, ['native_ref']),
        'fundamentals': ({'native_ref': native, 'limit': count, 'report_id': report_id}, ['native_ref']),
        'facts': ({'native_ref': native, 'report_id': report_id,
            'concepts': {'type': 'array', 'minItems': 1, 'maxItems': 8,
                'items': {'type': 'string', 'minLength': 3, 'maxLength': 240}},
            'limit': {'type': 'integer', 'minimum': 1, 'maximum': 200}}, ['native_ref', 'report_id', 'concepts']),
    }
    descriptions = {
        'resolve': 'Check whether filings.xbrl.org indexes a reporting entity for an exact LEI and return its native reference and the LEI the repository echoes. The repository is incomplete: not found does not mean the company publishes no reports.',
        'filings': 'Read bounded indexed XBRL report metadata (ESEF, UKSEF and similar) by native LEI reference: viewer, report, package and xBRL-JSON links, reporting period, country and validation counts. `latest` says whether the latest period has one report or several variants that need an explicit report_id. Reporting dates and repository added dates are not filing dates.',
        'fundamentals': 'Read supported undimensioned IFRS facts from the latest uniquely identified report or an explicit report_id. Keeps units, exact periods, precision and source identity. When several reports share the latest period, returns ambiguous_report with the candidates instead of picking one; unavailable reports do not fall back to older reports.',
        'facts': 'Read selected numeric xBRL-JSON concepts from an explicit report_id. Concept names use that report\'s namespace prefixes. Keeps dimensions, precision and periods; no taxonomy downloads or inferred ratios. Non-numeric or unsupported facts are qualified as limitations.',
    }
    return {operation: {'name': TOOLS[operation], 'description': descriptions[operation],
        'parameters': {'type': 'object', 'properties': properties, 'required': required,
            'additionalProperties': False, '$comment': json.dumps({'pythia_http_operation': {
                'plugin': 'pythia-xbrl-filings', 'operation': operation,
                'read_only': True, 'updates': False, 'cache_seconds': 0}})}}
        for operation, (properties, required) in fields.items()}
