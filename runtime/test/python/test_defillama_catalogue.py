"""DefiLlama's catalogue as core receives it: synthetic `/protocols` and `/pools` directories.

Shapes follow DefiLlama's free API documentation (https://api-docs.defillama.com/, "TVL" /protocols and "Yields"
/pools): protocol `id`, `name`, `slug`, `chains`; pool `pool`, `chain`, `project`, `symbol`, `poolMeta`,
`underlyingTokens`, `tvlUsd`. Protocols, pools and non-curated coin types are invented; the native SUI and native
USDC coin types are the on-chain identifiers core's curated table names. No provider responses retained.
"""
from copy import deepcopy
import importlib
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from market_data_fixture import connector, wire
from test_plugin_contracts import PLUGINS, checked_batch, identity

ROOT = PLUGINS / 'defillama'
spec = importlib.util.spec_from_file_location('defillama_fixture', ROOT / '__init__.py', submodule_search_locations=[str(ROOT)])
plugin = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = plugin
spec.loader.exec_module(plugin)
catalogue = importlib.import_module('defillama_fixture.catalogue')
STAMP = '2026-09-30T10:00:00+00:00'

SUI_SHORT, SUI_LONG = '0x2::sui::SUI', '0x' + '2'.rjust(64, '0') + '::sui::SUI'
NATIVE_USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
BRIDGED_USDC = '0x' + 'ab' * 32 + '::coin::COIN'  # another coin type DefiLlama also labels USDC
GENERIC_LP = '0x' + 'cd' * 32 + f'::pool::LP<{SUI_SHORT}, {NATIVE_USDC}>'
LONG_TYPE = '0x' + 'ef' * 32 + '::' + 'm' * 40 + '::' + 'T' * 40  # 172 characters once encoded


def uuid(seed):
    return f'{seed:08x}-0000-4000-8000-000000000000'


def pool(seed, project, symbol, tokens, chain='Sui', meta=None, tvl=1_000_000.0):
    return {'pool': uuid(seed), 'chain': chain, 'project': project, 'symbol': symbol, 'poolMeta': meta,
            'underlyingTokens': tokens, 'tvlUsd': tvl, 'apy': 4.2, 'stablecoin': symbol == 'USDC',
            'exposure': 'single' if len(tokens) == 1 else 'multi'}


PROTOCOLS = [
    {'id': '9001', 'name': 'Example Lend', 'slug': 'example-lend', 'chains': ['Sui'], 'category': 'Lending'},
    {'id': '9002', 'name': 'Example Swap', 'slug': 'example-swap', 'chains': ['Sui', 'Aptos'], 'category': 'Dexs'},
    {'id': '9003', 'name': 'Other Dex', 'slug': 'other-dex', 'chains': ['Ethereum'], 'category': 'Dexs'},
    # Lists no chain, yet runs a Sui pool: still a Sui protocol, so the pool's `part_of` has an end.
    {'id': '9004', 'name': 'Example Vault', 'slug': 'example-vault', 'chains': [], 'deadFrom': '2026-01-01'},
    {'id': 'not text', 'name': None, 'slug': 'broken'},
]
POOLS = {'status': 'success', 'data': [
    pool(1, 'example-lend', 'SUI', [SUI_SHORT]),
    pool(2, 'example-lend', 'USDC', [NATIVE_USDC]),
    pool(3, 'example-lend', 'USDC', [BRIDGED_USDC]),
    pool(4, 'example-swap', 'USDC-SUI', [GENERIC_LP, SUI_LONG, LONG_TYPE], meta='0.25%'),
    pool(5, 'other-dex', 'WETH-USDC', ['0x' + '12' * 20, '0x' + '34' * 20], chain='Ethereum'),
    pool(6, 'example-vault', 'USDC', [NATIVE_USDC]),
    {**pool(7, 'example-lend', 'SUI', [SUI_SHORT]), 'pool': 'not-a-uuid'},
]}


class Transport:
    def __init__(self, responses):
        self.responses, self.calls = responses, []

    def run_worker(self, _command, request, _environment, **_options):
        self.calls.append(request['url'])
        return {'data': deepcopy(self.responses[request['url']]), 'observed_at': STAMP, 'issues': []}


def reader(protocols=PROTOCOLS, pools=POOLS):
    transport = Transport({catalogue.URLS['protocols']: protocols, catalogue.URLS['pools']: pools})
    return plugin.Reader(wire, connector, transport=transport), transport


def pages(scope, chains=None, **fixtures):
    """Every page of a scope, each checked by core against the plugin's contract."""
    read, _transport = reader(**fixtures)
    found, cursor = [], None
    while True:
        result = read.invoke('catalogue', {'scope': scope, **({'cursor': cursor} if cursor else {})}, chains=chains)
        found.append(checked_batch('defillama', result))
        cursor = result['next_cursor']
        if cursor is None:
            return found


