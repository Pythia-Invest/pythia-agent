"""The Sui plugin's catalogue as core receives it, answered by `sui_chain_fixture.Sui`, a fake of Sui's GraphQL endpoint
over invented objects shaped like the chain's (see `sui_chain_fixture`): protocols by original package, tokens with
bridge provenance, the DeepBook, AlphaLend and Bucket markets with their roles, the drift alarms, and a sync through
core's ingest."""
import json
import unittest
from unittest.mock import patch

from sui_chain_fixture import (
    ALPHALEND, BTC_BRIDGE, BUCKET, COIN_GY, DEEP, DEEPBOOK, FIXTURE, GONE, ROOT, SSUI, STAMP, SUI, TEST_SEED, USDB,
    USDC, USDT_BRIDGE, WAL, WSOL, WUSDC, Sui, by_id, catalogue, chain, claims, issues, listing, pool, reader, records,
    run, seed)
from test_identity_ingest import IngestTest
from test_plugin_contracts import identity
from pythia_identity_fixture import ingest, page  # noqa: E402


class Protocols(unittest.TestCase):
    def test_each_protocol_is_keyed_by_its_original_package_and_other_families_are_aliases(self):
        found = by_id(claims('protocols'), 'protocol')
        self.assertEqual(len(found), 10)
        for original, claim in found.items():
            self.assertEqual([item['value'] for item in claim['identifiers']], [original])  # one `sui_package` per record
            self.assertEqual(claim['identifiers'][0]['scheme'], 'sui_package')
            self.assertEqual(claim['native_ref']['native_scope'], 'protocol')
        names = {claim['attributes']['name']: claim for claim in found.values()}
        self.assertEqual(sorted(names), ['AlphaLend', 'Bluefin', 'Bucket Protocol', 'Cetus CLMM', 'DeepBook V3', 'Momentum',
                                         'NAVI Lending', 'Scallop', 'Suilend', 'Turbos'])
        self.assertEqual(names['DeepBook V3']['identifiers'][0]['value'], DEEPBOOK)
        aliases = {name: claim['attributes']['aliases'] for name, claim in names.items() if claim['attributes']['aliases']}
        self.assertEqual(aliases, {  # Cetus DLMM, Bluefin Pro and Bucket's USDB families, by their own original ids
            'Cetus CLMM': ['0x5664f9d3fd82c84023870cfbda8ea84e14c8dd56ce557ad2116e0668581a682b'],
            'Bluefin': ['0xe74481697f432ddee8dd6f9bd13b9d0297a5b63d55f3db25c4d3b5d34dad85b7'],
            'Bucket Protocol': ['0xe14726c336e81b32328e92afc37345d159f5b550b09fa92bd43640cfdd0a0cfd']})
        # The latest package and version at read time are an observation on the record, never its key.
        deepbook = FIXTURE['families'][DEEPBOOK]
        self.assertEqual(names['DeepBook V3']['provenance']['source_version'], f"{deepbook['latest']}@v{deepbook['version']}")

    def test_one_read_confirms_every_family(self):
        results, sui = run('protocols')
        self.assertEqual((sui.names(), results[0]['issues']), (['Family', 'Family'], []))  # 13 families, 12 a request

    def drift(self, change):
        sui = Sui()
        change(sui.fx['families'])
        results, _sui = run('protocols', sui)
        return by_id(results[0]['data']['claims'], 'protocol'), issues(results)

    def test_a_package_the_chain_does_not_know_is_left_out_and_named(self):
        found, problems = self.drift(lambda families: families.pop(DEEPBOOK))
        self.assertNotIn(DEEPBOOK, found)
        self.assertEqual((len(found), problems), (9, {'package_unknown': 'The chain does not know the original package of '
                                                                         'DeepBook V3: left out.'}))

    def test_an_id_that_is_not_the_original_of_its_family_is_left_out(self):
        found, problems = self.drift(lambda families: families[ALPHALEND].update(original=DEEPBOOK))
        self.assertNotIn(ALPHALEND, found)
        self.assertEqual(list(problems), ['package_not_original'])

    def test_a_family_that_lost_its_anchor_module_is_left_out(self):
        found, problems = self.drift(lambda families: families[BUCKET].update(anchor='cdp'))
        self.assertNotIn(BUCKET, found)
        self.assertEqual(list(problems), ['package_family_changed'])

    def test_a_secondary_family_the_chain_does_not_confirm_is_not_an_alias(self):
        found, problems = self.drift(lambda families: families.pop('0x5664f9d3fd82c84023870cfbda8ea84e14c8dd56ce557ad2116e0668581a682b'))
        cetus = next(claim for claim in found.values() if claim['attributes']['name'] == 'Cetus CLMM')
        self.assertEqual((cetus['attributes']['aliases'], problems), ([], {}))


