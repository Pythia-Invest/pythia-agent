"""DeepBook's catalogue as core receives it: `/get_pools` records cut from the Mysten Labs indexer (2026-09-30).

`fixtures/deepbook-get-pools.json` keeps 5 of the 26 pools, trimmed to the fields the plugin reads: SUI_USDC, DEEP_SUI,
a native bridged ETH book, a Wormhole USDC book and NS_SUI. The rest of each test's input is invented and says so.
"""
from copy import deepcopy
import unittest

from sui_plugin_fixture import claims, fixture, identified, issues, load, pages, reader, records, relations
from test_identity_ingest import IngestTest
from test_plugin_contracts import manifest
from pythia_identity_fixture import page  # noqa: E402

plugin, catalogue = load('deepbook')
FIXTURE = fixture('deepbook-get-pools.json')
SUI_USDC = '0xe05dafb5133bcffb8d59f4e12465dc0e9faeaa05e3e342a08fe135800e3e4407'
GENERIC_LP = '0x' + 'cd' * 32 + '::pool::LP<0x2::sui::SUI, 0x2::sui::SUI>'


def changed(index, **changes):
    return {**deepcopy(FIXTURE[index]), **changes}


def all_pools(response=FIXTURE):
    return claims('deepbook', reader(plugin, response)[0], 'pools')


class Catalogue(unittest.TestCase):
    def test_every_page_passes_cores_checks(self):
        read, _transport = reader(plugin, FIXTURE)
        for scope in ('protocols', 'pools'):
            batch, = pages('deepbook', read, scope)
            self.assertTrue(batch.complete)

    def test_a_pool_is_keyed_by_its_object_and_the_protocol_by_its_package(self):
        found = all_pools()
        self.assertEqual({identified(claim) for claim in records(found, 'market')}, {item['pool_id'] for item in FIXTURE})
        market, = [claim for claim in records(found, 'market') if identified(claim) == SUI_USDC]
        self.assertEqual((market.native_ref.native_scope, market.native_ref.native_id, market.identifiers[0].scheme),
                         ('pool', SUI_USDC, 'sui_object'))
        protocol, = records(claims('deepbook', reader(plugin, FIXTURE)[0], 'protocols'))
        self.assertEqual((protocol.native_ref.native_id, protocol.identifiers[0].scheme, identified(protocol),
                          protocol.attributes.name, protocol.attributes.aliases),
                         ('deepbook-v3', 'sui_package', catalogue.PACKAGE, 'DeepBook V3', ('DeepBook',)))
        self.assertEqual(all_pools(), found)  # stable across runs

    def test_names_are_the_indexers_pool_names_and_no_governance_parameter_is_stated(self):
        found = records(all_pools(), 'market')
        self.assertEqual({identified(claim): claim.attributes.name for claim in found}[SUI_USDC], 'DeepBook SUI_USDC')
        self.assertEqual(sorted(claim.attributes.name for claim in found),
                         ['DeepBook BWETH_USDC', 'DeepBook DEEP_SUI', 'DeepBook NS_SUI', 'DeepBook SUI_USDC',
                          'DeepBook WUSDC_USDC'])
        self.assertFalse(any(claim.attributes.rank for claim in found))  # the indexer has no TVL

    def test_a_pool_holds_its_base_and_quote_coin_in_those_roles(self):
        found = all_pools()
        roles = {(claim.from_key.native_id, claim.role): claim.to_key.value for claim in relations(found, 'market_asset')}
        self.assertEqual(roles[(SUI_USDC, 'base')], 'sui:mainnet/slip44:784')
        self.assertEqual(roles[(SUI_USDC, 'quote')], catalogue.sui_caip19(FIXTURE[0]['quote_asset_id']))
        self.assertEqual(len(roles), 10)
        self.assertEqual({claim.to_key.native_id for claim in relations(found, 'part_of')}, {'deepbook-v3'})
        tokens = [claim.identifiers[0].value for claim in records(found, 'listing')]
        self.assertEqual(len(tokens), len(set(tokens)))  # native USDC and SUI are one record each, not one a pool
        self.assertEqual(len(tokens), 6)  # SUI, USDC, DEEP, NS, bridged ETH, Wormhole USDC

    def test_the_wormhole_and_native_usdc_books_hold_two_different_coins(self):
        held = {claim.from_key.native_id: claim.to_key.value for claim in relations(all_pools(), 'market_asset')
                if claim.role == 'base'}
        self.assertNotEqual(held[FIXTURE[3]['pool_id']], catalogue.sui_caip19(FIXTURE[0]['quote_asset_id']))