def claims(scope, **options):
    return [claim for batch in pages(scope, **options) for claim in batch.claims]


def key(claim):
    """The subject ID a record names, as core's ingest derives it."""
    if claim.native_ref is not None:
        ref = claim.native_ref
        return identity.provisional_id(claim.level, ref.provider, ref.native_scope, ref.native_id)
    return identity.subject_id(claim.level, {item.scheme: item.value for item in claim.identifiers})


def records(found):
    return [claim for claim in found if isinstance(claim, identity.RecordClaim)]


def assets(found, seed):
    """The subject IDs pool `seed`'s `market_asset` relations name."""
    return [identity.subject_id('listing', {'caip19': claim.to_key.value}) for claim in found
            if isinstance(claim, identity.RelationClaim) and claim.type == 'market_asset'
            and claim.from_key.native_id == uuid(seed)]


def curated_listings():
    """The listing IDs core's curated crypto table gives each deployment (the reference build's rule)."""
    table = json.loads((PLUGINS.parent / 'core/identity/canonical_assets.json').read_text())
    return {identity.subject_id('listing', {'caip19': deployment})
            for asset in table['assets'] for deployment in (asset['caip19'], *asset.get('deployments', ()))}


class Catalogue(unittest.TestCase):
    def test_every_page_passes_cores_checks_and_pages_add_up_to_the_scope(self):
        whole = claims('pools')
        with patch.object(catalogue, 'PAGE_CLAIMS', 4):
            paged = pages('pools')
        self.assertGreater(len(paged), 2)
        self.assertEqual([batch.complete for batch in paged], [False] * (len(paged) - 1) + [True])
        self.assertEqual({key(claim) for claim in records(whole)},
                         {key(claim) for batch in paged for claim in records(batch.claims)})
        protocols = pages('protocols')
        self.assertEqual(len(protocols), 1)
        self.assertTrue(protocols[0].complete)

    def test_ids_are_stable_across_runs(self):
        first, second = claims('pools'), claims('pools')
        self.assertEqual(first, second)
        self.assertIn('market:provisional:defillama:pool:' + uuid(1), [key(claim) for claim in records(first)])
        self.assertEqual(sorted(key(claim) for claim in records(claims('protocols'))),
                         ['protocol:provisional:defillama:protocol:9001', 'protocol:provisional:defillama:protocol:9002',
                          'protocol:provisional:defillama:protocol:9004'])

    def test_a_pool_holding_sui_links_to_the_curated_sui_listing(self):
        found = claims('pools')
        self.assertEqual(assets(found, 1), ['listing:caip19:sui:mainnet/slip44:784'])
        self.assertIn('listing:caip19:sui:mainnet/slip44:784', curated_listings())
        self.assertEqual(assets(found, 4), ['listing:caip19:sui:mainnet/slip44:784'])  # the long form is SUI too

    def test_a_pool_holding_native_usdc_links_to_the_curated_sui_usdc_deployment(self):
        found = claims('pools')
        [usdc] = assets(found, 2)
        self.assertIn(usdc, curated_listings())
        self.assertEqual(assets(found, 6), [usdc])
        self.assertEqual(sum(key(claim) == usdc for claim in records(found)), 1)  # one record per page

    def test_two_usdc_coin_types_stay_two_subjects(self):
        found = claims('pools')
        [native], [bridged] = assets(found, 2), assets(found, 3)
        self.assertNotEqual(native, bridged)
        self.assertNotIn(bridged, curated_listings())
        labels = {key(claim): claim.attributes.name for claim in records(found) if claim.level == 'listing'}
        self.assertEqual((labels[native], labels[bridged]), ('USDC', 'USDC'))  # same symbol, two subjects

    def test_a_generic_or_over_long_coin_type_is_never_emitted_as_caip19(self):
        found = claims('pools')
        values = {item.value for claim in records(found) for item in claim.identifiers}
        values |= {claim.to_key.value for claim in found if isinstance(claim, identity.RelationClaim)
                   and isinstance(claim.to_key, identity.IdentifierValue)}
        self.assertFalse([value for value in values if 'LP' in value or 'mmmm' in value])
        self.assertIn('market:provisional:defillama:pool:' + uuid(4), [key(claim) for claim in records(found)])
        for coin in (GENERIC_LP, LONG_TYPE):
            self.assertIsNone(catalogue.sui_caip19(coin))
            with self.assertRaises(identity.IdentifierError):
                identity.normalize_identifier('caip19', 'sui:mainnet/coin:' + coin)
        for coin in (SUI_SHORT, SUI_LONG, NATIVE_USDC, BRIDGED_USDC):  # the plugin keys a type as core does
            self.assertEqual(catalogue.sui_caip19(coin), identity.normalize_identifier('caip19', 'sui:mainnet/coin:' + coin))

    def test_pools_are_part_of_their_protocol_by_its_id(self):
        found = claims('pools')
        part_of = {claim.from_key.native_id: claim.to_key.native_id for claim in found
                   if isinstance(claim, identity.RelationClaim) and claim.type == 'part_of'}
        self.assertEqual(part_of, {uuid(1): '9001', uuid(2): '9001', uuid(3): '9001', uuid(4): '9002', uuid(6): '9004'})
        names = {claim.native_ref.native_id: claim.attributes.name for claim in records(found) if claim.level == 'market'}
        self.assertEqual(names[uuid(4)], 'Example Swap USDC-SUI (0.25%)')
        status = {claim.native_ref.native_id: claim.attributes.status for claim in records(claims('protocols'))}
        self.assertEqual(status, {'9001': 'active', '9002': 'active', '9004': 'inactive'})

    def test_the_chains_setting_defaults_to_sui_and_all_means_every_chain(self):
        pools = lambda found: {claim.native_ref.native_id for claim in records(found) if claim.level == 'market'}
        sui = pools(claims('pools'))
        self.assertNotIn(uuid(5), sui)
        for cleared in ([], '', ' , ', None):  # clearing the setting restores the default
            self.assertEqual(pools(claims('pools', chains=cleared)), sui)
        everything = claims('pools', chains='ALL')
        self.assertEqual(pools(everything), sui | {uuid(5)})
        self.assertEqual(assets(everything, 5), [])  # only Sui coin types are keyed yet
        self.assertEqual(len(records(claims('protocols', chains='sui, ethereum'))), 4)
        self.assertEqual(claims('pools', chains=['Aptos']), [])  # a chain with protocols and no pools

    def test_an_unknown_chain_is_reported_and_never_ends_a_scope_empty(self):
        read, _transport = reader()
        alone = read.invoke('catalogue', {'scope': 'pools'}, chains='sui-mainnet')
        self.assertEqual((alone['data'], alone['issues'][0]['code']), (None, 'unknown_chain'))
        self.assertIn('sui-mainnet', alone['issues'][0]['message'])
        mixed = read.invoke('catalogue', {'scope': 'protocols'}, chains=['Sui', 'Suii'])
        self.assertTrue(mixed['data']['complete'])
        self.assertIn(('unknown_chain', 'warning'), [(item['code'], item['severity']) for item in mixed['issues']])

    def test_malformed_input_is_counted_or_refused_never_coerced(self):
        read, _transport = reader()
        result = read.invoke('catalogue', {'scope': 'pools'})
        self.assertEqual((result['outcome'], result['issues'][0]['code']), ('partial', 'invalid_reference'))
        self.assertIn('1 malformed', result['issues'][0]['message'])  # the scope's own directory
        broken, _transport = reader(pools={'status': 'error', 'data': []})
        self.assertEqual(broken.invoke('catalogue', {'scope': 'pools'})['issues'][0]['code'], 'invalid_response')
        self.assertEqual(read.invoke('catalogue', {'scope': 'pools'}, chains=7)['issues'][0]['code'],
                         'invalid_configuration')
        self.assertEqual(read.invoke('catalogue', {'scope': 'tokens'})['issues'][0]['code'], 'invalid_request')

    def test_a_refresh_between_pages_skips_no_pool_both_snapshots_hold(self):
        with patch.object(catalogue, 'PAGE_CLAIMS', 4):
            before, _transport = reader()
            first = before.invoke('catalogue', {'scope': 'pools'})
            self.assertEqual({claim['native_ref']['native_id'] for claim in first['data']['claims']
                              if claim.get('level') == 'market'}, {uuid(1)})
            # The hourly snapshot is refreshed mid-sync, and pool 1, already emitted, is gone from it.
            refreshed = {**POOLS, 'data': POOLS['data'][1:]}
            after, _transport = reader(pools=refreshed)
            seen, cursor = set(), first['next_cursor']
            while cursor:
                result = after.invoke('catalogue', {'scope': 'pools', 'cursor': cursor})
                seen |= {claim.native_ref.native_id for claim in records(checked_batch('defillama', result).claims)
                         if claim.level == 'market'}
                cursor = result['next_cursor']
        self.assertEqual(seen, {uuid(2), uuid(3), uuid(4), uuid(6)})

    def test_a_token_label_prefers_the_coins_own_symbol_then_the_most_common(self):
        tether, wrapped = '0x' + '56' * 32 + '::usdt::USDT', '0x' + '78' * 32 + '::coin::COIN'
        rows = [pool(10, 'example-lend', 'SBUSDT', [tether]), pool(11, 'example-lend', 'SUIUSDT', [tether]),
                pool(12, 'example-lend', 'USDT', [tether]), pool(13, 'example-lend', 'XUSDC', [wrapped]),
                pool(14, 'example-lend', 'WUSDC', [wrapped]), pool(15, 'example-swap', 'WUSDC', [wrapped])]
        found = claims('pools', pools={'status': 'success', 'data': rows})
        labels = {claim.identifiers[0].value: claim.attributes.name for claim in records(found) if claim.level == 'listing'}
        self.assertEqual(labels, {catalogue.sui_caip19(tether): 'USDT', catalogue.sui_caip19(wrapped): 'WUSDC'})

    def test_a_cetus_fee_tier_written_a_hundred_times_too_large_is_corrected_and_the_original_kept(self):
        protocols = [*PROTOCOLS, {'id': '9010', 'name': 'Cetus CLMM', 'slug': 'cetus-clmm', 'chains': ['Sui']},
                     {'id': '9011', 'name': 'Bluefin Spot', 'slug': 'bluefin-spot', 'chains': ['Sui']}]
        tokens = [NATIVE_USDC, SUI_LONG]

        def names(rows):
            found = claims('pools', protocols=protocols, pools={'status': 'success', 'data': rows})
            return {claim.native_ref.native_id: claim.attributes for claim in records(found) if claim.level == 'market'}
        seen = names([pool(20, 'cetus-clmm', 'USDC-SUI', tokens, meta='25%'),
                      pool(21, 'cetus-clmm', 'USDC-SUI', tokens, meta='100%'),
                      pool(22, 'cetus-clmm', 'USDC-SUI', tokens, meta='0.1%'),
                      pool(23, 'cetus-clmm', 'USDC-SUI', tokens),
                      pool(24, 'bluefin-spot', 'SUI-USDC', tokens, meta='0.25%'),
                      pool(25, 'bluefin-spot', 'SUI-USDC', tokens, meta='1%')])
        self.assertEqual({uuid(seed): seen[uuid(seed)].name for seed in (20, 21, 22, 23, 24, 25)},
                         {uuid(20): 'Cetus CLMM USDC-SUI (0.25%)', uuid(21): 'Cetus CLMM USDC-SUI (1%)',
                          uuid(22): 'Cetus CLMM USDC-SUI (0.001%)', uuid(23): 'Cetus CLMM USDC-SUI',
                          uuid(24): 'Bluefin Spot SUI-USDC (0.25%)', uuid(25): 'Bluefin Spot SUI-USDC (1%)'})
        [fix] = seen[uuid(20)].source_corrections  # the source's own text stays readable beside the corrected name
        self.assertEqual((fix.field, fix.original), ('name', 'Cetus CLMM USDC-SUI (25%)'))
        self.assertIn('times 100', fix.reason)
        self.assertEqual([seen[uuid(seed)].source_corrections for seed in (23, 24, 25)], [(), (), ()])

    def test_a_cetus_label_the_source_has_fixed_passes_through(self):
        protocols = [*PROTOCOLS, {'id': '9010', 'name': 'Cetus CLMM', 'slug': 'cetus-clmm', 'chains': ['Sui']}]
        rows = [pool(30, 'cetus-clmm', 'USDC-SUI', [NATIVE_USDC, SUI_LONG], meta='0.25%'),
                pool(31, 'cetus-clmm', 'USDC-SUI', [NATIVE_USDC, SUI_LONG], meta='1%')]
        found = claims('pools', protocols=protocols, pools={'status': 'success', 'data': rows})
        self.assertEqual([(claim.attributes.name, claim.attributes.source_corrections) for claim in records(found)
                          if claim.level == 'market'],
                         [('Cetus CLMM USDC-SUI (0.25%)', ()), ('Cetus CLMM USDC-SUI (1%)', ())])

    def test_one_sync_reads_each_directory_once(self):
        read, transport = reader()
        with patch.object(catalogue, 'PAGE_CLAIMS', 4):
            cursor = None
            for scope in ('protocols', 'pools'):
                while True:
                    result = read.invoke('catalogue', {'scope': scope, **({'cursor': cursor} if cursor else {})})
                    cursor = result['next_cursor']
                    if cursor is None:
                        break
        self.assertEqual(sorted(transport.calls), sorted(catalogue.URLS.values()))


if __name__ == '__main__':
    unittest.main()
