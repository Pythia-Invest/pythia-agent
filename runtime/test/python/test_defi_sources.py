"""The Sui experiment's protocol and market metrics from DeFiLlama and NAVI, as core receives them (slice E4).

`fixtures/defillama-metrics.json` and `fixtures/navi-reserve-metrics.json` are cut from each provider's own answers
(2026-09-30: DeFiLlama `/protocols` and `/summary/{fees,dexs}/{slug}` for NAVI Lending, Cetus CLMM and DeepBook V3;
NAVI `/api/navi/pools?market=sui-usdc`), trimmed to the fields the plugins read. Expected figures are worked by hand from
those numbers. Nothing here reaches a network; every row passes core's own metric validator.
"""
from copy import deepcopy
import importlib
import importlib.util
import json
from pathlib import Path
import sys
import unittest

from market_data_fixture import connector, wire
from test_plugin_contracts import PLUGINS, identity

FIXTURES = Path(__file__).parent / 'fixtures'
STAMP = '2026-09-30T13:10:00+00:00'


def load(name):
    root = PLUGINS / name
    spec = importlib.util.spec_from_file_location(f'{name}_metrics_fixture', root / '__init__.py',
                                                  submodule_search_locations=[str(root)])
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


defillama, navi = load('defillama'), load('navi')
llama_metrics = importlib.import_module('defillama_metrics_fixture.metrics')
LLAMA = json.loads((FIXTURES / 'defillama-metrics.json').read_text())
NAVI = json.loads((FIXTURES / 'navi-reserve-metrics.json').read_text())
USDC_RESERVE = '0x981de52ee841ac80387e0edd85c944197a273110043351e1bf5242b47c23abe8'
SUI_RESERVE = '0x8bceed4cc17d596cbd2c798c702f0b729991566e708d704c4a6e7f1f51f7b632'


class Transport:
    """Answers each request from a table keyed by URL; a URL it lacks is DefiLlama's 400, `failures` name others."""

    def __init__(self, answers, failures=None):
        self.answers, self.failures, self.calls = answers, failures or {}, []

    def run_worker(self, _command, request, _environment, **_options):
        self.calls.append(request['url'])
        if request['url'] in self.failures:
            raise connector.SourceFailure({'error': self.failures[request['url']]})
        if request['url'] not in self.answers:
            raise connector.SourceFailure({'error': 'invalid_request'})
        return {'data': deepcopy(self.answers[request['url']]), 'observed_at': STAMP, 'issues': []}


def llama_answers(protocols=None, summaries=None):
    answers = {defillama.catalogue.URLS['protocols']: protocols or LLAMA['protocols']}
    for key, summary in (summaries or LLAMA['summaries']).items():
        endpoint, slug, data_type = key.split(':')
        answers[llama_metrics.summary_url(endpoint, slug, None if data_type == 'None' else data_type)] = summary
    return answers


def llama(protocol_id, answers=None, failures=None, **arguments):
    transport = Transport(answers or llama_answers(), failures)
    reader = defillama.Reader(wire, connector, transport=transport)
    ref = {'provider': 'defillama', 'native_scope': 'protocol', 'native_id': protocol_id}
    return reader.invoke('metrics', {'native_ref': ref, **arguments}), transport


def reserve(pool, markets=None, data=None, **ref):
    transport = Transport({navi.catalogue.url(navi.catalogue.markets(markets)): data or NAVI})
    reader = navi.Reader(wire, connector, transport=transport)
    native = {'provider': 'navi', 'native_scope': 'reserve', 'native_id': pool, **ref}
    return reader.invoke('metrics', {'native_ref': native}, markets=markets), transport


def checked(result, kind):
    """The rows as core accepts them (its metric vocabulary), keyed by metric, definition and window."""
    rows = identity.validate_metrics(result['data']['metrics'], kind)
    return {(row['metric'], row['definition']['id'], row['period'].get('window')): row for row in rows}


