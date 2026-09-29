"""Native SEC reference connector: filer resolve and filing content.

It uses core's connector toolkit and reads its declared configuration through
core (`pythia_platform`); identity decisions stay with Pythia's core.
"""
from collections import OrderedDict
import json
from threading import Lock
import time
from datetime import datetime, timedelta, timezone

from . import filings, financials, identity
from .client import Transport
from .definition import TOOLS, schemas

# Retained-copy ages per SEC resource, in seconds.
AGES = {'directory': 86400, 'submissions': 300, 'submissions_page': 86400, 'companyfacts': 3600}
PAGES = 3  # older submissions pages read at most, for a forms search
REREAD_KEPT = 4  # companyfacts re-read for a newly filed report, kept per filing until the retained copy expires
PAGING_SECONDS = 20  # one deadline for all of them
# SEC's own contact rule, reported under core's needs_configuration code.
INVALID_CONTACT = {'schema_version': 1, 'outcome': 'error', 'data': None, 'issues': [{
    'code': 'needs_configuration', 'severity': 'error',
    'fields': [{'key': 'sec_identity', 'label': 'SEC contact', 'file': 'settings.json', 'status': 'invalid'}],
    'message': 'This plugin needs configuration in the Pythia config folder: SEC contact (sec_identity in '
               'settings.json) must be a name followed by an email address, in plain ASCII.'}]}


def envelope(data, issues=None):
    issues = issues or []
    failed = any(issue.get('severity', 'error') == 'error' for issue in issues)
    outcome = ('partial' if failed else 'ok') if data else ('error' if failed else 'empty')
    return {'schema_version': 1, 'outcome': outcome, 'data': data, 'issues': issues}


def failure(code, message):
    return envelope(None, [{'code': code, 'severity': 'error', 'message': message}])


