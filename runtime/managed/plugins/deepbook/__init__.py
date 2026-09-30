"""Native DeepBook plugin: DeepBook V3 pools on Sui as subjects for Pythia's core.

One keyless, read-only operation serves a bulk catalogue (`catalogue.py`) that core's identity sync ingests. Core's
connector toolkit bounds the one directory read; there are no prices, order books, profiles or search here.
"""
import json

from . import catalogue
from .definition import TOOLS, schemas

POLICY = 'deepbook-catalogue-1'  # the projection cached reads carry; bump it when the projection changes


def envelope(data, issues=(), **extra):
    issues = list(issues)
    outcome = ('partial' if issues else 'ok') if data is not None else 'error'
    return {'schema_version': 1, 'outcome': outcome, 'data': data, 'issues': issues, **extra}


def issue(code, message, severity='error'):
    return {'code': code, 'severity': severity, 'message': message}


def drift(found):
    """The warnings a read's counts raise: each is a reason the catalogue may not be what the indexer lists."""
    return [issue(code, message.format(count=count), 'warning') for code, count, message in (
        ('invalid_reference', found['rejected'], '{count} malformed DeepBook records were left out.'),
        ('duplicate_pool', found['duplicated'], '{count} DeepBook records share a pool object id with another and '
                                                'were left out.'),
        ('unkeyed_coin_type', found['unkeyed'], '{count} DeepBook pool coins have a coin type with no CAIP-19 key; '
                                                'they carry no token link.')) if count]


class Reader:
    def __init__(self, wire, connector, *, transport=None):
        self.wire, self.connector = wire, connector
        self.definitions = schemas(wire)
        if transport is None:
            transport = connector.Transport(provider=catalogue.PROVIDER, origins=catalogue.ORIGINS,
                                            max_bytes=2_000_000, socket_timeout=5)
        self.reads = connector.WorkerReads(transport)

    def invoke(self, operation, arguments, *, cancelled=None, cache_scope=None):
        try:
            clean = self.wire.validate_parameters(self.definitions[operation]['parameters'], arguments)
            # The indexer publishes no limit; a sync makes one request.
            budget = self.connector.connection(catalogue.PROVIDER, concurrency=2, per_minute=30)

            def prepare(raw):
                try:
                    return {**raw, 'data': catalogue.pool_rows(raw['data'])}
                except (ValueError, TypeError, KeyError, AttributeError):
                    raise self.connector.SourceFailure({'error': 'invalid_response'}) from None
            # Both scopes read the one list (2026-09-30: 14 KB, 26 pools); a sync shares this hour-old snapshot.
            read = self.reads.read([__file__], {'operation': 'pools', 'url': catalogue.URL}, {}, age=3600,
                                   cache_scope={'access': cache_scope, 'policy': POLICY}, prepare_result=prepare,
                                   cancelled=cancelled, budget=budget, timeout=30)
            return envelope(catalogue.page(clean['scope'], read['data'], read['observed_at']), drift(read['data']),
                            next_cursor=None)
        except self.wire.WireError:
            return envelope(None, [issue('invalid_request', 'The DeepBook request is invalid.')])
        except ValueError:
            return envelope(None, [issue('invalid_response', 'DeepBook returned data that could not be read.')])
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
        result = reader.invoke('catalogue', arguments, cancelled=context.get('cancelled'), cache_scope=access)
        if platform.access.native_access_scope() != access:
            return json.dumps(envelope(None, [issue('unavailable', 'Native access changed during the DeepBook read.')]))
        return json.dumps(result, allow_nan=False)
    ctx.register_tool(name=TOOLS['catalogue'], toolset='pythia-core', schema=reader.definitions['catalogue'],
                      handler=handler)
