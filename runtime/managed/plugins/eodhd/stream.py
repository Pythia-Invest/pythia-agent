"""Explicit native connection mode; one owned child multiplexes Cboe feeds."""
import hashlib
import importlib
import os
from pathlib import Path
from threading import RLock, Event, Timer
import uuid

from .identity import reference
from .series import definition, selector
from .stream_results import read, moving_request


class Streams:
    def __init__(self, ctx, wire, credentials):
        self.ctx, self.wire, self.credentials = ctx, wire, credentials
        self.lock, self.listeners, self.latest = RLock(), {}, {}
        self.worker, self.key, self.timer = None, None, None
        self.generation = None
        self.started = False

    def close(self):
        """Native unload retires the owned child and every retained observation."""
        with self.lock:
            if self.timer: self.timer.cancel()
            worker, self.worker, self.key = self.worker, None, None
            self.generation = None
            listeners, self.listeners = list(self.listeners.values()), {}
            self.latest.clear()
        if worker: worker.close()
        for listener in listeners:
            listener['receive']({'type': 'reset', 'state': 'unavailable', 'code': 'access_changed'})

    def mode(self):
        mode = self.ctx.get_config('streaming', 'disabled')
        if mode not in ('disabled', 'demo', 'account'):
            raise ValueError('unavailable')
        return mode

    def subscribe(self, arguments, subscription):
        request = self.wire.validate('read_request', arguments['request'])
        native, mode = selector(arguments['source_selector'])
        descriptor = self.wire.validate('series', definition(native, mode))
        if mode not in ('edgx_latest', 'edgx_1m') or request['view'] != {'kind': 'source', 'series_id': descriptor['id']}:
            raise ValueError('binding_mismatch')
        configured = self.mode()
        if configured == 'disabled': raise ValueError('unavailable')
        token = 'demo' if configured == 'demo' else self.credentials.eodhd_token()[1]
        if not token: raise ValueError('unavailable')
        symbol, feed = reference(native)[:-3], 'us' if mode == 'edgx_latest' else 'us-candles'
        binding = hashlib.sha256(token.encode()).hexdigest()
        identifier = uuid.uuid4().hex
        def receive(message):
            if message.get('type') == 'data':
                value = self.wire.validate_read_result(read(moving_request(request, subscription.window), descriptor, mode, message))
                subscription.emit({'type': 'snapshot', 'state': 'ready', 'data': value})
            else:
                subscription.emit({**message, **({'type': 'reset'} if message.get('state') == 'unavailable' else {})})
        with self.lock:
            if self.key is not None and self.key != binding and self.listeners:
                raise ValueError('access_changed')
            subscriptions = {(row['feed'], row['symbol']) for row in self.listeners.values()} | {(feed, symbol)}
            if sum(3 if entry[0] == 'us' else 1 for entry in subscriptions) > 50:
                raise ValueError('rate_limit')
            self.key = binding
            self.listeners[identifier] = {'feed': feed, 'symbol': symbol, 'receive': receive}
            if self.worker is None or self.worker.closed.is_set():
                root, node = os.environ.get('PYTHIA_MANAGED_ROOT', ''), os.environ.get('PYTHIA_NODE', '')
                worker = Path(root) / 'runner/dist/eodhd-live.js'
                if not Path(node).is_absolute() or not worker.is_file():
                    self.listeners.pop(identifier)
                    raise ValueError('unavailable')
                helpers = importlib.import_module(self.wire.__package__ + '.process_stream')
                budget = importlib.import_module(self.wire.__package__ + '.governor').connection('eodhd', token,
                    per_minute=self.ctx.get_config('requests_per_minute', 60))
                env = {key: os.environ[key] for key in ('PATH', 'LANG', 'LC_ALL') if key in os.environ}
                generation = self.generation = uuid.uuid4().hex
                try:
                    self.worker = helpers.StreamingWorker([node, '--max-old-space-size=256', str(worker)], env,
                        {'token': token, 'subscriptions': {}, 'resumed': self.started}, budget, lambda message: self.receive(message, generation))
                    self.started = True
                except BaseException:
                    self.listeners.pop(identifier, None)
                    if not self.listeners: self.key = None
                    raise
            if self.timer: self.timer.cancel()
            self.timer = Timer(.03, self.configure)
            self.timer.daemon = True
            self.timer.start()
            cached = self.latest.get((feed, symbol))
            cached_generation = self.generation
        def stop():
            with self.lock:
                self.listeners.pop(identifier, None)
                if not any(row['feed'] == feed and row['symbol'] == symbol for row in self.listeners.values()):
                    self.latest.pop((feed, symbol), None)
                worker = None
                if not self.listeners:
                    if self.timer: self.timer.cancel()
                    worker, self.worker, self.key = self.worker, None, None
                    self.generation = None
                    self.latest.clear()
                else:
                    if self.timer: self.timer.cancel()
                    self.timer = Timer(.03, self.configure)
                    self.timer.daemon = True
                    self.timer.start()
            if worker: worker.close()
        subscription.on_close(stop)
        # on_close may wait on the lifetime lock while a disconnect invalidates
        # this retained value. Validate and deliver under the stream lock so a
        # stale transition cannot be followed by the old ready snapshot.
        with self.lock:
            if (cached and identifier in self.listeners and self.generation == cached_generation
                    and self.latest.get((feed, symbol)) is cached):
                receive(cached)

    def configure(self):
        try:
            with self.lock:
                if self.worker and not self.worker.closed.is_set():
                    self.worker.send({'subscriptions': {feed: sorted({row['symbol'] for row in self.listeners.values() if row['feed'] == feed})
                        for feed in ('us', 'us-candles')}})
        except RuntimeError:
            self.receive({'type': 'status', 'state': 'stale', 'code': 'connection_lost'}, self.generation)

    def receive(self, message, generation):
        worker = None
        with self.lock:
            if generation != self.generation: return
            if message.get('code') == 'connection_lost':
                # The platform demand owner retries active subscriptions. Retire
                # the whole child so no feed retains a candle across this loss.
                worker, self.worker = self.worker, None
                self.generation = None
                if self.timer: self.timer.cancel()
                message = {'type': 'status', 'state': 'stale', 'code': 'connection_lost'}
            if message.get('type') == 'data':
                self.latest[(message['feed'], message['symbol'])] = message
            elif message.get('state') in ('unavailable', 'stale'):
                self.latest = {key: value for key, value in self.latest.items() if message.get('feed') and key[0] != message['feed']}
            # Publish before another thread can invalidate this generation or
            # retained value. The RLock permits a native callback to release
            # its own subscription. Recheck after any reentrant callback too.
            publication_generation = self.generation
            for identifier, listener in list(self.listeners.items()):
                if self.generation != publication_generation or self.listeners.get(identifier) is not listener: continue
                if message.get('feed') and message['feed'] != listener['feed']: continue
                if message.get('symbol') and message['symbol'] != listener['symbol']: continue
                try: listener['receive'](message)
                except Exception: listener['receive']({'type': 'reset', 'state': 'unavailable', 'code': 'invalid_response'})
        if worker: worker.close()

    def snapshot(self, arguments, cancelled):
        from importlib import import_module
        Subscription = import_module(self.wire.__package__ + '.subscriptions').Subscription
        ready, result = Event(), []
        def receive(event):
            result.append(event)
            ready.set()
        lifetime = Subscription(receive)
        try:
            self.subscribe(arguments, lifetime)
            for _ in range(100):
                if ready.wait(.1) or (cancelled and cancelled()): break
            if cancelled and cancelled(): raise ValueError('cancelled')
            if result and result[-1].get('type') == 'snapshot': return result[-1]['data']
            code = result[-1].get('code') if result else 'timeout'
            allowed = {'access_denied', 'authentication_failed', 'rate_limit', 'timeout', 'cancelled',
                       'connection_lost', 'no_recent_observation', 'backfill_unavailable', 'invalid_response'}
            raise ValueError(code if code in allowed else 'source_unavailable')
        finally: lifetime.close()
