"""Synthetic execution-boundary regressions; no external provider traffic."""
import importlib
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from market_data_fixture import PACKAGE

governor = importlib.import_module(PACKAGE + '.governor')
process = importlib.import_module(PACKAGE + '.process')
helpers = importlib.import_module(PACKAGE + '.connector')


class ConnectorExecution(unittest.TestCase):
    def test_invalid_batch_rows_are_logged_not_cached_and_recover(self):
        class Transport:
            calls = 0
            def run_worker(self, *args, **kwargs):
                self.calls += 1
                return {'data': ['PRIVATE provider payload'] if self.calls == 1 else [{'id': 1, 'value': '1.25'}]}
        transport = Transport()
        batch = helpers.NativeBatch(size=10, age=60)
        request = {'operation': 'quotes', 'arguments': {'id': '1'}}
        def read():
            return helpers.worker_batch(batch, transport, [__file__], request, {}, ['1'],
                argument='id', separator=',', row_id='id', cancelled=lambda: False)
        try:
            with self.assertLogs('tools.pythia.connectors', level='WARNING') as logs:
                failed = read()
            self.assertEqual(failed['error'], 'invalid_response')
            self.assertIn(failed['diagnostic_id'], ' '.join(logs.output))
            self.assertIn('batch_invalid_response', ' '.join(logs.output))
            self.assertNotIn('PRIVATE', ' '.join(logs.output))
            self.assertEqual(read()['data'], [{'id': 1, 'value': '1.25'}])
            self.assertEqual(read()['data'], [{'id': 1, 'value': '1.25'}])
            self.assertEqual(transport.calls, 2)
        finally:
            batch.pool.shutdown(wait=True)

    def test_resident_rpc_host_cancels_one_call_without_losing_other_consumers(self):
        import shutil
        host = Path(__file__).resolve().parents[2] / 'managed/runner/dist/provider-worker.js'
        source = """
import { serveWorker, workerSignal } from 'HOST';
await serveWorker(async input => {
    if (input.wait) await new Promise(resolve => workerSignal().addEventListener('abort', resolve, { once:true }));
    return {data: input.value};
});
""".replace('HOST', host.as_uri())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'worker.mjs'
            path.write_text(source)
            transport, cancel = helpers.ResidentTransport(), threading.Event()
            command = [shutil.which('node'), str(path)]
            try:
                with ThreadPoolExecutor(max_workers=2) as pool:
                    first = pool.submit(transport.run_worker, command, {'wait': True, 'value': 1}, {}, cancelled=cancel.is_set)
                    deadline = time.monotonic() + 2
                    while len(transport.pending) != 1 and time.monotonic() < deadline: time.sleep(.01)
                    second = pool.submit(transport.run_worker, command, {'value': 2}, {}, cancelled=lambda: False)
                    cancel.set()
                    with self.assertRaisesRegex(process.WorkerError, 'cancelled'): first.result(timeout=2)
                    self.assertEqual(second.result(timeout=2)['data'], 2)
                with self.assertRaisesRegex(process.WorkerError, 'timeout'):
                    transport.run_worker(command, {'wait': True}, {}, timeout=.2, cancelled=lambda: False)
                self.assertIsNotNone(transport.child.process.poll())
                self.assertEqual(transport.run_worker(command, {'value': 3}, {}, cancelled=lambda: False)['data'], 3)
            finally: transport.shutdown()

    def test_fifo_burst_cancel_expiry_and_quota_have_separate_outcomes(self):
        clock = [10.0]
        budget = governor.Governor(concurrency=1, per_minute=2, clock=lambda: clock[0])
        first, cancelled, third = [budget.request() for _ in range(3)]
        self.assertTrue(first['reply']['allowed'])
        self.assertIsNone(third['reply'])
        budget.cancel(cancelled)
        budget.release()
        self.assertTrue(third['reply']['allowed'])
        budget.release()
        quota = budget.request()['reply']
        self.assertEqual((quota['code'], quota['origin']), ('rate_limit', 'connector'))
        clock[0] += 61
        self.assertTrue(budget.request()['reply']['allowed'])
        expired = budget.request()
        clock[0] += 11
        budget.service()
        self.assertEqual(expired['reply']['code'], 'busy')
        budget.release(status=429, retry_after=20)
        self.assertEqual(budget.request()['reply']['origin'], 'provider')
        self.assertEqual(budget.active, 0)

    def test_actual_parallel_workers_wait_and_release_instead_of_local_429(self):
        source = '''
import json, os, runpy, time
permit = runpy.run_path(os.environ['PYTHIA_BUDGET_MODULE'])['operation_permit']
with permit(): time.sleep(.12)
print(json.dumps({'data': 1}))
'''
        budget = governor.Governor(concurrency=1)
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: process.run_worker([sys.executable, '-I', '-c', source], {}, {},
                budget=budget, cancelled=lambda: False), range(4)))
        self.assertEqual([row['data'] for row in results], [1] * 4)
        self.assertEqual((budget.active, budget.metrics['denied'], budget.metrics['provider_throttles']), (0, 0, 0))
        self.assertEqual(budget.metrics['calls'], 4)

    def test_nested_errors_are_not_cached_and_logs_never_include_exception_payload(self):
        error = helpers.SourceFailure({'error': 'rate_limit', 'retry_after': 7, 'limit_origin': 'provider', 'diagnostic_id': 'a' * 16})
        with self.assertLogs('tools.pythia.connectors', level='WARNING') as logs:
            failed = helpers.failed_item('SYNTH', error, points=[])
            helpers.detail(RuntimeError('https://secret.example?api_key=PRIVATE'))
        self.assertNotIn('PRIVATE', ' '.join(logs.output))
        self.assertEqual(failed['failure']['retry_after_seconds'], 7)
        raw = {'data': {'charts': [failed]}, 'issues': []}
        self.assertFalse(helpers.cacheable(raw))
        result = helpers.qualify_items({'outcome': 'ok', **raw})
        self.assertEqual(result['outcome'], 'partial')
        self.assertEqual(result['issues'][0]['limit_origin'], 'provider')
        class Transport:
            calls = 0
            def run_worker(self, *args, **kwargs):
                self.calls += 1
                return raw if self.calls == 1 else {'data': {'charts': [{'points': [1], 'error': None}]}, 'issues': []}
        transport = Transport()
        reads = helpers.WorkerReads(transport)
        for _ in range(3): reads.read([__file__], {}, {}, age=60, cancelled=lambda: False)
        self.assertEqual(transport.calls, 2)

    def test_resident_child_reuses_process_and_reaps_on_unload(self):
        source = '''
import json, os, sys
for line in sys.stdin:
    row = json.loads(line)
    if row['type'] == 'request':
        print(json.dumps({'type':'result','id':row['id'],'result':{'data':os.getpid()}}), flush=True)
'''
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'worker.py'
            path.write_text(source)
            transport = helpers.ResidentTransport(idle_seconds=60)
            try:
                values = [transport.run_worker([sys.executable, '-I', str(path)], {}, {}, cancelled=lambda: False) for _ in range(2)]
                self.assertEqual(values[0]['data'], values[1]['data'])
                child = transport.child
            finally: transport.shutdown()
            self.assertIsNotNone(child.process.poll())
            with self.assertRaisesRegex(process.WorkerError, 'unavailable'):
                transport.run_worker([sys.executable, '-I', str(path)], {}, {}, cancelled=lambda: False)
