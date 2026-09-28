"""Native filings.xbrl.org connector: issuer resolve and report content by LEI.

Shared host support owns transport and authorization; market-data's connector
library supplies bounded reads. There is deliberately no search operation.
"""
import importlib
import json
from pathlib import Path
import time

from . import facts, identity, reports
from .definition import TOOLS, schemas

DOCUMENT_SECONDS = 60  # a report document streams through core's reader
MESSAGES = {
    'invalid_request': 'The XBRL repository request is invalid.',
    'ambiguous_report': 'Several reports share the latest reporting period and none was picked. Choose one report_id from the candidates; repository order does not establish amendment order.',
    'unavailable_report': 'The selected report has validation errors or no machine-readable data. Inspect its filing link; no older report was substituted.',
    'missing_observation': 'The repository has no report matching this request.',
}


def helpers(ctx):
    from hermes_cli.plugins import get_plugin_manager
    loaded = get_plugin_manager()._plugins.get('pythia-market-data')
    if not ctx.has_plugin('pythia-market-data') or loaded is None or not loaded.enabled or loaded.module is None:
        raise RuntimeError('unavailable')
    return tuple(importlib.import_module(loaded.module.__name__ + '.' + name) for name in ('wire', 'connector', 'selection'))


def envelope(data, issues=None, outcome=None):
    issues = issues or []
    return {'schema_version': 1, 'outcome': outcome or (('partial' if issues else 'ok') if data else ('error' if issues else 'empty')),
            'data': data, 'issues': issues}


class Reader:
    def __init__(self, wire, connector, *, transport=None, extract=None):
        self.wire, self.connector = wire, connector
        self.definitions = schemas(wire)
        if transport is None:
            transport = connector.Transport(provider=identity.PROVIDER, origins=(identity.ORIGIN,), max_bytes=16_000_000)
        self.transport, self.extract = transport, extract  # extract: core's document reader (platform.read_document)
        self.reads = connector.WorkerReads(transport)

    def document(self, url, cancelled, budget):
        """A report document streamed through core's reader; its failures in the connector's vocabulary."""
        def body(response, check):
            try:
                return self.extract(response, check)
            except RuntimeError as error:  # core's size cap is `output_limit`
                raise self.connector.SourceFailure({'error': str(error)}) from None
            except (ValueError, UnicodeError):
                raise self.connector.SourceFailure({'error': 'invalid_response'}) from None
        raw = self.transport.run_worker(None, {'operation': 'document', 'url': url}, {}, cancelled=cancelled or (lambda: False),
                                        budget=budget, timeout=DOCUMENT_SECONDS, body=body)
        return {**raw['data'], 'url': url, 'observed_at': raw['observed_at']}

    def invoke(self, operation, arguments, cancelled=None, cache_scope=None):
        try:
            clean = self.wire.validate_parameters(self.definitions[operation]['parameters'], arguments)
            refresh = clean.pop('refresh', False)
            budget = self.connector.connection(identity.PROVIDER, concurrency=2, per_minute=60)
            # One deadline for all reads of an operation, inside the protected
            # HTTP adapter's 30-second limit.
            deadline = time.monotonic() + 25

            def fetch(url, label, validate, age=3600, scope=None):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise self.connector.SourceFailure({'error': 'timeout'})

                def prepare(raw):
                    try:
                        return {**raw, 'data': validate(raw['data'], raw['observed_at'])}
                    except (ValueError, KeyError, TypeError, AttributeError) as error:
                        code = 'missing_observation' if str(error) == 'missing_observation' else 'invalid_response'
                        raise self.connector.SourceFailure({'error': code}) from None
                return self.reads.read([__file__], {'operation': label, 'url': url}, {},
                    cancelled=cancelled, budget=budget, age=0 if refresh else age, timeout=min(20, remaining),
                    prepare_result=prepare, cache_scope=['xbrl-validated:2', cache_scope, scope])

            def validate_reports(raw, stamp):
                reports.filings(raw, identifier, stamp, 50)
                return raw

            if operation == 'resolve':
                identifier = identity.lei(clean['identifiers']['lei'])

                def validate_entity(raw, stamp):
                    identity.entity(raw, stamp, identifier)
                    return raw
                raw = fetch(identity.entity_url(identifier), 'entity', validate_entity, age=86400)
                return envelope(identity.entity(raw['data'], raw['observed_at'], identifier))
            identifier = identity.from_reference(clean['native_ref'])
            limit = clean.get('limit', 20)
            if operation == 'document':  # a listed report's own document, found by its hash; never a caller's URL
                raw = fetch(identity.reports_url(identifier), 'reports', validate_reports)
                row = next((row for row in reports.records(raw['data'], identifier)[0] if row['hash'] == clean['id']),
                           None)
                url = row and row['links'].get('report')  # the xhtml itself; the viewer page adds a large fact script
                if not url:
                    raise ValueError('missing_observation')
                return envelope(self.document(url, cancelled, budget))
            if operation == 'filings':
                # Share one bounded metadata page with simultaneous fundamentals.
                raw = fetch(identity.reports_url(identifier), 'reports', validate_reports)
                result = reports.filings(raw['data'], identifier, raw['observed_at'], limit)
                for code, values in result.get('drift', {}).items():  # for maintainers: Pythia leaves these rows out
                    self.connector.emit('source_drift', level='warning', provider=identity.PROVIDER,
                                        operation='filings', code=code, count=sum(values.values()))
                return envelope(result)
            if clean.get('report_id'):
                def validate_report(raw, stamp):
                    if not reports.owned(raw['data'], identifier):
                        # Another issuer's report is no report of this issuer.
                        raise ValueError('missing_observation')
                    validate_reports({'data': [raw['data']], 'meta': {'count': 1}}, stamp)
                    return raw
                raw = fetch(identity.ORIGIN + '/api/filings/' + clean['report_id'], 'report', validate_report,
                            scope=identifier)
                # Still validate the response entity, never trust the supplied ID.
                data = {'data': [raw['data']['data']], 'meta': {'count': 1}}
            else:
                raw = fetch(identity.reports_url(identifier), 'reports', validate_reports)
                data = raw['data']
            selected = reports.select(data, identifier, clean.get('report_id'))

            def project(raw, stamp):
                return facts.read(raw, identifier, selected, stamp, limit, clean.get('concepts'))
            # The key includes the report hash, and a report never changes.
            document = fetch(selected['json_url'], 'report_facts', project, age=86400,
                scope={'hash': selected['hash'], 'report_id': selected['id'],
                       'limit': limit, 'concepts': clean.get('concepts')})
            return envelope(document['data'])
        except reports.AmbiguousReport as error:
            # Visible, never silent: the caller sees every variant and picks one.
            return envelope(None, [{'code': 'ambiguous_report', 'severity': 'error',
                                    'message': MESSAGES['ambiguous_report'], 'candidates': error.candidates}])
        except (ValueError, KeyError, TypeError, AttributeError) as error:
            code = 'invalid_request' if isinstance(error, self.wire.WireError) else str(error)
            if code not in MESSAGES:
                code = 'invalid_response'
            return envelope(None, [{'code': code, 'severity': 'error', 'message': MESSAGES.get(code,
                'The repository response could not be interpreted safely. Retry the read.')}])
        except (RuntimeError, OSError) as error:
            if operation == 'resolve' and getattr(error, 'raw', {}).get('error') == 'missing_observation':
                return envelope(None, outcome='empty')
            if operation == 'filings' and getattr(error, 'raw', {}).get('error') == 'missing_observation':
                # The repository does not know this entity (its filings path is 404): core's next source may serve.
                return envelope(None, [{'code': 'not_covered', 'severity': 'warning',
                                        'message': 'filings.xbrl.org has no reports of this entity.'}], outcome='empty')
            failure = self.connector.detail(error)
            return self.connector.qualify_failure(envelope(None, [{'code': failure['code'],
                'severity': 'error', 'message': failure['message']}]), getattr(error, 'raw', {}))


