"""Core's connector toolkit: bounded source reads for every plugin (ADR 0045).

Plugins reach it through `pythia_platform` (`connector`, `wire` and `process`), never by
importing this package. It is implementation support, not discovery or a new registry.
"""
from .worker_reads import WorkerReads, SourceFailure, qualify_failure
from .native_batch import NativeBatch, worker_batch, worker_item
from .resident_worker import ResidentTransport
from .public_http import Transport
from .governor import connection
from .failures import failed_item, detail, cacheable, item_failures, qualify_items, worker_failure
from .diagnostics import emit
from .cache import ReadCache, ReadCancelled
from .parallel import parallel
from .process_stream import StreamingWorker
from .worker_budget import retry_after

__all__ = ['WorkerReads', 'SourceFailure', 'qualify_failure', 'NativeBatch',
           'worker_batch', 'worker_item', 'ResidentTransport', 'Transport', 'connection', 'failed_item',
           'detail', 'cacheable', 'item_failures', 'qualify_items', 'worker_failure', 'emit',
           'ReadCache', 'ReadCancelled', 'parallel', 'StreamingWorker', 'retry_after']
