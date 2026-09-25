"""Blocking SEC HTTP reads inside native bounded execution workers.

Only fixed public SEC resources are admitted; no cookies, bearer auth or URLs
from callers. Shared WorkerReads supplies single-flight and bounded memory cache.
"""
from datetime import datetime, timezone
import json
import socket
import time
from threading import Lock
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .identity import DIRECTORY_URL, submissions_url
from .financials import facts_url

MAX_BYTES = 24_000_000


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, url):
        return None


class Transport:
    """WorkerReads transport using stdlib HTTP, without a Python subprocess."""

    def __init__(self, connector, opener=None):
        self.connector = connector
        self.opener = opener or build_opener(NoRedirect())
        self._pacing_lock, self._next_start = Lock(), 0.0

    def _pace(self, cancelled):
        # SEC's 10/second fair-access ceiling is additional to the shared
        # per-minute connection budget. Use 5/second headroom within this host.
        while True:
            if cancelled():
                raise RuntimeError('cancelled')
            with self._pacing_lock:
                delay = self._next_start - time.monotonic()
                if delay <= 0:
                    self._next_start = time.monotonic() + .2
                    return
            time.sleep(min(delay, .05))

    def run_worker(self, _command, request, _environment, *, cancelled, budget, timeout=12):
        from importlib import import_module
        retry_after = import_module(self.connector.__package__ + '.worker_budget').retry_after
        operation = request['operation']
        url = DIRECTORY_URL if operation == 'directory' else submissions_url(request['cik']) if operation == 'submissions' else facts_url(request['cik'])
        req = Request(url, headers={'User-Agent': request['contact'], 'Accept': 'application/json', 'Accept-Encoding': 'identity'})
        started, status = time.monotonic(), None
        try:
            with budget.slot(cancelled):
                if cancelled():
                    raise RuntimeError('cancelled')
                self._pace(cancelled)
                with self.opener.open(req, timeout=min(timeout, 8)) as response:
                    status = response.status
                    content, size = [], 0
                    while True:
                        if cancelled():
                            raise RuntimeError('cancelled')
                        if time.monotonic() - started > timeout:
                            raise TimeoutError('timeout')
                        chunk = response.read(65536)
                        if not chunk:
                            break
                        size += len(chunk)
                        if size > MAX_BYTES:
                            raise RuntimeError('output_limit')
                        content.append(chunk)
                    value = json.loads(b''.join(content))
                    if not isinstance(value, dict):
                        raise ValueError('invalid_response')
                    return {'data': value, 'issues': [], 'observed_at': datetime.now(timezone.utc).isoformat()}
        except HTTPError as error:
            status = error.code
            code = {401: 'authentication_failed', 403: 'access_denied', 404: 'missing_observation', 429: 'rate_limit'}.get(error.code, 'source_unavailable')
            raw = {'error': code, 'data': None, 'issues': [code], 'limit_origin': 'provider'}
            delay = retry_after(error.headers.get('Retry-After'))
            if delay is not None:
                raw['retry_after'] = delay
            raise self.connector.SourceFailure(raw) from None
        except (TimeoutError, socket.timeout):
            raise self.connector.SourceFailure({'error': 'timeout'}) from None
        except URLError:
            raise self.connector.SourceFailure({'error': 'network_error'}) from None
        except (ValueError, UnicodeError):
            raise self.connector.SourceFailure({'error': 'invalid_response'}) from None
        finally:
            self.connector.emit('outbound_completed', provider='sec', operation=operation,
                                http_status=status, duration_ms=round((time.monotonic() - started) * 1000))