class DefiLlamaMetrics(unittest.TestCase):
    def test_a_lending_tvl_is_stated_net_of_borrowed_and_a_dex_tvl_as_held_assets(self):
        lending, _ = llama('3323')
        dex, _ = llama('2289')
        tvl = checked(lending, 'protocol')[('tvl', 'net_of_borrowed', None)]
        self.assertEqual((tvl['value'], tvl['unit'], tvl['basis'], tvl['period']),
                         ('192577192.7001955', 'USD', 'standardized', {'kind': 'instant'}))
        self.assertEqual(tvl['as_of'], STAMP)
        self.assertEqual(tvl['source_url'], 'https://api.llama.fi/protocols')
        self.assertEqual(checked(dex, 'protocol')[('tvl', 'held_assets', None)]['value'], '30990821.75936783')
        self.assertNotIn(('tvl', 'net_of_borrowed', None), checked(dex, 'protocol'))

    def test_fees_revenue_and_volume_carry_their_rolling_windows(self):
        rows = checked(llama('2289')[0], 'protocol')
        self.assertEqual({key: row['value'] for key, row in rows.items() if key[0] != 'tvl'}, {
            ('fees', 'user_paid', '24h'): '29615', ('fees', 'user_paid', '7d'): '251322',
            ('fees', 'user_paid', '30d'): '764665', ('revenue', 'protocol_kept', '24h'): '5923',
            ('revenue', 'protocol_kept', '7d'): '50263', ('revenue', 'protocol_kept', '30d'): '152933',
            ('volume', 'traded', '24h'): '22184025', ('volume', 'traded', '7d'): '182636975',
            ('volume', 'traded', '30d'): '516902030'})
        self.assertEqual(rows[('volume', 'traded', '24h')]['period'], {'kind': 'duration', 'window': '24h'})

    def test_a_dimension_defillama_keeps_nothing_for_has_no_row_and_is_not_zero(self):
        result, transport = llama('3323')  # NAVI Lending: fees only; its revenue and dexs answers are 400
        rows = checked(result, 'protocol')
        self.assertEqual({key[0] for key in rows}, {'tvl', 'fees'})
        self.assertEqual(result['outcome'], 'ok')
        self.assertIn('no revenue, volume', ' '.join(result['data']['limitations']))
        self.assertEqual(len(transport.calls), 4)  # the snapshot and three dimensions

    def test_a_dimension_that_fails_for_another_reason_keeps_the_others_with_a_warning(self):
        url = llama_metrics.summary_url('dexs', 'cetus-clmm', None)
        result, _ = llama('2289', failures={url: 'rate_limit'})
        self.assertEqual(result['outcome'], 'partial')
        self.assertEqual([(item['code'], item['severity']) for item in result['issues']], [('rate_limit', 'warning')])
        self.assertEqual({key[0] for key in checked(result, 'protocol')}, {'tvl', 'fees', 'revenue'})

    def test_a_summary_naming_another_protocol_is_left_out(self):
        summaries = deepcopy(LLAMA['summaries'])
        summaries['fees:cetus-clmm:dailyRevenue']['id'] = '9999'  # the slug now belongs to another protocol
        result, _ = llama('2289', llama_answers(summaries=summaries))
        self.assertEqual([item['code'] for item in result['issues']], ['identity_mismatch'])
        self.assertEqual({key[0] for key in checked(result, 'protocol')}, {'tvl', 'fees', 'volume'})

    def test_a_malformed_summary_fails_that_dimension_and_a_total_left_out_makes_no_row(self):
        summaries = deepcopy(LLAMA['summaries'])
        summaries['fees:cetus-clmm:dailyFees']['total24h'] = -1
        summaries['dexs:cetus-clmm:None']['total7d'] = None
        result, _ = llama('2289', llama_answers(summaries=summaries))
        self.assertEqual([item['code'] for item in result['issues']], ['invalid_response'])
        rows = checked(result, 'protocol')
        self.assertNotIn('fees', {key[0] for key in rows})
        self.assertEqual({key[2] for key in rows if key[0] == 'volume'}, {'24h', '30d'})

    def test_a_protocol_the_snapshot_does_not_list_once_and_a_pool_reference_are_refused(self):
        self.assertEqual(llama('0')[0]['issues'][0]['code'], 'unknown_protocol')
        protocols = LLAMA['protocols'] + [LLAMA['protocols'][0]]
        self.assertEqual(llama('3323', llama_answers(protocols=protocols))[0]['issues'][0]['code'], 'unknown_protocol')
        pool = defillama.Reader(wire, connector, transport=Transport(llama_answers())).invoke(
            'metrics', {'native_ref': {'provider': 'defillama', 'native_scope': 'pool', 'native_id': '2289'}})
        self.assertEqual(pool['issues'][0]['code'], 'invalid_request')

    def test_the_catalogue_still_reads_the_same_protocols_with_the_extended_snapshot(self):
        transport = Transport({defillama.catalogue.URLS['protocols']: LLAMA['protocols'],
                               defillama.catalogue.URLS['pools']: {'status': 'success', 'data': []}})
        result = defillama.Reader(wire, connector, transport=transport).invoke('catalogue', {'scope': 'protocols'})
        self.assertEqual(sorted(claim['native_ref']['native_id'] for claim in result['data']['claims']),
                         ['2289', '3323', '5296'])


