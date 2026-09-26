"""Synthetic CoinMarketCap values, no network or credentials.

Shapes follow the official reference (checked 2026-09-25): v1 map and v3
listings/quotes return arrays with `quote` as a list of {symbol, ...}; v2 info
and v3 historical quotes are keyed by coin ID. Values are invented.
"""
from contextlib import contextmanager
import copy
import importlib
import importlib.util
import io
import json
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from native_plugin_fixtures import Context
from test_market_data_identity import PACKAGE, platform_module

ROOT = Path(__file__).resolve().parents[2] / 'managed/plugins/coinmarketcap'
NAME = 'coinmarketcap_fixture'
spec = importlib.util.spec_from_file_location(NAME, ROOT / '__init__.py', submodule_search_locations=[str(ROOT)])
plugin = importlib.util.module_from_spec(spec)
sys.modules[NAME] = plugin
spec.loader.exec_module(plugin)
worker = importlib.import_module(NAME + '.worker')
series = importlib.import_module(NAME + '.series')
wire = importlib.import_module(PACKAGE + '.wire')
process = importlib.import_module(PACKAGE + '.process')
credentials = importlib.import_module(PACKAGE + '.credentials')
matching = importlib.import_module(PACKAGE + '.identity_matching')

TOKEN_PLATFORM = {'id': 1, 'name': 'Example Chain', 'symbol': 'EXC', 'slug': 'example-chain', 'token_address': '0xabc'}
MAP = [{'id': 1, 'rank': 1, 'name': 'Synthetic Coin', 'symbol': 'SYN', 'slug': 'synthetic-coin', 'is_active': 1, 'status': 'active', 'platform': None},
       {'id': 7, 'rank': 900, 'name': 'Synthetic Token', 'symbol': 'SYN', 'slug': 'synthetic-token', 'is_active': 1, 'status': 'active', 'platform': TOKEN_PLATFORM}]
LISTINGS = [{'id': 1, 'cmc_rank': 1, 'quote': [{'symbol': 'USD', 'market_cap': '123456789.125', 'last_updated': '2026-01-02T00:00:00.000Z'}]}]
INFO = {'id': 7, 'name': 'Synthetic Token', 'symbol': 'SYN', 'slug': 'synthetic-token', 'category': 'token',
        'description': 'Synthetic description.', 'logo': 'https://example.invalid/7.png', 'notice': '',
        'urls': {'website': ['https://example.invalid'], 'twitter': [], 'explorer': ['https://explorer.example.invalid/0xabc']},
        'tag-names': ['Example tag'], 'date_added': '2020-01-01T00:00:00.000Z', 'date_launched': None,
        'contract_address': [{'contract_address': '0xabc', 'platform': {'name': 'Example Chain', 'coin': {'id': '1027', 'name': 'Example', 'symbol': 'EXC', 'slug': 'example-chain'}}}]}


def quote_rows(ids):
    return [{'id': int(identifier), 'symbol': 'SYN', 'name': 'Synthetic ' + identifier,
             'quote': [{'symbol': 'USD', 'price': '0.123456789012345678901', 'percent_change_24h': '-2', 'last_updated': '2026-01-02T00:00:00.000Z'}]}
            for identifier in ids.split(',')]


def responses(operation, arguments):
    status = {'timestamp': '2026-01-02T00:00:05.000Z', 'credit_count': 1}
    data = {'map': lambda: MAP[:arguments.get('limit', 0)], 'listings': lambda: LISTINGS, 'info': lambda: {'7': INFO},
            'quotes': lambda: quote_rows(arguments['id'])}[operation]()
    return {'data': data, 'error': None, 'source_status': status}


def call(ctx, operation, arguments):
    return json.loads(ctx.tools['pythia_coinmarketcap_' + operation](arguments))


def comment(ctx, operation):
    return json.loads(ctx.registrations['pythia_coinmarketcap_' + operation]['schema']['parameters']['$comment'])


@contextmanager
def registered(answer=responses, key=('configured', 'SYNTHETIC-KEY')):
    feature = SimpleNamespace(enabled=True, module=sys.modules[PACKAGE], manifest=SimpleNamespace(name='pythia-market-data'))
    manager = SimpleNamespace(_plugins={'features/pythia-market-data': feature})
    calls = []
    def run_worker(_command, message, _environment, **_options):
        worker.request_spec(message)  # Every outbound message is an admitted worker request.
        calls.append((message['operation'], copy.deepcopy(message['arguments'])))
        return answer(message['operation'], message['arguments'])
    modules = {'hermes_cli': ModuleType('hermes_cli'), 'hermes_cli.plugins': SimpleNamespace(get_plugin_manager=lambda: manager)}
    with patch.dict(sys.modules, modules), patch.object(credentials, '_token', return_value=key), \
            patch.object(process, 'run_worker', side_effect=run_worker):
        ctx = Context('pythia-coinmarketcap')
        plugin.register(ctx)
        yield ctx, calls


