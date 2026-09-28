"""Blocking SEC HTTP reads inside native bounded execution workers.

Only fixed public SEC resources are admitted; no cookies, bearer auth or URLs
from callers: a filing document's URL is built from a CIK, an accession number
and a checked document name. Shared WorkerReads supplies single-flight and a
bounded memory cache.
"""
from datetime import datetime, timezone
import json
import socket
import time
from threading import Lock
import zlib
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .identity import DIRECTORY_URL, submissions_page_url, submissions_url
from .financials import facts_url, filing_url

# Decoded-size caps. SEC's JSON APIs stay well below 24 MB; filing documents do not (ASML's 2025 20-F is 24.9 MB of
# HTML), so a document has its own cap and a longer default read time.
JSON_MAX_BYTES = 24_000_000
DOCUMENT_MAX_BYTES = 64_000_000
DOCUMENT_TIMEOUT = 60


def text(body, headers):
    """A document body as text in its declared charset, else UTF-8; undecodable bytes become U+FFFD."""
    charset = headers.get_content_charset() if hasattr(headers, 'get_content_charset') else None
    try:
        return body.decode(charset or 'utf-8', errors='replace')
    except LookupError:
        return body.decode('utf-8', errors='replace')


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

    def run_worker(self, _command, request, _environment, *, cancelled, budget, timeout=None):
        """One SEC read. `document` answers the filing document's text (decoded with its declared charset, else
        UTF-8) and content type; every other operation answers its JSON object."""
        from importlib import import_module
        retry_after = import_module(self.connector.__package__ + '.worker_budget').retry_after
        operation = request['operation']
        document = operation == 'document'
        timeout = timeout or (DOCUMENT_TIMEOUT if document else 12)
        limit = DOCUMENT_MAX_BYTES if document else JSON_MAX_BYTES
        url = (DIRECTORY_URL if operation == 'directory' else submissions_url(request['cik']) if operation == 'submissions'
               else submissions_page_url(request['cik'], request['page']) if operation == 'submissions_page'
               else filing_url(request['cik'], request['accession'], request['document']) if document
               else facts_url(request['cik']))
        req = Request(url, headers={'User-Agent': request['contact'], 'Accept-Encoding': 'gzip',
                                    'Accept': '*/*' if document else 'application/json'})
        started, status = time.monotonic(), None
        try:
            with budget.slot(cancelled):
                if cancelled():
                    raise RuntimeError('cancelled')
                self._pace(cancelled)
                with self.opener.open(req, timeout=min(timeout, 8)) as response:
                    status = response.status
                    # `limit` bounds the decoded size, so a small compressed body cannot expand past it.
                    compressed = (response.headers.get('Content-Encoding') or '').strip().lower() == 'gzip'
                    decoder = zlib.decompressobj(zlib.MAX_WBITS | 16) if compressed else None
                    content, size = [], 0
                    while True:
                        if cancelled():
                            raise RuntimeError('cancelled')
                        if time.monotonic() - started > timeout:
                            raise TimeoutError('timeout')
                        chunk = response.read(65536)
                        if not chunk:
                            break
                        if decoder is not None:
                            chunk = decoder.decompress(chunk, limit + 1 - size)
                        size += len(chunk)
                        if size > limit:
                            raise RuntimeError('output_limit')
                        content.append(chunk)
                    if decoder is not None and not decoder.eof:
                        raise ValueError('invalid_response')
                    if document:
                        return {'data': {'url': url, 'content_type': response.headers.get('Content-Type'), 'bytes': size,
                                         'text': text(b''.join(content), response.headers)},
                                'issues': [], 'observed_at': datetime.now(timezone.utc).isoformat()}
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
        except (ValueError, UnicodeError, zlib.error):
            raise self.connector.SourceFailure({'error': 'invalid_response'}) from None
        finally:
            self.connector.emit('outbound_completed', provider='sec', operation=operation,
                                http_status=status, duration_ms=round((time.monotonic() - started) * 1000))
