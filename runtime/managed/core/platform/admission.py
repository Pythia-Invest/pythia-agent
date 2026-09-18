"""Bounded asynchronous admission; shared callers do not occupy worker slots."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
import threading
import time


class AdmissionError(Exception):
    def __init__(self, code, status=503):
        self.code, self.status = code, status


class Admission:
    def __init__(self, workers=4, limit=64):
        self.executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix='pythia-data')
        self.slots = asyncio.Semaphore(workers)
        self.limit, self.jobs, self.closed = limit, {}, False

    async def run(self, key, function, *, timeout=30, disconnected=lambda: False):
        if self.closed:
            raise AdmissionError('unavailable')
        job = self.jobs.get(key)
        if job is not None and job['cancel'].is_set():
            raise AdmissionError('busy', 429)
        if job is None:
            if len(self.jobs) >= self.limit:
                raise AdmissionError('busy', 429)
            job = {'cancel': threading.Event(), 'consumers': 0}
            context = copy_context()

            async def execute():
                try:
                    async with self.slots:
                        if job['cancel'].is_set():
                            raise AdmissionError('cancelled', 499)
                        return await asyncio.get_running_loop().run_in_executor(
                            self.executor, context.run, function, job['cancel'].is_set)
                finally:
                    self.jobs.pop(key, None)

            job['task'] = asyncio.create_task(execute())
            job['task'].add_done_callback(lambda task: task.exception() if not task.cancelled() else None)
            self.jobs[key] = job
        job['consumers'] += 1
        deadline = time.monotonic() + timeout
        try:
            while not job['task'].done():
                if disconnected():
                    raise AdmissionError('cancelled', 499)
                if time.monotonic() >= deadline:
                    raise AdmissionError('timeout', 504)
                await asyncio.wait({job['task']}, timeout=0.05)
            return job['task'].result()
        finally:
            job['consumers'] -= 1
            if not job['consumers']:
                job['cancel'].set()

    async def close(self):
        self.closed = True
        for job in list(self.jobs.values()):
            job['cancel'].set()
        tasks = [job['task'] for job in self.jobs.values()]
        if tasks:
            await asyncio.wait(tasks, timeout=2)
        self.executor.shutdown(wait=False, cancel_futures=True)
