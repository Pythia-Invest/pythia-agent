"""Synthetic native candidates test search authority, persistence and concurrency.

Fixtures use the shared v1 reference/evidence contracts, not recorded responses.
IBKR listing fixtures reuse the documented contract-shape fixtures from identity
tests; they establish no new real-provider qualification.
"""
import copy
from concurrent.futures import ThreadPoolExecutor
from importlib import import_module
import tempfile
import threading
import unittest

from test_market_data_identity import PACKAGE, evidence, native, isin

Backend = import_module(f'{PACKAGE}.backend').Backend
context = import_module(f'{PACKAGE}.request_context')
ReadCancelled = import_module(f'{PACKAGE}.cache').ReadCancelled


class SearchTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.rows = {'synthetic': [self.row('synthetic', 'APPLE')]}
        self.enabled = {'synthetic': True}
        self.fail = {}
        self.calls = []
        self.hook = None
        self.backend = self.make_backend()

    def row(self, provider, symbol):
        return {'provider_ref': {'provider': provider, 'native_id': symbol, 'native_scope': 'catalogue'},
                'name': 'Synthetic Apple', 'symbol': symbol, 'kind': 'instrument', 'evidence': []}

    def project(self):
        return [{'contribution': {'provider': provider, 'adapter_version': '1', 'subject_kinds': ['instrument', 'listing']},
                 'operations': [{'operation': operation, 'available': enabled} for operation in ('search', 'details')]}
                for provider, enabled in sorted(self.enabled.items())], False

    def call(self, provider, operation, arguments):
        self.calls.append((provider, operation))
        if self.hook:
            self.hook(provider, operation)
        if provider in self.fail:
            return self.fail[provider]
        rows = copy.deepcopy(self.rows[provider])
        if operation == 'details':
            rows = [row for row in rows if row['provider_ref'] == arguments['native_ref']]
        return {'schema_version': 1, 'outcome': 'ok' if rows else 'empty', 'data': rows, 'issues': []}

    def make_backend(self):
        return Backend(self.directory.name, source_call=self.call, source_projection=self.project,
                       access_scope=lambda: {'platform': 'api_server'})

    def search(self, **kwargs):
        return self.backend.handle({'action': 'search_catalogue', 'query': 'apple', **kwargs})

    def adopt(self, row=None, scope='instrument'):
        row = row or self.rows['synthetic'][0]
        return self.backend.handle({'action': 'adopt_search', 'native_ref': row['provider_ref'], 'scope': scope})

    def test_search_is_read_only_and_unqualified_selection_is_stable(self):
        before = self.backend.identity.cache_token()
        found = self.search()['data']['results'][0]
        self.assertIsNone(found['subject'])
        self.assertEqual(self.backend.identity.cache_token(), before)
        self.assertEqual(self.calls, [('synthetic', 'search')])
        first = self.adopt()['data']
        self.assertEqual(first['identity_status'], 'unresolved')
        self.assertEqual(first['binding'], self.rows['synthetic'][0]['provider_ref'])
        self.backend = self.make_backend()
        second = self.adopt()['data']
        self.assertEqual(first, second)
        self.assertEqual(self.search()['data']['results'][0]['subject'], first['subject'])

    def test_disabled_source_preserves_adopted_identity_without_provider_read(self):
        saved = self.adopt()['data']
        self.enabled['synthetic'] = False
        self.calls.clear()
        response = self.search()
        self.assertEqual(response['data']['results'][0]['subject'], saved['subject'])
        self.assertFalse(response['data']['results'][0]['references'][0]['available'])
        self.assertEqual(self.adopt()['outcome'], 'error')
        self.assertEqual(self.calls, [])

    def test_partial_failure_keeps_success_and_retry_qualification(self):
        self.enabled['other'] = True
        self.rows['other'] = []
        retry = {'code': 'rate_limit', 'message': 'Try later.', 'severity': 'error', 'retry_after_seconds': 12}
        self.fail['other'] = {'schema_version': 1, 'outcome': 'error', 'data': None, 'issues': [retry]}
        response = self.search()
        self.assertEqual(response['outcome'], 'partial')
        self.assertEqual(len(response['data']['results']), 1)
        self.assertEqual(response['data']['coverage'][0]['issues'], [retry])

    def test_shared_isin_does_not_collapse_distinct_listings(self):
        a, b = native(1), native(2, venue='VENUE_B', currency='EUR')
        self.enabled = {'ibkr': True}
        self.rows = {'ibkr': [{'provider_ref': ref, 'name': 'Synthetic Apple', 'kind': 'instrument',
                              'evidence': evidence(ref, standard=isin(5), version='1')} for ref in (a, b)]}
        for row in self.rows['ibkr']:
            self.adopt(row)
        found = self.search()['data']['results']
        self.assertEqual(len(found), 2)
        self.assertEqual(found[0]['subject'], found[1]['subject'])
        self.assertNotEqual(found[0]['currency'], found[1]['currency'])

    def test_fresh_qualified_listing_routes_group_without_persistence(self):
        self.enabled = {'ibkr': True}
        refs = (native(1), native(1, route='DIRECT'))
        self.rows = {'ibkr': [{'provider_ref': ref, 'name': 'Synthetic Apple', 'kind': 'listing',
                              'evidence': evidence(ref, listing=True, version='1')} for ref in refs]}
        before = self.backend.identity.cache_token()
        found = self.search()['data']['results']
        self.assertEqual(len(found), 1)
        self.assertEqual(len(found[0]['references']), 2)
        self.assertIsNone(found[0]['subject'])
        self.assertEqual(self.backend.identity.cache_token(), before)

    def test_identity_change_during_search_cannot_publish_obsolete_group(self):
        fired = False
        def hook(_provider, operation):
            nonlocal fired
            if operation == 'search' and not fired:
                fired = True
                self.adopt()
        self.hook = hook
        response = self.search()
        self.assertEqual(response['outcome'], 'error')
        self.assertEqual(response['data']['results'], [])

    def test_equivalent_concurrent_searches_share_source_work(self):
        entered, release = threading.Event(), threading.Event()
        def hook(_provider, operation):
            if operation == 'search':
                entered.set()
                self.assertTrue(release.wait(3))
        self.hook = hook
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(self.search)
            self.assertTrue(entered.wait(3))
            second = pool.submit(self.search)
            # Wait for the second consumer to attach, rather than sleeping and
            # guessing whether its thread has reached the shared resource.
            import time
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                with self.backend.cache.lock:
                    attached = any(job['consumers'] == 2 for job in self.backend.cache.inflight.values())
                if attached:
                    break
                time.sleep(.005)
            release.set()
            self.assertTrue(attached)
            self.assertEqual(first.result(), second.result())
        self.assertEqual(self.calls.count(('synthetic', 'search')), 1)

    def test_cancelled_search_never_starts_provider_calls(self):
        token = context.cancel_signal.set(lambda: True)
        try:
            with self.assertRaises(ReadCancelled):
                self.search()
        finally:
            context.cancel_signal.reset(token)
        self.assertEqual(self.calls, [])

    def test_details_enrichment_preserves_selected_identity_in_later_search(self):
        original = copy.deepcopy(self.rows['synthetic'][0])
        enriched = copy.deepcopy(original)
        enriched['provider_ref']['qualifiers'] = {'venue': 'VENUE_A', 'currency': 'USD'}
        call = self.backend._call
        def source(provider, operation, arguments):
            if operation == 'details':
                return {'schema_version': 1, 'outcome': 'ok', 'data': [enriched], 'issues': []}
            return call(provider, operation, arguments)
        self.backend._call = source
        saved = self.adopt(original)['data']
        found = self.search()['data']['results']
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]['subject'], saved['subject'])
        self.assertEqual(found[0]['venue'], 'VENUE_A')
        self.assertEqual(self.adopt(original)['data']['subject'], saved['subject'])

    def test_contradictory_duplicate_candidate_is_not_grouping_authority(self):
        self.enabled = {'ibkr': True}
        a, b = native(1), native(1, route='DIRECT')
        first = {'provider_ref': a, 'name': 'Synthetic Apple', 'kind': 'listing',
                 'evidence': evidence(a, listing=True, version='1')}
        contradiction = {**first, 'name': 'Different security'}
        peer = {'provider_ref': b, 'name': 'Synthetic Apple', 'kind': 'listing',
                'evidence': evidence(b, listing=True, version='1')}
        self.rows = {'ibkr': [first, contradiction, peer]}
        response = self.search()
        self.assertEqual(len(response['data']['results']), 2)
        conflict = next(row for row in response['data']['results'] if row['identity_status'] == 'conflicting')
        self.assertIsNone(conflict['name'])
        self.assertEqual(response['outcome'], 'partial')

    def test_large_candidate_set_reports_bounds_without_skipping_sources(self):
        self.rows = {provider: [self.row(provider, f'APPLE{i}') for i in range(10000)] for provider in ('one', 'two')}
        self.enabled = {'one': True, 'two': True}
        response = self.search(limit=100)
        self.assertEqual(len(response['data']['results']), 100)
        self.assertEqual({row['provider'] for row in response['data']['coverage']}, {'one', 'two'})
        self.assertTrue(all(row['truncated'] for row in response['data']['coverage']))
        self.assertTrue(response['data']['truncated'])

    def test_adoption_rejects_scope_invented_by_caller(self):
        with self.assertRaises(ValueError):
            self.adopt(scope='company')
        self.assertEqual(self.backend.identity.cache_token(), 0)

    def test_broker_adoption_keeps_working_native_binding_without_implicit_opt_in(self):
        from market_data_read_fixtures import Sources, request, CRITERIA
        sources = Sources()
        sources.providers = ('ibkr',)
        sources.policies['ibkr'] = {'requires_broker_app': True}
        backend = sources.backend(self.directory.name, canonical=False)
        args = {'action': 'adopt_search', 'native_ref': sources.refs['ibkr'], 'scope': 'instrument'}
        preferences = backend.preferences.get()
        selected = backend.handle(args)['data']
        self.assertEqual(selected['identity_status'], 'confirmed')
        self.assertEqual(selected['binding'], sources.refs['ibkr'])
        read = request({'kind': 'pythia', 'subject': selected['binding']})
        result = backend.handle({'action': 'read', 'request': read, 'criteria': CRITERIA})
        self.assertEqual(result['outcome'], 'ok', result)
        self.assertEqual(backend.preferences.get(), preferences)
        backend.preferences.set('latest', ['ibkr'])
        self.assertEqual(backend.handle(args)['data']['binding'], sources.refs['ibkr'])
        backend.preferences.set('history', ['ibkr'])
        self.assertEqual(backend.handle(args)['data']['binding'], selected['subject'])

    def test_empty_or_ambiguous_details_produce_defined_nonwriting_adoption_failure(self):
        row = self.rows['synthetic'][0]
        for rows in ([], [row, copy.deepcopy(row)]):
            with self.subTest(count=len(rows)):
                self.backend._call = lambda *_args: {'schema_version': 1, 'outcome': 'ok' if rows else 'empty', 'data': rows, 'issues': []}
                response = self.adopt()
                self.assertEqual(response['outcome'], 'error')
                self.assertIsNone(response['data'])
                self.assertNotIn('effect', response)
                self.assertEqual(response['issues'][-1]['code'], 'identity_not_selected')
                if rows:
                    self.assertEqual(response['issues'][0]['code'], 'ambiguous_identity')
                self.assertEqual(self.backend.identity.cache_token(), 0)