class Tokens(unittest.TestCase):
    def setUp(self):
        patcher = patch.object(catalogue, 'SEED', TEST_SEED)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.found = by_id(claims('tokens'), 'listing')

    def test_the_seed_coins_and_the_coins_of_the_chain_read_markets_are_listed_by_caip19(self):
        # The seed's eight, and from the markets DeepBook's WAL, DEEP and COIN_GY, and Bucket's USDB debt coin.
        self.assertEqual(set(self.found), {listing(coin) for coin in (SUI, USDC, USDT_BRIDGE, BTC_BRIDGE, WUSDC, WSOL, SSUI,
                                                                       GONE, DEEP, WAL, USDB, COIN_GY)})
        self.assertEqual(self.found[listing(SUI)]['identifiers'], [{'scheme': 'caip19', 'value': 'sui:mainnet/slip44:784'}])

    def test_a_coin_is_named_from_its_on_chain_metadata_with_its_symbol_as_an_alias(self):
        usdc = self.found[listing(USDC)]['attributes']
        self.assertEqual((usdc['name'], usdc.get('aliases')), ('USDC', None))  # the symbol is the name: no alias
        deep = self.found[listing(DEEP)]['attributes']
        self.assertEqual((deep['name'], deep['aliases'], deep['asset_class']), ('DeepBook Token', ['DEEP'], 'crypto'))
        self.assertEqual(self.found[listing(SSUI)]['attributes']['name'], 'sSUI')
        self.assertEqual(self.found[listing(SSUI)]['provenance']['source_record'], f'coinMetadata {SSUI}')

    def test_supply_is_stated_only_where_the_chain_reads_one_and_in_whole_coins(self):
        rank = {coin: self.found[listing(coin)]['attributes'].get('rank') for coin in (USDC, DEEP, SSUI, WSOL)}
        self.assertEqual(rank[USDC], {'supply': 250000000.5})  # 250000000500000 at 6 decimals
        self.assertEqual(rank[DEEP], {'supply': 9000000123.456789})
        self.assertEqual((rank[SSUI], rank[WSOL]), (None, None))  # a wrapped TreasuryCap reads null: not zero

    def test_a_coin_the_sui_bridge_supports_says_so_and_points_at_the_bridge_table(self):
        usdt = self.found[listing(USDT_BRIDGE)]
        self.assertEqual(usdt['attributes']['name'], 'Tether (Sui Bridge)')
        self.assertEqual(usdt['provenance']['source_record'], f'sui bridge 0x9 supported_tokens id 4 for {USDT_BRIDGE}')
        self.assertEqual(self.found[listing(BTC_BRIDGE)]['attributes']['name'], 'Wrapped Bitcoin (Sui Bridge)')

    def test_a_coin_wormhole_wrapped_names_its_origin_chain_and_address(self):
        usdc = self.found[listing(WUSDC)]
        self.assertEqual(usdc['attributes']['name'], 'USD Coin (Wormhole, from Ethereum)')
        self.assertEqual(usdc['provenance']['source_record'],
                         f'wormhole {chain.WORMHOLE_STATE} token_registry WrappedAsset<{WUSDC}> from chain 2 (Wormhole id)'
                         ' address 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')  # Ethereum's USDC
        self.assertEqual(self.found[listing(WSOL)]['attributes']['name'], 'Wrapped SOL (Wormhole, from Solana)')
        # Both say USDC; they are two listings, and the native one claims no bridge.
        self.assertNotEqual(listing(USDC), listing(WUSDC))
        self.assertNotIn('Wormhole', self.found[listing(USDC)]['attributes']['name'])

    def test_wormhole_custody_of_a_sui_native_coin_is_no_provenance(self):
        sui = Sui()
        sui.fx['wormhole']['assets'][WUSDC] = {'type': f'{chain.WORMHOLE_STATE[:4]}::native_asset::NativeAsset<{WUSDC}>',
                                               'json': {'custody': '1'}}
        found = by_id(claims('tokens', sui), 'listing')
        self.assertEqual(found[listing(WUSDC)]['attributes']['name'], 'USD Coin')

    def test_a_coin_with_no_metadata_is_listed_without_a_name_and_counted(self):
        results, _sui = run('tokens')
        self.assertEqual(self.found[listing(GONE)]['attributes'], {'asset_class': 'crypto', 'status': 'active'})
        self.assertEqual(issues(results), {'metadata_missing': '1 coin types have no on-chain metadata; their listing has no '
                                                               'name.'})

    def test_a_refused_lookup_is_halved_until_the_endpoint_answers_and_every_request_fits(self):
        results, sui = run('tokens')
        lookups = [size for name, size in sui.calls if name == 'CoinMetadata']
        self.assertGreater(len(lookups), 2)  # 12 coins at 6 a request would be 2 if nothing were refused
        self.assertLess(max(size for _name, size in sui.calls), 5000)
        self.assertEqual(sum(record['attributes'].get('name') is not None for record in records(
            [claim for result in results for claim in result['data']['claims']])), 11)

    def test_a_request_is_cut_to_the_payload_limit(self):
        with patch.object(chain, 'MAX_PAYLOAD', 900):
            _results, sui = run('tokens')
        self.assertLessEqual(max(size for name, size in sui.calls if name in ('CoinMetadata', 'Wormhole')), 900)

    def test_pages_add_up_to_the_scope_and_metadata_is_read_once_per_coin_across_scopes(self):
        whole = set(self.found)
        using = reader(Sui(lookups=99))  # nothing refused, so a coin asked twice would be a real repeat
        with patch.object(catalogue, 'PAGE_COINS', 5):
            results, sui = run('tokens', using=using)
        self.assertEqual([len(result['data']['claims']) for result in results], [5, 5, 2])
        self.assertEqual([result['data']['complete'] for result in results], [False, False, True])
        self.assertEqual({record['identifiers'][0]['value'] for result in results for record in result['data']['claims']}, whole)
        run('markets', using=using)  # names its markets from the symbols the tokens pages already read
        self.assertEqual((len(sui.asked), len(set(sui.asked))), (12, 12))

    def test_every_seed_coin_is_a_plain_canonical_type_core_can_key(self):
        coins = [coin for group in seed.SEED.values() for coin in group]
        self.assertEqual(len(set(coins)), 74)
        self.assertEqual({coin for coin in coins if not catalogue.keyed(coin)}, set())
        with patch.object(catalogue, 'SEED', seed.SEED):
            self.assertEqual(len(catalogue.universe([])), 74)


