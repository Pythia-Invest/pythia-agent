"""Native Sui plugin: DeFi protocols, tokens and on-chain markets on Sui as subjects for Pythia's core.

One keyless, read-only catalogue operation pages the chain's state (`catalogue.py`) that core's identity sync ingests, and
one read serves a DeepBook pool's governance parameters. Everything is read from Sui's public GraphQL endpoint through
the one chain layer (`chain.py`) and per-protocol modules (`deepbook.py`, `alphalend.py`, `bucket.py`).
"""
import json

from . import catalogue, chain, deepbook
from .definition import TOOLS, schemas

ALARMS = (  # (found key, issue code, message): each is a reason the catalogue may not be what the chain holds
    ('missing', 'package_unknown', 'The chain does not know the original package of {names}: left out.'),
    ('not_original', 'package_not_original', 'A package id of {names} is not the original of its family: left out.'),
    ('changed', 'package_family_changed', 'The latest package of {names} lost the module it is checked by: left out.'),
    ('unexpected_root', 'unexpected_root', '{count} protocol root object(s) are not what the plugin expects; their '
                                           'markets were left out.'),
    ('malformed', 'invalid_reference', '{count} markets were not readable as the protocol\'s own and were left out.'),
    ('unverified', 'unverified_protocol', '{count} markets of a protocol the chain did not confirm were left out.'),
    ('unkeyed_coin_type', 'unkeyed_coin_type', '{count} market assets hold a coin type with no CAIP-19 key; they carry '
                                               'no token link.'),
    ('no_metadata_coins', 'metadata_missing', '{count} coin types have no on-chain metadata; their listing has no name.'),
)


def envelope(data, issues=(), **extra):
    issues = list(issues)
    outcome = ('partial' if issues else 'ok') if data is not None else 'error'
    return {'schema_version': 1, 'outcome': outcome, 'data': data, 'issues': issues, **extra}


def issue(code, message, severity='error'):
    return {'code': code, 'severity': severity, 'message': message}


def drift(found):
    """The warnings a read's counts raise. A list names protocols, a number counts records."""
    return [issue(code, message.format(count=len(value) if isinstance(value, list) else value,
                                       names=', '.join(value) if isinstance(value, list) else ''), 'warning')
            for key, code, message in ALARMS if (value := found.get(key))]


class Reader:
    def __init__(self, wire, connector, *, transport=None):
        self.wire, self.connector = wire, connector
        self.definitions = schemas(wire)
        if transport is None:
            # The largest answer is a chunk of DeepBook pool states (about 100 KB) or AlphaLend's markets (about 150 KB).
            transport = connector.Transport(provider=chain.PROVIDER, origins=chain.ORIGINS, max_bytes=4_000_000,
                                            socket_timeout=5)
        self.reads, self.memo = connector.WorkerReads(transport), {}

    def invoke(self, operation, arguments, *, cancelled=None, cache_scope=None):
        try:
            clean = self.wire.validate_parameters(self.definitions[operation]['parameters'], arguments)
            link = chain.Chain(self.reads, self.connector, scope=cache_scope, cancelled=cancelled, memo=self.memo)
            if operation == 'metrics':
                return self.metrics(link, clean['market'])
            batch, following, found = catalogue.page(link, clean['scope'], clean.get('cursor'))
            return envelope(batch, drift(found), next_cursor=following)
        except self.wire.WireError:
            return envelope(None, [issue('invalid_request', 'The Sui request is invalid.')])
        except chain.ChainError as error:
            return envelope(None, [issue(error.code, error.message)])
        except (ValueError, KeyError, TypeError, AttributeError, IndexError):
            return envelope(None, [issue('invalid_response', 'Sui returned data that could not be read.')])
        except (RuntimeError, OSError) as error:
            detail = self.connector.detail(error)
            return self.connector.qualify_failure(envelope(None, [issue(detail['code'], detail['message'])]),
                                                  getattr(error, 'raw', {}))

    def metrics(self, link, market):
        found = deepbook.governance(link, chain.address(market))
        if found is None:
            return envelope(None, [issue('not_covered', 'Only DeepBook V3 pools have governance parameters here.')])
        rows, epoch = found
        return envelope({'market': chain.address(market), 'basis': 'on_chain', 'as_of': link.observed_at,
                         'governance_epoch': epoch, 'metrics': rows,
                         'definition': 'DeepBook pool trade_params: fractions of trade value (from 1e9) and DEEP staked '
                                       'for the discount. Governance changes them by vote at an epoch boundary; a '
                                       '`next_` row is voted for the next epoch and not yet in force.'})


def register(ctx):
    import pythia_platform as platform  # published by Pythia core (ADR 0045)
    platform.require(1)
    reader = Reader(platform.wire, platform.connector)

    def handler(operation):
        def run(arguments, **context):
            access = platform.access.native_access_scope()
            result = reader.invoke(operation, arguments, cancelled=context.get('cancelled'), cache_scope=access)
            if platform.access.native_access_scope() != access:
                return json.dumps(envelope(None, [issue('unavailable', 'Native access changed during the Sui read.')]))
            return json.dumps(result, allow_nan=False)
        return run
    for operation, name in TOOLS.items():
        ctx.register_tool(name=name, toolset='pythia-core', schema=reader.definitions[operation],
                          handler=handler(operation))
