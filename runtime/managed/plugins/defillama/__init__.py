"""Native DefiLlama plugin: DeFi protocols and yield pools as subjects for Pythia's core.

A keyless, read-only operation pages a bulk catalogue (`catalogue.py`) that core's identity sync ingests, and a second
serves a protocol's metrics (`metrics.py`: TVL, fees, revenue, volume) through core's `fundamentals` concept. Core's
connector toolkit bounds the reads; there are no profiles or search here.
"""
import json

from . import catalogue, metrics
from .definition import TOOLS, schemas

CHAINS = 'defillama_chains'  # native plugin setting: DefiLlama chain names; unset or empty is Sui, `all` every chain
POLICY = 'defillama-catalogue-2'  # the projection cached reads carry; bump it when the projection changes
SUMMARY_AGE = 900  # seconds a dimension summary is reused: DefiLlama updates them hourly at most


def envelope(data, issues=(), **extra):
    issues = list(issues)
    outcome = ('partial' if issues else 'ok') if data is not None else 'error'
    return {'schema_version': 1, 'outcome': outcome, 'data': data, 'issues': issues, **extra}


def issue(code, message, severity='error'):
    return {'code': code, 'severity': severity, 'message': message}


class Reader:
    def __init__(self, wire, connector, *, transport=None):
        self.wire, self.connector = wire, connector
        self.definitions = schemas(wire)
        if transport is None:
            # Both directories are whole-list downloads (2026-09-30: 9.0 MB and 11.6 MB).
            transport = connector.Transport(provider=catalogue.PROVIDER, origins=catalogue.ORIGINS,
                                            max_bytes=24_000_000, socket_timeout=5)
        self.reads = connector.WorkerReads(transport)

    def read(self, operation, url, project, *, age, cache_scope, cancelled, budget):
        """One validated read of `url`, projected by `project`; a malformed answer is an invalid response."""
        def prepare(raw):
            try:
                return {**raw, 'data': project(raw['data'])}
            except (ValueError, TypeError, KeyError, AttributeError):
                raise self.connector.SourceFailure({'error': 'invalid_response'}) from None
        return self.reads.read([__file__], {'operation': operation, 'url': url}, {}, age=age,
                               cache_scope={'access': cache_scope, 'policy': POLICY}, prepare_result=prepare,
                               cancelled=cancelled, budget=budget, timeout=30)

    def invoke(self, operation, arguments, *, chains=None, cancelled=None, cache_scope=None):
        try:
            clean = self.wire.validate_parameters(self.definitions[operation]['parameters'], arguments)
            # A conservative local ceiling, not a published free-API limit.
            budget = self.connector.connection(catalogue.PROVIDER, concurrency=2, per_minute=30)

            def snapshot(name):  # a sync's pages share these hour-old snapshots; a refresh between pages is safe (`page`)
                project = catalogue.protocol_rows if name == 'protocols' else catalogue.pool_rows
                return self.read(name, catalogue.URLS[name], project, age=3600, cache_scope=cache_scope,
                                 cancelled=cancelled, budget=budget)

            if operation == 'metrics':
                return self.metrics(clean['native_ref'], snapshot('protocols'), cache_scope, cancelled, budget)
            wanted = catalogue.chains(chains)
            read = {'protocols': snapshot('protocols'), 'pools': snapshot('pools')}
            scope = clean['scope']
            unknown = catalogue.unknown_chains(read['protocols']['data'], read['pools']['data'], wanted)
            if unknown and not wanted - set(unknown):
                # Nothing matched: an empty complete page would tell core every subject is gone.
                return envelope(None, [issue('unknown_chain', f'DefiLlama has no pool or protocol on '
                                             f'{", ".join(unknown)}; check the {CHAINS} setting.')])
            batch, following = catalogue.page(scope, read['protocols']['data'], read['pools']['data'], wanted,
                                              clean.get('cursor'), read[scope]['observed_at'])
            skipped = read[scope]['data']['rejected']
            issues = [issue('invalid_reference', f'{skipped} malformed DefiLlama records were left out.',
                            'warning')] if skipped else []
            if unknown:
                issues.append(issue('unknown_chain', f'DefiLlama has no pool or protocol on {", ".join(unknown)}.',
                                    'warning'))
            return envelope(batch, issues, next_cursor=following)
        except self.wire.WireError:
            return envelope(None, [issue('invalid_request', 'The DefiLlama request is invalid.')])
        except ValueError as error:
            if str(error) == 'invalid_configuration':
                return envelope(None, [issue('invalid_configuration', f'The {CHAINS} setting must list DefiLlama '
                                             'chain names, or `all`, as a list or comma-separated text.')])
            return envelope(None, [issue('invalid_response', 'DefiLlama returned data that could not be read.')])
        except (RuntimeError, OSError) as error:
            detail = self.connector.detail(error)
            return self.connector.qualify_failure(envelope(None, [issue(detail['code'], detail['message'])]),
                                                  getattr(error, 'raw', {}))

    def metrics(self, native_ref, protocols, cache_scope, cancelled, budget):
        """A protocol's TVL, fees, revenue and volume rows. A dimension that fails leaves the others, with a warning."""
        if (native_ref.get('provider'), native_ref.get('native_scope')) != (catalogue.PROVIDER, 'protocol'):
            return envelope(None, [issue('invalid_request', 'Metrics are read for a DefiLlama protocol only.')])
        found = [row for row in protocols['data']['rows'] if row['id'] == native_ref['native_id']]
        if len(found) != 1:
            return envelope(None, [issue('unknown_protocol', 'DefiLlama lists no single protocol with this id.')])
        record, observed_at = found[0], protocols['observed_at']
        rows = [row for row in [metrics.tvl_row(record, observed_at)] if row]
        issues, kept_none = [], []
        for metric, endpoint, data_type, definition, text in metrics.DIMENSIONS:
            url = metrics.summary_url(endpoint, record['slug'], data_type)
            try:
                got = self.read(f'{endpoint}:{data_type}', url, metrics.summary_rows, age=SUMMARY_AGE,
                                cache_scope=cache_scope, cancelled=cancelled, budget=budget)
            except (RuntimeError, OSError) as error:
                failure = self.connector.detail(error)
                if failure['code'] == 'invalid_request':  # DefiLlama answers 400 where it keeps no such dimension
                    kept_none.append(metric)
                else:
                    issues.append(issue(failure['code'], f"DefiLlama {metric} could not be read: {failure['message']}",
                                        'warning'))
                continue
            if got['data']['id'] != record['id']:
                issues.append(issue('identity_mismatch', f"DefiLlama's {metric} summary for {record['slug']} names "
                                    'another protocol; it is left out.', 'warning'))
                continue
            rows += metrics.dimension_rows(metric, definition, text, url, got['data'], got['observed_at'])
        limits = [f'DefiLlama keeps no {", ".join(kept_none)} for this protocol, so there is no row; that is not zero.'
                  ] if kept_none else []
        limits += ["DefiLlama's summaries carry no time of their own: as_of is when Pythia read them.",
                  'Figures cover every chain the protocol runs on, and the protocol is DefiLlama\'s own record, not '
                  'the on-chain package.']
        return envelope({'protocol': {'id': record['id'], 'name': record['name'], 'slug': record['slug'],
                                      'category': record['category']}, 'metrics': rows, 'limitations': limits}, issues)


def register(ctx):
    import pythia_platform as platform  # published by Pythia core (ADR 0045)
    platform.require(1)
    reader = Reader(platform.wire, platform.connector)

    def handle(operation):
        def read(arguments, **context):
            access = platform.access.native_access_scope()
            result = reader.invoke(operation, arguments, chains=ctx.get_config(CHAINS),
                                   cancelled=context.get('cancelled'), cache_scope=access)
            if platform.access.native_access_scope() != access:
                return json.dumps(envelope(None, [issue('unavailable', 'Native access changed during the DefiLlama read.')]))
            return json.dumps(result, allow_nan=False)
        return read
    for operation, schema in reader.definitions.items():
        ctx.register_tool(name=TOOLS[operation], toolset='pythia-core', schema=schema, handler=handle(operation))
    platform.register_agent_tool(
        ctx, 'defillama_protocol_metrics', TOOLS['metrics'],
        'DeFi protocol TVL, fees, revenue and volume from DefiLlama. Each row has its definition, period and as-of. '
        'Use it for a protocol subject DefiLlama lists. TVL differs by source and category (supplied minus borrowed '
        'for lending): compare rows only when their definition ids match.')
