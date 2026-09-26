"""Bounded public GET transport for native connector execution workers.

Connectors build URLs from their validated domain arguments and fixed endpoints;
this is not a public arbitrary-URL operation. WorkerReads supplies coordination
and caching, and its caller remains responsible for native access checks.

The synchronous socket timeout bounds blocking network operations. Cancellation
and the total deadline are checked between them; DNS resolution remains subject
to the operating system resolver. No extra event loop, worker or queue is added.
"""
from datetime import datetime, timezone
from http.client import HTTPException
import json
import math
import os
from pathlib import Path
import socket
import ssl
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener

from . import diagnostics
from .worker_budget import BudgetDeferred, retry_after
from .worker_reads import SourceFailure


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, url):
        return None


def _origin(url):
    if not isinstance(url, str) or len(url) > 8192 or any(ord(char) <= 32 for char in url) or '\\' in url:
        raise ValueError('invalid_request')
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username is not None or parsed.password is not None or parsed.fragment:
        raise ValueError('invalid_request')
    if parsed.port not in (None, 443):
        raise ValueError('invalid_request')
    return f'https://{parsed.hostname.lower()}'


def _size(value, maximum):
    if type(value) is not int or not 1 <= value <= maximum:
        raise ValueError('invalid_request')
    return value


def _https_context(provider=None):
    """Verified trust matching pinned Hermes urllib policy, without redirects.

    Hermes already depends on certifi and uses it on macOS, where a Python
    OpenSSL trust path need not contain the current system Keychain roots.
    Explicit deployment trust wins; a broken explicit store fails closed.
    """
    bundle = next((os.environ[key].strip() for key in
                   ('HERMES_CA_BUNDLE', 'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE')
                   if os.environ.get(key, '').strip()), None)
    directory = os.environ.get('SSL_CERT_DIR', '').strip() or None
    if bundle or directory:
        context = ssl.create_default_context(cafile=str(Path(bundle).expanduser()) if bundle else None,
                                             capath=str(Path(directory).expanduser()) if directory else None)
        policy = 'explicit_bundle' if bundle else 'explicit_directory'
    elif sys.platform == 'darwin':
        import certifi
        context, policy = ssl.create_default_context(cafile=certifi.where()), 'certifi'
    else:
        context, policy = ssl.create_default_context(), 'system'
    diagnostics.emit('tls_context_ready', provider=provider, code=policy, count=context.cert_store_stats()['x509_ca'])
    return context


