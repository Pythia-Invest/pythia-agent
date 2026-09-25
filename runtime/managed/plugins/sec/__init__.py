"""Native SEC reference connector: ticker catalogue, filer resolve and filing content.

It uses the market-data plugin's shared execution helpers and reads its declared
configuration through core; identity decisions stay with Pythia's core.
"""
import importlib
import json

from . import catalogue, financials, identity
from .client import Transport
from .definition import TOOLS, schemas

# Retained-copy ages per SEC resource, in seconds.
AGES = {'directory': 86400, 'submissions': 300, 'companyfacts': 3600}
# SEC's own contact rule, reported under core's needs_configuration code.
INVALID_CONTACT = {'schema_version': 1, 'outcome': 'error', 'data': None, 'issues': [{
    'code': 'needs_configuration', 'severity': 'error',
    'fields': [{'key': 'sec_identity', 'label': 'SEC contact', 'file': 'settings.json', 'status': 'invalid'}],
    'message': 'This plugin needs configuration in the Pythia config folder: SEC contact (sec_identity in '
               'settings.json) must be a name followed by an email address.'}]}


def helpers(ctx):
    from hermes_cli.plugins import get_plugin_manager
    loaded = get_plugin_manager()._plugins.get('pythia-market-data')
    if not ctx.has_plugin('pythia-market-data') or loaded is None or not loaded.enabled or loaded.module is None:
        raise RuntimeError('unavailable')
    namespace = loaded.module.__name__
    return tuple(importlib.import_module(namespace + '.' + name) for name in ('wire', 'connector', 'selection', '_platform'))


def envelope(data, issues=None):
    issues = issues or []
    failed = any(issue.get('severity', 'error') == 'error' for issue in issues)
    outcome = ('partial' if failed else 'ok') if data else ('error' if failed else 'empty')
    return {'schema_version': 1, 'outcome': outcome, 'data': data, 'issues': issues}


def failure(code, message):
    return envelope(None, [{'code': code, 'severity': 'error', 'message': message}])


class Reader:
    """``configuration()`` returns core's ``platform.configuration`` for ``ctx``."""

    def __init__(self, wire, connector, configuration, ctx, *, transport=None):
        self.wire, self.connector, self.configuration, self.ctx = wire, connector, configuration, ctx
        self.definitions = schemas(wire)
        self.reads = connector.WorkerReads(transport or Transport(connector))

    def contact(self):
        """``(contact, None)`` when usable, else ``(None, needs-configuration result)``."""
        configuration = self.configuration()
        blocked = configuration.needs_configuration(self.ctx)
        if blocked is not None:
            return None, blocked
        value = configuration.value(self.ctx, 'sec_identity')[1]
        return (value, None) if identity.contact(value) else (None, INVALID_CONTACT)

    def invoke(self, operation, arguments, cancelled=None, scope=None):
        contact, blocked = self.contact()
        if blocked is not None:
            return blocked
        try:
            clean = self.wire.validate_parameters(self.definitions[operation]['parameters'], arguments)
            refresh = clean.pop('refresh', False)
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
    reader = Reader(wire, connector, lambda: platform.platform().configuration, ctx)

    def available():
        try:
            helpers(ctx)
            return True
        except RuntimeError:
            return False

    def handler(operation):
        def read(arguments, **context):
            try:
                selection = helpers(ctx)[2]  # A disabled dependency cannot serve retained results.
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
                          check_fn=available)
