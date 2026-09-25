"""Native OpenFIGI reference connector: explicit identifier resolution only.

It supplies FIGI evidence to Pythia's core, never a canonical decision, and has
no search operation. The API key is optional; without it the documented keyless
limits apply.
"""
import importlib
import json

from . import configuration_shim, mapping
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


def setting(ctx, platform, key):
    """``(status, value)`` from core ``platform.configuration`` custody.

    configuration_shim stands in only while core lacks that reader.
    """
    try:
        reader = getattr(platform.platform(), 'configuration', None) or configuration_shim
        return reader.value(ctx, key)
    except (RuntimeError, OSError, ValueError, KeyError, TypeError):
        return 'invalid', None  # An unreadable declaration or store never yields a usable value.


def failure(code, message):
    return {'schema_version': 1, 'outcome': 'error', 'data': None,
            'issues': [{'code': code, 'severity': 'error', 'message': message}]}


class Resolver:
    """``setting(key)`` returns ``(status, value)`` from core configuration custody."""

    def __init__(self, wire, connector, setting, *, transport=None):
        self.wire, self.connector, self.setting = wire, connector, setting
        self.definition = schema()
        self.reads = connector.WorkerReads(transport or Transport(connector))

    def invoke(self, arguments, cancelled=None, scope=None):
        try:
            jobs = mapping.validate(self.wire.validate_parameters(self.definition['parameters'], arguments)['jobs'])
            readiness, key = self.setting('openfigi_api_key')
            notes = [] if readiness != 'invalid' else [{'code': 'invalid_configuration', 'severity': 'warning',
                'message': 'The OpenFIGI API key in Settings is invalid; keyless limits were used.'}]
            key = key if readiness == 'configured' else None
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
    resolver = Resolver(wire, connector, lambda key: setting(ctx, platform, key))

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
