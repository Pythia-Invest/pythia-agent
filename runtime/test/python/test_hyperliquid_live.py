"""Hyperliquid live adapter (docs/sources/hyperliquid.md): strict parses, drift alarms and stream lifetime.

Fixtures are synthetic and minimal, shaped like the documented messages
(https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions)
and the audited differences from them (string values in `activeAssetCtx`).
"""
import importlib
import importlib.util
import json
import queue
import sys
import threading
import time
import unittest
from pathlib import Path

from test_plugin_contracts import identity

PLUGIN = Path(__file__).resolve().parents[2] / 'managed/plugins/hyperliquid'
if 'hyperliquid_fixture' not in sys.modules:
    spec = importlib.util.spec_from_file_location('hyperliquid_fixture', PLUGIN / '__init__.py',
                                                  submodule_search_locations=[str(PLUGIN)])
    sys.modules[spec.name] = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sys.modules[spec.name])
feed = importlib.import_module('hyperliquid_fixture.feed')
stream = importlib.import_module('hyperliquid_fixture.stream')
market = importlib.import_module('hyperliquid_fixture.market')
plugin = importlib.import_module('hyperliquid_fixture')
SUBJECT = 'market:pythia:hyperliquid-btc-perp'


def now():
    return int(time.time() * 1000)


def book(at, bids=((100.0, 2), (99.5, 1)), asks=((100.5, 1), (101.0, 3)), **extra):
    level = lambda px, sz: {'px': str(px), 'sz': str(sz), 'n': 1}  # noqa: E731
    return {'channel': 'l2Book', 'data': {'coin': 'BTC', 'time': at, 'levels': [
        [level(*row) for row in bids], [level(*row) for row in asks]], **extra}}


def trade(at, tid, px='100.5', side='B'):
    return {'coin': 'BTC', 'side': side, 'px': px, 'sz': '0.1', 'time': at, 'hash': '0x' + '0' * 64, 'tid': tid,
            'users': ['0x' + '1' * 40, '0x' + '2' * 40]}


def ctx(**change):
    values = {'funding': '0.0000125', 'openInterest': '1000.5', 'prevDayPx': '99.0', 'dayNtlVlm': '5000000.0',
              'premium': '-0.0001', 'oraclePx': '100.1', 'markPx': '100.2', 'midPx': '100.25',
              'impactPxs': ['100.2', '100.3'], 'dayBaseVlm': '50000.0', **change}
    return {'channel': 'activeAssetCtx', 'data': {'coin': 'BTC', 'ctx': values}}


class FakeSocket:
    def __init__(self, messages=(), then=None):
        self.sent, self.inbox, self.closed = [], queue.Queue(), threading.Event()
        for message in messages:
            self.inbox.put(message)
        if then is not None:
            self.inbox.put(then)

    def send(self, text):
        self.sent.append(json.loads(text))

    def recv(self, timeout=None):
        if self.closed.is_set():
            raise ConnectionError('closed')
        try:
            item = self.inbox.get(timeout=timeout)
        except queue.Empty:
            raise TimeoutError from None
        if isinstance(item, BaseException):
            raise item
        return json.dumps(item)

    def close(self):
        self.closed.set()


class Listener:
    def __init__(self):
        self.events, self.stops, self.arrived = [], [], threading.Event()

    def emit(self, event):
        self.events.append(event)
        self.arrived.set()

    def on_close(self, stop):
        self.stops.append(stop)

    def close(self):
        for stop in self.stops:
            stop()

    def wait(self, test, timeout=3.0):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            found = [event for event in self.events if test(event)]
            if found:
                return found[-1]
            self.arrived.wait(0.05)
            self.arrived.clear()
        raise AssertionError(f'no matching event in {self.events[-3:]}')

    def snapshots(self):
        return [event['data']['data'] for event in self.events if event.get('type') == 'snapshot']


