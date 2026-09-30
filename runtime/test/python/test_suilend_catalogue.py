"""Suilend's catalogue as core receives it: `/markets` and `/proxy/prices` records cut from Suilend's API (2026-09-30).

`fixtures/suilend-markets.json` keeps 3 of the 7 markets, trimmed to the fields the plugin reads: Main Market with 4 of
its 43 listed coins (SUI, USDC, sSUI and FUD, whose on-chain price is a placeholder), Bitwise Market, whose reserves the
API does not list, and Elixir Market, with a coin Suilend's price service has no price for. `fixtures/suilend-prices.json`
is the price service's answer for those coins. The rest of each test's input is invented and says so.
"""
from copy import deepcopy
import unittest

from sui_plugin_fixture import claims, fixture, identified, issues, load, pages, reader, records, relations
from test_identity_ingest import IngestTest
from test_plugin_contracts import manifest
from pythia_identity_fixture import page  # noqa: E402

plugin, catalogue = load('suilend')
MARKETS, PRICES = fixture('suilend-markets.json'), fixture('suilend-prices.json')
MAIN, BITWISE, ELIXIR = (item['id'] for item in MARKETS)
FUD = '0x76cb819b01abed502bee8a702b4c2d547532c12f25001c9dea795a5e631c26f1::fud::FUD'
SDEUSD = '0xf6b468748dced8435f4407d0ecb0457b921a2e89266a60862e36dbf243c71841::sdeusd::SDEUSD'
GENERIC_LP = '0x' + 'cd' * 32 + '::pool::LP<0x2::sui::SUI, 0x2::sui::SUI>'


def served(markets=MARKETS, prices=PRICES):
    def answer(url):
        if url.startswith(catalogue.PRICES_URL):
            asked = url[len(catalogue.PRICES_URL):].split(',')
            return {'data': {coin: entry for coin, entry in prices['data'].items() if coin in asked}, 'missing': []}
        return markets
    return answer


def changed(index, **changes):
    return {**deepcopy(MARKETS[index]), **changes}


def all_markets(**options):
    return claims('suilend', reader(plugin, served(**options))[0], 'markets')


def read(scope='markets', **options):
    return reader(plugin, served(**options))[0].invoke('catalogue', {'scope': scope})


class Catalogue(unittest.TestCase):
    def test_every_page_passes_cores_checks(self):
        read_, _transport = reader(plugin, served())
        for scope in ('protocols', 'markets'):
            batch, = pages('suilend', read_, scope)
            self.assertTrue(batch.complete)

    def test_a_market_is_keyed_by_its_object_and_the_protocol_by_its_package(self):
        found = all_markets()
        self.assertEqual({identified(claim) for claim in records(found)}, {MAIN, BITWISE, ELIXIR})
        market, = [claim for claim in records(found) if identified(claim) == MAIN]
        self.assertEqual((market.native_ref.native_scope, market.native_ref.native_id, market.identifiers[0].scheme),
                         ('market', MAIN, 'sui_object'))
        protocol, = records(claims('suilend', reader(plugin, served())[0], 'protocols'))
        self.assertEqual((protocol.native_ref.native_id, protocol.identifiers[0].scheme, identified(protocol),
                          protocol.attributes.name),
                         ('suilend', 'sui_package', catalogue.PACKAGE, 'Suilend'))
        self.assertEqual(all_markets(), found)  # stable across runs

    def test_names_are_the_protocol_and_the_market_as_suilend_shows_them(self):
        self.assertEqual({identified(claim): claim.attributes.name for claim in records(all_markets())},
                         {MAIN: 'Suilend Main Market', BITWISE: 'Suilend Bitwise Market', ELIXIR: 'Suilend Elixir Market'})

    def test_a_market_lists_its_coins_as_supply_and_a_hidden_market_is_inactive(self):
        found = all_markets()
        held = {(claim.from_key.native_id, claim.to_key.value) for claim in relations(found, 'market_asset')}
        self.assertEqual({market for market, _coin in held}, {MAIN, ELIXIR})  # Bitwise lists no reserves
        self.assertEqual(len([1 for market, _coin in held if market == MAIN]), 4)
        self.assertIn((MAIN, 'sui:mainnet/slip44:784'), held)
        self.assertEqual({claim.role for claim in relations(found, 'market_asset')}, {'supply'})
        self.assertEqual({claim.to_key.native_id for claim in relations(found, 'part_of')}, {'suilend'})
        hidden = records(all_markets(markets=[changed(0, isHidden=True)]))
        self.assertEqual([claim.attributes.status for claim in hidden], ['inactive'])

    def test_no_token_is_introduced_and_no_price_is_stated(self):
        found = all_markets()
        self.assertEqual({claim.level for claim in records(found)}, {'market'})  # Suilend names no coin
        self.assertFalse(any(claim.attributes.rank for claim in records(found)))
        self.assertNotIn('price', str(read()['data']).lower())