class Markets(unittest.TestCase):
    def setUp(self):
        self.results, self.sui = run('markets')
        self.claims = [claim for result in self.results for claim in result['data']['claims']]
        self.found = by_id(self.claims, 'market')

    def assets(self, market):
        return sorted((claim['to_key']['value'], claim.get('role')) for claim in self.claims
                      if claim.get('type') == 'market_asset' and claim['from_key']['value'] == market)

    def test_a_market_is_keyed_by_its_object_and_part_of_its_protocol(self):
        self.assertEqual(len(self.found), 4 + 5 + 3)  # four DeepBook pools, five AlphaLend markets, three Bucket vaults
        for object_id, claim in self.found.items():
            self.assertEqual(claim['identifiers'], [{'scheme': 'sui_object', 'value': object_id}])
            self.assertEqual(claim['native_ref'], {'provider': 'sui', 'native_scope': 'market', 'native_id': object_id})
        part_of = {claim['from_key']['value']: claim['to_key']['value'] for claim in self.claims if claim.get('type') == 'part_of'}
        self.assertEqual(sorted(set(part_of.values())), sorted([DEEPBOOK, ALPHALEND, BUCKET]))
        self.assertEqual(len(part_of), len(self.found))

    def test_deepbook_pools_are_base_and_quote_above_the_dust_floor(self):
        deepbook = {key: claim for key, claim in self.found.items() if 'DeepBook' in claim['attributes']['name']}
        self.assertEqual(sorted(claim['attributes']['name'] for claim in deepbook.values()),
                         ['DeepBook V3 DEEP/SUI', 'DeepBook V3 GY/USDC', 'DeepBook V3 SUI/USDC', 'DeepBook V3 WAL/SUI'])
        sui_usdc = pool('SUI', 'USDC')['address']
        self.assertEqual(self.assets(sui_usdc), sorted([(listing(SUI), 'base'), (listing(USDC), 'quote')]))
        # Exactly 8 resting orders is in, 7 (CETUS/SUI) and none (PUMPKIN/USDC) are out: the floor is `MIN_ORDERS`.
        self.assertEqual(catalogue.deepbook.MIN_ORDERS, 8)
        self.assertNotIn(pool('CETUS', 'SUI')['address'], deepbook)
        self.assertNotIn(pool('PUMPKIN', 'USDC')['address'], deepbook)
        self.assertFalse(any('fee' in str(claim).lower() for claim in deepbook.values()))  # governance is a read, not a claim

    def alphalend(self):
        return {claim['attributes']['name']: key for key, claim in self.found.items() if 'AlphaLend' in claim['attributes']['name']}

    def test_alphalend_markets_are_keyed_by_their_field_object_and_roles_follow_the_config(self):
        names = self.alphalend()
        self.assertEqual(sorted(names), sorted(['AlphaLend DEEP (market 11)', 'AlphaLend DEEP (market 8)',
                                                'AlphaLend SUI (market 1)', 'AlphaLend USDC (market 6)',
                                                'AlphaLend DEEPBOOK_STAKED (market 32)']))
        fields = {item['key']: item['address'] for item in FIXTURE['alphalend']['fields']}
        self.assertEqual(names['AlphaLend SUI (market 1)'], fields['1'])  # the table entry's own object, not `Market.id`
        self.assertEqual(self.assets(fields['1']), sorted([(listing(SUI), 'collateral'), (listing(SUI), 'supply')]))
        self.assertEqual(self.assets(fields['8']), [(listing(DEEP), 'supply')])  # safe collateral ratio 0: not collateral
        self.assertEqual(self.found[fields['8']]['attributes']['status'], 'inactive')
        self.assertEqual(self.found[fields['11']]['attributes']['status'], 'active')
        self.assertNotEqual(fields['8'], fields['11'])  # one coin, two markets, two subjects

    def test_a_generic_receipt_market_is_kept_without_a_token_link_and_counted(self):
        generic = next(item['address'] for item in FIXTURE['alphalend']['fields'] if item['key'] == '32')
        self.assertIn(generic, self.found)
        self.assertEqual(self.assets(generic), [])
        self.assertEqual(self.found[generic]['attributes']['name'], 'AlphaLend DEEPBOOK_STAKED (market 32)')
        self.assertEqual(issues(self.results)['unkeyed_coin_type'],
                         '2 market assets hold a coin type with no CAIP-19 key; they carry no token link.')  # and a Bucket vault

    def test_a_borrowable_alphalend_market_adds_the_borrow_role(self):
        sui = Sui()
        sui.fx['alphalend']['fields'][1]['json']['config']['borrow_limit'] = '500'
        found = claims('markets', sui)
        key = sui.fx['alphalend']['fields'][1]['address']
        self.assertEqual(sorted(claim['role'] for claim in found if claim.get('type') == 'market_asset'
                                and claim['from_key']['value'] == key), ['borrow', 'collateral', 'supply'])

    def test_bucket_vaults_come_from_the_registry_with_collateral_and_usdb_debt(self):
        registry = next(item for item in FIXTURE['bucket']['objects'] if item['type'].endswith('::vault::Vault'))
        vaults = [entry['value']['vault']['objectId'] for entry in registry['json']['table']['contents']]
        self.assertEqual(sorted(key for key, claim in self.found.items() if claim['attributes']['name'].startswith('Bucket')),
                         sorted(vaults))
        first = vaults[0]
        self.assertEqual(self.found[first]['attributes']['name'], 'Bucket SUI vault')
        self.assertEqual(self.assets(first), sorted([(listing(SUI), 'collateral'), (listing(USDB), 'debt')]))
        # A Scallop receipt coin is a plain coin and keyed; a generic StakedHouseCoin is not and keeps only its debt.
        self.assertEqual(self.assets(vaults[1]), sorted([(listing(SSUI), 'collateral'), (listing(USDB), 'debt')]))
        self.assertEqual(self.assets(vaults[2]), [(listing(USDB), 'debt')])

    def test_a_pages_add_up_to_the_scope(self):
        with patch.object(catalogue, 'PAGE_MARKETS', 5):
            results, _sui = run('markets')
        self.assertEqual([result['data']['complete'] for result in results], [False, False, True])
        self.assertEqual(set(by_id([claim for result in results for claim in result['data']['claims']], 'market')), set(self.found))


