"""Bounded parallel reads for a connector's batch and for market-data's coordinated reads.

A call made from inside a parallel call runs its values in turn, so nested reads never wait on the same pool.
"""
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context, ContextVar

_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix='pythia-read-group')
_inside = ContextVar('pythia_parallel_read', default=False)


def parallel(function, values):
    if _inside.get():
        return [function(value) for value in values]
    def call(value):
        token = _inside.set(True)
        try: return function(value)
        finally: _inside.reset(token)
    tasks = [_pool.submit(copy_context().run, call, value) for value in values]
    return [task.result() for task in tasks]
