"""Reusable native response cache below tool/HTTP entry points."""
from contextlib import contextmanager
from contextvars import copy_context
from pathlib import Path
from threading import get_ident

from .cache import ReadCache
from . import process
from .request_context import cancel_signal, cancelled as is_cancelled
from .selection import fingerprint
from .failures import cacheable, MESSAGES
from . import diagnostics


class SourceFailure(RuntimeError):
    def __init__(self, raw):
        self.raw = raw
        super().__init__(raw.get('error') or next(iter(raw.get('issues') or ['source_unavailable'])))


def qualify_failure(result, raw):
    """Keep scheduling qualifications in domain issues for every entry point."""
    for issue in result.get('issues', []):
        if issue.get('severity', 'error') != 'error': continue
        code = raw.get('error') or raw.get('failure', {}).get('code')
        if code in MESSAGES: issue.update(code=code, message=MESSAGES[code])
        retry = raw.get('retry_after', raw.get('retry_after_seconds'))
        if type(retry) in (int, float) and 0 <= retry <= 86400:
            issue['retry_after_seconds'] = retry
        origin = raw.get('limit_origin', raw.get('failure', {}).get('origin'))
        if origin in ('connector', 'provider'):
            issue['limit_origin'] = origin
            if origin == 'connector' and issue.get('code') == 'rate_limit':
                issue['message'] = 'The connection request budget is busy. The read will be eligible after its retry delay.'
        elif issue.get('code') == 'rate_limit':
            issue['limit_origin'] = 'provider'
        if raw.get('error') == 'busy' or raw.get('failure', {}).get('code') == 'busy':
            issue.update(code='busy', message='Data requests are busy. Retrying shortly.')
    return result


@contextmanager
def consumer(provided=None):
    inherited = cancel_signal.get()
    caller_context = copy_context()
    caller = get_ident()
    try:
        from tools.interrupt import is_thread_interrupted
    except ImportError:  # The same helper supports isolated, non-Hermes callers.
        is_thread_interrupted = lambda _caller: False
    # Native callbacks may themselves read cancel_signal. Evaluate them in the
    # caller's captured context, never recursively through this replacement.
    token = cancel_signal.set(lambda: bool((provided and caller_context.copy().run(provided)) or
        (inherited and caller_context.copy().run(inherited)) or is_thread_interrupted(caller)))
    try: yield
    finally: cancel_signal.reset(token)


class WorkerReads:
    def __init__(self, transport=process):
        self.transport = transport
        self.cache = ReadCache(max_entries=128, max_bytes=8_000_000)

    def read(self, command, request, environment, *, age=0, cancelled=None, cache_scope=None, **options):
        # Include worker revision and all transport/credential inputs. Secrets
        # are hashed into an opaque in-memory key, never logged or persisted.
        worker = Path(command[-1])
        try:
            revision = [worker.stat().st_mtime_ns, worker.stat().st_size]
        except OSError:
            revision = None
        key = fingerprint({'command': command, 'revision': revision, 'request': request, 'environment': environment, 'fresh': age == 0, 'scope': cache_scope})
        def fetch():
            cached = self.cache.get(key) if age else None
            if cached is not None:
                diagnostics.emit('cache_hit', level='debug', provider=getattr(options.get('budget'), 'provider', None), operation=request.get('operation'))
                return cached
            value = self.transport.run_worker(command, request, environment, cancelled=is_cancelled, **options)
            if age and not is_cancelled() and (value.get('data') is not None or value.get('observations')) and cacheable(value):
                self.cache.put(key, value, ttl_seconds=age)
            return value
        with consumer(cancelled):
            return self.cache.coalesce(key, fetch)
