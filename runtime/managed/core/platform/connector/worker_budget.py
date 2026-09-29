"""Small isolated Python-worker side of the trusted permit pipe."""
from contextlib import contextmanager
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import json
import os
import socket
from urllib.error import HTTPError

_channel, _reader, _sequence = None, None, 0


class BudgetDeferred(RuntimeError):
    def __init__(self, reply):
        code = reply.get('code', 'busy')
        self.raw = {'error': code, 'limit_origin': reply.get('origin', 'connector'),
                    'retry_after': reply.get('retry_after', 1)}
        super().__init__(code)


@contextmanager
def operation_permit(cost=1):
    """Non-HTTP outbound message/RPC boundary. No provider payload is sent."""
    global _channel, _reader, _sequence
    if not os.environ.get('PYTHIA_BUDGET_FD'):
        yield
        return
    if _channel is None:
        _channel = socket.socket(fileno=int(os.environ['PYTHIA_BUDGET_FD']))
        _channel.settimeout(15)
        _reader = _channel.makefile('rb')
    _sequence += 1
    identifier = _sequence
    _channel.sendall(json.dumps({'type': 'acquire', 'id': identifier, 'cost': cost}).encode() + b'\n')
    reply = json.loads(_reader.readline(4096))
    if reply.get('id') != identifier: raise OSError('invalid_permit')
    if not reply.get('allowed'): raise BudgetDeferred(reply)
    try:
        yield
    finally:
        _channel.sendall(json.dumps({'type': 'release', 'id': identifier}).encode() + b'\n')


def retry_after(value):
    try:
        delay = float(value) if value.replace('.', '', 1).isdigit() else (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds()
        return max(0, min(86400, delay))
    except (TypeError, ValueError, AttributeError, OverflowError):
        return None


@contextmanager
def open_budgeted(opener, request, *, timeout=10, cost=1):
    global _channel, _reader, _sequence
    if not os.environ.get('PYTHIA_BUDGET_FD'):
        with opener.open(request, timeout=timeout) as response:
            yield response
        return
    if _channel is None:
        _channel = socket.socket(fileno=int(os.environ['PYTHIA_BUDGET_FD']))
        _channel.settimeout(max(15, timeout))
        _reader = _channel.makefile('rb')
    _sequence += 1
    identifier = _sequence
    _channel.sendall(json.dumps({'type': 'acquire', 'id': identifier, 'cost': cost}).encode() + b'\n')
    reply = json.loads(_reader.readline(4096))
    if reply.get('id') != identifier:
        raise OSError('invalid_permit')
    if not reply.get('allowed'):
        raise BudgetDeferred(reply)
    status, retry, credits = None, None, None
    class Response:
        def __init__(self, raw): self.raw = raw
        def read(self, limit):
            nonlocal credits
            data = self.raw.read(limit)
            try:
                body = json.loads(data)
                value = body.get('status', {}).get('credit_count') if isinstance(body, dict) else None
                if type(value) in (int, float) and 0 <= value <= 10000:
                    credits = value
            except (ValueError, AttributeError, TypeError):
                pass
            return data
        def __getattr__(self, name): return getattr(self.raw, name)
    try:
        with opener.open(request, timeout=timeout) as raw:
            status = getattr(raw, 'status', 200)
            yield Response(raw)
    except HTTPError as error:
        status, retry = error.code, retry_after(error.headers.get('Retry-After'))
        raise
    finally:
        _channel.sendall(json.dumps({'type': 'release', 'id': identifier, 'status': status,
                                     'retry_after': retry, 'credits': credits}).encode() + b'\n')
