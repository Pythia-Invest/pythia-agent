"""Connector-owned native-ID batching; never cross-provider identity matching."""
from concurrent.futures import Future, ThreadPoolExecutor, TimeoutError
from contextvars import copy_context
from threading import RLock, Timer
import copy
from pathlib import Path

from .cache import ReadCache, ReadCancelled
from . import diagnostics
from .request_context import cancel_signal, cancelled
from .selection import fingerprint
from .worker_reads import consumer
from .failures import worker_failure


class NativeBatch:
    def __init__(self, *, size=20, age=60):
        self.size, self.age = size, age
        self.cache = ReadCache(max_entries=256, max_bytes=8_000_000, ttl_seconds=age)
        self.lock, self.entries, self.pending = RLock(), {}, {}
        self.timer = None
        self.pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix='pythia-native-batch')

    def read(self, identifiers, binding, fetch, *, cancellation=None, fresh=False):
        scope = fingerprint([binding, fresh])
        rows, handles = {}, []
        with consumer(cancellation):
            try:
                with self.lock:
                    for identifier in identifiers:
                        key = (scope, identifier)
                        cached = self.cache.get(key) if not fresh else None
                        if cached is not None:
                            rows[identifier] = cached
                            continue
                        entry = self.entries.get(key)
                        if entry is not None and entry.get('abandoned'):
                            raise RuntimeError('rate_limit')
                        if entry is None:
                            if len(self.entries) >= 128:
                                raise RuntimeError('rate_limit')
                            entry = {'future': Future(), 'consumers': 0, 'id': identifier, 'key': key}
                            self.entries[key] = entry
                            group = self.pending.setdefault(scope, {'entries': [], 'fetch': fetch, 'context': copy_context(), 'fresh': fresh})
                            group['entries'].append(entry)
                        entry['consumers'] += 1
                        handles.append(entry)
                    if self.pending and self.timer is None:
                        self.timer = Timer(.01, self.flush)
                        self.timer.daemon = True
                        self.timer.start()
                for entry in handles:
                    while True:
                        if cancelled(): raise ReadCancelled('cancelled')
                        try:
                            rows[entry['id']] = copy.deepcopy(entry['future'].result(timeout=.05))
                            break
                        except TimeoutError:
                            if entry['future'].done():
                                entry['future'].result()
                return rows
            finally:
                with self.lock:
                    for entry in handles:
                        entry['consumers'] -= 1
                        if not entry['consumers']: entry['abandoned'] = True

    def flush(self):
        with self.lock:
            groups, self.pending, self.timer = self.pending, {}, None
        for group in groups.values():
            for offset in range(0, len(group['entries']), self.size):
                entries = group['entries'][offset:offset + self.size]
                self.pool.submit(group['context'].copy().run, self.execute, group, entries)

    def execute(self, group, entries):
        def abandoned():
            with self.lock: return all(entry['consumers'] == 0 for entry in entries)
        token = cancel_signal.set(abandoned)
        try:
            if abandoned(): raise ReadCancelled('cancelled')
            values = group['fetch']([entry['id'] for entry in entries], abandoned)
            with self.lock:
                for entry in entries:
                    value = values.get(entry['id'])
                    if value is not None and not (isinstance(value, dict) and (value.get('error') or value.get('issues'))) and not group['fresh'] and not abandoned():
                        self.cache.put(entry['key'], value)
                    entry['future'].set_result(copy.deepcopy(value))
        except BaseException as error:
            for entry in entries: entry['future'].set_exception(error)
        finally:
            cancel_signal.reset(token)
            with self.lock:
                for entry in entries: self.entries.pop(entry['key'], None)


def worker_batch(batch, transport, command, request, environment, identifiers, *, argument,
                 separator=None, row_id=None, fresh=False, cancelled=None, **options):
    """Share only a connector-declared native endpoint and its identical options.

    Per-ID values retain the worker envelope, including missing rows and errors.
    Unlike ReadCache producers these workers run directly in the batch executor.
    """
    template = copy.deepcopy(request)
    template['arguments'].pop(argument, None)
    worker = Path(command[-1])
    revision = [worker.stat().st_mtime_ns, worker.stat().st_size]
    binding = [command, revision, template, environment, argument, separator, row_id]
    def fetch(ids, abandoned):
        message = copy.deepcopy(template)
        message['arguments'][argument] = separator.join(ids) if separator is not None else ids
        reference = diagnostics.identifier()
        token = diagnostics.request_id.set(reference)
        try:
            raw = transport.run_worker(command, message, environment, cancelled=abandoned, **options)
        except Exception as error:
            raw = worker_failure(error)
        finally:
            diagnostics.request_id.reset(token)
        try:
            if not isinstance(raw, dict): raise ValueError('invalid_response')
            rows = raw.get('data')
            if raw.get('error') or raw.get('issues'):
                return {identifier: raw for identifier in ids}
            if row_id:
                if not isinstance(rows, list): raise ValueError('invalid_response')
                data = {str(row[row_id]): row for row in rows}
                if len(data) != len(rows): raise ValueError('invalid_response')
            else:
                if not isinstance(rows, dict): raise ValueError('invalid_response')
                data = rows
            if set(data) - set(ids): raise ValueError('invalid_response')
        except (ValueError, KeyError, TypeError):
            diagnostics.emit('batch_invalid_response', level='warning', request_id=reference,
                provider=getattr(options.get('budget'), 'provider', None), operation=message.get('operation'),
                code='invalid_response', count=len(ids))
            return {identifier: {'error': 'invalid_response', 'issues': ['invalid_response'], 'data': None, 'diagnostic_id': reference} for identifier in ids}
        return {identifier: {**raw, 'data': {identifier: data[identifier]} if identifier in data else {}} for identifier in ids}
    values = batch.read(identifiers, binding, fetch, cancellation=cancelled, fresh=fresh)
    errors = {key: value for key, value in values.items() if value.get('error') or value.get('issues')}
    successes = [value for key, value in values.items() if key not in errors]
    merged = {key: row for value in successes for key, row in value['data'].items()}
    envelope = next(iter(successes), next(iter(errors.values()), {'data': {}, 'issues': []}))
    return {**envelope, 'data': list(merged.values()) if row_id else merged,
            **({'item_errors': errors} if errors else {})}


def worker_item(raw, identifier):
    """Select one native result without giving it a sibling's failure."""
    if identifier in raw.get('item_errors', {}): return raw['item_errors'][identifier]
    return {key: value for key, value in raw.items() if key != 'item_errors'}
