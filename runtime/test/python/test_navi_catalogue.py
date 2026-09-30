"""NAVI's catalogue as core receives it: `/api/navi/pools` records cut from NAVI's own responses (2026-09-30).

`fixtures/navi-pools.json` keeps 13 of the 62 reserves, trimmed to the fields the plugin reads: SUI, native USDC
(in three markets), vSUI, Sui Bridge suiUSDT and wBTC, a Wormhole and a LayerZero wBTC, a deprecated Wormhole WBTC and
a deprecating YBTC.B. The rest of each test's input is invented and says so.
"""
from contextlib import closing
from copy import deepcopy
import importlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import sys
import unittest
from unittest.mock import patch

from market_data_fixture import connector, wire
from test_identity_contracts import PROVENANCE, load_reference
from test_identity_ingest import IngestTest
import test_identity_search_device as search_tests
from test_plugin_contracts import PLUGINS, checked_batch, identity
from pythia_identity_fixture import ingest, page, store  # noqa: E402
from pythia_core_queue_fixture import ingest_ops, queue_ops  # noqa: E402

ROOT = PLUGINS / 'navi'
spec = importlib.util.spec_from_file_location('navi_fixture', ROOT / '__init__.py', submodule_search_locations=[str(ROOT)])
plugin = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = plugin
spec.loader.exec_module(plugin)
catalogue = importlib.import_module('navi_fixture.catalogue')
STAMP = '2026-09-30T10:00:00+00:00'
FIXTURE = json.loads((Path(__file__).parent / 'fixtures' / 'navi-pools.json').read_text())

SUI_COIN = '0x2::sui::SUI'
NATIVE_USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
SUI_BRIDGE_USDT = '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT'
VSUI = '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT'
WBTC_LAYERZERO = '0x0041f9f9344cac094454cd574e333c4fdb132d7bcc9379bcd4aab485b2a63942::wbtc::WBTC'
GENERIC_LP = '0x' + 'cd' * 32 + f'::pool::LP<{SUI_COIN}, {NATIVE_USDC}>'
POOL_USDC = '0xa3582097b4c57630046c0c49a88bfc6b202a3ec0a9db5597c31765f7563755a8'  # main-10
ALL_MARKETS = ','.join(catalogue.MARKETS)


def reserve(unique_id):
    return next(deepcopy(item) for item in FIXTURE['data'] if item['uniqueId'] == unique_id)


def answer(*items, extra=()):
    return {'code': 0, 'data': [*items, *extra], 'meta': {}}


class Transport:
    def __init__(self, response):
        self.response, self.calls = response, []

    def run_worker(self, _command, request, _environment, **_options):
        self.calls.append(request['url'])
        return {'data': deepcopy(self.response), 'observed_at': STAMP, 'issues': []}


def reader(response=FIXTURE):
    transport = Transport(response)
    return plugin.Reader(wire, connector, transport=transport), transport


def pages(scope, markets=None, response=FIXTURE):
    """Every page of a scope, each checked by core against the plugin's contract."""
    read, _transport = reader(response)
    found, cursor = [], None
    while True:
        result = read.invoke('catalogue', {'scope': scope, **({'cursor': cursor} if cursor else {})}, markets=markets)
        found.append(checked_batch('navi', result))
        cursor = result['next_cursor']
        if cursor is None:
            return found


def claims(scope, **options):
    return [claim for batch in pages(scope, **options) for claim in batch.claims]


def records(found):
    return [claim for claim in found if isinstance(claim, identity.RecordClaim)]


def named(found, level):
    """Name by subject key, as core's ingest derives the key."""
    return {(claim.native_ref.native_id if claim.native_ref else claim.identifiers[0].value): claim.attributes.name
            for claim in records(found) if claim.level == level}


def listing(coin_type):
    return identity.subject_id('listing', {'caip19': 'sui:mainnet/coin:' + coin_type})


def issues(result):
    return {item['code']: item['message'] for item in result['issues']}


