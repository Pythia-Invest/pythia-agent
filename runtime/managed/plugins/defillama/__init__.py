"""Native DefiLlama plugin: DeFi protocols and yield pools as subjects for Pythia's core.

One keyless, read-only operation pages a bulk catalogue (`catalogue.py`) that core's identity sync ingests. Core's
connector toolkit bounds the two directory reads; there are no metrics, profiles or search here.
"""
import json

from . import catalogue
from .definition import TOOLS, schemas

CHAINS = 'defillama_chains'  # native plugin setting: DefiLlama chain names; empty means every chain
POLICY = 'defillama-catalogue-1'  # the projection cached reads carry; bump it when the projection changes


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

    def invoke(self, operation, arguments, *, chains=catalogue.DEFAULT_CHAINS, cancelled=None, cache_scope=None):
        try:
            clean = self.wire.validate_parameters(self.definitions[operation]['parameters'], arguments)
            wanted = catalogue.chains(chains)
            # A conservative local ceiling, not a published free-API limit.
            budget = self.connector.connection(catalogue.PROVIDER, concurrency=2, per_minute=30)

            def fetch(scope, project):
                def prepare(raw):
                    try:
                        return {**raw, 'data': project(raw['data'])}
                    except (ValueError, TypeError, KeyError, AttributeError):
                        raise self.connector.SourceFailure({'error': 'invalid_response'}) from None
                # Every page of a sync reads the same hour-old snapshots, so its offsets stay consistent.
                return self.reads.read([__file__], {'operation': scope, 'url': catalogue.URLS[scope]}, {},
                    age=3600, cache_scope={'access': cache_scope, 'policy': POLICY}, prepare_result=prepare,
                    cancelled=cancelled, budget=budget, timeout=30)

            read = {'protocols': fetch('protocols', catalogue.protocol_rows), 'pools': fetch('pools', catalogue.pool_rows)}
            scope = clean['scope']
            batch, following = catalogue.page(scope, read['protocols']['data'], read['pools']['data'], wanted,
                                              clean.get('cursor'), read[scope]['observed_at'])
            skipped = read[scope]['data']['rejected']
            issues = [issue('invalid_reference', f'{skipped} malformed DefiLlama records were left out.',
                            'warning')] if skipped else []
            return envelope(batch, issues, next_cursor=following)
        except self.wire.WireError:
            return envelope(None, [issue('invalid_request', 'The DefiLlama request is invalid.')])
        except ValueError as error:
            if str(error) == 'invalid_configuration':
                return envelope(None, [issue('invalid_configuration', f'The {CHAINS} setting must list DefiLlama '
                                             'chain names, as a list or comma-separated text.')])
            if str(error) == 'invalid_request':
                return envelope(None, [issue('invalid_request', 'The catalogue cursor is past the last page.')])
            return envelope(None, [issue('invalid_response', 'DefiLlama returned data that could not be read.')])
        except (RuntimeError, OSError) as error:
            detail = self.connector.detail(error)
            return self.connector.qualify_failure(envelope(None, [issue(detail['code'], detail['message'])]),
                                                  getattr(error, 'raw', {}))


def register(ctx):
    import pythia_platform as platform  # published by Pythia core (ADR 0045)
    platform.require(1)
    reader = Reader(platform.wire, platform.connector)

    def handler(arguments, **context):
        access = platform.access.native_access_scope()
        result = reader.invoke('catalogue', arguments, chains=ctx.get_config(CHAINS, list(catalogue.DEFAULT_CHAINS)),
                               cancelled=context.get('cancelled'), cache_scope=access)
        if platform.access.native_access_scope() != access:
            return json.dumps(envelope(None, [issue('unavailable', 'Native access changed during the DefiLlama read.')]))
        return json.dumps(result, allow_nan=False)
    ctx.register_tool(name=TOOLS['catalogue'], toolset='pythia-core', schema=reader.definitions['catalogue'],
                      handler=handler)
