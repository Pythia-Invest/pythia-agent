"""Deterministic lifecycle/admission regressions, with synthetic domain results."""
import asyncio
import importlib
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from market_data_fixture import PLATFORM

Admission = importlib.import_module(PLATFORM + '.admission').Admission
AdmissionError = importlib.import_module(PLATFORM + '.admission').AdmissionError
live = importlib.import_module(PLATFORM + '.live')
LiveReads = live.LiveReads


class Delivery(unittest.IsolatedAsyncioTestCase):
    async def test_push_notification_wakes_delivery_immediately(self):
        subscribed, published = asyncio.Queue(), asyncio.Queue()
        async def access(_): return 'allowed'
        async def read(_): raise AssertionError('Push must not poll')
        async def subscribe(_, publish):
            subscribed.put_nowait(publish)
            return lambda: None
        async def publish(_, event): published.put_nowait(event)
        hub = LiveReads(read, access, subscribe=subscribe)
        try:
            await hub.attach([{'operation': 'synthetic', 'arguments': {}}], publish)
            receive = await asyncio.wait_for(subscribed.get(), 1)
            # A worker-thread notification must reach the consumer without the
            # one-second idle access check delaying each pushed result.
            await asyncio.to_thread(receive, {'type': 'snapshot', 'state': 'ready', 'data': 42})
            event = await asyncio.wait_for(published.get(), .5)
            self.assertEqual(event['data'], 42)
        finally:
            await hub.close()

    async def test_push_reconnect_honors_retry_delay_and_cancels_when_unused(self):
        for state, delay in (('stale', 120), ('unavailable', 600)):
            with self.subTest(state=state):
                clock, callbacks, events, stopped = [0], [], [], []
                pauses, advances = asyncio.Queue(), asyncio.Queue()
                async def sleep(_):
                    pauses.put_nowait(None)
                    clock[0] = await advances.get()
                async def step(at):
                    advances.put_nowait(at)
                    await asyncio.wait_for(pauses.get(), 1)
                async def access(_): return 'allowed'
                async def read(_): raise AssertionError('A pushed feed must not fall back to polling')
                async def subscribe(_, publish):
                    callbacks.append(publish)
                    index = len(callbacks)
                    return lambda: stopped.append(index)
                async def publish(_, event): events.append(event)
                runtime = SimpleNamespace(**{name: getattr(asyncio, name) for name in (
                    'create_task', 'get_running_loop', 'CancelledError', 'to_thread', 'gather', 'Event')}, sleep=sleep)
                with patch.object(live, 'time', SimpleNamespace(monotonic=lambda: clock[0])), patch.object(live, 'asyncio', runtime), patch.object(live, 'wait_for_push', sleep):
                    hub = LiveReads(read, access, subscribe=subscribe, grace=0)
                    try:
                        handles = await hub.attach([{'operation': 'synthetic', 'arguments': {}}], publish)
                        await asyncio.wait_for(pauses.get(), 1)
                        callbacks[0]({'type': 'status', 'state': state, 'code': 'rate_limit',
                                      'retry_after_seconds': delay, 'limit_origin': 'provider'})
                        await step(1)
                        self.assertEqual(stopped, [1])
                        self.assertEqual(events[-1]['retry_after_seconds'], delay)
                        await step(delay)
                        self.assertEqual(len(callbacks), 1)
                        await step(delay + 1)
                        self.assertEqual(len(callbacks), 2)
                        hub.detach(handles)
                        await asyncio.wait_for(asyncio.gather(handles[0][0]['task'], return_exceptions=True), 1)
                        self.assertEqual(stopped, [1, 2])
                    finally:
                        await hub.close()

    async def test_push_reset_discards_late_callbacks_from_previous_selection(self):
        scope, callbacks, stopped, events = ['first'], [], [], []
        async def access(_): return scope[0]
        async def read(_): raise AssertionError('Push must not poll a different feed')
        async def subscribe(_, publish):
            callbacks.append(publish)
            selected = scope[0]
            return lambda: stopped.append(selected)
        async def publish(_, event): events.append(event)
        hub = LiveReads(read, access, subscribe=subscribe)
        try:
            await hub.attach([{'operation': 'fixture', 'arguments': {}}], publish)
            await asyncio.sleep(.02)
            callbacks[0]({'type': 'snapshot', 'state': 'ready', 'data': {'source': 'first'}})
            await asyncio.sleep(1.05)
            scope[0] = 'second'
            await asyncio.sleep(1.05)
            self.assertEqual(stopped, ['first'])
            self.assertEqual(events[-1]['type'], 'reset')
            callbacks[0]({'type': 'snapshot', 'state': 'ready', 'data': {'source': 'first-late'}})
            callbacks[1]({'type': 'snapshot', 'state': 'ready', 'data': {'source': 'second'}})
            await asyncio.sleep(1.05)
            self.assertEqual(events[-1]['data'], {'source': 'second'})
            self.assertNotEqual(events[0]['generation'], events[-1]['generation'])
            self.assertFalse(any(event.get('data') == {'source': 'first-late'} for event in events))
        finally:
            await hub.close()
        self.assertEqual(stopped, ['first', 'second'])

    async def test_one_cancelled_consumer_does_not_cancel_joiner_and_queue_is_bounded(self):
        owner = Admission(workers=1, limit=2)
        started, release = threading.Event(), threading.Event()
        calls = []
        def work(cancelled):
            calls.append(1)
            started.set()
            while not release.wait(.01):
                if cancelled():
                    raise AssertionError('Joiner still needs this work')
            return 42
        first = asyncio.create_task(owner.run('same', work))
        second = asyncio.create_task(owner.run('same', work))
        try:
            self.assertTrue(await asyncio.to_thread(started.wait, 1))
            first.cancel()
            await asyncio.gather(first, return_exceptions=True)
            queued = asyncio.create_task(owner.run('other', lambda _: 7))
            await asyncio.sleep(.01)
            with self.assertRaises(AdmissionError) as caught:
                await owner.run('overflow', lambda _: 0)
            self.assertEqual(caught.exception.code, 'busy')
            release.set()
            self.assertEqual(await second, 42)
            self.assertEqual(await queued, 7)
            self.assertEqual(calls, [1])
        finally:
            release.set()
            await owner.close()

    async def test_shared_poll_snapshot_replay_and_revocation(self):
        calls, scope = [], ['allowed']
        async def access(_):
            if scope[0] == 'denied':
                raise AdmissionError('unavailable', 403)
            return scope[0]
        async def read(_):
            calls.append(1)
            return {'value': 42}, 60
        hub = LiveReads(read, access, grace=.01)
        request = {'operation': 'synthetic', 'arguments': {}}
        a, b = [], []
        async def publish_a(_, event): a.append(event)
        async def publish_b(_, event): b.append(event)
        try:
            one = await hub.attach([request], publish_a)
            for _ in range(20):
                if a: break
                await asyncio.sleep(.01)
            two = await hub.attach([request], publish_b)
            self.assertEqual(a[0]['data'], b[0]['data'])
            self.assertEqual(calls, [1])
            hub.detach(one)
            scope[0] = 'denied'
            await asyncio.sleep(1.1)
            self.assertEqual(b[-1]['type'], 'reset')
            self.assertNotIn('data', b[-1])
            denied = await hub.attach([request], publish_a)
            self.assertEqual(a[-1]['type'], 'reset')
            self.assertNotIn('data', a[-1])
            hub.detach(denied)
            hub.detach(two)
            await asyncio.sleep(1.1)
            self.assertEqual(len(hub.resources), 0)
        finally:
            await hub.close()