def info(universe=({'name': 'BTC', 'szDecimals': 5, 'maxLeverage': 40, 'marginTableId': 56},)):
    def read(body):
        if body['type'] == 'meta':
            return {'universe': list(universe), 'marginTables': [], 'collateralToken': 0}
        start = (now() // 60_000 - 3) * 60_000
        return [{'t': start + minute * 60_000, 'T': start + minute * 60_000 + 59_999, 's': 'BTC', 'i': '1m',
                 'o': '99', 'c': str(99 + minute), 'h': '103', 'l': '98', 'v': '1.5', 'n': 10} for minute in range(4)]
    return read


class StepClock:
    """A clock that moves only when a test moves it, so a rate limit's count never depends on the machine's speed."""

    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class PacedSocket(FakeSocket):
    """Delivers one message per `step` seconds of the injected clock, and says once the last one has been read."""

    def __init__(self, messages, clock, step):
        super().__init__(messages)
        self.clock, self.step, self.drained = clock, step, threading.Event()

    def recv(self, timeout=None):
        if self.inbox.empty():
            self.drained.set()
        else:
            self.clock.now += self.step
        return super().recv(timeout)


def streams(sockets, read_info=None, **options):
    queue_ = list(sockets)

    def open_socket(_url):
        item = queue_.pop(0) if queue_ else FakeSocket()
        if isinstance(item, BaseException):
            raise item
        return item
    return stream.Streams(identity.validate_live_market, open_socket=open_socket, read_info=read_info or info(),
                          log=lambda _message: None, **options)


def full(event):
    data = (event.get('data') or {}).get('data') or {}
    return event.get('type') == 'snapshot' and 'book' in data and 'context' in data and data['trades']['items']


class Parses(unittest.TestCase):
    """Each read field parses to its one meaning; a contradiction is drift, never coerced."""

    def setUp(self):
        self.alarms = feed.Alarms()

    def test_book_is_a_full_snapshot_of_ordered_levels(self):
        parsed = feed.book(book(now())['data'], 'BTC', self.alarms)
        self.assertEqual(parsed['bids'][0], ['100.0', '2', 1])
        self.assertEqual((parsed['depth'], parsed['unit']), ('snapshot', {'kind': 'coin', 'code': 'BTC'}))
        cases = {'crossed book': book(now(), bids=((101.0, 1),)), 'must fall': book(now(), bids=((99.0, 1), (99.5, 1))),
                 'at most 5': book(now(), bids=tuple((100 - i, 1) for i in range(6))),
                 'decimal string': {'channel': 'l2Book', 'data': {**book(now())['data'], 'levels': [
                     [{'px': 100.0, 'sz': '1', 'n': 1}], []]}},
                 'far from the local clock': book(now() // 1000)}
        for message, value in cases.items():
            with self.subTest(message), self.assertRaisesRegex(feed.Drift, message):
                feed.book(value['data'], 'BTC', self.alarms)

    def test_the_fast_book_may_echo_its_flag(self):
        feed.book(book(now(), fast=True)['data'], 'BTC', self.alarms)
        self.assertEqual(self.alarms.counts, {})
        with self.assertRaisesRegex(feed.Drift, 'fast book expected'):
            feed.book(book(now(), fast=False)['data'], 'BTC', self.alarms)

    def test_an_extra_field_is_reported_and_the_read_fields_still_parse(self):
        parsed = feed.book(book(now(), spread='0.5')['data'], 'BTC', self.alarms)
        self.assertEqual(len(parsed['asks']), 2)
        self.assertEqual(self.alarms.counts, {'l2Book.spread': 1})
        issue = self.alarms.issues()[0]
        self.assertEqual((issue['code'], issue['severity']), ('source_extra', 'info'))
        self.assertIn('nothing left out', issue['message'])

    def test_drift_warnings_clear_after_a_clean_period_but_stay_recorded(self):
        clock = [1000.0]
        alarms = feed.Alarms(clock=lambda: clock[0])
        with self.assertRaises(feed.Drift) as caught:
            feed.book(book(now(), bids=((101.0, 1),))['data'], 'BTC', alarms)
        alarms.drift(caught.exception)
        self.assertEqual([issue['code'] for issue in alarms.issues()], ['source_drift'])
        clock[0] += feed.SHOWN_S + 1
        self.assertEqual((alarms.issues(), alarms.counts), ([], {'l2Book.levels': 1}))

    def test_a_far_clock_is_logged_not_shown_as_the_sources_drift(self):
        with self.assertRaises(feed.Drift) as caught:
            feed.book(book(now() - 3_600_000)['data'], 'BTC', self.alarms)
        self.alarms.drift(caught.exception)
        self.assertEqual((self.alarms.issues(), self.alarms.counts), ([], {'l2Book.time': 1}))

    def test_trades_keep_the_aggressor_side_and_drop_addresses(self):
        rows = feed.trades([trade(now(), 7, side='A')], 'BTC', self.alarms)
        self.assertEqual(rows[0][1:], (7, '100.5', '0.1', 'sell'))
        self.assertNotIn('0x1111', json.dumps(rows))
        with self.assertRaisesRegex(feed.Drift, 'B or A'):
            feed.trades([trade(now(), 8, side='S')], 'BTC', self.alarms)

    def test_context_values_are_decimal_strings_with_receipt_time(self):
        parsed = feed.context(ctx()['data'], 'BTC', self.alarms, 1_790_000_000_000)
        self.assertEqual((parsed['mark'], parsed['oracle'], parsed['day_volume']), ('100.2', '100.1', '50000.0'))
        self.assertEqual(parsed['funding'], {'rate_1h': '0.0000125', 'next_time': 1_790_002_800_000})
        self.assertNotIn('mid', feed.context(ctx(midPx=None)['data'], 'BTC', self.alarms, 1_790_000_000_000))
        for change, message in (({'markPx': 100.2}, 'decimal string'), ({'funding': '0.05'}, '4% an hour cap'),
                                ({'oraclePx': None}, 'decimal string')):
            with self.subTest(change), self.assertRaisesRegex(feed.Drift, message):
                feed.context(ctx(**change)['data'], 'BTC', self.alarms, 1_790_000_000_000)
        with self.assertRaisesRegex(feed.Drift, 'ctx.markPx: missing'):
            values = ctx()['data']
            del values['ctx']['markPx']
            feed.context(values, 'BTC', self.alarms, 1_790_000_000_000)

    def test_candles_seed_closed_minutes_only(self):
        points = feed.candles(info()({'type': 'candleSnapshot'}), 'BTC', self.alarms, now())
        self.assertEqual(len(points), 3)  # the running minute is left out
        self.assertTrue(all(point[0] % 60_000 == 59_999 for point in points))

    def test_market_checks_listing_and_delisting(self):
        universe = {'universe': [{'name': 'BTC', 'szDecimals': 5, 'maxLeverage': 40},
                                 {'name': 'OLD', 'szDecimals': 1, 'maxLeverage': 3, 'isDelisted': True}]}
        self.assertEqual([feed.market(universe, coin, self.alarms) for coin in ('BTC', 'OLD', 'NEW')],
                         [None, 'delisted', 'unknown_market'])

    def test_unknown_channels_are_drift(self):
        with self.assertRaisesRegex(feed.Drift, 'unknown channel'):
            feed.envelope({'channel': 'l3Book', 'data': {}}, self.alarms)


class StreamLifetime(unittest.TestCase):
    def setUp(self):
        self.saved = stream.PUBLISH_S, stream.STALE_S, stream.MAX_BACKOFF_S
        stream.MAX_BACKOFF_S = 0.2

    def tearDown(self):
        stream.PUBLISH_S, stream.STALE_S, stream.MAX_BACKOFF_S = self.saved

    def test_publishes_valid_snapshots_without_trader_addresses(self):
        at = now()
        socket = FakeSocket([book(at), {'channel': 'trades', 'data': [trade(at - 5, 1), trade(at - 1, 2, '100.6')]},
                             ctx()])
        owner, listener = streams([socket]), Listener()
        owner.subscribe('BTC', SUBJECT, listener)
        try:
            event = listener.wait(full)
            document = identity.validate_live_market(event['data']['data'])
            self.assertEqual(document['subject'], {'subject_id': SUBJECT})
            self.assertEqual(document['trades']['items'][-1], [at - 1, '100.6', '0.1', 'buy'])
            self.assertEqual(document['line']['seeded_from'], 'candle_1m')
            self.assertEqual(document['line']['points'][-1], [at - 1, '100.6'])
            self.assertNotIn('0x1111', json.dumps(listener.events))
            self.assertIn({'method': 'subscribe', 'subscription': {'type': 'l2Book', 'coin': 'BTC', 'fast': True}},
                          socket.sent)
        finally:
            listener.close()
            owner.close()

    def test_at_most_four_snapshots_a_second(self):
        at, clock = now(), StepClock()
        socket = PacedSocket([book(at + index) for index in range(41)], clock, 0.1)  # ten books a second, for four seconds
        owner, listener = streams([socket], clock=clock), Listener()
        owner.subscribe('BTC', SUBJECT, listener)
        try:
            self.assertTrue(socket.drained.wait(5), 'the stream read every message')  # a deadline, never a delay
            elapsed = clock.now - 1000.0
            published = len(listener.snapshots())
            self.assertAlmostEqual(elapsed, 4.1)
            self.assertGreaterEqual(published, 2)  # it publishes, only not on every message
            self.assertLessEqual(published, 4 * elapsed + 1)
        finally:
            listener.close()
            owner.close()

    def test_reconnect_drops_replayed_trades_and_keeps_the_gap(self):
        at = now()
        first = FakeSocket([book(at), ctx(), {'channel': 'trades', 'data': [trade(at - 9, 1), trade(at - 8, 2)]}],
                           then=ConnectionError('dropped'))
        second = FakeSocket([book(at + 10), ctx(), {'channel': 'trades', 'data': [trade(at - 9, 1), trade(at - 8, 2),
                                                                                    trade(at + 5, 3)]}])
        owner, listener = streams([first, second]), Listener()
        owner.subscribe('BTC', SUBJECT, listener)
        try:
            listener.wait(lambda event: any(issue['code'] == 'reconnecting'
                                            for issue in (event.get('data') or {}).get('data', {}).get('issues', [])))
            event = listener.wait(lambda event: full(event) and event['data']['data']['gaps'])
            document = event['data']['data']
            self.assertEqual([row[0] for row in document['trades']['items']], [at - 9, at - 8, at + 5])
            self.assertEqual(len(document['gaps']), 1)
            self.assertNotIn('reconnecting', [issue['code'] for issue in document['issues']])
        finally:
            listener.close()
            owner.close()

    def test_drift_drops_the_part_and_says_so(self):
        at = now()
        socket = FakeSocket([book(at), ctx(markPx=100.2), {'channel': 'candles', 'data': []},
                             {'channel': 'trades', 'data': [trade(at, 1)]}])
        owner, listener = streams([socket]), Listener()
        owner.subscribe('BTC', SUBJECT, listener)
        try:
            event = listener.wait(lambda event: event.get('type') == 'snapshot' and len(
                [issue for issue in event['data']['data']['issues'] if issue['code'] == 'source_drift']) == 2)
            document = event['data']['data']
            self.assertNotIn('context', document)
            self.assertIn('book', document)
            self.assertEqual(sorted(issue['message'].split(' at ')[1].split(' ')[0] for issue in document['issues']),
                             ['ctx.markPx', 'message.channel'])
            self.assertTrue(all('left out' in issue['message'] for issue in document['issues']))
        finally:
            listener.close()
            owner.close()

    def test_an_unknown_market_is_refused_without_subscribing(self):
        socket = FakeSocket()
        owner, listener = streams([socket], info(universe=())), Listener()
        owner.subscribe('BTC', SUBJECT, listener)
        try:
            event = listener.wait(lambda event: event.get('type') == 'reset')
            self.assertEqual((event['state'], event['code']), ('unavailable', 'unknown_market'))
            self.assertFalse([item for item in socket.sent if item.get('method') == 'subscribe'])
        finally:
            listener.close()
            owner.close()

    def test_a_far_clock_is_explained_without_blaming_the_source(self):
        socket = FakeSocket([book(now() - 3_600_000), ctx()])
        owner, listener = streams([socket]), Listener()
        owner.subscribe('BTC', SUBJECT, listener)
        try:
            event = listener.wait(lambda event: event.get('type') == 'snapshot' and any(
                issue['code'] == 'clock_off' for issue in event['data']['data']['issues']))
            self.assertFalse([issue for issue in event['data']['data']['issues'] if issue['code'] == 'source_drift'])
        finally:
            listener.close()
            owner.close()

    def test_a_drifted_market_list_is_drift_not_a_lost_connection(self):
        socket = FakeSocket()
        owner, listener = streams([socket], lambda body: {'universe': [{'name': 'BTC'}]}), Listener()
        owner.subscribe('BTC', SUBJECT, listener)
        try:
            event = listener.wait(lambda event: event.get('type') == 'reset')
            self.assertEqual((event['state'], event['code']), ('unavailable', 'source_drift'))
            self.assertEqual(owner.alarms.counts, {'meta.universe[0].maxLeverage': 1})
            self.assertFalse([item for item in socket.sent if item.get('method') == 'subscribe'])
            self.assertNotIn('stale', [event.get('state') for event in listener.events])
        finally:
            listener.close()
            owner.close()

    def test_a_refused_subscription_is_logged_not_shown(self):
        at = now()
        first = FakeSocket(then=ConnectionError('closed by server'))
        second = FakeSocket([book(at), ctx()])
        owner, listener = streams([first, second]), Listener()
        owner.subscribe('BTC', SUBJECT, listener)
        try:
            event = listener.wait(lambda event: full(event) or (event.get('type') == 'snapshot'
                                                                and 'context' in event['data']['data']
                                                                and event['data']['data']['gaps']))
            self.assertEqual(event['state'], 'ready')
            self.assertEqual(owner.alarms.counts, {'subscription': 1})
            self.assertFalse([issue for issue in event['data']['data']['issues'] if 'subscription' in issue['message']])
        finally:
            listener.close()
            owner.close()

    def test_a_long_outage_hands_the_retry_to_the_platform(self):
        stream.STALE_S = 0.2
        owner, listener = streams([OSError('down')] * 50), Listener()
        owner.subscribe('BTC', SUBJECT, listener)
        try:
            event = listener.wait(lambda event: event.get('state') == 'stale')
            self.assertEqual(event['code'], 'connection_lost')
        finally:
            listener.close()
            owner.close()

    def test_the_last_listener_leaving_closes_the_socket(self):
        socket = FakeSocket([book(now())])
        owner, listener = streams([socket]), Listener()
        owner.subscribe('BTC', SUBJECT, listener)
        listener.wait(lambda event: event.get('type') == 'snapshot')
        listener.close()
        self.assertTrue(socket.closed.wait(2))
        deadline = time.monotonic() + 2
        while owner.thread is not None and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertIsNone(owner.thread)

    def test_one_shot_snapshot_for_the_agent(self):
        at = now()
        owner = streams([FakeSocket([book(at), ctx(), {'channel': 'trades', 'data': [trade(at, 1)]}])])
        try:
            result = owner.snapshot('BTC', SUBJECT, timeout=3)
            self.assertEqual(result['outcome'], 'ok')
            identity.validate_live_market(result['data'])
            self.assertEqual(result['data']['line']['bucket_ms'], 60_000)
        finally:
            owner.close()

    def test_the_agent_gets_a_minute_line_with_its_summary(self):
        start = (now() // 60_000 - 15) * 60_000
        points = [[start + second * 1000, f'{100 + (second % 97) / 10:.1f}'] for second in range(900)]
        answer = market.brief({'outcome': 'ok', 'data': {'line': {'measure': 'last_trade', 'bucket_ms': 1000,
                                                                   'points': points}}})
        self.assertLessEqual(len(answer['data']['line']['points']), 16)
        self.assertEqual(answer['line_summary'], {'from': points[0][0], 'to': points[-1][0], 'first': '100.0',
                                                  'last': points[-1][1], 'high': '109.6', 'low': '100.0',
                                                  'points': 900})

    def test_arguments_name_one_perp(self):
        self.assertEqual(plugin.target({'subject_id': SUBJECT, 'native_ref': {
            'provider': 'hyperliquid', 'native_scope': 'perp', 'native_id': 'BTC'}}), ('BTC', SUBJECT))
        with self.assertRaises(ValueError):
            plugin.target({'subject_id': SUBJECT, 'native_ref': {
                'provider': 'hyperliquid', 'native_scope': 'perp', 'native_id': 'btc'}})


if __name__ == '__main__':
    unittest.main()