def register(ctx):
    wire, connector, selection = helpers(ctx)
    platform = importlib.import_module(wire.__package__ + '._platform').platform
    reader = Reader(wire, connector, extract=lambda response, check: platform().read_document(response, check))
    ctx.register_skill('xbrl-filings', Path(__file__).parent / 'skills/xbrl-filings/SKILL.md',
        description='Read public ESEF and other XBRL annual report links and reported financial facts by company LEI.',
        frontmatter={'platforms': ['linux', 'macos']})
    for operation, schema in reader.definitions.items():
        def handler(arguments, _operation=operation, **context):
            helpers(ctx)
            access = selection.native_access_scope()
            result = reader.invoke(_operation, arguments, context.get('cancelled'), cache_scope=access)
            helpers(ctx)
            if selection.native_access_scope() != access:
                return json.dumps(envelope(None, [{'code': 'unavailable', 'severity': 'error',
                    'message': 'Native access changed during the XBRL repository read.'}]))
            return json.dumps(result, allow_nan=False)
        ctx.register_tool(name=TOOLS[operation], toolset='pythia-core', schema=schema, handler=handler)
    agent = platform().register_agent_tool
    agent(ctx, 'esef_fundamentals', TOOLS['fundamentals'], 'Annual revenue, earnings, balance sheet from ESEF '
          'reports. IFRS figures of an EU or UK company\'s latest annual report on filings.xbrl.org, or an explicit '
          'report_id, with exact periods, units and precision; several reports for one period come back as '
          'candidates to choose from. It gives the report\'s own year; for the prior-year comparative, read the '
          'concept (such as ifrs-full:Revenue) with esef_company_facts on the same report_id.')
    agent(ctx, 'esef_company_facts', TOOLS['facts'], 'Reported IFRS facts from one ESEF annual report. Named concepts '
          'of an explicit report_id (esef_fundamentals names it), with every period the report tags, including the '
          'prior-year comparatives, and dimensions and precision.')
