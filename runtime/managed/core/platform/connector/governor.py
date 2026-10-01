"""Connection-scoped outbound accounting, separate from HTTP admission.

Short concurrency bursts use a bounded FIFO. Quota deferrals return a retry
deadline; the demand coordinator reschedules, without changing the source.
Counters are local to this gateway, not an account-wide quota guarantee.
"""
from collections import OrderedDict, deque
import hashlib
import json
import math
import threading
import time
import re
from contextlib import contextmanager
from . import diagnostics


class Governor:
    def __init__(self, *, concurrency=4, per_minute=60, credits_per_minute=None, clock=time.monotonic):
        self.concurrency, self.per_minute = concurrency, per_minute
        self.credit_limit, self.clock = credits_per_minute, clock
        self.lock, self.recent = threading.RLock(), deque()
        self.active, self.cooldown = 0, 0
        self.waiters = deque()
        self.provider = 'connector'
        self.metrics = {'calls': 0, 'estimated_credits': 0, 'reported_credits': 0, 'denied': 0, 'provider_throttles': 0}

    @contextmanager
    def slot(self, cancelled=lambda: False):
        """In-process blocking adapter; call only from a native execution worker."""
        from .worker_budget import BudgetDeferred
        ticket = self.request()
        report = {}
        try:
            while ticket['reply'] is None:
                if cancelled(): raise RuntimeError('cancelled')
                threading.Event().wait(.05)
                self.service()
            if not ticket['reply']['allowed']: raise BudgetDeferred(ticket['reply'])
            yield
        except Exception as error:
            from .worker_budget import retry_after
            report = {'status': getattr(error, 'code', None),
                      'retry_after': retry_after((getattr(error, 'headers', None) or {}).get('Retry-After'))}
            raise
        finally: self.cancel(ticket, **report)

    def request(self, cost=1):
        """FIFO concurrency admission; quota/cooldown never waits in this queue."""
        if type(cost) not in (int, float) or not 0 <= cost <= 10000:
            raise ValueError('invalid_cost')
        with self.lock:
            ticket = {'cost': cost, 'created': self.clock(), 'reply': None, 'cancelled': False}
            if len(self.waiters) >= 64:
                ticket['reply'] = {'allowed': False, 'code': 'busy', 'origin': 'connector', 'retry_after': 1}
            else:
                self.waiters.append(ticket)
                self.service()
            return ticket

    def service(self):
        with self.lock:
            while self.waiters:
                ticket = self.waiters[0]
                if ticket['cancelled']:
                    self.waiters.popleft()
                    continue
                if self.clock() - ticket['created'] >= 10:
                    ticket['reply'] = {'allowed': False, 'code': 'busy', 'origin': 'connector', 'retry_after': 1}
                elif self.active >= self.concurrency:
                    break
                else:
                    ticket['reply'] = self.acquire(ticket['cost'])
                    if not ticket['reply']['allowed']: ticket['reply']['code'] = 'rate_limit'
                self.waiters.popleft()

    def cancel(self, ticket, **report):
        with self.lock:
            if ticket['cancelled']: return
            ticket['cancelled'] = True
            if (ticket.get('reply') or {}).get('allowed'):
                self.release(**report)
            self.service()

    def acquire(self, cost=1):
        if type(cost) not in (int, float) or not 0 <= cost <= 10000:
            raise ValueError('invalid_cost')
        with self.lock:
            now = self.clock()
            while self.recent and self.recent[0][0] <= now - 60:
                self.recent.popleft()
            delay = max(0, self.cooldown - now)
            if self.active >= self.concurrency:
                delay = max(delay, 1)
            if len(self.recent) >= self.per_minute or (self.credit_limit and sum(item[1] for item in self.recent) + cost > self.credit_limit):
                delay = max(delay, (self.recent[0][0] + 60 - now) if self.recent else 60)
            if delay:
                self.metrics['denied'] += 1
                return {'allowed': False, 'retry_after': math.ceil(delay), 'origin': 'provider' if self.cooldown > now else 'connector'}
            self.active += 1
            self.recent.append((now, cost))
            self.metrics['calls'] += 1
            self.metrics['estimated_credits'] += cost
            return {'allowed': True}

    def release(self, *, status=None, retry_after=None, credits=None, remaining=None):
        with self.lock:
            self.active = max(0, self.active - 1)
            if type(credits) in (int, float) and 0 <= credits <= 10000:
                self.metrics['reported_credits'] += credits
            if status == 429:
                delay = retry_after if type(retry_after) in (int, float) and 0 <= retry_after <= 86400 else 60
                self.cooldown = max(self.cooldown, self.clock() + delay)
                self.metrics['provider_throttles'] += 1
            if remaining == 0:
                self.cooldown = max(self.cooldown, self.clock() + 60)
            self.service()