class Catalogue(unittest.TestCase):
    def test_every_page_passes_cores_checks_and_pages_add_up_to_the_scope(self):
        whole = claims('reserves')
        with patch.object(catalogue, 'PAGE_CLAIMS', 5):
            paged = pages('reserves')
        self.assertGreater(len(paged), 2)
        self.assertEqual([batch.complete for batch in paged], [False] * (len(paged) - 1) + [True])
        self.assertEqual({claim.native_ref.native_id for claim in records(whole) if claim.level == 'market'},
                         {claim.native_ref.native_id for batch in paged for claim in records(batch.claims)
                          if claim.level == 'market'})
        protocol, = pages('protocols')
        self.assertTrue(protocol.complete)

    def test_a_reserve_is_keyed_by_its_pool_object_and_the_protocol_by_its_slug(self):
        found = claims('reserves')
        pools = {claim.native_ref.native_id for claim in records(found) if claim.level == 'market'}
        self.assertEqual(pools, {item['contract']['pool'] for item in FIXTURE['data']})
        self.assertEqual(len(pools), 13)  # the same coin in three markets is three reserves, not one
        self.assertEqual({claim.native_ref.native_scope for claim in records(found) if claim.native_ref}, {'reserve'})
        protocol, = records(claims('protocols'))
        self.assertEqual((protocol.level, protocol.native_ref.native_scope, protocol.native_ref.native_id,
                          protocol.attributes.name, protocol.attributes.status),
                         ('protocol', 'protocol', 'navi-lending', 'NAVI Lending', 'active'))
        self.assertEqual(claims('reserves'), found)  # stable across runs

    def test_names_are_as_navi_shows_them(self):
        found = claims('reserves')
        names = named(found, 'market')
        self.assertEqual(names[POOL_USDC], 'NAVI Lending USDC (Main Market)')
        self.assertEqual(names[reserve('ember-0')['contract']['pool']], 'NAVI Lending USDC (eACRED / USDC Market)')
        self.assertEqual(names[reserve('main-19')['contract']['pool']], 'NAVI Lending suiUSDT (Sui Bridge, Main Market)')
        tokens = named(found, 'listing')
        self.assertEqual(tokens['sui:mainnet/slip44:784'], 'SUI')
        self.assertEqual(tokens[catalogue.sui_caip19(SUI_BRIDGE_USDT)], 'suiUSDT (Sui Bridge)')
        self.assertEqual(tokens[catalogue.sui_caip19(VSUI)], 'vSUI')
        # NAVI calls three different coins wBTC/WBTC; the bridge tells them apart.
        self.assertEqual({name for name in tokens.values() if 'BTC' in name},
                         {'wBTC (Sui Bridge)', 'WBTC (LayerZero)', 'WBTC (Wormhole)', 'YBTC.B'})

    def test_aliases_carry_the_names_navi_is_also_called_by(self):
        protocol, = records(claims('protocols'))
        self.assertEqual(protocol.attributes.aliases, ('NAVI', 'NAVI Protocol'))
        # Nothing else: a label NAVI's API does not state is not the plugin's to assert.
        self.assertEqual([claim.attributes.aliases for claim in records(claims('reserves')) if claim.level != 'protocol'
                          and claim.attributes.aliases], [])

    def test_a_deprecated_reserve_is_inactive_and_tvl_is_supplied_minus_borrowed_in_dollars(self):
        found = records(claims('reserves'))
        status = {claim.native_ref.native_id: claim.attributes.status for claim in found if claim.level == 'market'}
        self.assertEqual({item['uniqueId'] for item in FIXTURE['data'] if status[item['contract']['pool']] == 'inactive'},
                         {'main-8', 'main-30'})  # both carry isDeprecated; ember's "deprecating" market does not
        self.assertEqual(status[POOL_USDC], 'active')
        ranks = {claim.native_ref.native_id: claim.attributes.rank for claim in found if claim.level == 'market'}
        usdc = reserve('main-10')
        self.assertAlmostEqual(ranks[POOL_USDC]['tvl_usd'], (int(usdc['totalSupplyAmount']) - int(usdc['borrowedAmount']))
                               / 1e9 * float(usdc['oracle']['price']))
        self.assertLess(ranks[POOL_USDC]['tvl_usd'], int(usdc['totalSupplyAmount']) / 1e9)  # not the amount supplied
        # A record missing a value has no rank rather than a wrong one.
        for damaged in ({'borrowedAmount': None}, {'totalSupplyAmount': 'n/a'}, {'oracle': {}}):
            only = claims('reserves', markets='main', response=answer(reserve('main-10') | damaged))
            self.assertEqual([claim.attributes.rank for claim in records(only) if claim.level == 'market'], [{}])

    def test_a_reserve_is_part_of_the_protocol_and_holds_its_coin(self):
        found = claims('reserves')
        relations = [claim for claim in found if isinstance(claim, identity.RelationClaim)]
        self.assertEqual({claim.to_key.native_id for claim in relations if claim.type == 'part_of'}, {'navi-lending'})
        held = {claim.from_key.native_id: claim.to_key.value for claim in relations if claim.type == 'market_asset'}
        self.assertEqual(held[POOL_USDC], catalogue.sui_caip19(NATIVE_USDC))
        self.assertEqual(held[reserve('main-0')['contract']['pool']], 'sui:mainnet/slip44:784')
        self.assertEqual(len(held), 13)
        # Three reserves hold native USDC; it is one token record.
        self.assertEqual(sum(claim.identifiers[0].value == catalogue.sui_caip19(NATIVE_USDC)
                             for claim in records(found) if claim.level == 'listing'), 1)

    def test_two_wbtc_coins_stay_two_listings_whatever_their_symbols(self):
        held = {claim.from_key.native_id: claim.to_key.value for claim in claims('reserves')
                if isinstance(claim, identity.RelationClaim) and claim.type == 'market_asset'}
        layer_zero, wormhole = (held[reserve(unique)['contract']['pool']] for unique in ('main-32', 'main-8'))
        self.assertNotEqual(layer_zero, wormhole)
        self.assertEqual(held[reserve('wbtc-usdc-0')['contract']['pool']], layer_zero)  # the same coin in another market

    def test_the_sui_key_is_the_one_core_applies(self):
        for coin in (SUI_COIN, '0x' + '2'.rjust(64, '0') + '::sui::SUI', NATIVE_USDC, SUI_BRIDGE_USDT, VSUI):
            self.assertEqual(catalogue.sui_caip19(coin), identity.normalize_identifier('caip19', 'sui:mainnet/coin:' + coin))
        for coin in (GENERIC_LP, '0x' + 'ef' * 32 + '::' + 'm' * 40 + '::' + 'T' * 40, 'dba34672::usdc::USDC', None):
            self.assertIsNone(catalogue.sui_caip19(coin))  # NAVI's `coinType` (no 0x) is never used; `suiCoinType` is

    def test_one_sync_reads_the_directory_once_with_every_market(self):
        read, transport = reader()
        for scope in ('protocols', 'reserves'):
            self.assertIsNotNone(read.invoke('catalogue', {'scope': scope})['data'])
        self.assertEqual(transport.calls, [catalogue.URL + ALL_MARKETS])
        self.assertTrue(transport.calls[0].startswith('https://open-api.naviprotocol.io/api/navi/pools?env=prod&market=main,'))

    def test_a_refresh_between_pages_skips_no_reserve_both_snapshots_hold(self):
        ordered = sorted(item['contract']['pool'] for item in FIXTURE['data'])
        with patch.object(catalogue, 'PAGE_CLAIMS', 5):
            before, _transport = reader()
            first = before.invoke('catalogue', {'scope': 'reserves'})
            emitted = {claim['native_ref']['native_id'] for claim in first['data']['claims'] if claim.get('level') == 'market'}
            self.assertEqual(emitted, set(ordered[:len(emitted)]))
            # The hourly snapshot is refreshed mid-sync and a reserve already emitted is gone from it.
            gone = next(item for item in FIXTURE['data'] if item['contract']['pool'] == ordered[0])
            after, _transport = reader({**FIXTURE, 'data': [item for item in FIXTURE['data'] if item is not gone]})
            seen, cursor = set(emitted), first['next_cursor']
            while cursor:
                result = after.invoke('catalogue', {'scope': 'reserves', 'cursor': cursor})
                seen |= {claim.native_ref.native_id for claim in records(checked_batch('navi', result).claims)
                         if claim.level == 'market'}
                cursor = result['next_cursor']
        self.assertEqual(seen, set(ordered))


