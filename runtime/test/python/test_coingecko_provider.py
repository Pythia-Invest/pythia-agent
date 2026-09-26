"""Synthetic values shaped by CoinGecko's public docs; no network, keys or responses.

Shapes: docs.coingecko.com/reference/coins-list (include_platform=true),
/coins/markets, /simple/price, /coins/{id}, /coins/{id}/ohlc
and /coins/{id}/market_chart, checked 2026-09-25. Coin IDs, symbols and
addresses below are invented.
"""
from contextlib import contextmanager
import importlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
from datetime import datetime, timezone, timedelta
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit

from native_plugin_fixtures import Context
from market_data_fixture import PACKAGE

ROOT = Path(__file__).resolve().parents[2] / 'managed'
package = types.ModuleType('test_cg')
package.__path__ = [str(ROOT / 'plugins' / 'coingecko')]
sys.modules['test_cg'] = package
identity = importlib.import_module('test_cg.identity')
series = importlib.import_module('test_cg.series')
results = importlib.import_module('test_cg.results')
catalogue = importlib.import_module('test_cg.catalogue')
config = importlib.import_module('test_cg.config')
dashboard = importlib.import_module('test_cg.dashboard')
wire = importlib.import_module(PACKAGE + '.wire')
failures = importlib.import_module(PACKAGE + '.connector')
spec = importlib.util.spec_from_file_location('cg_worker', ROOT / 'runner/coingecko/main.py')
worker = importlib.util.module_from_spec(spec); spec.loader.exec_module(worker)
NATIVE = {'provider': 'coingecko', 'native_scope': 'coin', 'native_id': 'synthetic-coin'}
DEMO = {'mode': 'demo', 'token': 'SYNTHETIC', 'operation': 'catalogue', 'arguments': {}}
LIST = [
    {'id': 'zeta-token', 'symbol': 'zet', 'name': 'Synthetic Zeta',
     'platforms': {'chain-b': '0xB0', 'chain-a': '0xA0'}},
    {'id': 'alpha-native', 'symbol': 'alp', 'name': 'Synthetic Alpha', 'platforms': {}},
    {'id': 'beta-native', 'symbol': '', 'name': 'Synthetic Beta', 'platforms': {'': ''}},
]
MARKETS = [{'id': 'alpha-native', 'market_cap_rank': 1, 'market_cap': 123456789012,
            'current_price': 1.5, 'total_volume': 9},
           {'id': 'zeta-token', 'market_cap_rank': None, 'market_cap': 0},
           {'id': 'not-listed', 'market_cap_rank': 2, 'market_cap': 5}]


def request(definition, latest=False):
    return {'schema_version': 1, 'operation': 'latest' if latest else 'history', 'view': {'kind': 'source', 'series_id': definition['id']},
            'window': {'start': None, 'end': None}, 'limit': 10, 'requirements': {'freshness': 'any', 'completion': 'any', 'coverage': 'any'}}


class Source:
    """Fixed synthetic bodies per endpoint; records every outbound URL."""
    def __init__(self, **overrides):
        self.bodies = {'/coins/list': LIST, '/coins/markets': MARKETS, **overrides}
        self.calls = []

    def open(self, http_request, **_kwargs):
        self.calls.append(http_request)
        body = self.bodies[urlsplit(http_request.full_url).path.removeprefix('/api/v3')]
        if isinstance(body, Exception):
            raise body
        return io.BytesIO(body if isinstance(body, bytes) else json.dumps(body).encode())


