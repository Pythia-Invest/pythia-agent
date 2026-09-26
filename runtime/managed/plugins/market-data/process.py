"""Bounded JSON worker transport for managed provider adapters on macOS/Linux.

The caller supplies a trusted executable and an explicit environment. Neither
command construction nor ambient credential selection belongs in this helper.
"""
import json
import os
import selectors
import signal
import socket
import subprocess
import time
from . import diagnostics
from .failures import item_failures, failure_code


class WorkerError(RuntimeError):
    """Fixed diagnostic code; never includes child output, arguments or secrets."""


def _invalid_constant(_value):
    raise ValueError("invalid JSON constant")


def _stop(process):
    # Also stop descendants which inherited the owned process group, even if
    # the immediate worker exited before them.
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=0.3)
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait(timeout=2)


def run_worker(command, request, environment, *, timeout=30, cancelled=None, budget=None, output_limit=2_000_000):
    """One bounded JSON request/result; terminate/reap on deadline or interrupt.

    Native tools use their thread-scoped Hermes interrupt. Headless Python
    callers supply an Event.is_set-compatible callable instead.
    stdout/stderr are bounded while reading; stderr is never returned or logged.
    A connector may raise the stdout bound for a documented bulk read.
    """
    if cancelled is None:
        from tools.interrupt import is_interrupted
        cancelled = is_interrupted
    if type(timeout) not in (int, float) or not 0 < timeout <= 120:
        raise WorkerError("invalid_deadline")
    if type(output_limit) is not int or output_limit <= 0:
        raise WorkerError("invalid_request")
    try:
        request_bytes = json.dumps(request, allow_nan=False).encode() + b"\n"
        if len(request_bytes) > 65536:
            raise WorkerError("input_limit")
    except (ValueError, TypeError, RecursionError):
        raise WorkerError("invalid_request") from None
    process = None
    started = time.monotonic()
    stdout = bytearray()
    stderr_count = 0
    channels, permits = (), None
    request_id = diagnostics.identifier()
    operation = request.get('operation', 'read') if isinstance(request, dict) else 'read'
    provider = getattr(budget, 'provider', 'connector')
    diagnostics.emit('worker_started', request_id=request_id, provider=provider, operation=operation)
    try:
        if cancelled():
            raise WorkerError("cancelled")
        env = dict(environment)
        env['PYTHIA_REQUEST_ID'] = request_id
        if budget is not None:
            from pathlib import Path
            from .governor import PermitChannel
            channels = socket.socketpair()
            permits = PermitChannel(budget, request_id)
            env['PYTHIA_BUDGET_FD'] = str(channels[1].fileno())
            env['PYTHIA_BUDGET_MODULE'] = str(Path(__file__).with_name('worker_budget.py'))
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, env=env, start_new_session=True,
            pass_fds=(channels[1].fileno(),) if channels else ())
        if channels:
            channels[1].close()
        with selectors.DefaultSelector() as selector:
            for stream, event in ((process.stdin, selectors.EVENT_WRITE),
                                  (process.stdout, selectors.EVENT_READ),
                                  (process.stderr, selectors.EVENT_READ)):
                os.set_blocking(stream.fileno(), False)
                selector.register(stream, event)
            if channels:
                selector.register(channels[0], selectors.EVENT_READ)
            pending = memoryview(request_bytes)
            while selector.get_map():
                if cancelled():
                    raise WorkerError("cancelled")
                remaining = timeout - (time.monotonic() - started)
                if remaining <= 0:
                    raise WorkerError("timeout")
                if permits and permits.pending: permits.drain(channels[0])
                for key, _events in selector.select(min(remaining, 0.05)):
                    stream = key.fileobj
                    if stream is process.stdin:
                        try:
                            pending = pending[os.write(stream.fileno(), pending):]
                        except BrokenPipeError:
                            pending = memoryview(b"")
                        if not pending:
                            selector.unregister(stream)
                            stream.close()
                    elif channels and stream is channels[0]:
                        chunk = stream.recv(16384)
                        if not chunk:
                            selector.unregister(stream)
                        else:
                            permits.receive(stream, chunk)
                    else:
                        chunk = os.read(stream.fileno(), 65536)
                        if not chunk:
                            selector.unregister(stream)
                            stream.close()
                        elif stream is process.stdout:
                            stdout.extend(chunk)
                        else:
                            stderr_count += len(chunk)
                        if len(stdout) > output_limit or stderr_count > 65536:
                            raise WorkerError("output_limit")
        while process.poll() is None:
            if cancelled():
                raise WorkerError("cancelled")
            remaining = timeout - (time.monotonic() - started)
            if remaining <= 0:
                raise WorkerError("timeout")
            try:
                process.wait(timeout=min(remaining, 0.05))
            except subprocess.TimeoutExpired:
                continue
        if process.returncode != 0:
            raise WorkerError("worker_failed")
        result = json.loads(stdout, parse_constant=_invalid_constant)
        if isinstance(result, dict):
            failures = item_failures(result.get('data'))
            failed = bool(result.get('error') or result.get('issues') or failures)
            if failed and 'schema_version' not in result: result['diagnostic_id'] = request_id
            diagnostics.emit('worker_failed' if failed else 'worker_completed', level='warning' if failed else 'info',
                request_id=request_id, provider=provider, operation=operation, count=len(failures),
                code=failure_code(result),
                duration_ms=round((time.monotonic() - started) * 1000))
        if permits and permits.denied and isinstance(result, dict):
            result.update(retry_after=permits.denied['retry_after'], limit_origin=permits.denied['origin'])
        return result
    except WorkerError as error:
        diagnostics.emit('worker_failed', level='warning', request_id=request_id, provider=provider,
            operation=operation, code=str(error), duration_ms=round((time.monotonic() - started) * 1000))
        raise
    except subprocess.TimeoutExpired:
        raise WorkerError("timeout") from None
    except (OSError, ValueError, TypeError, RecursionError):
        diagnostics.emit('worker_failed', level='warning', request_id=request_id, provider=provider,
                         operation=operation, code='invalid_response')
        raise WorkerError("invalid_response") from None
    finally:
        if permits:
            permits.close()
        for channel in channels:
            channel.close()
        if process is not None:
            _stop(process)
            for stream in (process.stdin, process.stdout, process.stderr):
                if not stream.closed:
                    stream.close()
