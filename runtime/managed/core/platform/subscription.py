"""Caller-owned update lifetime, passed as trusted context to a native handler."""
from threading import Event, RLock


class Subscription:
    def __init__(self, publish, window=None):
        self.publish, self.closed = publish, Event()
        self.window = window
        self.lock, self.stops = RLock(), []

    def emit(self, event):
        if not self.closed.is_set(): self.publish(event)

    def on_close(self, stop):
        with self.lock:
            if self.closed.is_set(): stop()
            else: self.stops.append(stop)

    def close(self):
        with self.lock:
            self.closed.set()
            stops, self.stops = self.stops, []
        for stop in stops: stop()