class Transport:
    """WorkerReads-compatible JSON GETs, with explicitly approved origins.

    Headers and the response size bound are connector policy, never forwarded
    user input. The injectable opener has urllib's ``open(Request, timeout=...)``
    interface.
    """

    def __init__(self, *, provider, origins, headers=None, max_bytes=8_000_000,
                 socket_timeout=3, opener=None, clock=time.monotonic):
        if not origins or isinstance(origins, str):
            raise ValueError('invalid_origins')
        self.origins = frozenset(_origin(origin) for origin in origins)
        for origin in origins:
            parsed = urlsplit(origin)
            if parsed.path not in ('', '/') or parsed.query:
                raise ValueError('invalid_origins')
        self.max_bytes = _size(max_bytes, 32_000_000)
        if type(socket_timeout) not in (int, float) or not math.isfinite(socket_timeout) or not 0 < socket_timeout <= 5:
            raise ValueError('invalid_socket_timeout')
        self.provider, self.socket_timeout, self.clock = provider, socket_timeout, clock
        self.headers = {'User-Agent': 'Pythia investment research', **(headers or {})}
        if any(not isinstance(key, str) or not isinstance(value, str) or
               any(char in key + value for char in '\r\n') for key, value in self.headers.items()):
            raise ValueError('invalid_headers')
        # Trust is resolved on first use: a broken CA configuration fails reads
        # with a diagnostic instead of failing plugin registration.
        self.opener = opener

    def _request(self, request):
        url = request.get('url')
        if _origin(url) not in self.origins:
            raise ValueError('invalid_request')
        headers = {'Accept': 'application/json', **self.headers, 'Accept-Encoding': 'identity'}
        return Request(url, headers=headers, method='GET')

    def run_worker(self, _command, request, _environment, *, cancelled, budget, timeout=12):
        started, status, code = self.clock(), None, None
        reference = diagnostics.identifier()

        def check():
            if cancelled():
                raise SourceFailure({'error': 'cancelled'})
            if self.clock() - started >= timeout:
                raise TimeoutError('timeout')

        try:
            if type(timeout) not in (int, float) or not math.isfinite(timeout) or not 0 < timeout <= 120:
                raise ValueError('invalid_request')
            req = self._request(request)
            if self.opener is None:
                self.opener = build_opener(HTTPSHandler(context=_https_context(self.provider)), NoRedirect())
            check()
            with budget.slot(check):
                check()
                with self.opener.open(req, timeout=min(self.socket_timeout, timeout - (self.clock() - started))) as response:
                    status = response.status
                    # urllib raises for error statuses. Enforce that property
                    # for custom openers too, and let the budget see the status.
                    if not 200 <= status < 300:
                        raise HTTPError(req.full_url, status, '', response.headers, None)
                    if status == 204:
                        raise SourceFailure({'error': 'missing_observation'})
                    content = self._content(response, self.max_bytes, check)
                check()
                try:
                    data = self._parse(content)
                except (ValueError, UnicodeError, RecursionError):
                    raise SourceFailure({'error': 'invalid_response'}) from None
                check()
                return {'data': data, 'issues': [], 'http_status': status,
                        'observed_at': datetime.now(timezone.utc).isoformat()}
        except HTTPError as error:
            status = error.code
            code = {400: 'invalid_request', 401: 'authentication_failed', 403: 'access_denied',
                    404: 'missing_observation', 408: 'timeout', 422: 'invalid_request',
                    429: 'rate_limit', 504: 'timeout'}.get(status, 'source_unavailable')
            raw = {'error': code, 'limit_origin': 'provider'}
            delay = retry_after((error.headers or {}).get('Retry-After'))
            if delay is not None:
                raw['retry_after'] = delay
            error.close()
            raise self._failure(raw, reference) from None
        except BudgetDeferred as error:
            code = error.raw['error']
            raise self._failure(error.raw, reference) from None
        except SourceFailure as error:
            code = error.raw['error']
            raise self._failure(error.raw, reference) from None
        except HTTPException:
            code = 'invalid_response'
            raise self._failure({'error': code}, reference) from None
        except (TimeoutError, URLError, OSError) as error:
            reason = getattr(error, 'reason', error)
            code = 'timeout' if isinstance(reason, TimeoutError) else 'network_error'
            detail = ('certificate_verify_failed' if isinstance(reason, ssl.SSLCertVerificationError) else
                      'tls_error' if isinstance(reason, ssl.SSLError) else
                      'dns_error' if isinstance(reason, socket.gaierror) else
                      'connection_reset' if isinstance(reason, ConnectionResetError) else code)
            diagnostics.emit('outbound_network_failed', level='warning', provider=self.provider,
                             operation=request.get('operation'), request_id=reference, code=detail)
            raise self._failure({'error': code}, reference) from None
        except (ValueError, TypeError, AttributeError):
            code = 'invalid_request'
            raise self._failure({'error': code}, reference) from None
        except RuntimeError as error:
            # Governor cancellation is intentionally a small, fixed vocabulary.
            code = 'cancelled' if str(error) == 'cancelled' else 'source_unavailable'
            raise self._failure({'error': code}, reference) from None
        finally:
            diagnostics.emit('outbound_completed', level='warning' if code else 'info',
                             provider=self.provider, operation=request.get('operation'),
                             request_id=reference, http_status=status, code=code,
                             duration_ms=round((self.clock() - started) * 1000))

    @staticmethod
    def _failure(raw, reference):
        return SourceFailure({**raw, 'diagnostic_id': reference})

    @staticmethod
    def _content(response, limit, check):
        headers = response.headers or {}
        if headers.get('Content-Encoding', 'identity').lower() != 'identity':
            raise SourceFailure({'error': 'invalid_response'})
        length = headers.get('Content-Length')
        expected = None
        if length is not None:
            try:
                expected = int(length)
                if expected < 0:
                    raise ValueError('invalid_length')
            except (ValueError, TypeError):
                raise SourceFailure({'error': 'invalid_response'}) from None
            if expected > limit:
                raise SourceFailure({'error': 'output_limit'})
        chunks, size = [], 0
        # read1 avoids waiting to fill a large chunk while a server slowly
        # drips bytes; it returns after at most one underlying read.
        read = getattr(response, 'read1', response.read)
        while True:
            check()
            chunk = read(min(65536, limit - size + 1))
            check()
            if not chunk:
                break
            size += len(chunk)
            if size > limit:
                raise SourceFailure({'error': 'output_limit'})
            chunks.append(chunk)
        if expected is not None and size != expected:
            raise SourceFailure({'error': 'invalid_response'})
        return b''.join(chunks)

    @staticmethod
    def _parse(content):
        def invalid_constant(_value):
            raise ValueError('invalid_json')
        def finite_number(value):
            number = float(value)
            if not math.isfinite(number):
                raise ValueError('invalid_json')
            return number
        return json.loads(content.decode('utf-8-sig'), parse_constant=invalid_constant, parse_float=finite_number)