class Catalogue(unittest.TestCase):
    def test_catalogue_requests_platforms_keyless_or_keyed_and_never_search(self):
        for mode, token, header in (('keyless', None, None), ('demo', 'SYNTHETIC', 'X-cg-demo-api-key'),
                                    ('paid', 'SYNTHETIC', 'X-cg-pro-api-key')):
            spec = worker.request_spec({**DEMO, 'mode': mode, 'token': token})
            self.assertEqual(spec.full_url, worker.HOSTS[mode] + '/coins/list?include_platform=true')
            self.assertEqual([k for k in spec.headers if 'api-key' in k.lower()], [header] if header else [])
            self.assertNotIn('SYNTHETIC', spec.full_url)
        for bad in ({**DEMO, 'arguments': {'include_platform': 'false'}}, {**DEMO, 'operation': 'search', 'arguments': {'query': 'x'}},
                    {**DEMO, 'mode': 'keyless', 'token': None, 'operation': 'dashboard_quotes', 'arguments': {'ids': ['a'], 'currency': 'usd'}}):
            with self.assertRaises(ValueError):
                worker.request_spec(bad)

    def test_snapshot_keeps_contracts_skips_native_placeholders_and_counts_bad_rows(self):
        snapshot = worker.catalogue_snapshot(LIST)
        self.assertEqual(snapshot['rows'], [['alpha-native', 'alp', 'Synthetic Alpha', []],
                                            ['beta-native', '', 'Synthetic Beta', []],
                                            ['zeta-token', 'zet', 'Synthetic Zeta', [['chain-a', '0xA0'], ['chain-b', '0xB0']]]])
        self.assertEqual(snapshot['rejected'], {'rows': 0, 'contracts': 0})
        self.assertEqual(snapshot['version'], worker.catalogue_snapshot(list(reversed(LIST)))['version'])
        # One malformed row or pair never fails the list; each one is counted.
        for row in ({'id': 'x', 'symbol': 's', 'name': 'N', 'platforms': ['chain-a']},
                    {'id': 'x', 'symbol': 's', 'name': ''}, {'id': 'bad\nid', 'symbol': 's', 'name': 'N'}, 'not-a-row'):
            snapshot = worker.catalogue_snapshot(LIST + [row])
            self.assertEqual((len(snapshot['rows']), snapshot['rejected']), (3, {'rows': 1, 'contracts': 0}))
        for address in ('0x\n1', 7, '   '):
            snapshot = worker.catalogue_snapshot([{'id': 'x', 'symbol': 's', 'name': 'N', 'platforms': {'chain-a': address, 'chain-b': '0xB0'}}])
            self.assertEqual((snapshot['rows'][0][3], snapshot['rejected']), ([['chain-b', '0xB0']], {'rows': 0, 'contracts': 1}))
        duplicated = worker.catalogue_snapshot(LIST + [{**LIST[0], 'name': 'Other'}])
        self.assertEqual([row[0] for row in duplicated['rows']], ['alpha-native', 'beta-native'], 'an ambiguous ID is never adopted')
        self.assertEqual(catalogue.page(duplicated, {'scope': 'coins'})['rejected'], {'rows': 2, 'contracts': 0})
        with self.assertRaises(ValueError):
            worker.catalogue_snapshot({'rows': LIST})
        with self.assertRaises(ValueError):  # Refuse rather than truncate an oversized list.
            worker.catalogue_snapshot([{'id': f'coin-{i}', 'symbol': 's', 'name': 'n' * 400,
                                        'platforms': {'chain-a': 'a' * 400}} for i in range(9000)])

    def test_two_sequential_bulk_reads_yield_identifiers_and_rank_signals_without_prices(self):
        source, calls, active, peak = Source(), [], 0, 0
        @contextmanager
        def permit(opener, http_request, **kwargs):
            nonlocal active, peak
            calls.append(http_request.full_url)
            active += 1
            peak = max(peak, active)
            try:
                with opener.open(http_request, **kwargs) as response:
                    yield response
            finally:
                active -= 1
        with patch.dict(os.environ, {'PYTHIA_BUDGET_MODULE': 'synthetic-budget'}), \
                patch.object(worker, 'budget_opener', return_value=permit):
            result = worker.execute({**DEMO, 'mode': 'keyless', 'token': None}, source)
        self.assertIsNone(result['error'])
        self.assertEqual([urlsplit(url).path for url in calls], ['/api/v3/coins/list', '/api/v3/coins/markets'])
        self.assertEqual(peak, 1, 'each budgeted request is released before the next one')
        data = json.loads(json.dumps(result['data']))  # the worker's transport form
        self.assertEqual(data['ranks'], {'alpha-native': {'rank': 1, 'market_cap': '123456789012'}})
        for price in ('current_price', 'total_volume', '1.5'):
            self.assertNotIn(price, json.dumps(data))
        first = catalogue.page(data, {'scope': 'coins', 'limit': 2})
        last = catalogue.page(data, {'scope': 'coins', 'cursor': first['next_cursor']})
        alpha, beta, zeta = first['rows'] + last['rows']
        self.assertEqual((first['total'], first['rank_coverage']), (3, 'top_250'))
        self.assertEqual(first['retention'], {'mode': 'persistent', 'max_age_seconds': 86400})
        self.assertIsNone(last['next_cursor'])
        self.assertEqual(alpha['identifiers'], [
            {'scheme': 'coingecko.id', 'value': 'alpha-native', 'authority': 'source_asserted'},
            {'scheme': 'symbol', 'value': 'alp', 'authority': 'source_asserted'}])
        self.assertEqual(alpha['rank']['market_cap'], {'value': '123456789012', 'currency': 'USD'})
        self.assertEqual((alpha['rank']['market_cap_rank'], alpha['rank']['time_basis']), (1, 'retrieval'))
        self.assertIsNone(beta['symbol'], 'an unknown symbol is not invented')
        self.assertNotIn('rank', zeta, 'zero market cap means unknown size, not rank')
        self.assertEqual([i for i in zeta['identifiers'] if i['scheme'] == 'contract_address'], [
            {'scheme': 'contract_address', 'value': '0xA0', 'network': 'chain-a', 'authority': 'source_asserted'},
            {'scheme': 'contract_address', 'value': '0xB0', 'network': 'chain-b', 'authority': 'source_asserted'}])
        for row in (alpha, beta, zeta):
            wire.validate('provider_ref', row['provider_ref'])
            self.assertEqual(row['level'], 'crypto')
        self.assertEqual(len(calls), 2, 'reading pages performs no further HTTP calls')

    def test_optional_enrichment_failures_keep_the_complete_list_without_retries(self):
        throttled = HTTPError('https://redacted.invalid', 429, 'Throttled', {'Retry-After': '60'}, io.BytesIO(b'{}'))
        for body in (throttled, b'{"status":{"error_code":10005}}', [{'id': 'alpha-native', 'market_cap_rank': True}]):
            source = Source(**{'/coins/markets': body})
            result = worker.execute(DEMO, source)
            self.assertIsNone(result['error'])
            page = catalogue.page(result['data'], {'scope': 'coins'})
            self.assertEqual(page['rank_coverage'], 'unavailable')
            self.assertEqual(len(page['rows']), 3)
            self.assertTrue(all('rank' not in row for row in page['rows']))
            self.assertEqual(len(source.calls), 2, 'optional failures are not retried')
        self.assertEqual(worker.execute(DEMO, Source(**{'/coins/list': throttled}))['error'], 'rate_limit')

    def test_page_bounds_and_opaque_identifiers(self):
        data = worker.catalogue_snapshot([{'id': 'Synthetic.?coin/#', 'symbol': 'syn', 'name': 'Synthetic'}])
        self.assertEqual(catalogue.page(data, {'scope': 'coins'})['rows'][0]['provider_ref']['native_id'], 'Synthetic.?coin/#')
        with self.assertRaisesRegex(ValueError, 'invalid_request'):
            catalogue.page(data, {'scope': 'coins', 'cursor': '2'})
        url = urlsplit(worker.request_spec({**DEMO, 'operation': 'details', 'arguments': {'id': '../example.invalid'}}).full_url)
        self.assertEqual((url.netloc, url.path.removeprefix('/api/v3/coins/').count('/')), ('api.coingecko.com', 0))


