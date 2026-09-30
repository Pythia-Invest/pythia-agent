"""A fake of Sui's public GraphQL endpoint and the loaded `pythia-sui` plugin, for its tests (`test_sui_catalogue.py`).

`fixtures/sui-chain.json` holds objects cut from the live chain on 2026-09-30 and trimmed to the fields the plugin reads:
six of DeepBook V3's 89 pools (SUI/USDC, DEEP/SUI, WAL/SUI, COIN_GY/USDC with exactly 8 resting orders, CETUS/SUI with 7,
PUMPKIN/USDC with none), five of AlphaLend's 36 markets (SUI, USDC, DEEP twice, and the generic DEEPBOOK_STAKED<USDC>),
Bucket's `Config` with three of its vaults, the Sui Bridge's supported tokens, two Wormhole wrapped assets, the on-chain
metadata of twelve coins, and the latest package and version of each protocol family. The fake answers by the name each
request is sent under and refuses what the real endpoint refuses: a request over 5,000 bytes, and more than four
`coinMetadata` lookups in one request (the real limit is a budget of about 21 backing-store lookups).
"""
from copy import deepcopy
import importlib
import importlib.util
import json
from pathlib import Path
import sys

from market_data_fixture import connector, wire
from test_plugin_contracts import PLUGINS, checked_batch

ROOT = PLUGINS / 'sui'
spec = importlib.util.spec_from_file_location('sui_fixture', ROOT / '__init__.py', submodule_search_locations=[str(ROOT)])
plugin = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = plugin
spec.loader.exec_module(plugin)
catalogue = importlib.import_module('sui_fixture.catalogue')
chain = importlib.import_module('sui_fixture.chain')
seed = importlib.import_module('sui_fixture.seed')
STAMP = '2026-09-30T10:00:00+00:00'
FIXTURE = json.loads((Path(__file__).parent / 'fixtures' / 'sui-chain.json').read_text())

SUI = '0x' + '2'.rjust(64, '0') + '::sui::SUI'
USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
DEEP = '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP'
WAL = '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL'
USDB = '0xe14726c336e81b32328e92afc37345d159f5b550b09fa92bd43640cfdd0a0cfd::usdb::USDB'
USDT_BRIDGE = '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT'
BTC_BRIDGE = '0xaafb102dd0902f5055cadecd687fb5b71ca82ef0e0285d90afde828ec58ca96b::btc::BTC'
WUSDC = '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN'
WSOL = '0xb7844e289a8410e50fb3ca48d69eb9cf29e27d223ef90353fe1bd8e27ff8f3f8::coin::COIN'
SSUI = '0xaafc4f740de0dd0dde642a31148fb94517087052f19afb0f7bed1dc41a50c77b::scallop_sui::SCALLOP_SUI'
GONE = '0x' + 'ab' * 32 + '::m::Gone'  # a coin with no CoinMetadata
TEST_SEED = {'test': (SUI, USDC, USDT_BRIDGE, BTC_BRIDGE, WUSDC, WSOL, SSUI, GONE)}
COIN_GY = '0x8a99b479476950871a0cf29a1cde19c283515067d4cd93da5b446b448ec512e9::coin_gy::COIN_GY'
DEEPBOOK = '0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963357661df5d3204809'
ALPHALEND = '0xd631cd66138909636fc3f73ed75820d0c5b76332d1644608ed1c85ea2b8219b4'
BUCKET = '0x9f835c21d21f8ce519fec17d679cd38243ef2643ad879e7048ba77374be4036e'
REFUSED = 'Exceeded the maximum number (21) of queries that require dedicated access to a backing store in a single request.'


def pool(base, quote):
    """A DeepBook pool of the fixture by the struct names of its coins."""
    def pair(item):
        return tuple(arg.split('::')[-1] for arg in item['type'].split('<', 1)[1][:-1].split(','))
    return next(item for item in FIXTURE['deepbook']['pools'] if pair(item) == (base, quote))