class PlaceholderPrices(unittest.TestCase):
    """Suilend's on-chain price for FUD is a placeholder; the plugin reads no on-chain price and states none."""

    def test_a_coin_the_price_service_cannot_price_is_alarmed_once(self):
        self.assertEqual(issues(read())['unpriced_coin'], '1 coins Suilend lists have no usable price in its price '
                                                          'service; its on-chain price for such a reserve can be a '
                                                          'placeholder. No price is stated.')  # SDEUSD

    def test_a_coin_with_a_zero_or_absurd_price_is_alarmed_too(self):
        prices = deepcopy(PRICES)
        prices['data'][FUD] = {'value': 0}
        prices['data'][SDEUSD] = {'value': 'n/a'}
        self.assertEqual(issues(read(prices=prices))['unpriced_coin'][:1], '2')

    def test_each_coin_is_asked_once_in_requests_under_the_url_limit(self):
        read_, transport = reader(plugin, served())
        read_.invoke('catalogue', {'scope': 'markets'})
        self.assertEqual(len(transport.calls), 2)  # the markets, then one price request for the 5 distinct coins
        self.assertEqual(len(transport.calls[1][len(catalogue.PRICES_URL):].split(',')), 5)
        many = [{'id': '0x' + f'{index:064x}', 'name': f'Market {index}', 'isHidden': False,
                 'reserveOrder': [f'0x{index:064x}::coin{index}::COIN{index}' for index in range(index * 60, index * 60 + 60)]}
                for index in range(2)]
        read_, transport = reader(plugin, served(markets=many))
        read_.invoke('catalogue', {'scope': 'markets'})
        self.assertEqual(len(transport.calls), 4)  # 120 coins in three requests of at most 50
        self.assertTrue(all(len(call) < 8192 for call in transport.calls))

    def test_an_unreadable_price_service_leaves_the_catalogue_intact_and_says_so(self):
        def answer(url):
            if url.startswith(catalogue.PRICES_URL):
                return {'unexpected': 'shape'}
            return MARKETS
        found = reader(plugin, answer)[0].invoke('catalogue', {'scope': 'markets'})
        self.assertEqual((found['outcome'], 'prices_unavailable' in issues(found), 'unpriced_coin' in issues(found)),
                         ('partial', True, False))
        self.assertEqual(len([claim for claim in found['data']['claims'] if claim.get('level') == 'market']), 3)


class DriftAlarms(unittest.TestCase):
    """Each way Suilend's answer can stop matching what the plugin reads is a warning or a refusal."""

    def test_the_fixture_raises_only_what_it_holds(self):
        self.assertEqual(sorted(issues(read())), ['unlisted_reserves', 'unpriced_coin'])  # Bitwise lists none; SDEUSD
        self.assertEqual(issues(read())['unlisted_reserves'], '1 Suilend markets list no reserves in the API; they carry '
                                                               'no token links.')

    def test_a_malformed_record_is_left_out_and_counted(self):
        broken = [changed(0, id='market-1'), changed(0, name=''), changed(0, isHidden='no'), changed(0, reserveOrder='x'),
                  'not a record']
        found = read(markets=[MARKETS[2], *broken])
        self.assertEqual(issues(found)['invalid_reference'], '5 malformed Suilend records were left out.')
        self.assertEqual([claim['native_ref']['native_id'] for claim in found['data']['claims'] if claim.get('level') == 'market'],
                         [ELIXIR])

    def test_two_records_sharing_a_market_object_are_both_left_out(self):
        found = read(markets=[MARKETS[0], changed(2, id=MAIN), MARKETS[1]])
        self.assertEqual(issues(found)['duplicate_market'], '2 Suilend records share a market object id with another and '
                                                            'were left out.')
        self.assertEqual([claim['native_ref']['native_id'] for claim in found['data']['claims'] if claim.get('level') == 'market'],
                         [BITWISE])

    def test_a_coin_type_without_a_caip19_key_keeps_the_market_without_a_token_link(self):
        found = read(markets=[changed(2, reserveOrder=[GENERIC_LP, SDEUSD])])
        self.assertEqual(issues(found)['unkeyed_coin_type'], '1 Suilend coin types have no CAIP-19 key; they carry no '
                                                              'token link.')
        links = [claim for claim in found['data']['claims'] if claim.get('type') == 'market_asset']
        self.assertEqual(len(links), 1)

    def test_an_answer_of_another_shape_or_with_no_market_fails(self):
        for response in ({'markets': MARKETS}, [], 'unavailable', [{'id': 1}], {}):
            with self.subTest(response=str(response)[:40]):
                found = reader(plugin, response)[0].invoke('catalogue', {'scope': 'markets'})
                self.assertEqual((found['data'], found['issues'][0]['code']), (None, 'invalid_response'))

    def test_an_invalid_request_is_refused(self):
        read_, transport = reader(plugin, served())
        for arguments in ({'scope': 'pools'}, {}, {'scope': 'markets', 'cursor': 'x'}):
            self.assertEqual(read_.invoke('catalogue', arguments)['issues'][0]['code'], 'invalid_request')
        self.assertEqual(transport.calls, [])


class Ingest(IngestTest):
    """Suilend's pages through core's ingest: the market's object id keys its subject, its coins link to tokens another
    source holds, and a link to a token nobody holds stays unmatched rather than introducing a nameless one."""

    def test_markets_and_the_protocol_are_subjects_under_the_open_keys_and_links_follow_held_tokens(self):
        info = page.PluginInfo(key='pythia-suilend', manifest=manifest('suilend'))
        self.world.plugins = [info]
        done = {}
        for scope in ('protocols', 'markets'):
            body = read(scope)['data']
            done[scope] = self.world.ingest(info, *body['claims'], scope=scope, complete=True)
        self.assertEqual(self.placed(info, MAIN), (f'market:sui_object:{MAIN}', 'introduced'))
        self.assertEqual(self.placed(info, 'suilend'), (f'protocol:sui_package:{catalogue.PACKAGE}', 'introduced'))
        self.assertEqual(done['markets']['introduced'], 3)
        self.assertEqual(done['markets']['unmatched'], 6)  # the six coin links: no token is held yet, the protocol is
        self.assertNoQuestions()


if __name__ == '__main__':
    unittest.main()
