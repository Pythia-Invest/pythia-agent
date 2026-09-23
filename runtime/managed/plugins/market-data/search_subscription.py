"""One bounded search over the existing protected update channel.

Progress contains source status only; candidates publish once, after ranking
and the normal search access recheck. Cumulative progress tolerates coalescing.
"""
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from threading import BoundedSemaphore, RLock
import logging

from .cache import ReadCancelled
from .request_context import cancel_signal
from .search import search
from .wire import require

_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix='pythia-search')
_slots = BoundedSemaphore(8)


def watch_search(backend, arguments, subscription):
    require({'action', 'query'} <= set(arguments) <= {'action', 'query', 'limit', 'providers'}, 'search', 'invalid fields')
    if not _slots.acquire(blocking=False):
        raise ValueError('search_busy')
    context = copy_context()

    def run():
        token = cancel_signal.set(subscription.closed.is_set)
        lock, completed = RLock(), {}
        try:
            def progress(provider, status, elapsed):
                with lock:
                    completed[provider] = {'provider': provider, 'status': status, 'elapsed_ms': elapsed}
                    subscription.emit({'type': 'snapshot', 'state': 'ready',
                                       'data': {'progress': list(completed.values())}})
            result = search(backend, arguments['query'], arguments.get('limit', 30), arguments.get('providers'), progress)
            subscription.emit({'type': 'snapshot', 'state': 'ready',
                               'data': {'progress': list(completed.values()), 'result': result}})
        except ReadCancelled:
            pass
        except Exception:
            logging.getLogger(__name__).exception('Search subscription failed')
            from .execution import failure
            subscription.emit({'type': 'snapshot', 'state': 'ready',
                               'data': {'progress': [], 'result': failure('source_error')}})
        finally:
            cancel_signal.reset(token)
            _slots.release()
    try:
        _pool.submit(context.run, run)
    except Exception:
        _slots.release()
        raise
    return {'schema_version': 1, 'mode': 'push'}
