"""Review reproductions: nested consumers and disconnected live resources."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
import importlib
from threading import Event
import unittest

from test_market_data_identity import PACKAGE, PLATFORM

cache = importlib.import_module(PACKAGE + '.cache')
context = importlib.import_module(PLATFORM + '.request_context')
LiveReads = importlib.import_module(PLATFORM + '.live').LiveReads


class NestedConsumers(unittest.TestCase):
    def test_nested_producer_observes_last_departure_but_keeps_independent_consumer(self):
        for survivor in (False, True):
            with self.subTest(survivor=survivor):
                outer, inner = cache.ReadCache(), cache.ReadCache()
                entered, check, checked, finish, cancel = [Event() for _ in range(5)]
                observed = []
                def provider():
                    entered.set()
                    if not check.wait(2): raise AssertionError('check not released')
                    observed.append(context.cancelled())
                    checked.set()
                    if not finish.wait(2): raise AssertionError('provider not released')
                    return 42
                def read():
                    token = context.cancel_signal.set(cancel.is_set)
                    try: return outer.coalesce('outer', lambda: inner.coalesce('inner', provider))
                    finally: context.cancel_signal.reset(token)
                with ThreadPoolExecutor(max_workers=2) as pool:
                    first = pool.submit(read)
                    try:
                        self.assertTrue(entered.wait(2))
                        second = None
                        if survivor:
                            joined = Event()
                            # Capture the joiner's cancellation callback before it waits.
                            def joined_cancel(): joined.set(); return False
                            token = context.cancel_signal.set(joined_cancel)
                            try: second = pool.submit(copy_context().run, inner.coalesce, 'inner', provider)
                            finally: context.cancel_signal.reset(token)
                            self.assertTrue(joined.wait(2))
                        cancel.set()
                        with self.assertRaises(cache.ReadCancelled): first.result(timeout=2)
                        check.set()
                        self.assertTrue(checked.wait(2))
                        self.assertEqual(observed, [not survivor])
                    finally:
                        check.set(); finish.set()
                    if second: self.assertEqual(second.result(timeout=2), 42)


class DepartingPoll(unittest.IsolatedAsyncioTestCase):
    async def test_last_listener_cancels_blocked_read_after_grace(self):
        started, cancelled, finish, cleaned = [asyncio.Event() for _ in range(4)]
        async def access(_): return 'allowed'
        async def read(_):
            started.set()
            try: await asyncio.Future()
            finally:
                cancelled.set()
                await finish.wait()
                cleaned.set()
        async def publish(*_): pass
        hub = LiveReads(read, access, grace=0)
        try:
            handles = await hub.attach([{'operation': 'synthetic', 'arguments': {}}], publish)
            await asyncio.wait_for(started.wait(), 1)
            hub.detach(handles)
            await asyncio.wait_for(cancelled.wait(), 1)
            closing = asyncio.create_task(hub.close())
            await asyncio.sleep(0)
            self.assertFalse(closing.done())  # Retiring polls still belong to shutdown.
            finish.set()
            await asyncio.wait_for(closing, 1)
            self.assertTrue(cleaned.is_set())
        finally:
            finish.set()
            await hub.close()