class Settings(unittest.TestCase):
    def test_the_markets_setting_defaults_to_every_market_and_selects_by_key(self):
        pools = lambda found: {claim.native_ref.native_id for claim in records(found) if claim.level == 'market'}
        every = pools(claims('reserves'))
        for cleared in ([], '', ' , ', None):  # clearing the setting restores the default
            self.assertEqual(pools(claims('reserves', markets=cleared)), every)
        read, transport = reader()
        read.invoke('catalogue', {'scope': 'reserves'}, markets=' Main, sui-usdc,main')
        self.assertEqual(transport.calls, [catalogue.URL + 'main,sui-usdc'])
        selected = {item['contract']['pool'] for item in FIXTURE['data'] if item['market'] in ('main', 'sui-usdc')}
        self.assertEqual(pools(claims('reserves', markets=['main', 'sui-usdc'])), selected)

    def test_a_market_the_sdk_does_not_name_is_shown_by_its_key(self):
        launched = reserve('main-0')
        launched['market'] = 'new-market'
        launched['contract']['pool'] = '0x' + 'ab' * 32
        found = claims('reserves', markets='new-market', response=answer(launched))
        self.assertEqual(list(named(found, 'market').values()), ['NAVI Lending SUI (new-market)'])

    def test_a_malformed_setting_is_refused(self):
        read, transport = reader()
        for bad in (7, [1], 'Main Market', 'main;rm', ['main', '../x']):
            with self.subTest(setting=bad):
                self.assertEqual(read.invoke('catalogue', {'scope': 'reserves'}, markets=bad)['issues'][0]['code'],
                                 'invalid_configuration')
        self.assertEqual(transport.calls, [])


