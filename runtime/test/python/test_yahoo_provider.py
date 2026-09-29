"""Semantic and native-boundary checks using synthetic Yahoo-shaped values."""
import importlib
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch
from market_data_fixture import connector, wire
from native_plugin_fixtures import Context, hide_market_data

ROOT = Path(__file__).resolve().parents[2] / 'managed/plugins'
package = sys.modules['test_yahoo'] = types.ModuleType('test_yahoo')
package.__path__ = [str(ROOT / 'yahoo-discovery')]
identity = importlib.import_module('test_yahoo.identity')
series = importlib.import_module('test_yahoo.series')
results = importlib.import_module('test_yahoo.results')
definition = importlib.import_module('test_yahoo.definition')


class Yahoo(unittest.TestCase):
    def test_registered_content_tools_have_no_provider_search(self):
        provider = importlib.import_module('test_yahoo.__init__')
        metadata = {'symbol': 'SYNTH.AS', 'type': 'EQUITY', 'currency': 'EUR', 'exchange': 'AMS'}
        calls = []
        def worker(_command, request, _environment, **_kwargs):
            calls.append(request)
            if request['operation'] == 'news':
                arguments = request['arguments']
                items = [{'uuid': 'a', 'title': 'Synthetic', 'link': 'https://example.test/a', 'published_at': '2026-01-05T10:00:00.000Z',
                          'matched': ['SYNTH'], 'related_tickers': ['SYNTH']}]
                window = {'from': '2026-01-01', 'to': '2026-01-07'}
                return {'data': {'source': 'yahoo.news', 'retrieved_at': '2026-01-07T00:00:00Z',
                                 'result': {'symbol': arguments['symbol'], 'symbols': [arguments['symbol'], *arguments.get('symbols', [])],
                                            'name': None, 'window': window, 'complete_from': None, 'queries': [], 'outside_window': 0,
                                            'drift': {'unknown_fields': [], 'unknown_types': [], 'unreadable_items': 0}, 'news': items}},
                        'issues': []}
            return {'data': {'common': {'SYNTH.AS': {'metadata': dict(metadata)}},
                'display': {'quotes': [], 'retrieved_at': '2026-01-01T00:00:00Z'}}, 'issues': []}
        process = types.SimpleNamespace(run_worker=worker, shutdown=lambda: None)
        ctx = Context('pythia-yahoo-discovery')
        native = {'provider': 'yahoo', 'native_id': 'SYNTH.AS', 'native_scope': 'symbol'}
        batch = connector.NativeBatch(size=20, age=60)
        self.addCleanup(batch.pool.shutdown)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            worker_path = root / 'runner/dist/yahoo.js'
            worker_path.parent.mkdir(parents=True)
            worker_path.touch()
            node = root / 'node'
            node.touch()
            with hide_market_data(), patch.dict(sys.modules, {'tools.registry': ctx.registry_module}), \
                    patch.object(connector, 'ResidentTransport', return_value=process), \
                    patch.object(connector, 'NativeBatch', return_value=batch), \
                    patch.dict(os.environ, {'PYTHIA_MANAGED_ROOT': directory, 'PYTHIA_NODE': str(node)}):
                provider.register(ctx)
                self.assertNotIn('pythia_yahoo_search', ctx.tools)
                research = ctx.tools[provider.TOOLS['research']]
                # Neither a search operation nor free text as a news key reaches Yahoo.
                for arguments in ({'operation': 'search', 'symbol': 'SYNTH'}, {'operation': 'news', 'symbol': 'free text'}):
                    self.assertEqual(json.loads(research(arguments))['issues'][0]['code'], 'invalid_request')
                news = json.loads(research({'operation': 'news', 'symbol': 'SYNTH.AS', 'symbols': ['SYNTH']}))
                self.assertEqual((news['outcome'], news['data']['result']['news'][0]['matched']), ('ok', ['SYNTH']))
                details = json.loads(ctx.tools[provider.TOOLS['details']]({'native_ref': native}))['data'][0]
                # Exact metadata adds Yahoo's venue/currency but asserts no identity evidence.
                self.assertEqual(details['provider_ref']['qualifiers'], {'currency': 'EUR', 'venue': 'AMS'})
                self.assertNotIn('evidence', details)
        self.assertEqual(calls, [{'operation': 'news', 'arguments': {'symbol': 'SYNTH.AS', 'symbols': ['SYNTH'], 'options': {}}},
                                 {'operation': 'quote_bundle', 'arguments': {'symbols': ['SYNTH.AS']}}])

    def test_identity_and_units_do_not_infer_equivalence_or_index_currency(self):
        metadata = {'symbol': 'SYNTH', 'type': 'EQUITY', 'currency': 'USD', 'exchange': 'SYN'}
        candidate = identity.candidate(metadata)
        self.assertNotIn('evidence', candidate)
        self.assertEqual((candidate['symbol'], candidate['kind']), ('SYNTH', 'listing'))
        self.assertEqual(candidate['metadata']['product_type'], 'Equity')
        receipt = identity.candidate({**metadata, 'short_name': 'Synthetic CEDEAR',
            'full_exchange_name': 'Synthetic Exchange', 'currency': 'GBp'})
        self.assertEqual(receipt['metadata']['short_name'], 'Synthetic CEDEAR')
        self.assertEqual(receipt['metadata']['native_currency'], 'GBp')
        self.assertNotIn('currency', receipt['provider_ref'].get('qualifiers', {}))
        self.assertEqual(receipt['venue'], 'Synthetic Exchange')
        # An unknown Yahoo type stays unscoped rather than guessed.
        self.assertIsNone(identity.candidate({'symbol': 'SYNTH', 'type': 'NEW_TYPE'})['kind'])
        with self.assertRaises(ValueError):
            identity.candidate({'name': 'Row without a symbol'})
        native = candidate['provider_ref']
        for mode in series.MODES:
            value = wire.validate('series', series.definition(native, mode, metadata))
            self.assertEqual(series.selector(value['source_detail']['values']['read_selector']), (native, mode))
        stock = series.definition(native, 'daily', metadata)
        index = series.definition(native, 'daily', {**metadata, 'type': 'INDEX'})
        self.assertNotEqual(stock['id'], index['id'])
        self.assertEqual(index['fields']['close']['unit']['kind'], 'unknown')
        self.assertEqual(stock['fields']['close']['unit']['code'], 'USD')

    def test_common_reads_keep_session_dates_and_unknown_completion(self):
        meta = {'symbol': 'SYNTH', 'type': 'EQUITY', 'currency': 'USD'}
        value = series.definition(identity.candidate(meta)['provider_ref'], 'daily', meta)
        request = {'schema_version': 1, 'operation': 'history', 'view': {'kind': 'source', 'series_id': value['id']},
                   'window': {'start': {'kind': 'session_date', 'value': '2026-01-02'}, 'end': {'kind': 'session_date', 'value': '2026-01-03'}},
                   'limit': 10, 'requirements': {'freshness': 'any', 'completion': 'any', 'coverage': 'any'}}
        row = {'time': '2026-01-02', 'open': 0.0000001, 'high': 2, 'low': 0, 'close': 1, 'volume': 1200}
        raw = {'data': {'rows': [row]}, 'issues': []}
        read = wire.validate_read_result(results.read(request, value, 'daily', raw))
        self.assertEqual(read['observations'][0]['time'], request['window']['start'])
        self.assertEqual(read['observations'][0]['open'], '0.0000001')
        self.assertEqual(read['observations'][0]['volume'], '1200')
        raw['data']['rows'].append(row)
        self.assertEqual(wire.validate_read_result(results.read(request, value, 'daily', raw))['outcome'], 'error')
        raw['data']['rows'] = [row]
        request['requirements']['completion'] = 'completed'
        read = wire.validate_read_result(results.read(request, value, 'daily', raw))
        self.assertEqual(read['observations'], [])
        self.assertFalse(read['requirements_satisfied'])

    def test_chart_metadata_may_add_a_qualifier_the_quote_lacks(self):
        """^STOXX50E: the quote has no currency, the chart's metadata says EUR; its bars still belong to the pin."""
        provider = importlib.import_module('test_yahoo.__init__')
        quote = identity.candidate({'symbol': '^STOXX50E', 'type': 'INDEX', 'exchange': 'STOXX'})['provider_ref']
        chart = identity.candidate({'symbol': '^STOXX50E', 'type': 'INDEX', 'exchange': 'STOXX', 'currency': 'EUR'})['provider_ref']
        self.assertTrue(provider.compatible(chart, quote))
        self.assertFalse(provider.compatible(quote, chart))  # a pinned qualifier must be present
        self.assertFalse(provider.compatible({**chart, 'native_id': '^FTSE'}, quote))

    def test_intraday_reads_carry_session_evidence_and_quotes_their_previous_close(self):
        meta = {'symbol': 'SYNTH', 'type': 'EQUITY', 'currency': 'USD'}
        native = identity.candidate(meta)['provider_ref']
        extended = series.definition(native, 'two_minute_extended', meta)
        self.assertEqual((extended['session'], extended['interval']), ('extended', {'kind': 'minute', 'count': 2}))
        # Declared spans are Yahoo's own interval limits.
        spans = {mode: series.definition(native, mode, meta)['read_support']['max_span_seconds'] // 86400
                 for mode in ('minute', 'two_minute_extended', 'thirty_minute', 'hour', 'weekly')}
        self.assertEqual(spans, {'minute': 7, 'two_minute_extended': 60, 'thirty_minute': 60, 'hour': 730, 'weekly': 36600})
        self.assertNotEqual(extended['id'], series.definition(native, 'five_minute', meta)['id'])
        request = {'schema_version': 1, 'operation': 'history', 'view': {'kind': 'source', 'series_id': extended['id']},
                   'window': {'start': {'kind': 'instant', 'value': '2026-01-05T00:00:00Z'}, 'end': {'kind': 'instant', 'value': '2026-01-06T00:00:00Z'}},
                   'limit': 10, 'requirements': {'freshness': 'any', 'completion': 'any', 'coverage': 'any'}}
        session = {'date': '2026-01-05', 'timezone': 'America/New_York',
                   'regular': {'start': '2026-01-05T14:30:00.000Z', 'end': '2026-01-05T21:00:00.000Z'},
                   'extended': {'start': '2026-01-05T09:00:00.000Z', 'end': '2026-01-06T01:00:00.000Z'}}
        row = {'time': '2026-01-05T09:05:00+00:00', 'open': 1, 'high': 2, 'low': 1, 'close': 2}
        read = wire.validate_read_result(results.read(request, extended, 'two_minute_extended',
                                                      {'data': {'rows': [row], 'session': session}, 'issues': []}))
        self.assertEqual(read['price_context'], {'session_window': session})
        # Schedules that contradict themselves fail validation instead of drawing.
        broken = {**session, 'regular': {'start': session['regular']['end'], 'end': session['regular']['start']}}
        with self.assertRaises(wire.WireError):
            wire.validate_read_result(results.read(request, extended, 'two_minute_extended',
                                                   {'data': {'rows': [row], 'session': broken}, 'issues': []}))
        latest = series.definition(native, 'latest', meta)
        request = {**request, 'operation': 'latest', 'view': {'kind': 'source', 'series_id': latest['id']},
                   'window': {'start': None, 'end': None}, 'limit': 1}
        quote = {'metadata': meta, 'retrieved_at': '2026-01-05T21:05:00Z', 'previous_close': 1.5,
                 'rows': [{'time': '2026-01-05T21:00:00Z', 'value': 2}], 'change': {'absolute': 0.5, 'percent': 33.3}}
        context = wire.validate_read_result(results.read(request, latest, 'latest', {'data': quote, 'issues': []}))['price_context']
        self.assertEqual((context['reference_close']['value'], context['reference_close']['time']), ('1.5', {'kind': 'unknown'}))
        quote['previous_close'] = 0
        context = wire.validate_read_result(results.read(request, latest, 'latest', {'data': quote, 'issues': []}))['price_context']
        self.assertNotIn('reference_close', context)
        # After-hours trades stay with the regular close they follow; a stale
        # trade, the regular session and a cash index carry none.
        quote.update(metadata={**meta, 'market_state': 'POSTPOST'},
                     extended={'session': 'post', 'price': 2.5, 'change': 0.5, 'percent': 25, 'time': '2026-01-05T23:00:00+00:00'})
        context = wire.validate_read_result(results.read(request, latest, 'latest', {'data': quote, 'issues': []}))['price_context']
        self.assertEqual((context['session']['state'], context['extended']['value'], context['extended']['percent']), ('closed', '2.5', '25'))
        quote['metadata']['market_state'] = 'POST'
        context = wire.validate_read_result(results.read(request, latest, 'latest', {'data': quote, 'issues': []}))['price_context']
        self.assertEqual(context['session']['state'], 'post')
        for change in ({'extended': {**quote['extended'], 'time': '2026-01-05T20:00:00+00:00'}},
                       {'metadata': {**meta, 'market_state': 'REGULAR'}},
                       {'metadata': {**meta, 'type': 'INDEX', 'market_state': 'POST'}}):
            context = wire.validate_read_result(results.read(request, latest, 'latest', {'data': {**quote, **change}, 'issues': []}))['price_context']
            self.assertNotIn('extended', context)

    def test_native_options_remain_bounded_data_not_schema_or_fetch_controls(self):
        schemas = definition.schemas(wire)
        for op, args in [('research', {'operation': 'quoteSummary', 'symbol': 'SYNTH', 'options_json': '{"modules":["price"]}'}),
                         ('dashboard', {'kind': 'quotes', 'symbols': ['SYNTH']})]:
            wire.validate_parameters(schemas[op]['parameters'], args)
            with self.assertRaises(wire.WireError):
                wire.validate_parameters(schemas[op]['parameters'], {**args, 'fetch': 'https://example.test'})
