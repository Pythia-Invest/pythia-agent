"""Native SEC reference connector: ticker catalogue, filer resolve and filing content.

It uses the market-data plugin's shared execution helpers and reads its declared
configuration through core; identity decisions stay with Pythia's core.
"""
import importlib
import json

from . import catalogue, configuration_shim, financials, identity
from .client import Transport
from .definition import CHECK, TOOLS, schemas

# Retained-copy ages per SEC resource, in seconds.
AGES = {'directory': 86400, 'submissions': 300, 'companyfacts': 3600}
UNCONFIGURED = {
    'missing': "SEC needs a contact name and email before it can be used: set sec_identity in Pythia's settings.json.",
    'invalid': "The SEC contact (sec_identity in Pythia's settings.json) must be a name followed by an email address.",
}


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


def envelope(data, issues=None):
    issues = issues or []
    failed = any(issue.get('severity', 'error') == 'error' for issue in issues)
    outcome = ('partial' if failed else 'ok') if data else ('error' if failed else 'empty')
    return {'schema_version': 1, 'outcome': outcome, 'data': data, 'issues': issues}


def failure(code, message):
    return envelope(None, [{'code': code, 'severity': 'error', 'message': message}])


class Reader:
    """``setting(key)`` returns ``(status, value)`` from core configuration custody."""

    def __init__(self, wire, connector, setting, *, transport=None):
        self.wire, self.connector, self.setting = wire, connector, setting
        self.definitions = schemas(wire)
        self.reads = connector.WorkerReads(transport or Transport(connector))

    def contact(self):
        readiness, value = self.setting('sec_identity')
        if readiness == 'configured' and not identity.contact(value):
            return 'invalid', None
        return readiness, value

    def ready(self):
        return self.contact()[0] == 'configured'

    def check(self):
        readiness = self.contact()[0]
        return {'schema_version': 1, 'data': {'status': 'valid'} if readiness == 'configured' else
                {'status': 'invalid', 'message': UNCONFIGURED.get(readiness, UNCONFIGURED['invalid'])}}

    def invoke(self, operation, arguments, cancelled=None, scope=None):
        if operation == CHECK:
            return self.check()
        try:
            clean = self.wire.validate_parameters(self.definitions[operation]['parameters'], arguments)
            refresh = clean.pop('refresh', False)
            readiness, contact = self.contact()
            if readiness != 'configured':
                return failure('not_configured', UNCONFIGURED.get(readiness, UNCONFIGURED['invalid']))
            budget = self.connector.connection('sec', contact, concurrency=2, per_minute=120)
            reuse = not refresh and (scope is None or scope.get('cacheable', False))

            def fetch(endpoint, number=None):
                request = {'operation': endpoint, 'contact': contact, **({'cik': number} if number else {})}
                return self.reads.read([__file__], request, {}, cancelled=cancelled, cache_scope=scope,
                                       age=AGES[endpoint] if reuse else 0, budget=budget, timeout=15)

            if operation == 'catalogue':
                raw = fetch('directory')
                return envelope(catalogue.page(raw['data'], raw['observed_at'],
                                               limit=clean.get('limit', 1000), cursor=clean.get('cursor')))
            if operation == 'resolve':
                return self.resolve(clean, fetch)
            number = identity.from_reference(clean['native_ref'])
            if operation == 'filings':
                raw = fetch('submissions', number)
                return envelope(financials.filings(raw['data'], number, raw['observed_at'], clean.get('limit', 20)))
            if operation == 'facts' and len(set(clean['concepts'])) != len(clean['concepts']):
                raise ValueError('invalid_request')
            raw = fetch('companyfacts', number)
            if operation == 'fundamentals':
                return envelope(financials.fundamentals(raw['data'], number, raw['observed_at'], clean.get('limit', 20)))
            return envelope(financials.native_facts(raw['data'], number, raw['observed_at'],
                clean['taxonomy'], clean['concepts'], clean.get('limit', 100)))
        except (ValueError, KeyError, TypeError) as error:
            if str(error) == 'snapshot_changed':
                return failure('snapshot_changed', 'The SEC ticker file changed while paging. Restart without a cursor.')
            if str(error) == 'invalid_request' or isinstance(error, self.wire.WireError):
                return failure('invalid_request', 'The SEC request is invalid.')
            return failure('invalid_response', 'SEC returned data that could not be interpreted safely. Retry the read.')
        except (RuntimeError, OSError) as error:
            detail = self.connector.detail(error)
            return self.connector.qualify_failure(failure(detail['code'], detail['message']), getattr(error, 'raw', {}))

    @staticmethod
    def resolve(clean, fetch):
        if ('cik' in clean) == ('ticker' in clean) or ('mic' in clean and 'ticker' not in clean):
            raise ValueError('invalid_request')
        if 'cik' in clean:
            number = identity.cik(clean['cik'])
            raw = fetch('submissions', number)
            return envelope([identity.submission_record(raw['data'], number, raw['observed_at'])])
        raw = fetch('directory')
        matches = identity.directory_matches(raw['data'], raw['observed_at'], clean['ticker'], clean.get('mic'))
        issues = [{'code': 'ambiguous', 'severity': 'warning',
                   'message': 'Several SEC filers list this ticker; none is selected.'}] if len(matches) > 1 else []
        return envelope(matches, issues)


def register(ctx):
    wire, connector, _selection, platform = helpers(ctx)
    reader = Reader(wire, connector, lambda key: setting(ctx, platform, key))

    def available(configured=True):
        # Unconfigured SEC tools are hidden from the agent; configuration.json
        # declares the required contact and the check reports its state.
        try:
            helpers(ctx)
        except RuntimeError:
            return False
        return not configured or reader.ready()

    def handler(operation):
        def read(arguments, **context):
            try:
                selection = helpers(ctx)[2]  # A disabled dependency cannot serve retained results.
                if operation == CHECK:
                    return json.dumps(reader.check())
                access = selection.native_access_scope()
                result = reader.invoke(operation, arguments, context.get('cancelled'), scope=access)
                if selection.native_access_scope() != access:
                    result = failure('unavailable', 'Access changed during the SEC read.')
            except RuntimeError:
                result = failure('unavailable', 'The SEC connector is unavailable.')
            return json.dumps(result, allow_nan=False)
        return read

    for operation, schema in reader.definitions.items():
        ctx.register_tool(name=TOOLS[operation], toolset='pythia-sec', schema=schema, handler=handler(operation),
                          check_fn=(lambda: available(False)) if operation == CHECK else available)
