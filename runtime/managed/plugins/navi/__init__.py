"""Native NAVI plugin: NAVI Protocol's lending reserves as subjects for Pythia's core.

A keyless, read-only operation pages a bulk catalogue (`catalogue.py`) that core's identity sync ingests, and a second
serves a reserve's supplied, borrowed, utilisation and rates (`metrics.py`) through core's `fundamentals` concept. Core's
connector toolkit bounds the reads; there are no positions, profiles or search here.
"""
import json

from . import catalogue, metrics
from .definition import TOOLS, schemas

MARKETS = 'navi_markets'  # native plugin setting: NAVI market keys; unset or empty is every market the SDK names
POLICY = 'navi-catalogue-2'  # the projection cached reads carry; bump it when the projection changes
METRICS_POLICY = 'navi-metrics-1'  # the same, for the metrics projection
METRICS_AGE = 60  # seconds: NAVI caches its answer for a minute


def envelope(data, issues=(), **extra):
    issues = list(issues)
    outcome = ('partial' if issues else 'ok') if data is not None else 'error'
    return {'schema_version': 1, 'outcome': outcome, 'data': data, 'issues': issues, **extra}


def issue(code, message, severity='error'):
    return {'code': code, 'severity': severity, 'message': message}


def drift(found):
    """The warnings a read's counts raise: each is a reason the catalogue may not be what NAVI lists."""
    return [issue(code, message.format(count=count), 'warning') for code, count, message in (
        ('invalid_reference', found['rejected'], '{count} malformed NAVI records were left out.'),
        ('unexpected_market', found['unrequested'], '{count} NAVI records for markets not asked for were left out.'),
        ('duplicate_pool', found['duplicated'], '{count} NAVI records share a Pool object id with another and were '
                                                'left out.'),
        ('unkeyed_coin_type', found['unkeyed'], '{count} NAVI reserves hold a coin type with no CAIP-19 key; they '
                                                'carry no token link.'),
        ('empty_market', len(found['empty']), '{count} requested NAVI markets came back with no reserve: ' +
                                              ', '.join(found['empty']) + '.')) if count]


class Reader:
    def __init__(self, wire, connector, *, transport=None):
        self.wire, self.connector = wire, connector
        self.definitions = schemas(wire)
        if transport is None:
            # The whole list is one download (2026-09-30: 150 KB for all 11 markets).
            transport = connector.Transport(provider=catalogue.PROVIDER, origins=catalogue.ORIGINS,
                                            max_bytes=8_000_000, socket_timeout=5)
        self.reads = connector.WorkerReads(transport)

    def invoke(self, operation, arguments, *, markets=None, cancelled=None, cache_scope=None):
        try:
            clean = self.wire.validate_parameters(self.definitions[operation]['parameters'], arguments)
            wanted = catalogue.markets(markets)
            # A conservative local ceiling: NAVI publishes no limit, and a sync makes one request.
            budget = self.connector.connection(catalogue.PROVIDER, concurrency=2, per_minute=30)
            if operation == 'metrics':
                return self.metrics(clean['native_ref'], wanted, cache_scope, cancelled, budget)

            def prepare(raw):
                try:
                    return {**raw, 'data': catalogue.reserve_rows(raw['data'], wanted)}
                except (ValueError, TypeError, KeyError, AttributeError):
                    raise self.connector.SourceFailure({'error': 'invalid_response'}) from None
            # Both scopes read the one directory; a sync's pages share this hour-old snapshot (`page`).
            read = self.reads.read([__file__], {'operation': 'reserves', 'url': catalogue.url(wanted)}, {},
                                   age=3600, cache_scope={'access': cache_scope, 'policy': POLICY},
                                   prepare_result=prepare, cancelled=cancelled, budget=budget, timeout=30)
            batch, following = catalogue.page(clean['scope'], read['data'], clean.get('cursor'),
                                              read['observed_at'], wanted)
            return envelope(batch, drift(read['data']), next_cursor=following)
        except self.wire.WireError:
            return envelope(None, [issue('invalid_request', 'The NAVI request is invalid.')])
        except ValueError as error:
            if str(error) == 'invalid_configuration':
                return envelope(None, [issue('invalid_configuration', f'The {MARKETS} setting must list NAVI '
                                             'market keys such as `main`, as a list or comma-separated text.')])
            return envelope(None, [issue('invalid_response', 'NAVI returned data that could not be read.')])
        except (RuntimeError, OSError) as error:
            detail = self.connector.detail(error)
            return self.connector.qualify_failure(envelope(None, [issue(detail['code'], detail['message'])]),
                                                  getattr(error, 'raw', {}))

    def metrics(self, native_ref, wanted, cache_scope, cancelled, budget):
        """One reserve's metric rows from a fresh read of the directory (a reserve is found by its Pool object id)."""
        if (native_ref.get('provider'), native_ref.get('native_scope')) != (catalogue.PROVIDER, 'reserve'):
            return envelope(None, [issue('invalid_request', 'Metrics are read for a NAVI reserve only.')])

        def prepare(raw):
            try:
                return {**raw, 'data': metrics.reserve_figures(raw['data'], wanted)}
            except (ValueError, TypeError, KeyError, AttributeError):
                raise self.connector.SourceFailure({'error': 'invalid_response'}) from None
        url = catalogue.url(wanted)
        read = self.reads.read([__file__], {'operation': 'reserve_metrics', 'url': url}, {}, age=METRICS_AGE,
                               cache_scope={'access': cache_scope, 'policy': METRICS_POLICY}, prepare_result=prepare,
                               cancelled=cancelled, budget=budget, timeout=30)
        figures = read['data'].get(native_ref['native_id'])
        if figures is None:
            return envelope(None, [issue('unknown_reserve', f'NAVI lists no single reserve with this Pool object id in '
                                         f'the {MARKETS} markets.')])
        limits = ["as_of is when Pythia read NAVI's answer, which NAVI caches for a minute; the reserve itself was last "
                  'updated on chain at updated_at.',
                  "Rates are NAVI's base rates before incentive rewards; amounts carry interest accrued to that update."]
        return envelope({'reserve': {'pool': figures['pool'], 'market': figures['market'], 'symbol': figures['symbol'],
                                     'updated_at': figures['updated_at']},
                         'metrics': metrics.reserve_rows(figures, read['observed_at'], url), 'limitations': limits})


def register(ctx):
    import pythia_platform as platform  # published by Pythia core (ADR 0045)
    platform.require(1)
    reader = Reader(platform.wire, platform.connector)

    def handle(operation):
        def read(arguments, **context):
            access = platform.access.native_access_scope()
            result = reader.invoke(operation, arguments, markets=ctx.get_config(MARKETS),
                                   cancelled=context.get('cancelled'), cache_scope=access)
            if platform.access.native_access_scope() != access:
                return json.dumps(envelope(None, [issue('unavailable', 'Native access changed during the NAVI read.')]))
            return json.dumps(result, allow_nan=False)
        return read
    for operation, schema in reader.definitions.items():
        ctx.register_tool(name=TOOLS[operation], toolset='pythia-core', schema=schema, handler=handle(operation))
    platform.register_agent_tool(
        ctx, 'navi_reserve_metrics', TOOLS['metrics'],
        'NAVI reserve supply, borrow, utilisation and rates. From NAVI\'s own API, each row with its definition and '
        'as-of. Use it for a NAVI reserve (market) subject. Supplied and borrowed are US dollars at NAVI\'s oracle '
        'price; rates are yearly percentages before incentive rewards.')
