"""Native stream retention: a quiet feed is subscribed but no longer ready."""
import importlib
import threading
import time
import types
import unittest
from test_eodhd_provider import identity, series, wire, request

Streams = importlib.import_module('test_eodhd.stream').Streams


class StreamLifetime(unittest.TestCase):
    def test_disconnect_between_listener_registration_and_cached_delivery_stays_stale(self):
        owner = Streams(types.SimpleNamespace(get_config=lambda *_: 'demo'), wire,
                        types.SimpleNamespace(eodhd_token=lambda: ('configured', 'synthetic')))
        closed, received, errors = threading.Event(), [], []
        owner.worker = types.SimpleNamespace(closed=closed, close=closed.set, send=lambda *_: None)
        owner.generation = 'fixture'
        owner.listeners['anchor'] = {'feed': 'us', 'symbol': 'SYNTH', 'receive': lambda *_: None}
        descriptor = series.definition(identity.native('SYNTH.US', 'USD'), 'edgx_latest')
        owner.latest[('us', 'SYNTH')] = {'type': 'data', 'feed': 'us', 'symbol': 'SYNTH',
            'rows': [{'t': 1788955200000, 'p': '2', 'v': '0'}], 'gap': False}
        Subscription = importlib.import_module(wire.__package__ + '.subscriptions').Subscription
        subscription = Subscription(received.append)
        def join():
            try:
                owner.subscribe({'request': request(descriptor, 'latest'),
                    'source_selector': descriptor['source_detail']['values']['read_selector']}, subscription)
            except Exception as error:
                errors.append(error)
        joining = threading.Thread(target=join)
        try:
            # Hold the real lifetime lock: subscribe captures retained data then
            # blocks registering its close callback, while the stream can fail.
            with subscription.lock:
                joining.start()
                until = time.monotonic() + 2
                while time.monotonic() < until:
                    with owner.lock:
                        if len(owner.listeners) == 2: break
                    threading.Event().wait(.01)
                self.assertEqual(len(owner.listeners), 2)
                owner.receive({'type': 'status', 'state': 'stale', 'code': 'connection_lost'}, 'fixture')
                self.assertEqual([event['state'] for event in received], ['stale'])
            joining.join(2)
            self.assertFalse(joining.is_alive())
            self.assertEqual(errors, [])
            self.assertEqual([event['state'] for event in received], ['stale'])
        finally:
            joining.join(2)
            subscription.close()
            owner.close()

    def test_data_delivery_and_concurrent_loss_preserve_event_order(self):
        owner = Streams(None, None, None)
        owner.generation = 'fixture'
        started, release, attempted, finished = (threading.Event() for _ in range(4))
        received, errors = [], []
        def receive(event):
            if event.get('type') == 'data':
                started.set()
                self.assertTrue(release.wait(2))
                received.append('ready')
            else:
                received.append(event['state'])
                finished.set()
        owner.listeners['anchor'] = {'feed': 'us', 'symbol': 'SYNTH', 'receive': receive}
        def data():
            try:
                owner.receive({'type': 'data', 'feed': 'us', 'symbol': 'SYNTH'}, 'fixture')
            except Exception as error: errors.append(error)
        def loss():
            attempted.set()
            owner.receive({'type': 'status', 'state': 'stale', 'code': 'connection_lost'}, 'fixture')
        producer, failing = threading.Thread(target=data), threading.Thread(target=loss)
        try:
            producer.start()
            self.assertTrue(started.wait(1))
            failing.start()
            self.assertTrue(attempted.wait(1))
            # The failure thread can mutate/invalidate only after the preceding
            # publication completes. On the buggy implementation it finishes now.
            finished.wait(.1)
        finally:
            release.set()
            producer.join(2)
            if failing.ident is not None: failing.join(2)
            owner.close()
        self.assertFalse(producer.is_alive() or failing.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(received[:2], ['ready', 'stale'])

    def test_published_callback_can_release_its_native_subscription(self):
        owner = Streams(types.SimpleNamespace(get_config=lambda *_: 'demo'), wire,
                        types.SimpleNamespace(eodhd_token=lambda: ('configured', 'synthetic')))
        closed = threading.Event()
        owner.worker = types.SimpleNamespace(closed=closed, close=closed.set, send=lambda *_: None)
        owner.generation = 'fixture'
        descriptor = series.definition(identity.native('SYNTH.US', 'USD'), 'edgx_latest')
        Subscription = importlib.import_module(wire.__package__ + '.subscriptions').Subscription
        subscription = Subscription(lambda _event: subscription.close())
        owner.subscribe({'request': request(descriptor, 'latest'),
            'source_selector': descriptor['source_detail']['values']['read_selector']}, subscription)
        publishing = threading.Thread(target=lambda: owner.receive({
            'type': 'data', 'feed': 'us', 'symbol': 'SYNTH',
            'rows': [{'t': 1788955200000, 'p': '2', 'v': '0'}], 'gap': False}, 'fixture'))
        try:
            publishing.start()
            publishing.join(2)
            self.assertFalse(publishing.is_alive())
            self.assertTrue(subscription.closed.is_set())
            self.assertTrue(closed.is_set())
            self.assertEqual(owner.listeners, {})
        finally:
            subscription.close()
            owner.close()

    def test_new_subscriber_does_not_receive_ready_after_no_recent_observation(self):
        owner = Streams(types.SimpleNamespace(get_config=lambda *_: 'demo'), wire,
                        types.SimpleNamespace(eodhd_token=lambda: ('configured', 'synthetic')))
        closed, received, stops = threading.Event(), [], []
        owner.worker = types.SimpleNamespace(closed=closed, close=closed.set, send=lambda *_: None)
        owner.generation = 'fixture'
        descriptor = series.definition(identity.native('SYNTH.US', 'USD'), 'edgx_latest')
        owner.latest[('us', 'SYNTH')] = {'type': 'data', 'feed': 'us', 'symbol': 'SYNTH',
            'rows': [{'t': 1788955200000, 'p': '2', 'v': '0'}], 'gap': False}
        try:
            owner.receive({'type': 'status', 'feed': 'us', 'symbol': 'SYNTH',
                           'state': 'stale', 'code': 'no_recent_observation'}, 'fixture')
            subscription = types.SimpleNamespace(window=None, emit=received.append, on_close=stops.append)
            owner.subscribe({'request': request(descriptor, 'latest'),
                             'source_selector': descriptor['source_detail']['values']['read_selector']}, subscription)
            self.assertEqual(received, [])
            self.assertFalse(closed.is_set(), 'Quiet feeds stay subscribed for the next observation')
            self.assertEqual(len(owner.listeners), 1)
        finally:
            for stop in stops: stop()
            owner.close()
        self.assertTrue(closed.is_set())


if __name__ == '__main__': unittest.main()
