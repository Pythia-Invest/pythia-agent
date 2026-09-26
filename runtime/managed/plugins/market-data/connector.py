"""Public helper library of the existing market-data owner.

Native connector plugins import this module through their resolved market-data
dependency. It is implementation support, not discovery or a new registry.
"""
from .worker_reads import WorkerReads, SourceFailure, qualify_failure
from .native_batch import NativeBatch, worker_batch, worker_item
from .resident_worker import ResidentTransport
from .public_http import Transport
from .governor import connection
from .failures import failed_item, detail, cacheable, item_failures, qualify_items, worker_failure
from .diagnostics import emit

__all__ = ['WorkerReads', 'SourceFailure', 'qualify_failure', 'NativeBatch',
           'worker_batch', 'worker_item', 'ResidentTransport', 'Transport', 'connection', 'failed_item',
           'detail', 'cacheable', 'item_failures', 'qualify_items', 'worker_failure', 'emit']