class Sui:
    """A fake of Sui's GraphQL endpoint: a transport answering from the fixture, by the name a request is sent under."""

    def __init__(self, limit=5000, lookups=4):
        self.fx, self.calls, self.failures, self.limit, self.lookups = deepcopy(FIXTURE), [], [], limit, lookups
        self.asked = []  # the coins asked for metadata, in order
        bucket = self.fx['bucket']
        self.objects = {item['address']: item for item in [bucket['config'], *bucket['objects']]}
        self.objects.update({address: {'address': address, 'type': kind, 'json': None}
                             for address, kind in bucket['vaults'].items()})
        self.objects.update({item['address']: item for item in self.fx['deepbook']['pools']})

    def run_worker(self, _command, request, _environment, **_options):
        body, name = request['json'], request['operation']
        size = len(json.dumps(body, separators=(',', ':')).encode())
        self.calls.append((name, size))
        if self.failures:
            raise connector.SourceFailure({'error': self.failures.pop(0)})
        if size > self.limit:
            answer = {'errors': [{'message': f'Query payload too large: {size}B > {self.limit}B'}]}
        else:
            answer = getattr(self, 'q_' + name)(body['variables'])
        return {'data': answer, 'observed_at': STAMP, 'issues': []}

    def names(self):
        return [name for name, _size in self.calls]

    @staticmethod
    def listed(items, after, per=2):
        start = int(after or 0)
        return {'pageInfo': {'hasNextPage': start + per < len(items), 'endCursor': str(start + per)},
                'nodes': items[start:start + per]}

    @staticmethod
    def node(item):
        return {'address': item['address'], 'asMoveObject': {'contents': {'type': {'repr': item['type']},
                                                                            'json': item['json']}}}

    def q_Family(self, v):
        data = {}
        for index in range(len(v) // 2):
            family = self.fx['families'].get(v[f'a{index}'])
            data[f'a{index}'] = family and {
                'address': family['latest'], 'version': family['version'],
                'module': {'name': v[f'm{index}']} if family['anchor'] == v[f'm{index}'] else None,
                'first': {'address': family.get('original', v[f'a{index}'])}}
        return {'data': data}

    def q_DeepBookPools(self, v):
        return {'data': {'objects': self.listed([self.node(item) for item in self.fx['deepbook']['pools']], v['after'])}}

    def q_DeepBookState(self, v):
        return {'data': {key: {'dynamicFields': {'nodes': [{'value': {'json': self.fx['deepbook']['inner'].get(inner)}}]}}
                         for key, inner in v.items()}}

    def q_AlphaLendProtocol(self, v):
        return {'data': {'objects': self.listed([self.node(self.fx['alphalend']['root'])], None)}}

    def q_AlphaLendMarkets(self, v):
        assert v['a'] == self.fx['alphalend']['root']['json']['markets']['id']
        fields = [{'address': item['address'], 'name': {'json': item['key']},
                   'value': {'type': {'repr': item['type']}, 'json': item['json']}} for item in self.fx['alphalend']['fields']]
        return {'data': {'address': {'dynamicFields': self.listed(fields, v['after'])}}}

    def q_Get(self, v):
        return {'data': {key: self.objects.get(address) and self.node(self.objects[address]) for key, address in v.items()}}

    q_BucketConfig = q_BucketConfigObjects = q_BucketVaults = q_DeepBookPool = q_Get

    def q_CoinMetadata(self, v):
        data, errors = {}, []
        self.asked += list(v.values())
        for index in range(len(v)):
            if index >= self.lookups:
                data[f'a{index}'] = None
                errors.append({'message': REFUSED, 'path': [f'a{index}']})
            else:
                data[f'a{index}'] = self.fx['metadata'].get(v[f't{index}'])
        return {'data': data, **({'errors': errors} if errors else {})}

    def q_Bridge(self, _v):
        return {'data': {'object': {'asMoveObject': {'contents': {'json': self.fx['bridge']['root']}}}}}

    def q_BridgeInner(self, _v):
        inner = self.fx['bridge']['inner']
        return {'data': {'address': {'dynamicFields': {'pageInfo': {'hasNextPage': False, 'endCursor': None}, 'nodes': [{
            'address': inner['address'], 'name': {'json': inner['key']},
            'value': {'type': {'repr': inner['type']}, 'json': inner['json']}}]}}}}

    def q_WormholeState(self, _v):
        state = self.fx['wormhole']['state']
        return {'data': {'object': {'asMoveObject': {'contents': {'type': {'repr': state['type']}, 'json': state['json']}}}}}

    def q_Wormhole(self, v):
        data = {}
        for index in range(len(v) - 1):
            coin = v[f't{index}'].split('Key<')[1].rstrip('>')
            asset = self.fx['wormhole']['assets'].get(coin)
            data[f'a{index}'] = {'dynamicField': {'value': asset and {'type': {'repr': asset['type']}, 'json': asset['json']}}}
        return {'data': data}


def reader(sui=None):
    sui = sui or Sui()
    return plugin.Reader(wire, connector, transport=sui), sui


def run(scope, sui=None, using=None):
    """Every page of a scope, each checked by core against the plugin's contract: (results, the fake). `using` is a
    (reader, fake) already in use, so its cache and coin metadata carry over."""
    read, sui = using or reader(sui)
    results, cursor = [], None
    while True:
        result = read.invoke('catalogue', {'scope': scope, **({'cursor': cursor} if cursor else {})}, cache_scope='test')
        results.append(result)
        if result['data'] is not None:
            checked_batch('sui', result)
        cursor = result.get('next_cursor')
        if cursor is None:
            return results, sui


def claims(scope, sui=None):
    results, _sui = run(scope, sui)
    return [claim for result in results for claim in (result['data'] or {}).get('claims', [])]


def records(found, level=None):
    return [claim for claim in found if 'level' in claim and level in (None, claim['level'])]


def by_id(found, level):
    return {claim['native_ref']['native_id'] if claim.get('native_ref') else claim['identifiers'][0]['value']: claim
            for claim in records(found, level)}


def issues(results):
    return {item['code']: item['message'] for result in results for item in result['issues']}


def listing(coin):
    return chain.caip19(coin)
