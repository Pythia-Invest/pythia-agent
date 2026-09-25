"""Synthetic public HTTP boundaries using urllib's documented response shape."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from http.client import BadStatusLine, IncompleteRead
import importlib
import io
import os
import ssl
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from test_market_data_identity import PACKAGE

http = importlib.import_module(PACKAGE + '.public_http')
governor = importlib.import_module(PACKAGE + '.governor')
reads_module = importlib.import_module(PACKAGE + '.worker_reads')


class Response(io.BytesIO):
    def __init__(self, content=b'{"value": 3}', *, status=200, headers=None):
        super().__init__(content)
        self.status, self.headers = status, headers or {}


class Opener:
    def __init__(self, factory=Response):
        self.factory, self.calls = factory, []

    def open(self, request, *, timeout):
        self.calls.append((request, timeout))
        return self.factory()


class PublicHttpTests(unittest.TestCase):
    def transport(self, opener=None, **kwargs):
        return http.Transport(provider='synthetic', origins=('https://data.example',),
                              opener=opener or Opener(), **kwargs)

    def read(self, transport, *, budget=None, cancelled=lambda: False, **request):
        return transport.run_worker([], {'operation': 'facts', 'url': 'https://data.example/facts', **request}, {},
                                    budget=budget or governor.Governor(), cancelled=cancelled)

    def test_fixed_https_origins_and_redirects_are_not_followed(self):
        opener = Opener()
        transport = self.transport(opener)
        for url in ('http://data.example/facts', 'https://other.example/facts',
                    'https://data.example.evil/facts', 'https://user@data.example/facts',
                    'https://data.example:444/facts', 'https://data.example/\nfacts',
                    'https://data.example\\@other.example/facts'):
            with self.subTest(url=url), self.assertRaises(reads_module.SourceFailure) as caught:
                self.read(transport, url=url)
            self.assertEqual(caught.exception.raw['error'], 'invalid_request')
        self.assertEqual(opener.calls, [])
        def redirected():
            raise HTTPError('https://data.example/facts', 302, 'secret',
                            {'Location': 'https://other.example/'}, io.BytesIO(b'secret'))
        redirect_opener = Opener(redirected)
        with self.assertRaises(reads_module.SourceFailure) as caught:
            self.read(self.transport(redirect_opener))
        self.assertEqual(caught.exception.raw['error'], 'source_unavailable')
        self.assertEqual(len(redirect_opener.calls), 1)
        self.assertIsNone(http.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://other.example/'))

    def test_tls_uses_native_ca_policy_without_disabling_verification(self):
        context = ssl.create_default_context()
        with patch.dict(os.environ, {}, clear=True), patch.object(http.sys, 'platform', 'darwin'), \
             patch.dict(sys.modules, {'certifi': SimpleNamespace(where=lambda: '/managed/roots.pem')}), \
             patch.object(http.ssl, 'create_default_context', return_value=context) as create:
            configured = http._https_context()
        create.assert_called_once_with(cafile='/managed/roots.pem')
        self.assertTrue(configured.check_hostname)
        self.assertEqual(configured.verify_mode, ssl.CERT_REQUIRED)
        with patch.dict(os.environ, {'HERMES_CA_BUNDLE': '/custom/roots.pem', 'SSL_CERT_FILE': '/other.pem',
                                      'SSL_CERT_DIR': '/custom/certs'}, clear=True), \
             patch.object(http.ssl, 'create_default_context', return_value=context) as create:
            http._https_context()
        create.assert_called_once_with(cafile='/custom/roots.pem', capath='/custom/certs')
        with tempfile.TemporaryDirectory() as directory, \
             patch.dict(os.environ, {'SSL_CERT_FILE': directory + '/missing.pem'}, clear=True):
            with self.assertRaises(OSError):
                http._https_context()

    def test_response_limits_and_malformed_payloads_are_never_successes(self):
        cases = [
            (b'x' * 17, {}, 'output_limit'),
            (b'{}', {'Content-Length': '100'}, 'output_limit'),
            (b'{}', {'Content-Length': '3'}, 'invalid_response'),
            (b'{}', {'Content-Encoding': 'gzip'}, 'invalid_response'),
            (b'{invalid}', {}, 'invalid_response'),
            (b'{"x":NaN}', {}, 'invalid_response'),
            (b'[1e309]', {}, 'invalid_response'),
            (b'\xff', {}, 'invalid_response'),
        ]
        for content, headers, code in cases:
            with self.subTest(code=code, headers=headers):
                response = Response(content, headers=headers)
                budget = governor.Governor()
                with self.assertRaises(reads_module.SourceFailure) as caught:
                    self.read(self.transport(Opener(lambda: response), max_bytes=16), budget=budget)
                self.assertEqual(caught.exception.raw['error'], code)
                self.assertTrue(response.closed)
                self.assertEqual(budget.active, 0)

    def test_malformed_http_and_truncated_chunked_body_are_safe_logged_failures(self):
        for error in (BadStatusLine('PRIVATE'), IncompleteRead(b'PRIVATE', 10)):
            def malformed():
                raise error
            budget = governor.Governor()
            with self.subTest(error=type(error).__name__), self.assertLogs('tools.pythia.connectors', level='WARNING') as logs:
                with self.assertRaises(reads_module.SourceFailure) as caught:
                    self.read(self.transport(Opener(malformed)), budget=budget)
            self.assertEqual(caught.exception.raw['error'], 'invalid_response')
            self.assertNotIn('PRIVATE', str(caught.exception.raw) + str(logs.output))
            self.assertEqual(budget.active, 0)

    def test_network_diagnostics_classify_tls_without_disclosing_host_or_certificate(self):
        def untrusted():
            raise URLError(ssl.SSLCertVerificationError(1, 'PRIVATE host and certificate detail'))
        with self.assertLogs('tools.pythia.connectors', level='WARNING') as logs:
            with self.assertRaises(reads_module.SourceFailure) as caught:
                self.read(self.transport(Opener(untrusted)))
        self.assertEqual(caught.exception.raw['error'], 'network_error')
        self.assertIn('certificate_verify_failed', str(logs.output))
        self.assertNotIn('PRIVATE', str(logs.output) + str(caught.exception.raw))

    def test_rate_limit_preserves_retry_origin_and_budget_cooldown_without_leaking_payload(self):
        def unavailable():
            raise HTTPError('https://data.example/?key=PRIVATE', 429, 'PRIVATE',
                            {'Retry-After': '7'}, io.BytesIO(b'PRIVATE'))
        budget = governor.Governor()
        opener = Opener(unavailable)
        transport = self.transport(opener)
        with self.assertLogs('tools.pythia.connectors', level='WARNING') as logs:
            with self.assertRaises(reads_module.SourceFailure) as caught:
                self.read(transport, budget=budget)
        raw = caught.exception.raw
        self.assertEqual((raw['error'], raw['retry_after'], raw['limit_origin']), ('rate_limit', 7, 'provider'))
        self.assertNotIn('PRIVATE', str(raw) + str(logs.output))
        self.assertIn(raw['diagnostic_id'], str(logs.output))
        with self.assertRaises(reads_module.SourceFailure) as deferred:
            self.read(transport, budget=budget)
        self.assertEqual(deferred.exception.raw['limit_origin'], 'provider')
        self.assertEqual((len(opener.calls), budget.active, budget.metrics['provider_throttles']), (1, 0, 1))

    def test_provider_failures_keep_their_meaning_and_do_not_poison_cache(self):
        for status, code in ((401, 'authentication_failed'), (403, 'access_denied'),
                             (404, 'missing_observation'), (503, 'source_unavailable')):
            attempts = []
            def factory():
                attempts.append(True)
                if len(attempts) == 1:
                    raise HTTPError('https://data.example/facts', status, '', {}, None)
                return Response()
            with self.subTest(status=status):
                reads = reads_module.WorkerReads(self.transport(Opener(factory)))
                request = {'operation': 'facts', 'url': 'https://data.example/facts'}
                budget = governor.Governor()
                with self.assertRaises(reads_module.SourceFailure) as caught:
                    reads.read([__file__], request, {}, age=60, budget=budget)
                self.assertEqual(caught.exception.raw['error'], code)
                self.assertEqual(reads.read([__file__], request, {}, age=60, budget=budget)['data'], {'value': 3})
                self.assertEqual(len(attempts), 2)

    def test_cancel_before_connect_and_during_body_releases_network_and_budget(self):
        cancel = threading.Event()
        cancel.set()
        opener = Opener()
        with self.assertRaises(reads_module.SourceFailure) as caught:
            self.read(self.transport(opener), cancelled=cancel.is_set)
        self.assertEqual(caught.exception.raw['error'], 'cancelled')
        self.assertEqual(len(opener.calls), 0)
        cancel.clear()
        class CancellingResponse(Response):
            def read1(self, size):
                cancel.set()
                return super().read1(size)
        response = CancellingResponse()
        budget = governor.Governor()
        with self.assertRaises(reads_module.SourceFailure) as caught:
            self.read(self.transport(Opener(lambda: response)), budget=budget, cancelled=cancel.is_set)
        self.assertEqual(caught.exception.raw['error'], 'cancelled')
        self.assertTrue(response.closed)
        self.assertEqual(budget.active, 0)

    def test_deadline_includes_queue_and_body_and_wrapped_socket_timeout(self):
        clock = [0]
        class SlowBudget:
            @contextmanager
            def slot(self, cancelled):
                clock[0] = 13
                cancelled()
                yield
        opener = Opener()
        with self.assertRaises(reads_module.SourceFailure) as caught:
            self.read(self.transport(opener, clock=lambda: clock[0]), budget=SlowBudget())
        self.assertEqual(caught.exception.raw['error'], 'timeout')
        self.assertEqual(len(opener.calls), 0)
        clock[0] = 0
        class SlowResponse(Response):
            def read1(self, size):
                clock[0] = 13
                return super().read1(size)
        response, budget = SlowResponse(), governor.Governor()
        with self.assertRaises(reads_module.SourceFailure) as caught:
            self.read(self.transport(Opener(lambda: response), clock=lambda: clock[0]), budget=budget)
        self.assertEqual(caught.exception.raw['error'], 'timeout')
        self.assertTrue(response.closed)
        self.assertEqual(budget.active, 0)
        def timed_out():
            raise URLError(TimeoutError('PRIVATE'))
        with self.assertRaises(reads_module.SourceFailure) as caught:
            self.read(self.transport(Opener(timed_out)))
        self.assertEqual(caught.exception.raw['error'], 'timeout')

    def test_shared_consumers_use_one_outbound_request(self):
        entered, release, second_started = threading.Event(), threading.Event(), threading.Event()
        class WaitingResponse(Response):
            def read1(self, size):
                entered.set()
                if not release.wait(timeout=2):
                    raise TimeoutError('test_barrier')
                return super().read1(size)
        opener, budget = Opener(WaitingResponse), governor.Governor()
        reads = reads_module.WorkerReads(self.transport(opener))
        request = {'operation': 'facts', 'url': 'https://data.example/facts'}
        def read(second=False):
            def cancelled():
                if second:
                    second_started.set()
                return False
            return reads.read([__file__], request, {}, age=0, budget=budget, cancelled=cancelled)
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(read)
            self.assertTrue(entered.wait(timeout=2))
            second = pool.submit(read, True)
            self.assertTrue(second_started.wait(timeout=2))
            release.set()
            self.assertEqual(first.result(timeout=2), second.result(timeout=2))
        self.assertEqual((len(opener.calls), budget.metrics['calls']), (1, 1))

    def test_domain_validation_rejects_bad_success_before_cache_and_projects_once(self):
        bodies = iter((b'{"other": 3}', b'{"value": 3}', b'{"value": 4}'))
        opener, prepared = Opener(lambda: Response(next(bodies))), []
        reads, budget = reads_module.WorkerReads(self.transport(opener)), governor.Governor()
        request = {'operation': 'facts', 'url': 'https://data.example/facts'}
        def prepare(raw):
            prepared.append(True)
            if 'value' not in raw['data']:
                raise reads_module.SourceFailure({'error': 'invalid_response'})
            return {**raw, 'data': {'value': str(raw['data']['value'])}}
        def read(scope):
            return reads.read([__file__], request, {}, age=60, budget=budget,
                              cache_scope=scope, prepare_result=prepare)
        with self.assertRaises(reads_module.SourceFailure) as caught:
            read('synthetic-v1')
        self.assertEqual(caught.exception.raw['error'], 'invalid_response')
        self.assertEqual(read('synthetic-v1')['data'], {'value': '3'})
        self.assertEqual(read('synthetic-v1')['data'], {'value': '3'})
        self.assertEqual((len(opener.calls), len(prepared)), (2, 2))
        self.assertEqual(opener.calls[0][0].get_header('Accept-encoding'), 'identity')
        self.assertEqual(read('synthetic-v2')['data'], {'value': '4'})
        self.assertEqual((len(opener.calls), len(prepared)), (3, 3))


if __name__ == '__main__':
    unittest.main()
