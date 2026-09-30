"""Native Suilend plugin: Suilend's lending markets on Sui as subjects for Pythia's core.

One keyless, read-only operation serves a bulk catalogue (`catalogue.py`) that core's identity sync ingests. Core's
connector toolkit bounds the reads; there are no rates, caps, positions, prices or search here.
"""
import json

from . import catalogue
from .definition import TOOLS, schemas

POLICY = 'suilend-catalogue-1'  # the projection cached reads carry; bump it when the projection changes


def envelope(data, issues=(), **extra):
    issues = list(issues)
    outcome = ('partial' if issues else 'ok') if data is not None else 'error'
    return {'schema_version': 1, 'outcome': outcome, 'data': data, 'issues': issues, **extra}


def issue(code, message, severity='error'):
    return {'code': code, 'severity': severity, 'message': message}


def drift(found, unpriced):
    """The warnings a read's counts raise: each is a reason the catalogue may not be what Suilend lists. `unpriced` is
    the coin types the price service cannot price, or None when it could not be asked."""
    return [issue(code, message.format(count=count), 'warning') for code, count, message in (
        ('invalid_reference', found['rejected'], '{count} malformed Suilend records were left out.'),
        ('duplicate_market', found['duplicated'], '{count} Suilend records share a market object id with another and '
                                                  'were left out.'),
        ('unlisted_reserves', found['unlisted'], '{count} Suilend markets list no reserves in the API; they carry no '
                                                 'token links.'),
        ('unkeyed_coin_type', found['unkeyed'], '{count} Suilend coin types have no CAIP-19 key; they carry no token '
                                                'link.'),
        ('unpriced_coin', len(unpriced or ()), '{count} coins Suilend lists have no usable price in its price service; '
                                               'its on-chain price for such a reserve can be a placeholder. No price '
                                               'is stated.'),
        ('prices_unavailable', unpriced is None, 'Suilend\'s price service could not be read, so placeholder prices '
                                                 'went unchecked.')) if count]


class Reader:
    def __init__(self, wire, connector, *, transport=None):
        self.wire, self.connector = wire, connector
        self.definitions = schemas(wire)
        if transport is None:
            transport = connector.Transport(provider=catalogue.PROVIDER, origins=catalogue.ORIGINS,
                                            max_bytes=2_000_000, socket_timeout=5)
        self.reads = connector.WorkerReads(transport)

    def read(self, operation, url, prepare, *, budget, cancelled, cache_scope):
        return self.reads.read([__file__], {'operation': operation, 'url': url}, {}, age=3600,
                               cache_scope={'access': cache_scope, 'policy': POLICY}, prepare_result=prepare,
                               cancelled=cancelled, budget=budget, timeout=30)

    def prepared(self, project, *arguments):
        def prepare(raw):
            try:
                return {**raw, 'data': project(raw['data'], *arguments)}
            except (ValueError, TypeError, KeyError, AttributeError):
                raise self.connector.SourceFailure({'error': 'invalid_response'}) from None
        return prepare

    def invoke(self, operation, arguments, *, cancelled=None, cache_scope=None):
        try:
            clean = self.wire.validate_parameters(self.definitions[operation]['parameters'], arguments)
            # Suilend answers 300 requests a minute for `/markets` and 60 for prices; a sync makes two or three.
            budget = self.connector.connection(catalogue.PROVIDER, concurrency=2, per_minute=30)
            options = {'budget': budget, 'cancelled': cancelled, 'cache_scope': cache_scope}
            read = self.read('markets', catalogue.MARKETS_URL, self.prepared(catalogue.market_rows), **options)
            unpriced = []
            try:  # the price check only alarms: Suilend's catalogue does not depend on it
                for url, asked in catalogue.price_requests(read['data']):
                    unpriced += self.read('prices', url, self.prepared(catalogue.unpriced, asked), **options)['data']
            except (RuntimeError, OSError):
                if cancelled and cancelled():
                    raise
                unpriced = None
            return envelope(catalogue.page(clean['scope'], read['data'], read['observed_at']),
                            drift(read['data'], unpriced), next_cursor=None)
        except self.wire.WireError:
            return envelope(None, [issue('invalid_request', 'The Suilend request is invalid.')])
        except ValueError:
            return envelope(None, [issue('invalid_response', 'Suilend returned data that could not be read.')])
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
            return json.dumps(envelope(None, [issue('unavailable', 'Native access changed during the Suilend read.')]))
        return json.dumps(result, allow_nan=False)
    ctx.register_tool(name=TOOLS['catalogue'], toolset='pythia-core', schema=reader.definitions['catalogue'],
                      handler=handler)