class DriftAlarms(unittest.TestCase):
    """Each way NAVI's answer can stop matching what the plugin reads is a warning or a refusal, never a coercion."""

    def read(self, response, markets=None):
        read, _transport = reader(response)
        return read.invoke('catalogue', {'scope': 'reserves'}, markets=markets)

    def test_a_clean_answer_raises_nothing(self):
        self.assertEqual(self.read(FIXTURE, markets='main,ember,sui-usdc,wbtc-usdc')['issues'], [])

    def test_a_malformed_record_is_left_out_and_counted(self):
        broken = [reserve('main-10') | {'isDeprecated': 'false'}, reserve('main-0') | {'suiCoinType': None},
                  reserve('main-5') | {'contract': {'pool': 'pool-1'}}, reserve('main-19') | {'token': {'symbol': ''}},
                  'not a record']
        found = self.read(answer(reserve('main-21'), extra=broken), markets='main')
        self.assertEqual((found['outcome'], issues(found)), ('partial', {'invalid_reference': '5 malformed NAVI records were left out.'}))
        self.assertEqual({claim['native_ref']['native_id'] for claim in found['data']['claims']
                          if claim.get('level') == 'market'}, {reserve('main-21')['contract']['pool']})

    def test_a_record_for_a_market_nobody_asked_for_is_left_out_and_counted(self):
        found = self.read(FIXTURE, markets='main')
        self.assertEqual(issues(found), {'unexpected_market': '4 NAVI records for markets not asked for were left out.'})
        markets = {claim['attributes']['name'].rsplit('(', 1)[1] for claim in found['data']['claims']
                   if claim.get('level') == 'market'}
        self.assertEqual(markets, {'Main Market)', 'Sui Bridge, Main Market)', 'Wormhole, Main Market)',
                                   'LayerZero, Main Market)'})

    def test_two_records_sharing_a_pool_object_are_both_left_out(self):
        clash = reserve('main-0') | {'contract': {'pool': POOL_USDC}}  # SUI claiming native USDC's Pool object
        found = self.read(answer(reserve('main-10'), clash, reserve('main-5')), markets='main')
        self.assertEqual(issues(found), {'duplicate_pool': '2 NAVI records share a Pool object id with another and were left out.'})
        self.assertEqual({claim['native_ref']['native_id'] for claim in found['data']['claims']
                          if claim.get('level') == 'market'}, {reserve('main-5')['contract']['pool']})

    def test_a_coin_type_without_a_caip19_key_keeps_the_reserve_without_a_token_link(self):
        lp = reserve('main-10') | {'suiCoinType': GENERIC_LP}
        found = self.read(answer(lp, reserve('main-5')), markets='main')
        self.assertEqual(issues(found), {'unkeyed_coin_type': '1 NAVI reserves hold a coin type with no CAIP-19 key; they carry no token link.'})
        batch = checked_batch('navi', found)  # core accepts the batch: no malformed identifier was emitted
        self.assertEqual(sorted(str(claim.level) for claim in records(batch.claims)), ['listing', 'market', 'market'])
        links = [claim.from_key.native_id for claim in batch.claims
                 if isinstance(claim, identity.RelationClaim) and claim.type == 'market_asset']
        self.assertEqual(links, [reserve('main-5')['contract']['pool']])

    def test_a_requested_market_with_no_reserve_is_named(self):
        found = self.read(FIXTURE, markets='main,ember,vsui-sui,hasui-sui,sui-usdc,wbtc-usdc')
        self.assertEqual(issues(found), {'empty_market': '2 requested NAVI markets came back with no reserve: vsui-sui, hasui-sui.'})

    def test_an_answer_of_another_shape_or_with_no_reserve_fails_and_is_not_cached(self):
        for response in ({'code': 1, 'data': FIXTURE['data']}, {'data': FIXTURE['data']}, {'code': 0, 'data': {}},
                         [], {'code': 0, 'data': []}, answer(reserve('main-10')), 'unavailable'):
            with self.subTest(response=str(response)[:40]):
                found = self.read(response, markets='ember' if response == answer(reserve('main-10')) else None)
                self.assertEqual((found['data'], found['issues'][0]['code']), (None, 'invalid_response'))

    def test_an_invalid_request_is_refused(self):
        read, transport = reader()
        for arguments in ({'scope': 'pools'}, {}, {'scope': 'reserves', 'cursor': ''}):
            self.assertEqual(read.invoke('catalogue', arguments)['issues'][0]['code'], 'invalid_request')
        self.assertEqual(transport.calls, [])


