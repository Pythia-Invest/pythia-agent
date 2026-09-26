"""Synthetic Cboe schemas from EODHD's WebSocket API documentation; no network."""
import importlib
import sys
import types
import unittest
from datetime import datetime, timezone
from pathlib import Path
from test_market_data_identity import PACKAGE

path = Path(__file__).resolve().parents[2] / 'managed/plugins/eodhd'
module = types.ModuleType('stream_context_fixture'); module.__path__ = [str(path)]
sys.modules[module.__name__] = module
results = importlib.import_module(module.__name__ + '.stream_results')
series = importlib.import_module(module.__name__ + '.series')
wire = importlib.import_module(PACKAGE + '.wire')


class StreamContext(unittest.TestCase):
    def test_reference_uses_calendar_and_rejects_stale_close_without_replacing_prices(self):
        # Synthetic fixtures shaped by exchange-details v2 and us-quote-delayed.
        enrich = importlib.import_module(module.__name__ + '.session_context').enrich
        native = {'provider': 'eodhd', 'native_scope': 'catalogue', 'native_id': 'SYNTH.US', 'qualifiers': {'currency': 'USD'}}
        definition = series.definition(native, 'edgx_latest')
        observation = {'shape': 'scalar', 'value': '102', 'time': {'kind': 'instant', 'value': '2026-09-17T14:00:00Z'}}
        reference = {'schedule': {'Code': 'US', 'Timezone': 'America/New_York',
            'TradingHours': {'Open': '09:30:00', 'Close': '16:00:00', 'PreMarketOpen': '04:00:00',
                'AfterHoursClose': '20:00:00', 'WorkingDays': 'Mon, Tue, Wed, Thu, Fri'},
            'ExchangeHolidays': {'2026-01-01': {'Type': 'Official'}}},
            'quote': {'currency': 'USD', 'previousClosePrice': 100, 'previousCloseDate': '2026-09-16 17:00:00',
                      'retrieved_at': '2026-09-17T14:00:00Z'}}
        context, issues = enrich({}, reference, definition, observation)
        wire.validate('price_context', context)
        self.assertFalse(issues)
        self.assertEqual(context['change']['percent'], '2.00')
        self.assertEqual(context['session_window']['regular']['start'], '2026-09-17T13:30:00+00:00')
        self.assertEqual(context['reference_close']['dataset'], 'EODHD:us-quote-delayed:previousClosePrice')
        self.assertEqual(observation['value'], '102')
        reference['quote']['previousCloseDate'] = '2026-09-15 17:00:00'
        context, issues = enrich({}, reference, definition, observation)
        self.assertNotIn('change', context)
        self.assertNotIn('reference_close', context)
        self.assertEqual(issues[0]['code'], 'close_reference_unavailable')
        reference['schedule']['ExchangeHolidays']['2026-09-17'] = {'Type': 'EarlyClose', 'EarlyClose': '13:00:00'}
        context, issues = enrich({}, reference, definition, observation)
        self.assertNotIn('session_window', context)
        self.assertEqual(issues[0]['code'], 'session_reference_unavailable')

    def test_book_time_and_size_remain_distinct_from_last_trade_and_no_change_is_invented(self):
        now = int(datetime.now(timezone.utc).timestamp() * 1000)
        native = {'provider': 'eodhd', 'native_scope': 'catalogue', 'native_id': 'SYNTH.US', 'qualifiers': {'currency': 'USD'}}
        definition = series.definition(native, 'edgx_latest')
        request = {'schema_version': 1, 'operation': 'latest', 'view': {'kind': 'source', 'series_id': definition['id']},
                   'window': {'start': None, 'end': None}, 'limit': 1,
                   'requirements': {'freshness': 'fresh', 'coverage': 'any', 'completion': 'any'}}
        row = {'t': now-1000, 'p': '100.25', 'v': '7', 'ms': 'open',
               'book': {'t': now, 'bp': 100.2, 'ap': 100.3, 'bs': 50, 'as': 80},
               'venue_status': {'t': now, 'h': 'T', 'r': '0'}}
        value = wire.validate_read_result(results.read(request, definition, 'edgx_latest', {'feed': 'us', 'rows': [row]}))
        context = value['price_context']
        self.assertEqual(value['observations'][0]['value'], '100.25')
        self.assertNotEqual(context['top_of_book']['time'], value['observations'][0]['time'])
        self.assertEqual(context['trade_size']['value'], '7')
        self.assertEqual(context['top_of_book']['bid_size'], '50')
        self.assertNotIn('change', context)
        self.assertEqual(context['session']['state'], 'regular')
        row['venue_status']['h'] = 'C'
        self.assertEqual(results.context(row)['session']['state'], 'closed')
        row['venue_status']['h'] = 'UNCLASSIFIED'
        self.assertEqual(results.context(row)['session']['state'], 'unknown')
        context['top_of_book']['bid_size'] = '-1'
        with self.assertRaises(wire.WireError): wire.validate('price_context', context)
