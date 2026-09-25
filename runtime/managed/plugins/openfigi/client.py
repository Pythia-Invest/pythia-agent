"""In-process OpenFIGI mapping transport under the shared connection budget.

The optional API key stays in this process: it is sent only as the documented
request header and is never logged, cached in clear or passed to a subprocess.
"""
from collections import deque
from datetime import datetime, timezone
import json
import math
import socket
import time
from threading import Lock
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from . import mapping

MAX_BYTES = 8_000_000
STATUS = {400: 'invalid_request', 401: 'authentication_failed', 403: 'access_denied', 413: 'invalid_request', 429: 'rate_limit'}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, url):
        return None


class Transport:
    """WorkerReads transport: splits jobs by the documented per-request size."""

    def __init__(self, connector, opener=None, clock=time.monotonic):
        self.connector, self.clock = connector, clock
        self.opener = opener or build_opener(NoRedirect())
        self._lock = Lock()
        self._starts = {False: deque(), True: deque()}

    def _pace(self, keyed, cancelled, deadline):
        # Request starts per documented window, in addition to the per-minute budget.
        limit = mapping.LIMITS[keyed]
        while True:
            if cancelled():
                raise RuntimeError('cancelled')
            with self._lock:
                now, starts = self.clock(), self._starts[keyed]
                while starts and starts[0] <= now - limit['window']:
                    starts.popleft()
                if len(starts) < limit['requests']:
                    starts.append(now)
                    return
                delay = starts[0] + limit['window'] - now
            if now + delay > deadline:
                raise self.connector.SourceFailure({'error': 'rate_limit', 'limit_origin': 'connector',
                                                    'retry_after': math.ceil(delay)})
            time.sleep(min(delay, .05))

    def _post(self, jobs, key, *, cancelled, budget, deadline):
        from importlib import import_module
        retry_after = import_module(self.connector.__package__ + '.worker_budget').retry_after
        headers = {'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'Pythia-OpenFIGI/1'}
        if key:
            headers['X-OPENFIGI-APIKEY'] = key
        request = Request(mapping.URL, data=json.dumps(jobs).encode(), headers=headers, method='POST')
        started, status = self.clock(), None
        try:
            with budget.slot(cancelled):
                self._pace(bool(key), cancelled, deadline)
                remaining = deadline - self.clock()
                if remaining <= 0:
                    raise TimeoutError('timeout')
                with self.opener.open(request, timeout=min(remaining, 15)) as response:
                    status, content, size = response.status, [], 0
                    while chunk := response.read(65536):
                        if cancelled():
                            raise RuntimeError('cancelled')
                        size += len(chunk)
                        if size > MAX_BYTES:
                            raise RuntimeError('output_limit')
                        content.append(chunk)
            return mapping.rows(json.loads(b''.join(content)), len(jobs))
        except HTTPError as error:
            status = error.code
            raw = {'error': STATUS.get(error.code, 'source_unavailable'), 'http_status': error.code}
            if error.code == 429:
                raw['limit_origin'] = 'provider'
            for header in ('Retry-After', 'ratelimit-reset'):
                delay = retry_after((error.headers or {}).get(header))
                if delay is not None:
                    raw['retry_after'] = delay
                    break
            error.close()
            raise self.connector.SourceFailure(raw) from None
        except (TimeoutError, socket.timeout):
            raise self.connector.SourceFailure({'error': 'timeout'}) from None
        except URLError:
            raise self.connector.SourceFailure({'error': 'network_error'}) from None
        except (ValueError, UnicodeError):
            raise self.connector.SourceFailure({'error': 'invalid_response'}) from None
        finally:
            self.connector.emit('outbound_completed', provider='openfigi', operation='mapping',
                                http_status=status, duration_ms=round((self.clock() - started) * 1000))

    def run_worker(self, _command, request, _environment, *, cancelled, budget, timeout=30):
        jobs, key = mapping.validate(request['jobs']), request.get('key')
        deadline, results, issues, raw = self.clock() + timeout, [], [], {}
        for batch in mapping.batches(jobs, bool(key)):
            try:
                answers = self._post(batch, key, cancelled=cancelled, budget=budget, deadline=deadline)
            except RuntimeError as error:
                if not results:
                    raise
                # Keep completed batches; report the rest as not attempted.
                raw = getattr(error, 'raw', None) or {'error': str(error)}
                issues.append(raw.get('error') or 'source_unavailable')
                results.extend({'job': job, 'outcome': 'not_attempted', 'candidates': []} for job in jobs[len(results):])
                break
            results.extend(mapping.result(job, row) for job, row in zip(batch, answers))
        if any(row['outcome'] == 'error' for row in results):
            issues.append('provider_error')  # Not retained: the next read retries.
        return {'data': {'provider': 'openfigi', 'source_url': mapping.URL, 'results': results},
                'issues': issues, 'observed_at': datetime.now(timezone.utc).isoformat(),
                **{name: raw[name] for name in ('retry_after', 'limit_origin') if name in raw}}
