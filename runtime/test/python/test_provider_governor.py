"""Outbound permits, shared cancellation and native worker reuse; no network."""
import importlib
import json
import sys
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from test_market_data_identity import PACKAGE

governor = importlib.import_module(PACKAGE + '.governor')
process = importlib.import_module(PACKAGE + '.process')
cache = importlib.import_module(PACKAGE + '.cache')
context = importlib.import_module(PACKAGE + '.request_context')


class Budgets(unittest.TestCase):
    def test_native_cancellation_callback_keeps_its_callers_context(self):
        consumer = importlib.import_module(PACKAGE + '.worker_reads').consumer
        signal = threading.Event()
        token = context.cancel_signal.set(signal.is_set)
        try:
            with consumer(lambda: context.cancelled()):
                self.assertFalse(context.cancelled())
                signal.set()
                self.assertTrue(context.cancelled())
        finally: context.cancel_signal.reset(token)
    def test_overlapping_native_batches_share_ids_and_fresh_bypasses_cache(self):
        NativeBatch = importlib.import_module(PACKAGE + '.native_batch').NativeBatch
        owner = NativeBatch(size=10, age=60)
        calls = []
        gate = threading.Barrier(2)
        def fetch(ids, _cancelled):
            calls.append(set(ids))
            return {identifier: {'value': identifier} for identifier in ids}
        def read(ids):
            gate.wait(timeout=1)
            return owner.read(ids, 'same-feed-usd', fetch)
        with ThreadPoolExecutor(max_workers=2) as pool:
            first, second = pool.submit(read, ['A', 'B']), pool.submit(read, ['B', 'C'])
            self.assertEqual(set(first.result(timeout=1)), {'A', 'B'})
            self.assertEqual(set(second.result(timeout=1)), {'B', 'C'})
        self.assertEqual(calls, [{'A', 'B', 'C'}])
        owner.read(['B'], 'same-feed-usd', fetch)
        self.assertEqual(len(calls), 1)
        owner.read(['B'], 'same-feed-usd', fetch, fresh=True)
        owner.read(['B'], 'different-feed-eur', fetch)
        self.assertEqual(len(calls), 3)
        owner.pool.shutdown()

    def test_producer_timeout_is_not_mistaken_for_waiting_timeout(self):
        def timed_out(): raise TimeoutError('provider deadline')
        with self.assertRaisesRegex(TimeoutError, 'provider deadline'):
            cache.ReadCache().coalesce('one', timed_out)

    def test_rate_credit_and_provider_cooldown_are_distinct(self):
        now = [10.0]
        budget = governor.Governor(concurrency=2, per_minute=10, credits_per_minute=5, clock=lambda: now[0])
        self.assertTrue(budget.acquire(4)['allowed'])
        self.assertFalse(budget.acquire(2)['allowed'])
        budget.release(status=429, retry_after=80)
        now[0] += 61
        rejected = budget.acquire()
        self.assertEqual(rejected, {'allowed': False, 'retry_after': 19, 'origin': 'provider'})
        now[0] += 20
        self.assertTrue(budget.acquire()['allowed'])
        budget.release()
        self.assertEqual(budget.active, 0)
        self.assertEqual(budget.metrics['calls'], 2)

    def test_child_actual_calls_are_counted_not_just_worker_launch(self):
        script = '''
import json, os, runpy, sys
from urllib.request import Request
from urllib.error import HTTPError
sys.stdin.read()
opening = runpy.run_path(os.environ['PYTHIA_BUDGET_MODULE'])['open_budgeted']
class Response:
    status = 200
    def __enter__(self): return self
    def __exit__(self, *_): pass
    def read(self, _limit): return b'{"status":{"credit_count":3}}'
class Opener:
    def open(self, *_args, **_kwargs): return Response()
statuses = []
for _ in range(2):
    try:
        with opening(Opener(), Request('https://example.invalid')) as response:
            response.read(1024)
            statuses.append(response.status)
    except RuntimeError as error:
        statuses.append(error.raw['error'])
print(json.dumps({'data': statuses}))
'''
        budget = governor.Governor(per_minute=1)
        result = process.run_worker([sys.executable, '-I', '-c', script], {}, {}, budget=budget, cancelled=lambda: False)
        self.assertEqual(result['data'], [200, 'rate_limit'])
        self.assertEqual(budget.metrics['provider_throttles'], 0)
        self.assertEqual(budget.metrics['calls'], 1)
        self.assertEqual(budget.metrics['reported_credits'], 3)
        self.assertEqual(result['limit_origin'], 'connector')
        self.assertEqual(budget.active, 0)

    def test_cancelled_cache_owner_does_not_cancel_other_consumer(self):
        store = cache.ReadCache()
        entered, release, cancel = threading.Event(), threading.Event(), threading.Event()
        calls = []
        def fetch():
            calls.append(1)
            entered.set()
            while not release.wait(.01):
                self.assertFalse(context.cancelled())
            return {'value': 42}
        def read(signal):
            token = context.cancel_signal.set(signal)
            try: return store.coalesce('same', fetch)
            finally: context.cancel_signal.reset(token)
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(read, cancel.is_set)
            self.assertTrue(entered.wait(1))
            second = pool.submit(read, lambda: False)
            deadline = time.monotonic() + 1
            while time.monotonic() < deadline:
                with store.lock:
                    if store.inflight['same']['consumers'] == 2: break
                threading.Event().wait(.001)
            cancel.set()
            try:
                with self.assertRaises(cache.ReadCancelled): first.result(timeout=1)
            finally:
                release.set()
            self.assertEqual(second.result(timeout=1), {'value': 42})
            self.assertEqual(calls, [1])
