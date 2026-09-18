"""Optional reusable RPC child for SDKs whose connection state is expensive.

Uses the existing owned-child transport and permits. No listener or service.
Pending calls, deadlines, cancellation, idle expiry and cleanup are bounded.
"""
import threading
import time
import uuid
from pathlib import Path

from . import diagnostics
from .process import WorkerError
from .process_stream import StreamingWorker
from .selection import fingerprint


class ResidentTransport:
    def __init__(self, idle_seconds=150):
        self.lock, self.pending = threading.RLock(), {}
        self.child, self.binding, self.timer = None, None, None
        self.idle_seconds = idle_seconds
        self.closed = False

    def run_worker(self, command, request, environment, *, timeout=30, cancelled=None, budget=None):
        if type(timeout) not in (int, float) or not 0 < timeout <= 120:
            raise WorkerError('invalid_deadline')
        if cancelled and cancelled(): raise WorkerError('cancelled')
        worker = Path(command[-1])
        binding = fingerprint([command, environment, worker.stat().st_mtime_ns, id(budget)])
        identifier, started = uuid.uuid4().hex[:16], time.monotonic()
        ready, entry = threading.Event(), {}
        with self.lock:
            if self.closed: raise WorkerError('unavailable')
            if self.timer: self.timer.cancel()
            if self.child and (self.binding != binding or self.child.closed.is_set()):
                if self.pending: raise WorkerError('busy')
                # Signal teardown without joining a pump whose callback may be
                # waiting on this lock. Its generation cannot resolve new calls.
                self.child.closed.set()
                self.child = None
            if len(self.pending) >= 32: raise WorkerError('busy')
            if self.child is None:
                generation = object()
                self.generation = generation
                self.child = StreamingWorker(command, {**environment, 'PYTHIA_WORKER_MODE': 'resident'},
                    {'type': 'init'}, budget, lambda message: self.receive(message, generation))
                self.binding = binding
                diagnostics.emit('resident_started', provider=getattr(budget, 'provider', None))
            self.pending[identifier] = (ready, entry)
            child = self.child
        provider = getattr(budget, 'provider', None)
        diagnostics.emit('read_started', request_id=identifier, provider=provider, operation=request.get('operation'))
        try:
            try: child.send({'type': 'request', 'id': identifier, 'request': request})
            except RuntimeError: raise WorkerError('source_unavailable') from None
            while not ready.wait(.05):
                if cancelled and cancelled(): raise WorkerError('cancelled')
                if time.monotonic() - started >= timeout: raise WorkerError('timeout')
            if 'failure' in entry: raise WorkerError(entry['failure'])
            result = entry['result']
            result['diagnostic_id'] = identifier
            from .failures import item_failures, failure_code
            errors = item_failures(result.get('data'))
            failed = bool(errors or result.get('error') or result.get('issues'))
            diagnostics.emit('read_failed' if failed else 'read_completed', level='warning' if failed else 'info',
                request_id=identifier, provider=provider, operation=request.get('operation'), count=len(errors),
                code=failure_code(result),
                duration_ms=round((time.monotonic() - started) * 1000))
            return result
        except WorkerError as error:
            diagnostics.emit('read_failed', level='warning', request_id=identifier, provider=provider, code=str(error))
            try: child.send({'type': 'cancel', 'id': identifier})
            except RuntimeError: pass
            if str(error) == 'timeout':
                # A child that misses its parent deadline cannot occupy the
                # serial SDK queue indefinitely. Fail affected calls explicitly.
                with self.lock:
                    child.closed.set()
                    for waiting, value in self.pending.values():
                        value['failure'] = 'timeout'
                        waiting.set()
                child.close()
            raise
        finally:
            with self.lock:
                self.pending.pop(identifier, None)
                if not self.pending and not self.closed:
                    self.timer = threading.Timer(self.idle_seconds, self.close)
                    self.timer.daemon = True
                    self.timer.start()

    def receive(self, message, generation):
        with self.lock:
            if generation is not self.generation: return
            if message.get('type') == 'result':
                target = self.pending.get(message.get('id'))
                if target:
                    if isinstance(message.get('result'), dict): target[1]['result'] = message['result']
                    else: target[1]['failure'] = 'invalid_response'
                    target[0].set()
            elif message.get('state') in ('stale', 'unavailable'):
                for ready, entry in self.pending.values():
                    entry['failure'] = 'source_unavailable'
                    ready.set()

    def close(self, *, force=False):
        with self.lock:
            if force:
                self.closed = True
                for ready, entry in self.pending.values():
                    entry['failure'] = 'unavailable'
                    ready.set()
            elif self.pending: return
            child, self.child = self.child, None
            if self.timer: self.timer.cancel()
        if child:
            child.close()
            diagnostics.emit('resident_stopped')

    def shutdown(self):
        self.close(force=True)