class DriftAlarms(unittest.TestCase):
    """Each way the indexer's answer can stop matching what the plugin reads is a warning or a refusal."""

    def read(self, response, scope='pools'):
        read, _transport = reader(plugin, response)
        return read.invoke('catalogue', {'scope': scope})

    def test_a_clean_answer_raises_nothing(self):
        self.assertEqual(self.read(FIXTURE)['issues'], [])

    def test_a_malformed_record_is_left_out_and_counted(self):
        broken = [changed(0, pool_id='pool-1'), changed(0, pool_name=''), changed(1, base_asset_symbol=None), 'not a record']
        found = self.read([FIXTURE[4], *broken])
        self.assertEqual((found['outcome'], issues(found)),
                         ('partial', {'invalid_reference': '4 malformed DeepBook records were left out.'}))
        self.assertEqual([claim['native_ref']['native_id'] for claim in found['data']['claims'] if claim.get('level') == 'market'],
                         [FIXTURE[4]['pool_id']])

    def test_two_records_sharing_a_pool_object_are_both_left_out(self):
        found = self.read([FIXTURE[0], changed(1, pool_id=SUI_USDC), FIXTURE[2]])
        self.assertEqual(issues(found), {'duplicate_pool': '2 DeepBook records share a pool object id with another and '
                                                           'were left out.'})
        self.assertEqual([claim['native_ref']['native_id'] for claim in found['data']['claims'] if claim.get('level') == 'market'],
                         [FIXTURE[2]['pool_id']])

    def test_a_coin_type_without_a_caip19_key_keeps_the_pool_without_a_token_link(self):
        found = self.read([changed(0, base_asset_id=GENERIC_LP)])
        self.assertEqual(issues(found), {'unkeyed_coin_type': '1 DeepBook pool coins have a coin type with no CAIP-19 key; '
                                                               'they carry no token link.'})
        self.assertEqual([claim['role'] for claim in found['data']['claims'] if claim.get('type') == 'market_asset'], ['quote'])

    def test_an_answer_of_another_shape_or_with_no_pool_fails(self):
        for response in ({'pools': FIXTURE}, [], 'unavailable', [{'pool_id': 1}], {}):
            with self.subTest(response=str(response)[:40]):
                found = self.read(response)
                self.assertEqual((found['data'], found['issues'][0]['code']), (None, 'invalid_response'))

    def test_an_invalid_request_is_refused(self):
        read, transport = reader(plugin, FIXTURE)
        for arguments in ({'scope': 'reserves'}, {}, {'scope': 'pools', 'cursor': 'x'}):
            self.assertEqual(read.invoke('catalogue', arguments)['issues'][0]['code'], 'invalid_request')
        self.assertEqual(transport.calls, [])

    def test_one_sync_reads_the_list_once(self):
        read, transport = reader(plugin, FIXTURE)
        for scope in ('protocols', 'pools'):
            self.assertIsNotNone(read.invoke('catalogue', {'scope': scope})['data'])
        self.assertEqual(transport.calls, [catalogue.URL])


class Ingest(IngestTest):
    """DeepBook's pages through core's ingest: the pool's object id keys its subject, with its roles."""

    def test_pools_and_the_protocol_are_subjects_under_the_open_keys_with_their_roles(self):
        info = page.PluginInfo(key='pythia-deepbook', manifest=manifest('deepbook'))
        self.world.plugins = [info]
        read, _transport = reader(plugin, FIXTURE)
        for scope in ('protocols', 'pools'):
            self.world.ingest(info, *read.invoke('catalogue', {'scope': scope})['data']['claims'], scope=scope, complete=True)
        self.assertEqual(self.placed(info, SUI_USDC), (f'market:sui_object:{SUI_USDC}', 'introduced'))
        self.assertEqual(self.placed(info, 'deepbook-v3'), (f'protocol:sui_package:{catalogue.PACKAGE}', 'introduced'))
        roles = self.world.identity.select("SELECT role FROM relations WHERE type = 'market_asset' AND from_id = ?",
                                           (f'market:sui_object:{SUI_USDC}',))
        self.assertEqual(sorted(row['role'] for row in roles), ['base', 'quote'])
        self.assertNoQuestions()


if __name__ == '__main__':
    unittest.main()