def sources(contracts=identity, pages=page):
    """NAVI's and DeFiLlama's plugins as core sees them (`contracts` and `pages` are the identity and page modules of
    the core the test runs), and their readers: DeFiLlama's on invented pools, one per coin type NAVI also holds
    (native USDC, Sui Bridge USDT, vSUI and SUI)."""
    import test_defillama_catalogue as llama
    protocols = [{'id': '3323', 'name': 'NAVI Lending', 'slug': 'navi-lending', 'chains': ['Sui']}]
    pools = {'status': 'success', 'data': [
        llama.pool(1, 'navi-lending', 'USDC', [NATIVE_USDC]), llama.pool(2, 'navi-lending', 'SUIUSDT', [SUI_BRIDGE_USDT]),
        llama.pool(3, 'navi-lending', 'VSUI', [VSUI]), llama.pool(4, 'navi-lending', 'SUI', [SUI_COIN])]}
    infos = {key: pages.PluginInfo(key=f'pythia-{key}', manifest=contracts.validate_manifest(
        json.loads((PLUGINS / key / 'contract.json').read_text()))) for key in ('navi', 'defillama')}
    return llama, infos, {'navi': reader()[0], 'defillama': llama.reader(protocols, pools)[0]}


def pages_of(info, read, contracts=identity):
    """The plugin's scopes in its contract's order, as core's identity sync reads them: one batch per page."""
    for scope in info.manifest.catalogue_scopes:
        cursor = None
        while True:
            body = read.invoke('catalogue', {'scope': scope, **({'cursor': cursor} if cursor else {})})
            yield contracts.batch_from_json(body['data'])
            cursor = body['next_cursor']
            if cursor is None:
                break