class NaviMetrics(unittest.TestCase):
    def test_a_reserves_figures_are_worked_from_navis_amounts_oracle_price_and_ray_rates(self):
        result, transport = reserve(USDC_RESERVE)
        rows = checked(result, 'market')
        self.assertEqual({key[:2]: row['value'] for key, row in rows.items()}, {
            ('supplied', 'at_oracle_price'): '3869708.495875', ('borrowed', 'at_oracle_price'): '1364291.184029',
            ('utilisation', 'borrowed_over_supplied'): '0.352557', ('supply_rate', 'base_apr'): '0.633910',
            ('borrow_rate', 'base_apr'): '2.115339'})
        self.assertEqual({(row['unit'], row['basis']) for row in rows.values()},
                         {('USD', 'as_reported'), ('ratio', 'as_reported'), ('percent', 'as_reported')})
        self.assertEqual(result['data']['reserve']['updated_at'], '2026-09-30T12:44:43.099000+00:00')
        self.assertEqual(result['data']['reserve']['symbol'], 'USDC')
        self.assertEqual(transport.calls, [navi.catalogue.url(tuple(navi.catalogue.MARKETS))])

    def test_an_unborrowed_reserve_states_zero_borrowed_and_zero_rates_as_navi_does(self):
        rows = checked(reserve(SUI_RESERVE)[0], 'market')
        self.assertEqual({key[0]: row['value'] for key, row in rows.items()}, {
            'supplied': '4473959.142093', 'borrowed': '0.000000', 'utilisation': '0.000000',
            'supply_rate': '0.000000', 'borrow_rate': '0.000000'})

    def test_a_figure_navi_leaves_out_makes_no_row_and_an_unsupplied_reserve_no_utilisation(self):
        data = deepcopy(NAVI)
        first, second = data['data']
        del first['oracle']['price']        # without a price neither USD figure can be stated
        del first['currentBorrowRate']
        second['totalSupplyAmount'] = '0'   # nobody supplied it: utilisation is undefined, not zero
        rows = checked(reserve(USDC_RESERVE, data=data)[0], 'market')
        self.assertEqual({key[0] for key in rows}, {'utilisation', 'supply_rate'})
        self.assertNotIn('utilisation', {key[0] for key in checked(reserve(SUI_RESERVE, data=data)[0], 'market')})

    def test_an_unknown_reserve_one_outside_the_configured_markets_and_a_pool_reference_are_refused(self):
        self.assertEqual(reserve('0x' + '11' * 32)[0]['issues'][0]['code'], 'unknown_reserve')
        self.assertEqual(reserve(USDC_RESERVE, markets='main')[0]['issues'][0]['code'], 'unknown_reserve')
        self.assertEqual(reserve(USDC_RESERVE, native_scope='pool')[0]['issues'][0]['code'], 'invalid_request')

    def test_two_records_sharing_a_pool_id_name_no_reserve_and_another_shape_is_refused(self):
        data = deepcopy(NAVI)
        data['data'].append(deepcopy(data['data'][0]))
        self.assertEqual(reserve(USDC_RESERVE, data=data)[0]['issues'][0]['code'], 'unknown_reserve')
        self.assertEqual(reserve(SUI_RESERVE, data=data)[0]['outcome'], 'ok')
        self.assertEqual(reserve(USDC_RESERVE, data={'code': 1, 'data': []})[0]['issues'][0]['code'], 'invalid_response')


class ContractsAndTools(unittest.TestCase):
    def test_each_plugin_declares_metrics_for_its_own_kind_and_its_own_basis(self):
        for plugin, kind, basis in (('defillama', 'protocol', 'standardized'), ('navi', 'market', 'as_reported')):
            entry = identity.validate_manifest(json.loads((PLUGINS / plugin / 'contract.json').read_text())
                                               ).concepts[identity.Concept.FUNDAMENTALS]
            self.assertEqual((str(entry.level), str(entry.via), entry.operations, entry.qualities['metrics']['basis']),
                             (kind, kind, {'metrics': 'metrics'}, (basis,)))

    def test_each_operation_tool_is_read_only_and_declares_its_contracts_operation(self):
        for plugin, module in (('defillama', defillama), ('navi', navi)):
            meta = json.loads(module.definition.schemas(wire)['metrics']['parameters']['$comment'])['pythia_http_operation']
            self.assertEqual((meta['operation'], meta['read_only'], meta['plugin']), ('metrics', True, f'pythia-{plugin}'))


if __name__ == '__main__':
    unittest.main()
