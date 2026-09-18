"""Small disposable process-local cache; no observations written to disk."""
from collections import OrderedDict
from concurrent.futures import Future, ThreadPoolExecutor, TimeoutError
from contextvars import ContextVar, copy_context
import copy
import json
from threading import RLock, Event, BoundedSemaphore
import time

from .request_context import cancel_signal, cancelled

_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix='pythia-shared-read')
_capacity = BoundedSemaphore(64)
_producing = ContextVar('pythia_cache_producer', default=False)


class ReadCancelled(RuntimeError):
    pass


class ReadCache:
    def __init__(self, *, max_entries=32, max_bytes=4_000_000, ttl_seconds=15, clock=time.monotonic):
        self.max_entries, self.max_bytes, self.ttl = max_entries, max_bytes, ttl_seconds
        self.clock = clock
        self.entries = OrderedDict()
        self.bytes = 0
        self.lock = RLock()
        self.inflight = {}

    def get(self, key):
        with self.lock:
            found = self.entries.get(key)
            if found is None:
                return None
            expires, size, value = found
            if self.clock() >= expires:
                del self.entries[key]
                self.bytes -= size
                return None
            self.entries.move_to_end(key)
            return copy.deepcopy(value)

    def put(self, key, value, *, ttl_seconds=None):
        size = len(json.dumps(value, ensure_ascii=False, allow_nan=False).encode())
        if size > self.max_bytes:
            return
        with self.lock:
            if key in self.entries:
                self.bytes -= self.entries.pop(key)[1]
            self.entries[key] = (self.clock() + (self.ttl if ttl_seconds is None else ttl_seconds), size, copy.deepcopy(value))
            self.bytes += size
            while len(self.entries) > self.max_entries or self.bytes > self.max_bytes:
                self.bytes -= self.entries.popitem(last=False)[1][1]

    def coalesce(self, key, fetch):
        """Detach upstream lifetime from any one consumer's cancellation."""
        with self.lock:
            job = self.inflight.get(key)
            if job is not None and job['cancel'].is_set():
                raise RuntimeError('rate_limit')
            owner = job is None
            if owner:
                job = {'future': Future(), 'cancel': Event(), 'consumers': 0, 'waiters': {}}
                self.inflight[key] = job
            job['consumers'] += 1
            waiter, context = object(), copy_context()
            job['waiters'][waiter] = lambda: context.copy().run(cancelled)
        def abandoned():
            with self.lock:
                callbacks = list(job['waiters'].values())
            if job['cancel'].is_set(): return True
            if not callbacks or all(callback() for callback in callbacks):
                with self.lock:
                    if list(job['waiters'].values()) == callbacks: job['cancel'].set()
            return job['cancel'].is_set()
        def produce():
            token = cancel_signal.set(abandoned)
            nested = _producing.set(True)
            try:
                job['future'].set_result(copy.deepcopy(fetch()))
            except BaseException as error:
                job['future'].set_exception(error)
            finally:
                cancel_signal.reset(token)
                _producing.reset(nested)
                with self.lock:
                    self.inflight.pop(key, None)
        if owner:
            if _producing.get():
                produce()  # Nested metadata does not deadlock the shared pool.
            elif _capacity.acquire(blocking=False):
                def work():
                    try: produce()
                    finally: _capacity.release()
                _pool.submit(copy_context().run, work)
            else:
                with self.lock:
                    self.inflight.pop(key, None)
                job['future'].set_exception(RuntimeError('rate_limit'))
        try:
            while True:
                if cancelled():
                    raise ReadCancelled('cancelled')
                try:
                    return copy.deepcopy(job['future'].result(timeout=.05))
                except TimeoutError:
                    if job['future'].done():
                        return copy.deepcopy(job['future'].result())
                    continue
        finally:
            with self.lock:
                job['consumers'] -= 1
                job['waiters'].pop(waiter, None)
                if not job['consumers']:
                    job['cancel'].set()

    def clear(self):
        with self.lock:
            self.entries.clear()
            self.bytes = 0