class Joins(IngestTest):
    """NAVI beside DeFiLlama, through core's ingest: a token both name joins one subject whichever syncs first, while
    a pool, a reserve and the two protocols stay separate subjects that share the token."""

    def setUp(self):
        super().setUp()
        self.llama, self.sources, self.readers = sources()

    def world_with_curated_sui(self):
        world = self.fresh()
        sui = 'security:caip19:sui:mainnet/slip44:784'
        with closing(sqlite3.connect(world.path)) as db, db:  # core's curated SUI and native USDC on Sui, as built
            load_reference(db, {
                'securities': [{'id': sui, 'name': 'Sui', 'asset_class': 'crypto', 'kind': 'coin'}],
                'listings': [{'id': 'listing:caip19:sui:mainnet/slip44:784', 'security_id': sui, 'chain': 'sui:mainnet'}],
                'assertions': [{'subject_id': 'listing:caip19:sui:mainnet/slip44:784', 'scheme': 'caip19',
                                'value': 'sui:mainnet/slip44:784', 'authority': 'source_asserted',
                                'provenance': {**PROVENANCE, 'source': 'curated'}}]})
        world.ref.close()
        world.ref = store.open_reference(world.path)
        world.plugins = list(self.sources.values())
        return world

    def sync(self, world, key):
        totals = dict.fromkeys(('introduced', 'joined', 'unmatched', 'conflicts', 'rejected'), 0)
        for batch in pages_of(self.sources[key], self.readers[key]):
            done = ingest.ingest(world.identity, world.ref, self.sources[key], batch, plugins=world.plugins)
            totals = {name: totals[name] + done[name] for name in totals}
        return totals

    def test_a_token_both_sources_name_joins_one_subject_whichever_syncs_first(self):
        for order in (('defillama', 'navi'), ('navi', 'defillama')):
            with self.subTest(first=order[0]):
                world = self.world_with_curated_sui()
                totals = {key: self.sync(world, key) for key in order}
                self.assertEqual((totals['navi']['unmatched'], totals['navi']['conflicts'], totals['navi']['rejected']), (0, 0, 0))
                states = {}
                for plugin, subject, state in map(tuple, world.identity.select(
                        "SELECT plugin, subject_id, state FROM claims WHERE native_scope = '#record' ORDER BY 1, 2")):
                    states.setdefault(subject, {})[plugin] = state
                shared = {listing(coin) for coin in (SUI_BRIDGE_USDT, VSUI, NATIVE_USDC)} | {'listing:caip19:sui:mainnet/slip44:784'}
                # One subject per shared coin type, stated by both; the second source to sync joined it.
                for subject in shared:
                    self.assertEqual(set(states[subject]), {'pythia-navi', 'pythia-defillama'}, subject)
                    self.assertEqual(states[subject][f'pythia-{order[1]}'], 'joined', subject)
                # The other coins (the three wBTC, YBTC.B, Wormhole USDC, eACRED) only NAVI names, and it introduced them.
                alone = {subject for subject, found in states.items() if set(found) == {'pythia-navi'}}
                self.assertEqual(len(alone), 6)  # the 13 reserves hold 10 coin types, 4 of them DeFiLlama's too
                self.assertTrue(all(found['pythia-navi'] == 'introduced' for subject, found in states.items() if subject in alone))
                self.assertNoQuestions(world)

    def test_pools_reserves_and_protocols_stay_separate_subjects_that_share_the_token(self):
        world = self.world_with_curated_sui()
        for key in ('defillama', 'navi'):
            self.sync(world, key)
        pool = f'market:provisional:defillama:pool:{self.llama.uuid(2)}'
        reserve_id = f'market:provisional:navi:reserve:{reserve("main-19")["contract"]["pool"]}'
        protocols = ('protocol:provisional:defillama:protocol:3323', 'protocol:provisional:navi:protocol:navi-lending')
        for subject in (pool, reserve_id, *protocols):
            row = world.identity.select('SELECT introduced_by FROM subjects WHERE id = ?', (subject,))
            self.assertEqual(len(row), 1, subject)
        self.assertEqual(world.identity.select("SELECT count(*) FROM claims WHERE state = 'joined' AND native_scope IN"
                                               " ('pool', 'reserve', 'protocol')")[0][0], 0)
        related = lambda subject: {(item['type'], item['id']) for item in world.subject(subject)['view']['related']}
        token = listing(SUI_BRIDGE_USDT)
        self.assertEqual({item for item in related(token) if item[0] == 'market_asset'},
                         {('market_asset', pool), ('market_asset', reserve_id)})  # adjacent on the token
        self.assertEqual({item for item in related(pool) if item[0] == 'part_of'}, {('part_of', protocols[0])})
        self.assertEqual({item for item in related(reserve_id) if item[0] == 'part_of'}, {('part_of', protocols[1])})


