"""Cetus's catalogue as core receives it: `stats_pools` records cut from Cetus's own response (2026-09-30).

`fixtures/cetus-stats-pools.json` keeps 7 of the pools in descending liquidity, trimmed to the fields the plugin reads:
the top pool, SUI/USDC at two fee tiers, USDC/USDY, two pools just over the US$1,000 floor and one just under it. The
rest of each test's input is invented and says so.
"""
from copy import deepcopy
import unittest
from unittest.mock import patch

from sui_plugin_fixture import claims, fixture, identified, issues, load, pages, reader, records, relations
from test_identity_ingest import IngestTest
from test_identity_sui_keys import source as other_source
from test_plugin_contracts import identity, manifest
from pythia_identity_fixture import page  # noqa: E402

plugin, catalogue = load('cetus')
FIXTURE = fixture('cetus-stats-pools.json')
POOLS = FIXTURE['data']['lp_list']
USDC_SUI = '0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105'  # 0.25%
USDC_SUI_005 = POOLS[3]['address']
SCA_SUI, BELOW_FLOOR = POOLS[4]['address'], POOLS[6]['address']
USDC = 'sui:mainnet/coin:0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7%3A%3Ausdc%3A%3AUSDC'
GENERIC_LP = '0x' + 'cd' * 32 + '::pool::LP<0x2::sui::SUI, 0x2::sui::SUI>'


def served(pools=POOLS):
    """Cetus's answer to `offset`: the pools from there, `PAGE` of them."""
    def answer(url):
        offset = int(url.rsplit('=', 1)[1])
        return {**FIXTURE, 'data': {**FIXTURE['data'], 'lp_list': deepcopy(pools[offset:offset + catalogue.PAGE])}}
    return answer


def changed(index, **changes):
    pool = deepcopy(POOLS[index])
    for key, value in changes.items():
        if isinstance(value, dict):
            pool[key] = {**pool[key], **value}
        else:
            pool[key] = value
    return pool


def all_pools(**options):
    return claims('cetus', reader(plugin, served(**options))[0], 'pools')


def named(found):
    return {identified(claim): claim.attributes.name for claim in records(found, 'market')}


class Catalogue(unittest.TestCase):
    def test_every_page_passes_cores_checks_and_pages_add_up_to_the_scope(self):
        whole = all_pools()
        with patch.object(catalogue, 'PAGE_CLAIMS', 7):
            paged = pages('cetus', reader(plugin, served())[0], 'pools')
        self.assertGreater(len(paged), 2)
        self.assertEqual([batch.complete for batch in paged], [False] * (len(paged) - 1) + [True])
        self.assertEqual({identified(claim) for claim in records(whole, 'market')},
                         {identified(claim) for batch in paged for claim in records(batch.claims, 'market')})

    def test_a_pool_is_keyed_by_its_object_and_the_protocol_by_its_package(self):
        found = all_pools()
        market, = [claim for claim in records(found, 'market') if identified(claim) == USDC_SUI]
        self.assertEqual((market.native_ref.native_scope, market.native_ref.native_id, market.identifiers[0].scheme),
                         ('pool', USDC_SUI, 'sui_object'))
        protocol, = records(claims('cetus', reader(plugin, served())[0], 'protocols'))
        self.assertEqual((protocol.level, protocol.native_ref.native_id, protocol.identifiers[0].scheme, identified(protocol),
                          protocol.attributes.name, protocol.attributes.aliases),
                         ('protocol', 'cetus-clmm', 'sui_package', catalogue.PACKAGE, 'Cetus CLMM', ('Cetus',)))
        self.assertEqual(all_pools(), found)  # stable across runs

    def test_names_carry_the_pair_and_the_fee_tier_as_cetus_states_them(self):
        names = named(all_pools())
        self.assertEqual(names[USDC_SUI], 'Cetus USDC/SUI 0.25%')  # DeFiLlama's label for it is "25%"
        self.assertEqual(names[USDC_SUI_005], 'Cetus USDC/SUI 0.05%')  # one pair, two tiers, two pools
        self.assertEqual(names[POOLS[0]['address']], 'Cetus haSUI/SUI 0.01%')
        self.assertEqual(names[POOLS[5]['address']], 'Cetus USDC/NS 1%')
        # Cetus lists "PNUT " with a trailing space: a label is trimmed, never a reason to lose the pool.
        self.assertEqual(named(all_pools(pools=[changed(1, coin_a={'symbol': 'USDC '})]))[USDC_SUI], 'Cetus USDC/SUI 0.25%')

    def test_a_pool_holds_its_two_coins_as_base_and_quote(self):
        found = all_pools()
        roles = {(claim.from_key.native_id, claim.role): claim.to_key.value for claim in relations(found, 'market_asset')}
        self.assertEqual(roles[(USDC_SUI, 'base')], catalogue.sui_caip19(POOLS[1]['coin_a_address']))
        self.assertEqual(roles[(USDC_SUI, 'quote')], 'sui:mainnet/slip44:784')  # 0x0...02::sui::SUI is SUI
        self.assertEqual(len(roles), 12)  # 6 pools over the floor, two roles each
        self.assertEqual({claim.to_key.native_id for claim in relations(found, 'part_of')}, {'cetus-clmm'})
        tokens = {claim.identifiers[0].value: claim.attributes.name for claim in records(found, 'listing')}
        self.assertEqual(tokens[catalogue.sui_caip19(POOLS[1]['coin_a_address'])], 'USDC')
        self.assertEqual(len(tokens), len(records(found, 'listing')))  # USDC and SUI are one record each, not one a pool

    def test_a_closed_or_paused_pool_is_inactive_and_liquidity_is_a_rank_signal(self):
        found = records(all_pools(pools=[changed(0, is_closed=True), changed(1, object={'is_pause': True}), POOLS[2]]),
                        'market')
        self.assertEqual([claim.attributes.status for claim in found], ['inactive', 'inactive', 'active'])
        self.assertEqual({claim.native_ref.native_id: claim.attributes.rank['tvl_usd'] for claim in found}[USDC_SUI],
                         float(POOLS[1]['pure_tvl_in_usd']))