class Reader:
    """``configuration()`` returns core's ``platform.configuration`` for ``ctx``."""

    def __init__(self, wire, connector, configuration, ctx, *, transport=None, extract=None):
        self.wire, self.connector, self.configuration, self.ctx = wire, connector, configuration, ctx
        self.definitions = schemas(wire)
        self.transport = transport or Transport(connector)
        self.reads = connector.WorkerReads(self.transport)
        self.extract = extract  # core's document reader (platform.read_document)
        # A fresh companyfacts read is not retained by WorkerReads, so a re-read for a new filing is kept here, once
        # per filing and access scope, until the retained copy it replaces would have expired.
        self._reread, self._reread_lock = OrderedDict(), Lock()

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

            def fetch(endpoint, number=None, page=None, timeout=15, fresh=False):
                request = {'operation': endpoint, 'contact': contact, **({'cik': number} if number else {}),
                           **({'page': page} if page else {})}
                return self.reads.read([__file__], request, {}, cancelled=cancelled, cache_scope=scope,
                                       age=AGES[endpoint] if reuse and not fresh else 0, budget=budget, timeout=timeout)

            if operation == 'resolve':
                return self.resolve(clean, fetch)
            number = identity.from_reference(clean['native_ref'])
            if operation == 'document':  # streamed through core's reader, never retained here
                url = filings.document_url(number, clean['id'], clean['url'])
                raw = self.transport.document(url, contact, cancelled=cancelled or (lambda: False), budget=budget,
                                              read=self.extract)
                return envelope({**raw['data'], 'url': url, 'observed_at': raw['observed_at']})
            if operation == 'filings':
                raw = fetch('submissions', number)
                limit, forms, kinds = clean.get('limit', 20), clean.get('forms'), clean.get('kinds')
                pages, issues = [], []
                if forms or kinds:  # an annual report must not be crowded out: read older pages back five years, at most three
                    first = filings.filings(raw['data'], number, raw['observed_at'], limit, forms, kinds=kinds)
                    since = (datetime.now(timezone.utc) - timedelta(days=5 * 366)).date().isoformat()
                    deadline = time.monotonic() + PAGING_SECONDS
                    if len(first['filings']) < limit and (first['coverage']['searched_back_to'] or '9') > since:
                        for name in filings.older_pages(raw['data'], since)[:PAGES]:
                            left = deadline - time.monotonic()
                            try:  # best effort: an older page never costs the filings already read
                                if left < 1:
                                    raise TimeoutError('timeout')
                                pages.append(fetch('submissions_page', number, name, timeout=min(15, left))['data'])
                            except (RuntimeError, OSError, ValueError, KeyError, TypeError):
                                issues.append({'code': 'incomplete', 'severity': 'warning', 'message':
                                               'Older SEC filings could not be searched; the list is incomplete.'})
                                break
                result = filings.filings(raw['data'], number, raw['observed_at'], limit, forms, pages, kinds)
                if issues:
                    result['coverage']['complete'] = False
                return envelope(result, [*issues, *self.drift(operation, result.get('drift'))])
            if operation == 'facts' and len(set(clean['concepts'])) != len(clean['concepts']):
                raise ValueError('invalid_request')
            raw = fetch('companyfacts', number)
            if operation == 'fundamentals':
                return self.fundamentals(raw, number, fetch, clean.get('limit', 20), scope if reuse else False)
            return envelope(financials.native_facts(raw['data'], number, raw['observed_at'],
                clean['taxonomy'], clean['concepts'], clean.get('limit', 100)))
        except (ValueError, KeyError, TypeError) as error:
            if str(error) == 'invalid_request' or isinstance(error, self.wire.WireError):
                return failure('invalid_request', 'The SEC request is invalid.')
            return failure('invalid_response', 'SEC returned data that could not be interpreted safely. Retry the read.')
        except (RuntimeError, OSError) as error:
            detail = self.connector.detail(error)
            return self.connector.qualify_failure(failure(detail['code'], detail['message']), getattr(error, 'raw', {}))

    def drift(self, operation, drift):
        """Unexpected SEC input, logged for maintainers; a warning only when it changes the rows."""
        issue = filings.drift_issue(drift)
        for kind, values in (drift or {}).items():
            self.connector.emit('source_drift', level='info' if kind == 'unknown_form' else 'warning', provider='sec',
                                operation=operation, code=kind, count=sum(values.values()))
        return [] if issue is None else [issue]

    def reread(self, key, fetch, number):
        """companyfacts read fresh once for `key` (CIK, accession, scope); later calls reuse it until it expires."""
        now = time.monotonic()
        with self._reread_lock:
            for stale in [item for item, (expires, _) in self._reread.items() if expires <= now]:
                del self._reread[stale]
            if key in self._reread:
                return self._reread[key][1]
        current = fetch('companyfacts', number, fresh=True)
        with self._reread_lock:
            self._reread[key] = (now + AGES['companyfacts'], current)
            while len(self._reread) > REREAD_KEPT:
                self._reread.popitem(last=False)
        return current

    def fundamentals(self, raw, number, fetch, limit, scope):
        """Fundamentals marked stale, visibly, when companyfacts lacks the latest periodic report.

        A retained companyfacts copy read before that report was accepted is read once more first, once per filing,
        so the alarm reports SEC's lag, not the cache's. `scope` is the retained copies' access scope, or False
        when this read retains nothing."""
        try:
            submissions = fetch('submissions', number)
            state = financials.freshness(submissions['data'], raw['data'], number, submissions['observed_at'])
            if (state and state['status'] == 'stale' and scope is not False
                    and financials.read_before(raw['observed_at'], state['latest_filing'])):
                try:
                    key = (number, state['latest_filing']['accession'], json.dumps(scope, sort_keys=True, default=str))
                    current = self.reread(key, fetch, number)
                    state = financials.freshness(submissions['data'], current['data'], number, submissions['observed_at'])
                    raw = current
                except (RuntimeError, OSError, ValueError, KeyError, TypeError):
                    pass  # the retained copy stays, marked stale
        except (RuntimeError, OSError, ValueError, KeyError, TypeError):
            state = {'status': 'unknown', 'latest_filing': None, 'reason': 'SEC\'s filing list could not be read, '
                     'so whether these facts include the latest report is unknown.'}
        result = financials.fundamentals(raw['data'], number, raw['observed_at'], limit)
        if state is None:  # nothing to check against, which is not a warning
            result['freshness'] = {'status': 'unknown', 'latest_filing': None,
                                   'reason': 'SEC lists no recent 10-K, 10-Q, 20-F, 40-F or 6-K with XBRL for this filer.'}
            return envelope(result)
        result['freshness'] = state
        if state['status'] == 'fresh':
            return envelope(result)
        result['limitations'].insert(0, state['reason'])
        if state['status'] == 'stale':
            self.connector.emit('source_drift', level='warning', provider='sec', operation='fundamentals',
                                code='companyfacts_behind', count=1)
        return envelope(result, [{'code': 'stale' if state['status'] == 'stale' else 'freshness_unknown',
                                  'severity': 'warning', 'message': state['reason']}])

    @staticmethod
    def resolve(clean, fetch):
        identifiers = clean['identifiers']
        if not identifiers:
            raise ValueError('invalid_request')
        if 'cik' in identifiers:
            number = identity.cik(identifiers['cik'])
            raw = fetch('submissions', number)
            return envelope(identity.claims([identity.submission_record(raw['data'], number, raw['observed_at'])]))
        ticker, mic = identifiers['ticker_mic'].split('@')
        if mic not in identity.OPERATING_MICS.values():
            return envelope(None)  # SEC lists no other venue; no request is made.
        raw = fetch('directory')
        matches = identity.directory_matches(raw['data'], raw['observed_at'], ticker, mic)
        issues = [{'code': 'ambiguous', 'severity': 'warning',
                   'message': 'Several SEC filers list this ticker; none is selected.'}] if len(matches) > 1 else []
        return envelope(identity.claims(matches) if matches else None, issues)


def register(ctx):
    import pythia_platform as platform  # published by Pythia core (ADR 0045)
    platform.require(1)
    reader = Reader(platform.wire, platform.connector, lambda: platform.configuration, ctx,
                    extract=platform.read_document)

    def handler(operation):
        def read(arguments, **context):
            try:
                access = platform.access.native_access_scope()
                result = reader.invoke(operation, arguments, context.get('cancelled'), scope=access)
                if platform.access.native_access_scope() != access:
                    result = failure('unavailable', 'Access changed during the SEC read.')
            except RuntimeError:
                result = failure('unavailable', 'The SEC connector is unavailable.')
            return json.dumps(result, allow_nan=False)
        return read

    for operation, schema in reader.definitions.items():
        ctx.register_tool(name=TOOLS[operation], toolset='pythia-core', schema=schema, handler=handler(operation))
    agent = platform.register_agent_tool
    agent(ctx, 'sec_company_facts', TOOLS['facts'], 'Reported financial facts (revenue, net income) from SEC. Named '
          'XBRL concepts of one taxonomy (us-gaap, ifrs-full, dei, srt) for a US-listed or foreign SEC filer, such as '
          'Revenues, NetIncomeLoss or Assets, keeping periods, filing revisions and units. Use sec_fundamentals for '
          'the standard annual set; pythia_filings lists the filings.')
    agent(ctx, 'sec_fundamentals', TOOLS['fundamentals'], 'Annual revenue, earnings and balance sheet from SEC EDGAR. '
          'Supported reported annual income, cash-flow and balance-sheet facts of a US GAAP or IFRS filer, with actual '
          'annual periods; no TTM, quarterly subtraction or conversion.')