class Search(search_tests.DeviceSearch):
    """What an investor types, found through core's search over the device: NAVI's pages ingested as core does."""

    def setUp(self):
        super().setUp()
        self.llama, self.infos, self.readers = sources(search_tests.identity, search_tests.page)
        self.plugins = list(self.infos.values())
        self.sync('navi')

    def sync(self, key):
        for batch in pages_of(self.infos[key], self.readers[key], search_tests.identity):
            ingest_ops.keep(self.ops, self.infos[key], batch)

    def reserve_group(self, unique_id):
        return f'market:provisional:navi:reserve:{reserve(unique_id)["contract"]["pool"]}'

    def test_the_main_market_reserve_leads_a_search_for_navi_usdc(self):
        groups = self.search('navi usdc')['data']['groups']
        self.assertEqual(groups[0]['id'], self.reserve_group('main-10'))
        self.assertEqual((groups[0]['name'], groups[0]['kind'], groups[0]['rows'][0]['source']),
                         ('NAVI Lending USDC (Main Market)', 'market', 'NAVI'))
        self.assertEqual({group['id'] for group in groups[1:3]},
                         {self.reserve_group('ember-0'), self.reserve_group('sui-usdc-1')})

    def test_navis_own_labels_find_its_tokens_its_protocol_and_its_bridges(self):
        token = lambda coin: search_tests.identity.subject_id('listing', {'caip19': catalogue.sui_caip19(coin)})
        found = lambda query: [group['id'] for group in self.search(query)['data']['groups']]
        self.assertEqual(found('vsui')[0], token(VSUI))
        self.assertEqual(found('suiusdt')[:2], [token(SUI_BRIDGE_USDT), self.reserve_group('main-19')])
        bridged = set(found('sui bridge'))
        self.assertLessEqual({token(SUI_BRIDGE_USDT), self.reserve_group('main-19'), self.reserve_group('main-21')}, bridged)
        self.assertNotIn(self.reserve_group('main-32'), bridged)  # LayerZero
        self.assertIn('protocol:provisional:navi:protocol:navi-lending', found('navi'))
        self.assertIn('protocol:provisional:navi:protocol:navi-lending', found('navi protocol'))

    def test_a_deprecated_reserve_stays_findable_after_the_live_one_and_its_page_still_opens(self):
        found = lambda query, **arguments: [group['id'] for group in self.search(query, **arguments)['data']['groups']]
        live, deprecated = self.reserve_group('main-1'), self.reserve_group('main-8')  # Wormhole USDC, Wormhole WBTC
        groups = found('navi wormhole')
        self.assertLess(groups.index(live), groups.index(deprecated))  # delisted lines rank below live ones
        self.assertEqual(found('navi wormhole', include_delisted=False), [live])
        body = json.loads(queue_ops.read_subject(self.ops, {'subject_id': self.reserve_group('main-8')}))
        self.assertEqual((body['outcome'], body['data']['subject']['name']),
                         ('ok', 'NAVI Lending WBTC (Wormhole, Main Market)'))

    def test_a_token_both_sources_name_is_one_search_result_under_either_spelling(self):
        self.sync('defillama')
        token = listing(SUI_BRIDGE_USDT)
        for query in ('suiusdt', 'SUIUSDT sui bridge'):
            with self.subTest(query=query):
                self.assertEqual([group['id'] for group in self.search(query)['data']['groups']].count(token), 1)
        # The two sources' pool and reserve are two results beside the token's, not one.
        pool = f'market:provisional:defillama:pool:{self.llama.uuid(2)}'
        self.assertEqual(set(self.groups('navi lending suiusdt')), {pool, self.reserve_group('main-19')})


if __name__ == '__main__':
    unittest.main()