def latest_input(identifier):
    native = {'provider': 'coinmarketcap', 'native_scope': 'coin', 'native_id': identifier}
    definition = series.definition(native, 'latest', 'USD')
    return {'request': {'schema_version': 1, 'operation': 'latest', 'view': {'kind': 'source', 'series_id': definition['id']},
                        'window': {'start': None, 'end': None}, 'limit': 1,
                        'requirements': {'freshness': 'any', 'completion': 'any', 'coverage': 'any'}},
            'source_selector': definition['source_detail']['values']['read_selector']}


class CoinMarketCap(unittest.TestCase):
    def test_worker_keeps_the_key_in_a_header_and_bounds_every_request(self):
        value = {'token': 'SYNTHETIC-KEY', 'operation': 'map', 'arguments': {'start': 1, 'limit': 2000}}
        request = worker.request_spec(value)
        self.assertEqual(request.headers['X-cmc_pro_api_key'], 'SYNTHETIC-KEY')
        self.assertNotIn('SYNTHETIC-KEY', request.full_url)
        self.assertIn('/v1/cryptocurrency/map?', request.full_url)
        self.assertIn('sort=id', request.full_url)
        self.assertIsNone(worker.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://elsewhere.invalid'))
        history = {'token': 'SYNTHETIC-KEY', 'operation': 'history', 'arguments': {'id': '1', 'convert': 'USD', 'interval': '15m',
                   'time_start': '2026-01-01T00:00:00Z', 'time_end': '2026-01-09T00:00:00Z'}}
        for changed, code in (({'arguments': {'start': 1, 'limit': 2001}}, 'invalid_request'),
                              ({'arguments': {'start': 1, 'limit': 2, 'symbol': 'SYN'}}, 'invalid_request'),
                              ({'operation': 'quotes', 'arguments': {'id': '1,1', 'convert': 'USD'}}, 'invalid_request'),
                              ({'operation': 'info', 'arguments': {'id': 'SYN'}}, 'invalid_request'),
                              ({'token': 'two words'}, 'authentication_failed'), (history, 'unsupported_window')):
            with self.subTest(changed=changed):
                self.assertEqual(worker.execute({**value, **changed})['error'], code)

        class Opener:
            def __init__(self, body): self.body = body
            def open(self, _request, timeout): return io.BytesIO(self.body)
        ok = worker.execute(value, Opener(b'{"status":{"error_code":0,"credit_count":0},"data":[{"price":0.123456789012345678901}]}'))
        self.assertEqual(str(ok['data'][0]['price']), '0.123456789012345678901')
        self.assertEqual(worker.execute(value, Opener(b'{"status":{"error_code":1002},"data":null}')), {'error': 'provider_error'})

        class Refused:
            def __init__(self, status, headers): self.status, self.headers = status, headers
            def open(self, *_args, **_kwargs): raise HTTPError('https://redacted.invalid', self.status, 'PRIVATE', self.headers, None)
        self.assertEqual(worker.execute(value, Refused(429, {'Retry-After': '30'})), {'error': 'rate_limit', 'source_code': '429', 'retry_after': 30.0})
        self.assertEqual(worker.execute(value, Refused(402, {}))['error'], 'access_denied')
        self.assertEqual(worker.execute(value, Refused(401, {}))['error'], 'authentication_failed')

    def test_catalogue_pages_by_permanent_id_with_identifiers_and_rank_signals(self):
        with registered() as (ctx, calls):
            self.assertNotIn('pythia_coinmarketcap_search', ctx.tools)
            marker = comment(ctx, 'latest')['pythia_market_data']
            self.assertNotIn('search', [item['operation'] for item in marker['operations']])
            result = call(ctx, 'catalogue', {'scope': 'coins', 'limit': 2})
        self.assertEqual(result['outcome'], 'ok', result['issues'])
        self.assertEqual(calls, [('map', {'start': 1, 'limit': 2}), ('listings', {'start': 1, 'limit': 500, 'convert': 'USD'})])
        page = result['data']
        self.assertEqual(page['next_cursor'], '2')
        coin, token = page['rows']
        # Same symbol, two coins: rows stay separate; symbols never merge.
        self.assertEqual([coin['native_ref']['native_id'], token['native_ref']['native_id']], ['1', '7'])
        self.assertEqual(coin['rank'], {'cmc_rank': 1, 'market_cap': {'value': '123456789.125', 'currency': 'USD', 'observed_at': '2026-01-02T00:00:00.000Z'}})
        self.assertEqual(token['rank'], {'cmc_rank': 900, 'market_cap': None})
        self.assertEqual({(item['scheme'], item['value']) for item in token['identifiers']},
                         {('cmc.id', '7'), ('cmc.slug', 'synthetic-token'), ('symbol', 'SYN'), ('contract_address', '0xabc')})
        contract = next(item for item in token['identifiers'] if item['scheme'] == 'contract_address')
        self.assertEqual((contract['level'], contract['network']['namespace'], contract['network']['id']),
                         ('deployment', 'coinmarketcap:platform', '1'))

        def no_listings(operation, arguments):
            return {'error': 'access_denied', 'source_code': '403'} if operation == 'listings' else responses(operation, arguments)
        with registered(no_listings) as (ctx, _calls):
            partial = call(ctx, 'catalogue', {'scope': 'coins', 'cursor': '0', 'limit': 5})
        self.assertEqual(partial['outcome'], 'partial')
        self.assertEqual(partial['issues'][0]['severity'], 'warning')
        self.assertEqual(partial['data']['rank_signals']['market_cap'], 'unavailable')
        self.assertIsNone(partial['data']['next_cursor'])
        self.assertEqual(partial['data']['rows'][0]['rank']['cmc_rank'], 1)

    def test_missing_or_invalid_key_is_reported_without_a_request(self):
        for status in ('missing', 'invalid'):
            with self.subTest(status=status), registered(key=(status, None)) as (ctx, calls):
                listed = call(ctx, 'catalogue', {'scope': 'coins'})
                self.assertEqual((listed['outcome'], listed['issues'][0]['code']), ('error', 'needs_configuration'))
                read = wire.validate_read_result(call(ctx, 'latest', latest_input('1')))
                self.assertEqual(read['issues'][0]['code'], 'needs_configuration')
                self.assertEqual(calls, [])
        # Once core configuration is available it is the only reader, and its standard result is returned.
        needed = {'schema_version': 1, 'outcome': 'error', 'data': None, 'issues': [
            {'code': 'needs_configuration', 'severity': 'error', 'message': 'Core message.', 'fields': []}]}
        core = SimpleNamespace(value=lambda _ctx, key: ('missing', None), needs_configuration=lambda _ctx: needed)
        with patch.object(platform_module, 'configuration', core, create=True), registered() as (ctx, calls):
            self.assertEqual(call(ctx, 'catalogue', {'scope': 'coins'}), needed)
            read = wire.validate_read_result(call(ctx, 'latest', latest_input('1')))
            self.assertEqual(read['issues'][0]['code'], 'needs_configuration')
            self.assertEqual(calls, [])
        core = SimpleNamespace(value=lambda _ctx, key: ('configured', 'CORE-KEY'), needs_configuration=lambda _ctx: None)
        with patch.object(platform_module, 'configuration', core, create=True), registered(key=('missing', None)) as (ctx, calls):
            self.assertEqual(call(ctx, 'catalogue', {'scope': 'coins', 'limit': 1})['outcome'], 'ok')

    def test_profile_and_details_keep_networks_source_scoped(self):
        native = {'provider': 'coinmarketcap', 'native_scope': 'coin', 'native_id': '7'}
        with registered() as (ctx, calls):
            profile = call(ctx, 'profile', {'native_ref': native})['data']
            details = call(ctx, 'details', {'native_ref': native})['data'][0]
        self.assertEqual(calls, [('info', {'id': '7'})])  # details reuses the cached info read
        self.assertEqual(profile['links'], {'website': ['https://example.invalid'], 'explorer': ['https://explorer.example.invalid/0xabc']})
        self.assertEqual(profile['source']['retrieved_at'], '2026-01-02T00:00:05.000Z')
        self.assertEqual(profile['deployments'][0]['network']['namespace'], 'coinmarketcap:coin')
        contract = [e for e in details['evidence'] if e['scheme'] == 'contract_address']
        self.assertEqual([e['qualifiers']['network'] for e in contract], ['coinmarketcap:coin:1027'])
        for evidence in details['evidence']:
            wire.validate('evidence', evidence)
        # A shared contract with another provider's coin is a candidate, never a merge.
        other = {'provider': 'coingecko', 'native_scope': 'coin', 'native_id': 'synthetic-token'}
        self.assertEqual(matching.compare(native, details['evidence'], other, [{**e, 'provider_ref': other} for e in contract], 'crypto'), 'candidate')

    def test_quotes_share_native_requests_and_history_uses_observation_times(self):
        with registered() as (ctx, calls):
            result = call(ctx, 'read_batch', {'reads': [latest_input(str(index)) for index in range(1, 13)]})
        self.assertEqual(result['outcome'], 'ok', result)
        self.assertEqual([operation for operation, _ in calls], ['quotes', 'quotes'])  # native batches of ten
        for row in result['data']:
            wire.validate_read_result(row)
            self.assertEqual(row['observations'][0]['value'], '0.123456789012345678901')
            self.assertEqual(row['price_context']['change']['percent'], '-2')
        sample = {'timestamp': '2026-01-02T10:00:00Z', 'quote': {'USD': {'timestamp': '2026-01-02T10:03:00Z', 'price': '2.5'}}}
        points = series.samples({'quotes': [sample, sample]}, 'USD')
        self.assertEqual(len(points), 1)
        self.assertEqual(series.timestamp('2026-01-02T10:03:00Z'), points[0][0])
        conflict = {**sample, 'quote': {'USD': {'timestamp': '2026-01-02T10:03:00Z', 'price': '2.6'}}}
        with self.assertRaises(ValueError):
            series.samples({'quotes': [sample, conflict]}, 'USD')


if __name__ == '__main__':
    unittest.main()