class MarketDrift(unittest.TestCase):
    def read(self, sui):
        results, _sui = run('markets', sui)
        return by_id([claim for result in results for claim in (result['data'] or {}).get('claims', [])], 'market'), issues(results)

    def test_markets_of_a_protocol_the_chain_did_not_confirm_are_left_out(self):
        sui = Sui()
        sui.fx['families'].pop(ALPHALEND)
        found, problems = self.read(sui)
        self.assertEqual({claim['attributes']['name'].split()[0] for claim in found.values()}, {'DeepBook', 'Bucket'})
        self.assertEqual({'package_unknown', 'unverified_protocol'} <= set(problems), True)
        self.assertEqual(problems['unverified_protocol'], '5 markets of a protocol the chain did not confirm were left out.')

    def test_no_market_at_all_fails_rather_than_telling_core_every_market_is_gone(self):
        sui = Sui()
        for package in (DEEPBOOK, ALPHALEND, BUCKET):
            sui.fx['families'].pop(package)
        results, _sui = run('markets', sui)
        self.assertEqual((results[0]['data'], results[0]['issues'][0]['code']), (None, 'invalid_response'))

    def test_a_deepbook_pool_that_is_not_a_pool_of_the_package_is_left_out(self):
        sui = Sui()
        pools = sui.fx['deepbook']['pools']
        pools[0]['type'] = pools[0]['type'].replace(DEEPBOOK, '0x' + 'ee' * 32)  # SUI/USDC of another package
        pools[3]['type'] = pools[3]['type'].replace(',', ',0x2::sui::SUI<')  # WAL/SUI with a garbled type argument
        sui.fx['deepbook']['inner'].pop(pools[5]['json']['inner']['id'])  # DEEP/SUI with no state
        found, problems = self.read(sui)
        self.assertEqual(sum('DeepBook' in claim['attributes']['name'] for claim in found.values()), 1)
        self.assertEqual(problems['invalid_reference'], '3 markets were not readable as the protocol\'s own and were left out.')

    def test_an_alphalend_market_that_is_not_a_market_is_left_out(self):
        sui = Sui()
        sui.fx['alphalend']['fields'][0]['type'] = sui.fx['alphalend']['fields'][0]['type'].replace('Market', 'Other')
        del sui.fx['alphalend']['fields'][1]['json']['config']
        found, problems = self.read(sui)
        self.assertEqual(sum('AlphaLend' in claim['attributes']['name'] for claim in found.values()), 3)
        self.assertEqual(problems['invalid_reference'], '2 markets were not readable as the protocol\'s own and were left out.')

    def test_a_root_that_is_not_exactly_one_object_leaves_the_protocols_markets_out(self):
        sui = Sui()
        sui.fx['alphalend']['root']['json'] = {}
        found, problems = self.read(sui)
        self.assertEqual({claim['attributes']['name'].split()[0] for claim in found.values()}, {'DeepBook', 'Bucket'})
        self.assertIn('unexpected_root', problems)

    def test_a_new_bucket_cdp_family_leaves_its_vaults_out(self):
        sui = Sui()
        package = next(item for item in sui.fx['bucket']['objects'] if item['type'].endswith('::package_config::PackageConfig'))
        package['json']['original_cdp_package_id'] = '0x' + '77' * 32
        sui.objects = {item['address']: item for item in [sui.fx['bucket']['config'], *sui.fx['bucket']['objects']]}
        found, problems = self.read(sui)
        self.assertEqual({claim['attributes']['name'].split()[0] for claim in found.values()}, {'DeepBook', 'AlphaLend'})
        self.assertIn('unexpected_root', problems)

    def test_a_vault_whose_type_disagrees_with_its_registry_entry_is_left_out(self):
        sui = Sui()
        first = next(iter(sui.fx['bucket']['vaults']))
        sui.objects[first]['type'] = sui.objects[first]['type'].replace('::sui::SUI', '::sui::NOT')
        found, problems = self.read(sui)
        self.assertEqual(sum('Bucket' in claim['attributes']['name'] for claim in found.values()), 2)
        self.assertEqual(problems['invalid_reference'], '1 markets were not readable as the protocol\'s own and were left out.')


