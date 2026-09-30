"""Native Cetus plugin: Cetus CLMM pools on Sui as subjects for Pythia's core.

One keyless, read-only operation pages a bulk catalogue (`catalogue.py`) that core's identity sync ingests. Core's
connector toolkit bounds each directory read; there are no prices, positions, profiles or search here.
"""
import json

from . import catalogue
from .definition import TOOLS, schemas

POLICY = 'cetus-catalogue-1'  # the projection cached reads carry; bump it when the projection changes


def envelope(data, issues=(), **extra):
    issues = list(issues)
    outcome = ('partial' if issues else 'ok') if data is not None else 'error'
    return {'schema_version': 1, 'outcome': outcome, 'data': data, 'issues': issues, **extra}


def issue(code, message, severity='error'):
    return {'code': code, 'severity': severity, 'message': message}


def drift(found):
    """The warnings a read's counts raise: each is a reason the catalogue may not be what Cetus lists."""
    return [issue(code, message.format(count=count), 'warning') for code, count, message in (
        ('invalid_reference', found['rejected'], '{count} malformed Cetus records were left out.'),
        ('fee_mismatch', found['mismatched'], '{count} Cetus pools whose fee label differs from their on-chain fee '
                                              'rate were left out.'),
        ('unkeyed_coin_type', found['unkeyed'], '{count} Cetus pool coins have a coin type with no CAIP-19 key; they '
                                                'carry no token link.'),
        ('floor_not_reached', found['capped'], 'Cetus\'s pool list ran past the page limit before reaching the '
                                               'liquidity floor, so smaller pools above it may be missing.')) if count]


class Reader:
    def __init__(self, wire, connector, *, transport=None):
        self.wire, self.connector = wire, connector
        self.definitions = schemas(wire)
        if transport is None:
            transport = connector.Transport(provider=catalogue.PROVIDER, origins=catalogue.ORIGINS,
                                            max_bytes=8_000_000, socket_timeout=5)
        self.reads = connector.WorkerReads(transport)

    def invoke(self, operation, arguments, *, cancelled=None, cache_scope=None):
        try:
            clean = self.wire.validate_parameters(self.definitions[operation]['parameters'], arguments)
            # Cetus answers 300 requests a minute (`x-ratelimit-limit`); a sync makes about five.
            budget = self.connector.connection(catalogue.PROVIDER, concurrency=2, per_minute=60)

            def prepare(raw):
                try:
                    return {**raw, 'data': catalogue.pool_rows(raw['data'])}
                except (ValueError, TypeError, KeyError, AttributeError):
                    raise self.connector.SourceFailure({'error': 'invalid_response'}) from None
            # Pools come in descending liquidity, 100 a request, until the floor; a sync's pages share these
            # hour-old reads.
            reads = []
            for index in range(catalogue.MAX_PAGES):
                reads.append(self.reads.read([__file__], {'operation': 'pools', 'url': catalogue.url(index * catalogue.PAGE)},
                                             {}, age=3600, cache_scope={'access': cache_scope, 'policy': POLICY},
                                             prepare_result=prepare, cancelled=cancelled, budget=budget, timeout=30))
                if reads[-1]['data']['end']:
                    break
            found = catalogue.merge([read['data'] for read in reads])
            batch, following = catalogue.page(clean['scope'], found, clean.get('cursor'), reads[0]['observed_at'])
            return envelope(batch, drift(found), next_cursor=following)
        except self.wire.WireError:
            return envelope(None, [issue('invalid_request', 'The Cetus request is invalid.')])
        except ValueError:
            return envelope(None, [issue('invalid_response', 'Cetus returned data that could not be read.')])
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
            return json.dumps(envelope(None, [issue('unavailable', 'Native access changed during the Cetus read.')]))
        return json.dumps(result, allow_nan=False)
    ctx.register_tool(name=TOOLS['catalogue'], toolset='pythia-core', schema=reader.definitions['catalogue'],
                      handler=handler)
