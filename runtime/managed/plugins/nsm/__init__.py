"""Native FCA National Storage Mechanism connector: UK issuers' regulated disclosures by LEI.

It reads the JSON search the NSM's own web page uses. That endpoint is undocumented: the FCA may change or block
it at any time, so every answer is checked for drift (records.py) and a refused search is reported as such, never
as "no disclosures". One search per issuer serves resolve, filings and news, and is kept for five minutes.
"""
from collections import OrderedDict
import importlib
import json
from threading import Lock

from . import records
from .definition import TOOLS, schemas

AGE = 300  # seconds a search answer is reused; the NSM itself trails the wire by one to two minutes
LISTED_KEPT = 1024  # issuers remembered as having disclosures, for the empty-answer alarm
# A drift code that removes rows from the answer; the others only report an unknown field or value.
DROPS = frozenset({'malformed_row', 'missing_field', 'foreign_lei', 'foreign_code', 'not_latest', 'test_submission',
                   'malformed_time', 'malformed_id', 'malformed_code', 'malformed_link', 'malformed_text'})
REFUSED = ('The NSM refused Pythia\'s search. It is an undocumented endpoint, so its interface may have changed; '
           'nothing is known about this issuer\'s disclosures until it is fixed.')


def helpers(ctx):
    from hermes_cli.plugins import get_plugin_manager
    loaded = get_plugin_manager()._plugins.get('pythia-market-data')
    if not ctx.has_plugin('pythia-market-data') or loaded is None or not loaded.enabled or loaded.module is None:
        raise RuntimeError('unavailable')
    return tuple(importlib.import_module(loaded.module.__name__ + '.' + name) for name in ('wire', 'connector', 'selection'))


def envelope(data, issues=None, outcome=None):
    issues = issues or []
    failed = any(issue['severity'] == 'error' for issue in issues)
    return {'schema_version': 1, 'outcome': outcome or (('partial' if failed else 'ok') if data else
                                                        ('error' if failed else 'empty')),
            'data': data, 'issues': issues}


def failure(code, message):
    return envelope(None, [{'code': code, 'severity': 'error', 'message': message}])