_owners, _lock = OrderedDict(), threading.RLock()


def connection(provider, credential=None, *, concurrency=4, per_minute=60, credits_per_minute=None):
    """Only connector code supplies policy and identity; no credentials retained."""
    if type(concurrency) is not int or not 1 <= concurrency <= 16 or type(per_minute) is not int or not 1 <= per_minute <= 10000:
        raise ValueError('invalid_budget')
    if credits_per_minute is not None and (type(credits_per_minute) not in (int, float) or not math.isfinite(credits_per_minute) or not 1 <= credits_per_minute <= 1_000_000):
        raise ValueError('invalid_budget')
    policy = {'concurrency': concurrency, 'per_minute': per_minute, 'credits_per_minute': credits_per_minute}
    key = hashlib.sha256(json.dumps([provider, credential], sort_keys=True).encode()).hexdigest()
    with _lock:
        if key not in _owners:
            for candidate, owner in list(_owners.items()):
                if len(_owners) < 32:
                    break
                if owner.active == 0 and owner.cooldown <= owner.clock() and (not owner.recent or owner.recent[-1][0] <= owner.clock() - 60):
                    del _owners[candidate]
            if len(_owners) >= 32:
                raise RuntimeError('rate_limit')
            _owners[key] = Governor(**policy)
            _owners[key].provider = provider
        else:
            with _owners[key].lock:
                _owners[key].concurrency = concurrency
                _owners[key].per_minute = per_minute
                _owners[key].credit_limit = credits_per_minute
        _owners.move_to_end(key)
        return _owners[key]


class PermitChannel:
    """Bounded child messages contain costs/status only, never URLs or keys."""
    def __init__(self, governor, request_id=None):
        self.governor, self.leases, self.buffer = governor, set(), bytearray()
        self.pending, self.started = {}, {}
        self.identifiers = {}
        self.request_id = request_id or diagnostics.identifier()
        self.denied = None

    def receive(self, channel, chunk):
        self.buffer.extend(chunk)
        if len(self.buffer) > 16384:
            raise ValueError('permit_limit')
        while b'\n' in self.buffer:
            line, _, rest = self.buffer.partition(b'\n')
            self.buffer = bytearray(rest)
            message = json.loads(line)
            identifier = message['id']
            if type(identifier) is not int or not 0 <= identifier <= 1_000_000:
                raise ValueError('invalid_permit')
            if message['type'] == 'acquire':
                if identifier in self.leases or identifier in self.pending or len(self.leases) + len(self.pending) >= 16:
                    raise ValueError('invalid_permit')
                self.pending[identifier] = self.governor.request(message.get('cost', 1))
                diagnostic = message.get('request_id')
                self.identifiers[identifier] = diagnostic if isinstance(diagnostic, str) and re.fullmatch(r'[a-f0-9]{16}', diagnostic) else self.request_id
            elif message['type'] == 'release' and identifier in self.leases:
                self.leases.remove(identifier)
                self.governor.release(status=message.get('status'), retry_after=message.get('retry_after'), credits=message.get('credits'), remaining=message.get('remaining'))
                diagnostics.emit('outbound_completed', level='warning' if (message.get('status') or 0) >= 400 else 'info',
                    provider=self.governor.provider, request_id=self.identifiers.pop(identifier, self.request_id), http_status=message.get('status'),
                    duration_ms=round((time.monotonic() - self.started.pop(identifier, time.monotonic())) * 1000))
            else:
                raise ValueError('invalid_permit')
        self.drain(channel)

    def drain(self, channel):
        self.governor.service()
        for identifier, ticket in list(self.pending.items()):
            reply = ticket['reply']
            if reply is None: continue
            del self.pending[identifier]
            wait = round((self.governor.clock() - ticket['created']) * 1000)
            if reply['allowed']:
                self.leases.add(identifier)
                self.started[identifier] = time.monotonic()
            else:
                self.denied = reply
            diagnostics.emit('outbound_admitted' if reply['allowed'] else 'outbound_deferred',
                level='info' if reply['allowed'] else 'warning', provider=self.governor.provider,
                request_id=self.identifiers.get(identifier, self.request_id), wait_ms=wait, code=reply.get('code'), origin=reply.get('origin'))
            if not reply['allowed']: self.identifiers.pop(identifier, None)
            channel.sendall(json.dumps({'id': identifier, **reply}).encode() + b'\n')

    def close(self):
        for ticket in self.pending.values(): self.governor.cancel(ticket)
        self.pending.clear()
        for _ in self.leases:
            self.governor.release()
        self.leases.clear()