class Floor(unittest.TestCase):
    def test_a_pool_under_the_floor_is_not_a_subject(self):
        found = named(all_pools())
        self.assertIn(SCA_SUI, found)  # 1,077
        self.assertNotIn(BELOW_FLOOR, found)  # 994
        self.assertEqual(len(found), 6)

    def test_reading_stops_at_the_page_that_ends_below_the_floor(self):
        for size, offsets in ((100, [0]), (3, [0, 3, 6]), (1, [0, 1, 2, 3, 4, 5, 6])):  # the 7th pool is the first below
            with self.subTest(page=size), patch.object(catalogue, 'PAGE', size):
                read, transport = reader(plugin, served(pools=POOLS + [changed(6, address='0x' + '11' * 32)]))
                read.invoke('catalogue', {'scope': 'pools'})
                self.assertEqual(transport.calls, [catalogue.url(offset) for offset in offsets])

    def test_a_sync_reads_each_page_once_for_both_scopes_and_every_cursor_page(self):
        with patch.object(catalogue, 'PAGE', 3), patch.object(catalogue, 'PAGE_CLAIMS', 7):
            read, transport = reader(plugin, served())
            pages('cetus', read, 'protocols')
            pages('cetus', read, 'pools')
        self.assertEqual(transport.calls, [catalogue.url(offset) for offset in (0, 3, 6)])

    def test_a_pool_that_moves_between_pages_is_one_pool(self):
        shifted = [POOLS[0], POOLS[1], POOLS[1], POOLS[2]]  # as the list is read, a pool above moved down a place
        with patch.object(catalogue, 'PAGE', 2):
            found = named(all_pools(pools=shifted))
        self.assertEqual(len(found), 3)


