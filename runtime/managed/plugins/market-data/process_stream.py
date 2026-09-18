"""Owned, bounded streaming child; no listener, service or credential store."""
import atexit
import json
import os
from pathlib import Path
from queue import Queue, Empty, Full
import selectors
import socket
import subprocess
import threading
import weakref

from .governor import PermitChannel
from .process import _stop
from . import diagnostics

_children = weakref.WeakSet()


def close_all():
    for child in list(_children):
        child.close()


atexit.register(close_all)


class StreamingWorker:
    def __init__(self, command, environment, initial, budget, receive):
        self.receive, self.closed = receive, threading.Event()
        self.commands = Queue(maxsize=32)
        self.channels = socket.socketpair()
        self.permits = PermitChannel(budget)
        env = {**environment, 'PYTHIA_BUDGET_FD': str(self.channels[1].fileno()),
               'PYTHIA_BUDGET_MODULE': str(Path(__file__).with_name('worker_budget.py'))}
        try:
            self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, env=env, pass_fds=(self.channels[1].fileno(),), start_new_session=True)
        except BaseException:
            for channel in self.channels: channel.close()
            raise
        self.channels[1].close()
        self.send(initial)
        self.thread = threading.Thread(target=self.pump, daemon=True, name='pythia-provider-stream')
        _children.add(self)
        self.thread.start()

    def send(self, message):
        encoded = json.dumps(message, allow_nan=False).encode() + b'\n'
        if len(encoded) > 65536 or self.closed.is_set():
            raise RuntimeError('stream_unavailable')
        try: self.commands.put_nowait(encoded)
        except Full: raise RuntimeError('stream_busy') from None

    def pump(self):
        output, pending, stderr = bytearray(), memoryview(b''), 0
        process = self.process
        try:
            with selectors.DefaultSelector() as selector:
                for stream in (process.stdout, process.stderr, self.channels[0]):
                    os.set_blocking(stream.fileno(), False)
                    selector.register(stream, selectors.EVENT_READ)
                os.set_blocking(process.stdin.fileno(), False)
                while not self.closed.is_set() and process.poll() is None:
                    if self.permits.pending: self.permits.drain(self.channels[0])
                    if not pending:
                        try:
                            pending = memoryview(self.commands.get_nowait())
                            selector.register(process.stdin, selectors.EVENT_WRITE)
                        except Empty: pass
                    for key, _ in selector.select(.05):
                        stream = key.fileobj
                        if stream is process.stdin:
                            pending = pending[os.write(stream.fileno(), pending):]
                            if not pending: selector.unregister(stream)
                            continue
                        chunk = os.read(stream.fileno(), 65536)
                        if not chunk:
                            selector.unregister(stream)
                            continue
                        if stream is self.channels[0]:
                            self.permits.receive(stream, chunk)
                        elif stream is process.stderr:
                            stderr += len(chunk)
                            if stderr > 65536: raise ValueError('output_limit')
                        else:
                            output.extend(chunk)
                            if len(output) > 2_000_000: raise ValueError('output_limit')
                            while b'\n' in output:
                                line, _, output = output.partition(b'\n')
                                self.receive(json.loads(line))
        except Exception:
            diagnostics.emit('stream_failed', level='warning', provider=getattr(self.permits.governor, 'provider', None),
                             request_id=self.permits.request_id, code='invalid_response')
        finally:
            stopped = self.closed.is_set()
            self.closed.set()
            _stop(process)
            self.permits.close()
            for stream in (process.stdin, process.stdout, process.stderr, *self.channels):
                stream.close()
            if not stopped:
                self.receive({'type': 'status', 'state': 'stale', 'code': 'connection_lost'})

    def close(self):
        self.closed.set()
        if threading.current_thread() is not self.thread:
            self.thread.join(timeout=3)