class Reader:
    def __init__(self, wire, connector, *, transport=None):
        self.wire, self.connector = wire, connector
        self.definitions = schemas(wire)
        self.reads = connector.WorkerReads(transport or connector.Transport(
            provider=records.PROVIDER, origins=(records.ORIGIN,), max_bytes=4_000_000))
        self._listed, self._lock = OrderedDict(), Lock()

    def invoke(self, operation, arguments, cancelled=None, cache_scope=None):
        try:
            clean = self.wire.validate_parameters(self.definitions[operation]['parameters'], arguments)
            if operation == 'resolve':
                identifier = records.lei(clean['identifiers']['lei'])
            else:
                identifier = records.from_reference(clean['native_ref'])
            kinds = clean.get('kinds') or ()
            # A low local budget: the endpoint is the FCA's web page's, not an API offered for programs.
            budget = self.connector.connection(records.PROVIDER, concurrency=1, per_minute=10)
            rows, drift = {}, []
            for type_codes in records.searches(kinds):
                raw, parsed = self.search(operation, identifier, type_codes, clean, budget, cancelled, cache_scope)
                drift.append(parsed['drift'])
                if not type_codes and not self.listed(identifier, parsed['total']):
                    self.connector.emit('source_drift', level='warning', provider=records.PROVIDER,
                                        operation=operation, code='known_lei_empty', count=1)
                    return failure('source_drift', 'The NSM listed disclosures of this issuer earlier and now lists '
                                                   'none. Its undocumented search may have changed; retry later.')
                rows.update((row['id'], row) for row in parsed['rows'] if not kinds or row['kind'] in kinds)
            issues = self.drift(operation, drift)
            parsed = {'rows': sorted(rows.values(), key=lambda row: row['submitted'], reverse=True)}
            if operation == 'resolve':
                return envelope(records.resolve(parsed, identifier, raw['observed_at']), issues)
            limit = clean.get('limit', 20)
            return envelope((records.filings if operation == 'filings' else records.news)(parsed, limit), issues)
        except (ValueError, KeyError, TypeError, AttributeError) as error:
            if str(error) == 'invalid_request' or isinstance(error, self.wire.WireError):
                return failure('invalid_request', 'The NSM request is invalid.')
            return failure('invalid_response', 'The NSM answered in a shape Pythia does not recognise. ' + REFUSED)
        except (RuntimeError, OSError) as error:
            raw = getattr(error, 'raw', {})
            if raw.get('error') == 'missing_observation' or (raw.get('error') == 'invalid_request'
                                                             and raw.get('limit_origin') == 'provider'):
                # The search answers an unknown issuer with an empty list; a 404, 204 or 400 means it refused.
                self.connector.emit('source_drift', level='warning', provider=records.PROVIDER, operation=operation,
                                    code='query_refused', count=1)
                return failure('source_drift', REFUSED)
            detail = self.connector.detail(error)
            return self.connector.qualify_failure(failure(detail['code'], detail['message']), raw)

    def search(self, operation, identifier, type_codes, clean, budget, cancelled, cache_scope):
        """One search answer, checked before it is kept, and its parsed disclosures."""
        def prepare(raw):
            try:
                records.disclosures(raw['data'], identifier, type_codes)
            except (ValueError, KeyError, TypeError, AttributeError):
                self.connector.emit('source_drift', level='warning', provider=records.PROVIDER,
                                    operation=operation, code='changed_shape', count=1)
                raise self.connector.SourceFailure({'error': 'invalid_response'}) from None
            return raw
        raw = self.reads.read([__file__], {'operation': 'search', 'url': records.SEARCH_URL,
                                           'json': records.query(identifier, type_codes)}, {},
                              cancelled=cancelled, budget=budget, age=0 if clean.get('refresh') else AGE,
                              timeout=20, prepare_result=prepare, cache_scope=['nsm:1', cache_scope])
        return raw, records.disclosures(raw['data'], identifier, type_codes)

    def listed(self, identifier, total):
        """False when an issuer the NSM listed disclosures of in this session now has none: an archive does not
        shrink, so the search has changed. Otherwise remembers an issuer that has disclosures."""
        with self._lock:
            if total == 0:
                return identifier not in self._listed
            self._listed[identifier] = True
            self._listed.move_to_end(identifier)
            while len(self._listed) > LISTED_KEPT:
                self._listed.popitem(last=False)
            return True

    def drift(self, operation, answers):
        """Unexpected NSM input in each answer's drift, logged for maintainers; a warning when it removed rows."""
        dropped = 0
        for code, values in ((code, values) for drift in answers for code, values in drift.items()):
            count = sum(values.values())
            dropped += count if code in DROPS else 0
            self.connector.emit('source_drift', level='warning' if code in DROPS else 'info',
                                provider=records.PROVIDER, operation=operation, code=code, count=count)
        return [{'code': 'source_drift', 'severity': 'warning', 'message': f'{dropped} NSM disclosure(s) could not '
                 'be read safely and are left out; the NSM search may have changed.'}] if dropped else []


def register(ctx):
    wire, connector, _selection = helpers(ctx)
    reader = Reader(wire, connector)

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
                result = reader.invoke(operation, arguments, context.get('cancelled'), cache_scope=access)
                if selection.native_access_scope() != access:
                    result = failure('unavailable', 'Access changed during the NSM read.')
            except RuntimeError:
                result = failure('unavailable', 'The NSM connector is unavailable.')
            return json.dumps(result, allow_nan=False)
        return read

    for operation, schema in reader.definitions.items():
        ctx.register_tool(name=TOOLS[operation], toolset='pythia-core', schema=schema, handler=handler(operation),
                          check_fn=available)