class Failures(unittest.TestCase):
    def test_a_timeout_halves_a_batch_and_is_retried_alone_and_a_persistent_one_is_reported(self):
        sui = Sui()
        sui.failures = ['timeout', 'network_error']
        results, _sui = run('protocols', sui)
        self.assertEqual(len(results[0]['data']['claims']), 10)  # the 13 families were asked in halves until they answered
        self.assertGreater(len(sui.names()), 4)
        sui = Sui()
        sui.failures = ['timeout'] * 100
        result = reader(sui)[0].invoke('catalogue', {'scope': 'protocols'}, cache_scope='test')
        self.assertEqual((result['data'], result['issues'][0]['code']), (None, 'timeout'))
        self.assertGreaterEqual(100 - len(sui.failures), 3)  # one family, asked three times alone

    def test_one_object_read_alone_is_asked_three_times(self):
        sui = Sui()
        sui.failures = ['timeout', 'timeout']
        market = pool('SUI', 'USDC')['address']
        result = reader(sui)[0].invoke('metrics', {'market': market}, cache_scope='test')
        self.assertEqual(result['outcome'], 'ok')

    def test_a_payload_the_endpoint_refuses_is_an_alarm_not_a_partial_answer(self):
        result = reader(Sui(limit=300))[0].invoke('catalogue', {'scope': 'protocols'}, cache_scope='test')
        self.assertEqual((result['data'], result['issues'][0]['code']), (None, 'payload_rejected'))

    def test_a_query_the_endpoint_no_longer_accepts_is_an_alarm(self):
        sui = Sui()
        sui.q_Family = lambda _v: {'errors': [{'message': 'Cannot query field "packageAt" on type "MovePackage"'}]}
        result = reader(sui)[0].invoke('catalogue', {'scope': 'protocols'}, cache_scope='test')
        self.assertEqual((result['data'], result['issues'][0]['code']), (None, 'query_rejected'))

    def test_an_answer_of_another_shape_fails_and_is_not_cached(self):
        for answer in ('unavailable', {}, {'data': None}, {'data': {'a0': None}}):
            sui = Sui()
            sui.q_Family = lambda _v, answer=answer: answer
            result = reader(sui)[0].invoke('catalogue', {'scope': 'protocols'}, cache_scope='test')
            self.assertEqual((result['data'], result['issues'][0]['code']), (None, 'invalid_response'), answer)

    def test_an_invalid_request_is_refused(self):
        read, sui = reader()
        for arguments in ({'scope': 'pools'}, {}, {'scope': 'markets', 'cursor': ''}):
            self.assertEqual(read.invoke('catalogue', arguments)['issues'][0]['code'], 'invalid_request')
        self.assertEqual(read.invoke('metrics', {'market': 'pool'})['issues'][0]['code'], 'invalid_request')
        self.assertEqual(sui.calls, [])