class DriftAlarms(unittest.TestCase):
    """Each way Cetus's answer can stop matching what the plugin reads is a warning or a refusal, never a coercion."""

    def read(self, response, scope='pools'):
        read, _transport = reader(plugin, response)
        return read.invoke('catalogue', {'scope': scope})

    def test_a_clean_answer_raises_nothing(self):
        self.assertEqual(self.read(FIXTURE)['issues'], [])

    def test_a_malformed_record_is_left_out_and_counted(self):
        broken = [changed(1, address='pool-1'), changed(1, fee=0.25), changed(2, pure_tvl_in_usd=None),
                  changed(2, coin_a={'symbol': '  '}), changed(2, is_closed='no'), 'not a record']
        found = self.read({**FIXTURE, 'data': {'lp_list': [*POOLS[:2], *broken]}})
        self.assertEqual((found['outcome'], issues(found)),
                         ('partial', {'invalid_reference': '6 malformed Cetus records were left out.'}))
        self.assertEqual({claim['native_ref']['native_id'] for claim in found['data']['claims'] if claim.get('level') == 'market'},
                         {POOLS[0]['address'], USDC_SUI})

    def test_a_fee_label_that_differs_from_the_onchain_fee_rate_leaves_the_pool_out(self):
        found = self.read({**FIXTURE, 'data': {'lp_list': [POOLS[0], changed(1, fee='25')]}})  # "25%" for a 0.25% pool
        self.assertEqual(issues(found), {'fee_mismatch': '1 Cetus pools whose fee label differs from their on-chain '
                                                          'fee rate were left out.'})
        self.assertEqual([claim['native_ref']['native_id'] for claim in found['data']['claims']
                          if claim.get('level') == 'market'], [POOLS[0]['address']])

    def test_a_coin_type_without_a_caip19_key_keeps_the_pool_without_a_token_link(self):
        lp = changed(1, coin_a_address=GENERIC_LP)
        found = self.read({**FIXTURE, 'data': {'lp_list': [lp, POOLS[0]]}})
        self.assertEqual(issues(found), {'unkeyed_coin_type': '1 Cetus pool coins have a coin type with no CAIP-19 key; '
                                                               'they carry no token link.'})
        self.assertEqual([claim['role'] for claim in found['data']['claims'] if claim.get('from_key', {}).get('native_id') == USDC_SUI
                          and claim['type'] == 'market_asset'], ['quote'])

    def test_a_list_that_runs_past_the_page_limit_before_the_floor_is_reported(self):
        with patch.object(catalogue, 'PAGE', 2), patch.object(catalogue, 'MAX_PAGES', 2):
            found = self.read(served())
        self.assertIn('floor_not_reached', issues(found))

    def test_an_answer_of_another_shape_or_with_no_pool_over_the_floor_fails(self):
        for response in ({'code': 1, 'data': FIXTURE['data']}, {'code': 0, 'data': {}}, {'code': 0, 'data': {'lp_list': 'x'}},
                         [], {'code': 0, 'data': {'lp_list': []}}, {**FIXTURE, 'data': {'lp_list': [POOLS[6]]}}, 'unavailable'):
            with self.subTest(response=str(response)[:40]):
                found = self.read(response)
                self.assertEqual((found['data'], found['issues'][0]['code']), (None, 'invalid_response'))

    def test_an_invalid_request_is_refused(self):
        read, transport = reader(plugin, FIXTURE)
        for arguments in ({'scope': 'reserves'}, {}, {'scope': 'pools', 'cursor': ''}):
            self.assertEqual(read.invoke('catalogue', arguments)['issues'][0]['code'], 'invalid_request')
        self.assertEqual(transport.calls, [])


class Ingest(IngestTest):
    """Cetus's pages through core's ingest: the pool's object id keys its subject, and another source stating the
    same object, or the same package, joins it."""

    def setUp(self):
        super().setUp()
        self.info = page.PluginInfo(key='pythia-cetus', manifest=manifest('cetus'))
        read, _transport = reader(plugin, served())
        for scope in ('protocols', 'pools'):
            body = read.invoke('catalogue', {'scope': scope})['data']
            self.world.plugins = [self.info]
            self.done = self.world.ingest(self.info, *body['claims'], scope=scope, complete=True)

    def test_pools_and_the_protocol_are_subjects_under_the_open_keys_with_their_roles(self):
        self.assertEqual(self.placed(self.info, USDC_SUI), (f'market:sui_object:{USDC_SUI}', 'introduced'))
        self.assertEqual(self.placed(self.info, 'cetus-clmm'), (f'protocol:sui_package:{catalogue.PACKAGE}', 'introduced'))
        roles = self.world.identity.select("SELECT role FROM relations WHERE type = 'market_asset' AND from_id = ?",
                                           (f'market:sui_object:{USDC_SUI}',))
        self.assertEqual(sorted(row['role'] for row in roles), ['base', 'quote'])
        self.assertNoQuestions()

    def test_another_source_stating_the_same_pool_or_package_joins_it(self):
        chain = other_source('chain')
        self.world.plugins.append(chain)
        self.world.ingest(chain, {
            'level': 'market', 'attributes': {'name': 'pool 0xb8d7'}, 'identifiers': [{'scheme': 'sui_object', 'value': USDC_SUI}],
            'provenance': {**identity_provenance(chain)}, 'native_ref': {'provider': 'chain', 'native_scope': 'pool',
                                                                          'native_id': 'pool-x'}},
            {'level': 'protocol', 'attributes': {'name': 'Cetus'}, 'identifiers': [{'scheme': 'sui_package', 'value': catalogue.PACKAGE}],
             'provenance': {**identity_provenance(chain)}, 'native_ref': {'provider': 'chain', 'native_scope': 'pkg',
                                                                           'native_id': 'pkg-x'}}, scope='all')
        self.assertEqual(self.placed(chain, 'pool-x'), (f'market:sui_object:{USDC_SUI}', 'joined'))
        self.assertEqual(self.placed(chain, 'pkg-x'), (f'protocol:sui_package:{catalogue.PACKAGE}', 'joined'))


def identity_provenance(info):
    from test_identity_contracts import PROVENANCE
    return {**PROVENANCE, 'plugin': info.manifest.plugin, 'source': info.manifest.provider}


if __name__ == '__main__':
    unittest.main()
