"""Native OpenFIGI reference connector: explicit identifier resolution only.

It supplies FIGI evidence to Pythia's core, never a canonical decision, and has
no search operation. The API key is optional; without it the documented keyless
limits apply.
"""
import importlib
import json

from . import mapping
from .client import Transport
from .definition import TOOL, schema

AGE = 86400  # Identical successful mappings are retained for a day.


def helpers(ctx):
    from hermes_cli.plugins import get_plugin_manager
    loaded = get_plugin_manager()._plugins.get('pythia-market-data')
    if not ctx.has_plugin('pythia-market-data') or loaded is None or not loaded.enabled or loaded.module is None:
        raise RuntimeError('unavailable')
    namespace = loaded.module.__name__
    return tuple(importlib.import_module(namespace + '.' + name) for name in ('wire', 'connector', 'selection', '_platform'))


def failure(code, message):
    return {'schema_version': 1, 'outcome': 'error', 'data': None,
            'issues': [{'code': code, 'severity': 'error', 'message': message}]}


class Resolver:
    """``configuration()`` returns core's ``platform.configuration`` for ``ctx``."""

    def __init__(self, wire, connector, configuration, ctx, *, transport=None):
        self.wire, self.connector, self.configuration, self.ctx = wire, connector, configuration, ctx
        self.definition = schema()
        self.reads = connector.WorkerReads(transport or Transport(connector))

    def invoke(self, arguments, cancelled=None, scope=None):
        readiness, key = self.configuration().value(self.ctx, 'openfigi_api_key')
        notes = [] if readiness != 'invalid' else [{'code': 'invalid_configuration', 'severity': 'warning',
            'message': "The OpenFIGI API key (openfigi_api_key in Pythia's secrets.json) is invalid; "
                       'keyless limits were used.'}]
        try:
            jobs = mapping.validate(self.wire.validate_parameters(self.definition['parameters'], arguments)['jobs'])
            budget = self.connector.connection('openfigi', key, concurrency=2, per_minute=250 if key else 25)
            reuse = scope is None or scope.get('cacheable', False)
            raw = self.reads.read([__file__], {'operation': 'mapping', 'jobs': jobs, 'key': key}, {},
                                  cancelled=cancelled, cache_scope=scope, age=AGE if reuse else 0,
                                  budget=budget, timeout=30)
        except (ValueError, KeyError, TypeError) as error:
            if str(error) == 'invalid_request' or isinstance(error, self.wire.WireError):
                return failure('invalid_request', 'The OpenFIGI mapping request is invalid.')
            return failure('invalid_response', 'OpenFIGI returned data that could not be interpreted safely.')
        except (RuntimeError, OSError) as error:
            detail = self.connector.detail(error)
            return self.connector.qualify_failure(failure(detail['code'], detail['message']), getattr(error, 'raw', {}))
        return self.envelope(raw, notes)

    def envelope(self, raw, notes):
        results = raw['data']['results']
        counts = {state: sum(row['outcome'] == state for row in results)
                  for state in ('found', 'not_found', 'error', 'not_attempted')}
        issues = list(notes)
        if counts['error']:
            issues.append({'code': 'provider_error', 'severity': 'error',
                           'message': f"OpenFIGI could not map {counts['error']} job(s); see each job's message."})
        if counts['not_attempted']:
            code = next((item for item in raw.get('issues', []) if item != 'provider_error'), 'source_unavailable')
            skipped = self.connector.qualify_failure({'issues': [{'code': code, 'severity': 'error',
                'message': f"{counts['not_attempted']} job(s) were not attempted."}]}, {**raw, 'error': code})
            issues.extend(skipped['issues'])
        answered = counts['found'] + counts['not_found']
        failed = counts['error'] + counts['not_attempted']
        outcome = ('partial' if answered else 'error') if failed else 'ok' if counts['found'] else 'empty'
        data = {**raw['data'], 'observed_at': raw['observed_at']}
        return {'schema_version': 1, 'outcome': outcome, 'data': data, 'issues': issues}


def register(ctx):
    wire, connector, _selection, platform = helpers(ctx)
    resolver = Resolver(wire, connector, lambda: platform.platform().configuration, ctx)

    def available():
        try:
            helpers(ctx)
            return True
        except RuntimeError:
            return False

    def handler(arguments, **context):
        try:
            selection = helpers(ctx)[2]  # A disabled dependency cannot serve retained results.
            access = selection.native_access_scope()
            result = resolver.invoke(arguments, context.get('cancelled'), scope=access)
            if selection.native_access_scope() != access:
                result = failure('unavailable', 'Access changed during the OpenFIGI read.')
        except RuntimeError:
            result = failure('unavailable', 'The OpenFIGI connector is unavailable.')
        return json.dumps(result, allow_nan=False)

    ctx.register_tool(name=TOOL, toolset='pythia-openfigi', schema=resolver.definition,
                      handler=handler, check_fn=available)