class Metrics(unittest.TestCase):
    def read(self, market, sui=None):
        read, sui = reader(sui)
        return read.invoke('metrics', {'market': market}, cache_scope='test')

    def test_a_deepbook_pools_governance_parameters_are_read_as_of_now(self):
        sui_usdc = pool('SUI', 'USDC')['address']
        result = self.read(sui_usdc)
        self.assertEqual(result['outcome'], 'ok')
        data = result['data']
        self.assertEqual((data['market'], data['basis'], data['as_of']), (sui_usdc, 'on_chain', STAMP))
        inner = FIXTURE['deepbook']['inner'][pool('SUI', 'USDC')['json']['inner']['id']]['state']['governance']
        self.assertEqual(data['governance_epoch'], inner['epoch'])
        self.assertEqual({row['metric']: row['value'] for row in data['metrics']},
                         {'taker_fee': int(inner['trade_params']['taker_fee']) / 1e9,
                          'maker_fee': int(inner['trade_params']['maker_fee']) / 1e9,
                          'stake_required': int(inner['trade_params']['stake_required']) / 1e6})
        self.assertEqual(self.read(sui_usdc.upper().replace('0X', '0x'))['data']['market'], sui_usdc)  # any case is the same pool

    def test_a_fee_voted_for_the_next_epoch_is_a_separate_row(self):
        sui = Sui()
        target = pool('SUI', 'USDC')
        governance = sui.fx['deepbook']['inner'][target['json']['inner']['id']]['state']['governance']
        governance['next_trade_params'] = {**governance['trade_params'], 'taker_fee': '100000'}
        rows = {row['metric']: row['value'] for row in self.read(target['address'], sui)['data']['metrics']}
        self.assertEqual(rows['next_taker_fee'], 0.0001)
        self.assertEqual({name for name in rows if name.startswith('next_')}, {'next_taker_fee'})  # the others are unchanged

    def test_any_other_market_is_not_covered(self):
        alpha = FIXTURE['alphalend']['fields'][0]['address']
        sui = Sui()
        sui.objects[alpha] = {'address': alpha, 'type': FIXTURE['alphalend']['fields'][0]['type'], 'json': {}}
        result = self.read(alpha, sui)
        self.assertEqual((result['data'], result['issues'][0]['code']), (None, 'not_covered'))
        self.assertEqual(self.read('0x' + '1' * 64, sui)['issues'][0]['code'], 'not_covered')  # no such object


