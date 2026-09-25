"""Native filings.xbrl.org connector: issuer resolve and report content by LEI.

Shared host support owns transport and authorization; market-data's connector
library supplies bounded reads. There is deliberately no search operation.
"""
import importlib
import json
from pathlib import Path

from . import facts, identity, reports
from .definition import TOOLS, schemas

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
    def __init__(self, wire, connector, *, transport=None):
        self.wire, self.connector = wire, connector
        self.definitions = schemas(wire)
        if transport is None:
            http = importlib.import_module(connector.__package__ + '.public_http')
            transport = http.Transport(provider=identity.PROVIDER, origins=(identity.ORIGIN,),
                headers={'User-Agent': 'Pythia investment research'}, max_bytes=16_000_000)
        self.reads = connector.WorkerReads(transport)

    def invoke(self, operation, arguments, cancelled=None, cache_scope=None):
        try:
            clean = self.wire.validate_parameters(self.definitions[operation]['parameters'], arguments)
            refresh = clean.pop('refresh', False)
            budget = self.connector.connection(identity.PROVIDER, 'public', concurrency=2, per_minute=60)

            def fetch(url, label, validate, age=3600, scope=None):
                def prepare(raw):
                    try:
                        return {**raw, 'data': validate(raw['data'], raw['observed_at'])}
                    except (ValueError, KeyError, TypeError, AttributeError):
                        raise self.connector.SourceFailure({'error': 'invalid_response'}) from None
                return self.reads.read([__file__], {'operation': label, 'url': url, 'format': 'json'}, {},
                    cancelled=cancelled, budget=budget, age=0 if refresh else age, timeout=20,
                    prepare_result=prepare, cache_scope=['xbrl-validated:2', cache_scope, scope])

            def validate_reports(raw, stamp):
                reports.filings(raw, identifier, stamp, 50)
                return raw

            if operation == 'resolve':
                identifier = identity.lei(clean['lei'])

                def validate_entity(raw, stamp):
                    identity.entity(raw, stamp, identifier)
                    return raw
                raw = fetch(identity.entity_url(identifier), 'entity', validate_entity, age=86400)
                return envelope({'status': 'resolved', 'request': {'scheme': 'lei', 'value': identifier},
                                 **identity.entity(raw['data'], raw['observed_at'], identifier)})
            identifier = identity.from_reference(clean['native_ref'])
            limit = clean.get('limit', 20)
            if operation == 'filings':
                # Share one bounded metadata page with simultaneous fundamentals.
                raw = fetch(identity.reports_url(identifier), 'reports', validate_reports)
                return envelope(reports.filings(raw['data'], identifier, raw['observed_at'], limit))
            if clean.get('report_id'):
                def validate_report(raw, stamp):
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
            document = fetch(selected['json_url'], 'report_facts', project,
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
                return envelope({'status': 'not_found', 'request': {'scheme': 'lei', 'value': clean['lei']}},
                                outcome='empty')
            failure = self.connector.detail(error)
            return self.connector.qualify_failure(envelope(None, [{'code': failure['code'],
                'severity': 'error', 'message': failure['message']}]), getattr(error, 'raw', {}))


def register(ctx):
    ctx.register_skill('xbrl-filings', Path(__file__).parent / 'skills/xbrl-filings/SKILL.md',
        description='Read public ESEF and other XBRL annual report links and reported financial facts by company LEI.',
        frontmatter={'platforms': ['linux', 'macos']})
    wire, connector, selection = helpers(ctx)
    reader = Reader(wire, connector)
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
        ctx.register_tool(name=TOOLS[operation], toolset='pythia-xbrl-filings', schema=schema, handler=handler)