class Access(unittest.TestCase):
    def test_auto_mode_is_keyless_without_a_key_and_never_downgrades_a_bad_one(self):
        def key(status, value=None):
            return lambda: (status, value)
        self.assertEqual(config.access('auto', key('missing')), ('keyless', None))
        self.assertEqual(config.access('auto', key('configured', 'SYNTHETIC')), ('demo', 'SYNTHETIC'))
        self.assertEqual(config.access('paid', key('configured', 'SYNTHETIC')), ('paid', 'SYNTHETIC'))
        self.assertEqual(config.access('keyless', lambda: self.fail('keyless must not read the key')), ('keyless', None))
        for mode, status in (('auto', 'invalid'), ('demo', 'missing'), ('paid', 'invalid')):
            with self.assertRaisesRegex(ValueError, 'unavailable'):
                config.access(mode, key(status))
        def unreadable():
            raise ValueError('invalid configuration field')
        self.assertEqual(config.access('auto', unreadable), ('keyless', None))
        with self.assertRaisesRegex(ValueError, 'unavailable'):
            config.access('demo', unreadable)

    def test_key_is_read_through_core_configuration(self):
        ctx = object()
        configuration = types.SimpleNamespace(value=lambda owner, key: ('configured', owner is ctx and key))
        self.assertEqual(config.key_reader(ctx, lambda: types.SimpleNamespace(configuration=configuration))(),
                         ('configured', 'coingecko_api_key'))

    def test_declaration_parses_with_core_configuration(self):
        spec = importlib.util.spec_from_file_location('cg_core_configuration', ROOT / 'core/platform/configuration.py')
        core = importlib.util.module_from_spec(spec); spec.loader.exec_module(core)
        declared = json.loads((ROOT / 'plugins/coingecko/configuration.json').read_text())
        self.assertEqual([(f['key'], f['kind'], f['required']) for f in core.parse(declared)], [(config.KEY, 'secret', False)])

    def test_registered_tools_follow_main_contract_and_keyless_readiness(self):
        provider = importlib.import_module('test_cg.__init__')
        feature = sys.modules[PACKAGE]
        ctx = Context('pythia-coingecko')
        # Core configuration reads the declaring package from the native manifest.
        ctx.manifest = types.SimpleNamespace(path=str(ROOT / 'plugins/coingecko'))
        plugins = types.ModuleType('hermes_cli.plugins')
        plugins.get_plugin_manager = lambda: types.SimpleNamespace(_plugins={
            'pythia-market-data': types.SimpleNamespace(enabled=True, module=feature)})
        with tempfile.TemporaryDirectory() as directory, \
                patch.dict(sys.modules, {'hermes_cli.plugins': plugins, 'tools.registry': ctx.registry_module}), \
                patch.dict(os.environ, {'PYTHIA_MANAGED_ROOT': str(ROOT), 'PYTHIA_CONFIG_ROOT': directory}):
            provider.register(ctx)
            self.assertEqual(set(ctx.tools), set(provider.TOOLS.values()))
            self.assertFalse(any('search' in name for name in ctx.tools))
            comments = {name: json.loads(entry['schema']['parameters'].get('$comment', '{}'))
                        for name, entry in ctx.registrations.items()}
            marked = {name: value['pythia_market_data'] for name, value in comments.items() if 'pythia_market_data' in value}
            # The dashboard is an explicit HTTP export, not a market-data contribution.
            self.assertIn('pythia_http_operation', comments[provider.TOOLS['dashboard']])
            for contribution in marked.values():
                wire.validate('contribution', contribution)
            self.assertEqual({op['operation'] for op in next(iter(marked.values()))['operations']},
                             {'details', 'series', 'latest', 'history', 'read_batch'})
            self.assertNotIn(provider.TOOLS['catalogue'], marked)
            # No key saved: auto mode is keyless, so explicit reads are ready and
            # the automatically refreshed dashboard is not.
            self.assertTrue(ctx.checks[provider.TOOLS['catalogue']]())
            self.assertTrue(ctx.checks[provider.TOOLS['latest']]())
            self.assertFalse(ctx.checks[provider.TOOLS['dashboard']]())
            calls = []
            def run_worker(_command, request, _environment, **options):
                calls.append((request, options))
                return {'data': worker.catalogue_snapshot(LIST), 'error': None}
            with patch.object(importlib.import_module(PACKAGE + '.process'), 'run_worker', run_worker):
                pages = [json.loads(ctx.tools[provider.TOOLS['catalogue']]({'scope': 'coins', 'limit': 2, **cursor}))
                         for cursor in ({}, {'cursor': '2'})]
            self.assertEqual([len(page['data']['rows']) for page in pages], [2, 1])
            self.assertEqual(len(calls), 1, 'pages share one cached source snapshot')
            self.assertEqual((calls[0][0]['mode'], calls[0][0]['token']), ('keyless', None))
            # The packed live list (~4 MB) exceeds the default 2 MB worker bound.
            self.assertGreater(calls[0][1]['output_limit'], 4_000_000)
        manifest = (ROOT / 'plugins/coingecko/plugin.yaml').read_text()
        self.assertEqual({line.strip()[2:] for line in manifest.splitlines() if line.strip().startswith('- pythia_coingecko_')},
                         set(provider.TOOLS.values()))