class ThroughCore(IngestTest):
    """The three scopes ingested as core's sync does: subjects under the open keys, roles on the relations."""

    def test_a_sync_places_every_record_and_keys_markets_and_protocols_by_their_chain_ids(self):
        manifest = identity.validate_manifest(json.loads((ROOT / 'contract.json').read_text()))
        info = page.PluginInfo(key='pythia-sui', manifest=manifest)
        using = reader()
        totals = dict.fromkeys(('introduced', 'joined', 'unmatched', 'conflicts', 'rejected'), 0)
        with patch.object(catalogue, 'SEED', TEST_SEED):
            for scope in manifest.catalogue_scopes:
                for result in run(scope, using=using)[0]:
                    done = ingest.ingest(self.world.identity, self.world.ref, info, identity.batch_from_json(result['data']),
                                         plugins=[info])
                    totals = {name: totals[name] + done[name] for name in totals}
        self.assertEqual((totals['unmatched'], totals['conflicts'], totals['rejected']), (0, 0, 0))
        subjects = {row[0] for row in self.world.identity.select('SELECT id FROM subjects')}
        self.assertIn(f'protocol:sui_package:{DEEPBOOK}', subjects)
        self.assertIn(f"market:sui_object:{pool('SUI', 'USDC')['address']}", subjects)
        self.assertIn('listing:caip19:sui:mainnet/slip44:784', subjects)
        roles = sorted(row[0] for row in self.world.identity.select(
            "SELECT DISTINCT role FROM relations WHERE type = 'market_asset'"))
        self.assertEqual(roles, ['base', 'collateral', 'debt', 'quote', 'supply'])
        self.assertEqual(self.world.identity.select("SELECT count(*) FROM relations WHERE type = 'part_of'")[0][0], 12)
        self.assertNoQuestions()


if __name__ == '__main__':
    unittest.main()