class Provider(unittest.TestCase):
    def test_dashboard_requires_key_and_batches_exact_coin_ids(self):
        for operation, arguments in (
            ('dashboard_quotes', {'ids': ['bitcoin', 'ethereum'], 'currency': 'usd'}),
            ('dashboard_chart', {'id': 'bitcoin', 'currency': 'usd'}),
        ):
            req = {'mode': 'keyless', 'token': None, 'operation': operation, 'arguments': arguments}
            with self.assertRaises(ValueError): worker.request_spec(req)
            for mode, header in (('demo', 'X-cg-demo-api-key'), ('paid', 'X-cg-pro-api-key')):
                spec = worker.request_spec({**req, 'mode': mode, 'token': 'SYNTHETIC'})
                self.assertEqual(spec.headers[header], 'SYNTHETIC')
                self.assertTrue(spec.full_url.startswith(worker.HOSTS[mode]))
                self.assertNotIn('SYNTHETIC', spec.full_url)
                if operation == 'dashboard_chart':
                    self.assertIn('days=1', spec.full_url)
                    self.assertNotIn('interval=', spec.full_url)
                else:
                    self.assertIn('price_change_percentage=24h%2C7d%2C30d', spec.full_url)
        calls = []
        def call(op, args):
            calls.append((op, args))
            return {'data': [{'id': 'bitcoin', 'symbol': 'btc', 'current_price': '123.45',
                             'last_updated': '2026-01-02T10:00:00Z', 'price_change_24h': '1.5',
                             'price_change_percentage_7d_in_currency': '25',
                             'price_change_percentage_30d_in_currency': None}]}
        result = dashboard.read({'kind': 'quotes', 'symbols': ['bitcoin', 'ethereum']}, 'USD', call, failures)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][1]['ids'], ['bitcoin', 'ethereum'])
        self.assertEqual(result['quotes'][0]['display_symbol'], 'BTC')
        self.assertEqual(result['quotes'][0]['price'], 123.45)
        self.assertEqual(result['quotes'][0]['period_changes']['7d']['percent'], 25)
        self.assertAlmostEqual(result['quotes'][0]['period_changes']['7d']['change'], 24.69)
        self.assertIsNone(result['quotes'][0]['period_changes']['30d']['percent'])
        self.assertIsNone(result['quotes'][1]['price'])
        with self.assertRaisesRegex(ValueError, 'invalid_response'):
            dashboard.read({'kind': 'quotes', 'symbols': ['ethereum']}, 'USD', call, failures)

    def test_dashboard_preserves_timestamped_samples_currency_and_partial_failure(self):
        now = int(datetime.now(timezone.utc).timestamp() * 1000)
        def call(op, args):
            self.assertEqual(op, 'dashboard_chart')
            self.assertEqual(args['currency'], 'eur')
            if args['id'] == 'ethereum': return {'error': 'rate_limit'}
            return {'data': {'prices': [[now - 90000000, '1'], [now - 300123, '2'], [now - 1000, '3']]}}
        rows = dashboard.read({'kind': 'charts', 'symbols': ['bitcoin', 'ethereum']}, 'EUR', call, failures)['charts']
        self.assertEqual(rows[0]['points'], [{'t': now - 300123, 'c': 2}, {'t': now - 1000, 'c': 3}])
        self.assertEqual(rows[0]['currency'], 'EUR')
        self.assertIsNone(rows[0]['session'])
        self.assertEqual(rows[1]['points'], [])
        self.assertIsNotNone(rows[1]['error'])

    def test_fixed_host_header_keyless_no_auth_and_no_redirect(self):
        for mode in ('keyless', 'demo', 'paid'):
            spec = worker.request_spec({'mode': mode, 'token': None if mode == 'keyless' else 'SYNTHETIC', 'operation': 'latest', 'arguments': {'id': 'synthetic', 'currency': 'usd'}})
            self.assertTrue(spec.full_url.startswith(worker.HOSTS[mode] + '/simple/price?'))
            self.assertNotIn('SYNTHETIC', spec.full_url)
            self.assertEqual(len([k for k in spec.headers if 'api-key' in k.lower()]), 0 if mode == 'keyless' else 1)
        self.assertIsNone(worker.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://evil.invalid'))
        with self.assertRaises(ValueError):
            worker.request_spec({'mode': 'keyless', 'token': 'SYNTHETIC', 'operation': 'details', 'arguments': {'id': 'x'}})
        spec = worker.request_spec({'mode': 'demo', 'token': 'SYNTHETIC', 'operation': 'latest_batch',
                                    'arguments': {'ids': ['synthetic_coin', 'Synthetic.?coin/#'], 'currency': 'usd'}})
        self.assertEqual(parse_qs(urlsplit(spec.full_url).query)['ids'], ['synthetic_coin,Synthetic.?coin/#'])

    def test_transport_decimal_body_bound_errors_no_retry(self):
        class Opener:
            def __init__(self, value): self.value, self.calls = value, 0
            def open(self, *args, **kwargs):
                self.calls += 1
                if isinstance(self.value, Exception): raise self.value
                return io.BytesIO(self.value)
        req = {'mode': 'keyless', 'token': None, 'operation': 'details', 'arguments': {'id': 'synthetic'}}
        response = worker.execute(req, Opener(b'{"price":0.123456789012345678901}'))
        self.assertEqual(str(response['data']['price']), '0.123456789012345678901')
        for payload in (b'not json', b'{"price":NaN}', b'{"price":1e999999999}', b'[' * (worker.LIMIT + 1)):
            self.assertIn(worker.execute(req, Opener(payload))['error'], ('invalid_response', 'response_limit'))
        for status, code in ((401,'authentication_failed'), (403,'access_denied'), (429,'rate_limit'), (302,'access_denied')):
            opener = Opener(HTTPError('https://redacted.invalid',status,'SECRET',{'Retry-After':'3'},None))
            result = worker.execute(req, opener)
            self.assertEqual(result['error'], code)
            self.assertEqual(result['retry_after'],3)
            self.assertEqual(opener.calls, 1)
            self.assertNotIn('SECRET', json.dumps(result))

    def test_http_failure_class_survives_numeric_source_error_body(self):
        # Synthetic body models only the documented status.error_code structure.
        req = {'mode': 'keyless', 'token': None, 'operation': 'ohlc',
               'arguments': {'id': 'synthetic-coin', 'currency': 'usd', 'days': 1}}
        for status, code in ((400, 'invalid_request'), (401, 'authentication_failed'),
                             (403, 'access_denied'), (408, 'timeout'),
                             (429, 'rate_limit'), (500, 'provider_error')):
            body = io.BytesIO(json.dumps({'status': {'error_code': status, 'error_message': 'SYNTHETIC'}}).encode())
            error = HTTPError('https://redacted.invalid', status, 'synthetic', {'Retry-After': '17'}, body)
            opener = types.SimpleNamespace(open=lambda *_args, **_kwargs: (_ for _ in ()).throw(error))
            raw = worker.execute(req, opener)
            self.assertEqual(raw['error'], code)
            self.assertEqual(raw['provider_code'], status)
            definition = series.definition(NATIVE, 'ohlc_30m', 'USD')
            result = wire.validate_read_result(results.read(request(definition), definition, 'ohlc_30m', raw))
            self.assertEqual(result['issues'][0]['code'], code)
            self.assertEqual(result['issues'][0]['source_code'], str(status))
            self.assertIn('17', result['issues'][0]['message'])
            self.assertEqual(result['observations'], [])
            self.assertNotIn('SYNTHETIC', json.dumps(result))
            error.close()

    def test_network_evidence_keeps_each_coin_and_network_distinct(self):
        one = identity.candidate({'id':'synthetic-coin','name':'Same','symbol':'same','platforms': {'ethereum':'0xAbC','solana':'0xAbC','':''}}, True)
        for evidence in one['evidence']: wire.validate('evidence', evidence)
        contracts = [e['qualifiers']['network'] for e in one['evidence'] if e['scheme'] == 'contract_address']
        self.assertEqual(len(contracts), len(set(contracts)))

    def test_stable_selectors_windows_and_actual_shapes(self):
        now = datetime.now(timezone.utc)
        for mode in series.modes('paid'):
            definition = wire.validate('series', series.definition(NATIVE, mode, 'USD'))
            self.assertEqual(series.selector(definition['source_detail']['values']['read_selector'], 'paid'), (NATIVE, mode, 'USD'))
            req = request(definition, mode == 'latest')
            if mode != 'latest':
                req['window'] = {'start': {'kind':'instant','value':(now-timedelta(hours=12)).isoformat()}, 'end':{'kind':'instant','value':now.isoformat()}}
                series.bounds(req, mode, now)
            self.assertEqual(definition['id'], series.definition(NATIVE, mode, 'USD')['id'])
            stamp = int((now-timedelta(hours=1)).timestamp()*1000)
            data = {'synthetic-coin': {'usd':'0.123456789012345678901','last_updated_at': stamp//1000}} if mode == 'latest' else {'prices':[[stamp,'2']], 'total_volumes': [[stamp, '900']]} if mode.startswith('sample') else [[stamp,'2','3','1','2']]
            result = wire.validate_read_result(results.read(req, definition, mode, {'data':data,'error':None}))
            self.assertEqual(result['outcome'], 'ok')
            self.assertNotIn('volume', result['observations'][0])
            self.assertEqual(result['observations'][0]['completion']['state'], 'unknown')
            if mode.startswith('ohlc'):
                self.assertEqual(result['observations'][0]['interval']['end'], result['observations'][0]['time'])
            req['requirements']['completion'] = 'completed'
            strict = wire.validate_read_result(results.read(req, definition, mode, {'data':data,'error':None}))
            self.assertEqual(strict['outcome'], 'error')
        definition = series.definition(NATIVE,'ohlc_30m','USD')
        req = request(definition); req['window'] = {'start':{'kind':'instant','value':(now-timedelta(days=2)).isoformat()},'end':{'kind':'instant','value':now.isoformat()}}
        with self.assertRaisesRegex(ValueError,'unsupported_window'): series.bounds(req,'ohlc_30m',now)
        with self.assertRaisesRegex(ValueError,'unsupported_series'): series.selector(series.definition(NATIVE,'ohlc_daily','USD')['source_detail']['values']['read_selector'],'demo')

    def test_unknown_latest_time_invalid_prices_and_granularity(self):
        d = series.definition(NATIVE, 'latest', 'USD'); req = request(d,True)
        value = wire.validate_read_result(results.read(req,d,'latest',{'data':{'synthetic-coin':{'usd':'0'}},'error':None}))
        self.assertEqual(value['observations'][0]['time'],{'kind':'unknown'})
        self.assertEqual(value['observations'][0]['value'],'0')
        missing = wire.validate_read_result(results.read(req,d,'latest',{'data':{'synthetic-coin':{'usd':None}},'error':None}))
        self.assertEqual(missing['observations'],[])
        d = series.definition(NATIVE,'sample_hourly','USD')
        raw = {'data':{'prices':[[1700000000000,'2'],[1700000300000,'3']]},'error':None}
        self.assertEqual(len(results.read(request(d),d,'sample_hourly',raw)['observations']),2)
        raw['data']['prices'].append([1700000000000,'4'])
        self.assertEqual(len(results.read(request(d),d,'sample_hourly',raw)['observations']),1)

    def test_currency_pin_paid_history_and_provider_plan_errors(self):
        usd = series.definition(NATIVE, 'sample_daily', 'USD')
        eur = series.definition(NATIVE, 'sample_daily', 'EUR')
        self.assertNotEqual(usd['id'], eur['id'])
        self.assertEqual(series.selector(usd['source_detail']['values']['read_selector'], 'demo')[2], 'USD')
        now = datetime.now(timezone.utc)
        req = request(usd)
        req['window'] = {'start': {'kind':'instant','value':(now-timedelta(days=600)).isoformat()}, 'end':{'kind':'instant','value':(now-timedelta(days=598)).isoformat()}}
        self.assertEqual(series.bounds(req,'sample_daily',now,access='paid')[0],'chart')
        with self.assertRaisesRegex(ValueError,'unsupported_window'): series.bounds(req,'sample_daily',now,access='demo')
        failure = worker.provider_error({'status':{'error_code':10005,'error_message':'DO_NOT_ECHO'}})
        self.assertEqual(failure,{'data':None,'error':'access_denied','provider_code':10005})
        result = results.read(request(usd),usd,'sample_daily',{**failure,'http_status':400,'retry_after':12})
        self.assertEqual(result['issues'][0]['source_code'],'10005')
        self.assertIn('12 seconds',result['issues'][0]['message'])
        self.assertNotIn('DO_NOT_ECHO',json.dumps(result))
        self.assertIsNone(worker.retry_after('Infinity'))

    def test_hourly_transport_window_and_quote_range_admission(self):
        now = datetime.now(timezone.utc).timestamp() * 1000
        for days in (7, 30):
            spec = worker.request_spec({'mode':'demo','token':'SYNTHETIC','operation':'dashboard_chart','arguments':{'id':'synthetic-coin','currency':'usd','days':days}})
            self.assertIn(f'days={days}', spec.full_url)
            self.assertIn('interval=hourly', spec.full_url)
            calls = []
            def call(op, args):
                calls.append((op, args))
                return {'data': {'prices': [[now-days*86400000-3600000, 99], [now-days*86400000+3600000, 100], [now-3600000, 110]]}}
            chart = dashboard.read({'kind':'charts','symbols':['synthetic-coin'],'range':f'{days}d'}, 'USD', call, failures)['charts'][0]
            self.assertEqual(calls[0][1]['days'], days)
            self.assertEqual(len(chart['points']), 2)
            self.assertEqual(chart['interval_ms'], 3600000)
            self.assertAlmostEqual(chart['window']['end']-chart['window']['start'],days*86400000,places=2)
        with self.assertRaises(ValueError): dashboard.read({'kind':'quotes','symbols':['synthetic-coin'],'range':'7d'}, 'USD', call, failures)


if __name__ == '__main__': unittest.main()
