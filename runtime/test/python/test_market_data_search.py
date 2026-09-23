"""Synthetic native candidates test search authority, persistence and concurrency.

Fixtures use the shared v1 reference/evidence contracts, not recorded responses.
IBKR listing fixtures reuse the documented contract-shape fixtures from identity
tests; they establish no new real-provider qualification.
"""
import copy
from concurrent.futures import ThreadPoolExecutor
from importlib import import_module
import tempfile
import sys
from types import ModuleType
from unittest.mock import patch
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
        self.failures = {}
        self.calls = []
        self.hook = None
        self.declarations = {}
        self.ordering = {}
        self.arguments = []
        self.parameters = {}
        self.backend = self.make_backend()

    def row(self, provider, symbol):
        return {'provider_ref': {'provider': provider, 'native_id': symbol, 'native_scope': 'catalogue'},
                'name': 'Synthetic Apple', 'symbol': symbol, 'kind': 'instrument', 'evidence': []}

    def project(self):
        return [{'contribution': {'provider': provider, 'adapter_version': '1', 'subject_kinds': ['instrument', 'listing'],
                                 **({'search': self.declarations[provider]} if provider in self.declarations else {})},
                 'operations': [{'operation': operation, 'available': enabled,
                                 'parameters': self.parameters.get(provider)} for operation in ('search', 'details')]}
                for provider, enabled in sorted(self.enabled.items())], False

    def call(self, provider, operation, arguments):
        self.calls.append((provider, operation))
        self.arguments.append((provider, operation, arguments))
        if self.hook:
            self.hook(provider, operation)
        if provider in self.failures:
            return self.failures[provider]
        rows = copy.deepcopy(self.rows[provider])
        if operation == 'details':
            rows = [row for row in rows if row['provider_ref'] == arguments['native_ref']]
        return {'schema_version': 1, 'outcome': 'ok' if rows else 'empty', 'data': rows, 'issues': [],
                **({'search_ordering': self.ordering[provider]} if provider in self.ordering else {})}

    def test_provider_selection_excludes_calls_and_results(self):
        self.enabled['other'] = True
        self.rows['other'] = [self.row('other', 'APPLE')]
        response = self.backend.handle({'action': 'search_catalogue', 'query': 'apple', 'providers': ['synthetic']})
        self.assertEqual(self.calls, [('synthetic', 'search')])
        self.assertEqual([row['provider'] for row in response['data']['coverage']], ['synthetic'])
        self.assertTrue(all(row['references'][0]['native_ref']['provider'] == 'synthetic' for row in response['data']['results']))
        self.calls.clear()
        response = self.backend.handle({'action': 'search_catalogue', 'query': 'apple', 'providers': []})
        self.assertEqual(self.calls, [])
        self.assertEqual(response['data']['results'], [])

    def test_describe_and_filters_include_unavailable_and_unregistered_retained_sources(self):
        self.adopt()
        self.enabled['removed'] = True
        self.rows['removed'] = [self.row('removed', 'APPLE')]
        self.adopt(self.rows['removed'][0])
        del self.enabled['removed']
        self.enabled['synthetic'] = False
        self.enabled['active'] = True
        self.rows['active'] = []
        self.calls.clear()
        execution = import_module(f'{PACKAGE}.execution')
        session = ModuleType('gateway.session_context')
        session.get_session_env = lambda *args: 'api_server'
        with patch.dict(sys.modules, {'gateway.session_context': session}), patch.object(execution, 'project', self.project):
            description = execution.dispatch({'action': 'describe'}, backend_factory=lambda: self.backend)
        self.assertEqual(description['search_sources'], ['active', 'removed', 'synthetic'])
        self.assertEqual([source['contribution']['provider'] for source in description['sources']], ['active', 'synthetic'])
        self.assertEqual(self.calls, [])
        found = self.search()['data']['results']
        self.assertEqual({row['references'][0]['native_ref']['provider'] for row in found}, {'removed', 'synthetic'})
        self.assertTrue(all(not row['references'][0]['available'] for row in found))
        self.assertEqual(self.calls, [('active', 'search')])
        self.calls.clear()
        included = self.search(providers=['removed'])['data']['results']
        self.assertEqual([row['references'][0]['native_ref']['provider'] for row in included], ['removed'])
        self.assertEqual(self.calls, [])
        self.assertEqual(self.search(providers=['active'])['data']['results'], [])
        self.assertEqual(self.search(providers=[])['data']['results'], [])

    def test_progress_reports_fast_source_before_slow_source_without_changing_ranking(self):
        self.enabled['slow'] = True
        self.rows['slow'] = [self.row('slow', 'APPLE')]
        release, fast_done = threading.Event(), threading.Event()
        self.hook = lambda provider, _operation: release.wait(3) if provider == 'slow' else None
        events = []
        def progress(provider, status, elapsed):
            events.append((provider, status, elapsed))
            if provider == 'synthetic':
                fast_done.set()
        search = import_module(f'{PACKAGE}.search').search
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(search, self.backend, 'apple', 30, None, progress)
            try:
                self.assertTrue(fast_done.wait(2))
                self.assertFalse(pending.done())
                self.assertEqual(events[0][0], 'synthetic')
            finally:
                release.set()
            result = pending.result()
        self.hook = None
        self.assertEqual(result['data']['results'], search(self.backend, 'apple')['data']['results'])
        self.assertEqual({row[0] for row in events}, {'synthetic', 'slow'})

    def test_search_subscription_emits_final_ranked_result(self):
        owner = import_module(f'{PACKAGE}.search_subscription')
        subscription_type = import_module(f'{PACKAGE}.subscriptions').Subscription
        done, events = threading.Event(), []
        def publish(event):
            events.append(event)
            if 'result' in event.get('data', {}):
                done.set()
        lifetime = subscription_type(publish)
        try:
            self.assertEqual(owner.watch_search(self.backend, {'action': 'search_catalogue', 'query': 'apple'}, lifetime)['mode'], 'push')
            self.assertTrue(done.wait(3))
            self.assertEqual(events[-1]['data']['result']['data']['results'][0]['symbol'], 'APPLE')
            self.assertEqual(events[0]['data']['progress'][0]['provider'], 'synthetic')
        finally:
            lifetime.close()

    def test_provider_order_is_preserved_and_large_catalogue_cannot_hide_other_sources(self):
        self.enabled = {'stocks': True, 'tokens': True}
        self.declarations = dict.fromkeys(self.enabled, {'modes': ['text']})
        self.rows = {'stocks': [{**self.row('stocks', 'AAPL'), 'name': 'Apple Inc.'},
                               {**self.row('stocks', 'APPLE'), 'name': 'Obscure Apple Product'}],
                     'tokens': [{**self.row('tokens', f'APPLE{i}'), 'name': 'Apple token'} for i in range(50)]}
        self.ordering = {'stocks': 'relevance', 'tokens': 'prominence'}
        found = self.search(limit=4)['data']['results']
        self.assertIn('AAPL', [row['symbol'] for row in found[:2]])
        stock_rows = [row['symbol'] for row in found if row['references'][0]['native_ref']['provider'] == 'stocks']
        self.assertEqual(stock_rows, ['AAPL', 'APPLE'])

    def test_unspecified_order_uses_names_and_symbols_without_alphabetical_ticker_bias(self):
        self.rows['synthetic'] = [{**self.row('synthetic', 'OTHER'), 'name': 'Other investment'},
                                  {**self.row('synthetic', 'AAPL'), 'name': 'Apple'}]
        self.assertEqual(self.search()['data']['results'][0]['symbol'], 'AAPL')
        ranking = import_module(f'{PACKAGE}.search_ranking')
        self.assertEqual(ranking.relevance('apple', {'symbol': 'APPLE'}),
                         ranking.relevance('apple', {'name': 'Apple'}))

    def test_modes_skip_unsupported_input_without_failure_and_dispatch_one_call(self):
        self.declarations['synthetic'] = {'modes': ['symbol']}
        for query in ('Apple Incorporated', 'US0378331005', 'isin:US0378331005'):
            result = self.search(query=query)
            self.assertEqual(result['outcome'], 'empty')
            self.assertEqual(result['data']['coverage'][0]['status'], 'unsupported')
        self.assertEqual(self.calls, [])
        self.search(query='NVDA')
        self.assertEqual(self.arguments[-1][2], {'query': 'NVDA', 'mode': 'symbol'})
        self.declarations['synthetic'] = {'modes': ['text', 'symbol', 'identifier'], 'identifier_schemes': ['isin']}
        self.search(query='US0378331005')
        self.assertEqual(self.arguments[-1][2], {'query': 'US0378331005', 'mode': 'identifier', 'identifier_scheme': 'isin'})
        self.search(query='Nvidia')
        self.assertEqual(self.arguments[-1][2], {'query': 'Nvidia', 'mode': 'text'})
        self.assertEqual(len(self.calls), 3)
        ranking = import_module(f'{PACKAGE}.search_ranking')
        params = {'properties': {'query': {'maxLength': 12}}}
        self.assertEqual(ranking.arguments('isin:US0378331005', self.declarations['synthetic'], params),
                         {'query': 'US0378331005', 'mode': 'identifier', 'identifier_scheme': 'isin'})
        self.assertIsNone(ranking.arguments('A much longer investment name', self.declarations['synthetic'], params))
        self.assertEqual(ranking.arguments('us0378331005', self.declarations['synthetic'], params),
                         {'query': 'US0378331005', 'mode': 'identifier', 'identifier_scheme': 'isin'})
        self.assertEqual(ranking.arguments('BBG000B9XRY4', {'modes': ['identifier'], 'identifier_schemes': ['figi', 'isin']}),
                         {'query': 'BBG000B9XRY4', 'mode': 'identifier', 'identifier_scheme': 'figi'})

    def test_malformed_source_constraint_does_not_discard_successful_sibling(self):
        self.enabled['broken'] = True
        self.rows['broken'] = []
        self.parameters['broken'] = {'properties': {'query': {'maxLength': 'invalid'}}}
        result = self.search()
        self.assertEqual(result['outcome'], 'partial')
        self.assertEqual(len(result['data']['results']), 1)
        self.assertEqual(result['data']['coverage'][0]['issues'][0]['code'], 'invalid_contribution')
        self.assertNotIn(('broken', 'search'), self.calls)

    def test_adopting_lower_provider_result_does_not_override_source_order(self):
        first = self.rows['synthetic'][0]
        second = {**self.row('synthetic', 'APPLE'), 'name': 'Apple alternate',
                  'provider_ref': self.row('synthetic', 'alternate')['provider_ref']}
        self.rows['synthetic'] = [first, second]
        self.ordering['synthetic'] = 'relevance'
        self.adopt(second)
        self.assertEqual([row['name'] for row in self.search()['data']['results']], ['Synthetic Apple', 'Apple alternate'])

    def test_match_quality_precedes_source_position_without_merging_identity(self):
        self.enabled = {'wide': True, 'narrow': True}
        self.declarations = dict.fromkeys(self.enabled, {'modes': ['text']})
        self.ordering = dict.fromkeys(self.enabled, 'prominence')
        self.rows = {'wide': [{**self.row('wide', 'ALPHABET'), 'name': 'Alphabet soup'},
                             {**self.row('wide', 'ALPHA-B'), 'name': 'Synthetic Class B'}],
                     'narrow': [{**self.row('narrow', 'ALPHAX'), 'name': 'Wrapped Alpha'}]}
        found = self.search(query='ALPHA.B')['data']['results']
        self.assertEqual(found[0]['symbol'], 'ALPHA-B')
        self.assertEqual(len(found), 3)
        self.assertTrue(all(row['identity_status'] == 'unresolved' for row in found))
        self.assertEqual(self.backend.identity.cache_token(), 0)

    def test_whole_words_precede_substrings_and_provider_alias_is_preserved(self):
        self.enabled = {'broad': True, 'catalogue': True}
        self.declarations = dict.fromkeys(self.enabled, {'modes': ['text']})
        self.ordering = {'broad': 'relevance', 'catalogue': 'prominence'}
        self.rows = {'broad': [{**self.row('broad', 'EXACT'), 'name': 'Exchange Index'},
                              {**self.row('broad', 'INDEX'), 'name': 'Alpha Index'}],
                     'catalogue': [{**self.row('catalogue', 'OTHER'), 'name': 'Alphabet'}]}
        found = self.search(query='Alpha')['data']['results']
        self.assertEqual([row['symbol'] for row in found], ['EXACT', 'INDEX', 'OTHER'])

    def test_product_category_is_display_not_identity_scope(self):
        self.rows['synthetic'][0].update(category='etf', kind='listing')
        row = self.search()['data']['results'][0]
        self.assertEqual((row['category'], row['kind']), ('etf', 'listing'))
        self.rows['synthetic'][0]['category'] = 'invented-category'
        result = self.search()
        self.assertEqual(result['data']['results'], [])
        self.assertEqual(result['issues'][0]['code'], 'invalid_candidate')

    def test_retained_search_accepts_punctuation_without_rewriting_reference(self):
        row = {**self.row('synthetic', 'ZZZ-B'), 'category': 'equity'}
        self.rows['synthetic'] = [row]
        self.adopt(row)
        self.enabled['synthetic'] = False
        found = self.search(query='ZZZ.B')['data']['results']
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]['references'][0]['native_ref'], row['provider_ref'])
        self.assertEqual(found[0]['category'], 'equity')

    def test_successful_empty_search_is_not_failure_when_another_source_is_offline(self):
        self.rows['synthetic'] = []
        self.enabled['offline'] = False
        response = self.search(query='No matching instrument')
        self.assertEqual(response['outcome'], 'partial')
        self.assertEqual(response['data']['results'], [])
        self.assertEqual({row['status'] for row in response['data']['coverage']}, {'empty', 'unavailable'})

    def test_fused_group_does_not_gain_votes_from_additional_providers(self):
        ranking = import_module(f'{PACKAGE}.search_ranking')
        one, two = ({'id': name, 'name': 'Apple', 'symbol': name, 'subject': None,
                     'references': [{'native_ref': self.row(name, name)['provider_ref']}]}
                    for name in ('one', 'two'))
        key = lambda row: import_module(f'{PACKAGE}.identity_db').native_key(row['references'][0]['native_ref'])
        order = {'a': [key(one)], 'b': [key(two)]}
        before = ranking.rank('apple', [one, two], order, {}, {'a': 'relevance', 'b': 'relevance'})
        order['c'] = [key(two)]
        self.assertEqual(ranking.rank('apple', [one, two], order, {}, dict.fromkeys(('a', 'b', 'c'), 'relevance')), before)

    def test_grouped_alias_keeps_its_source_match_independent_of_display_label(self):
        ranking = import_module(f'{PACKAGE}.search_ranking')
        references = [{'native_ref': self.row(provider, symbol)['provider_ref'],
                       'name': name, 'symbol': symbol}
                      for provider, name, symbol in (
                          ('first', 'Alpha Corporation', 'ALP'),
                          ('alias', 'Acme', 'ACME'),
                          ('tokens', 'Acme token', 'ACMET'))]
        group = {'id': 'confirmed-group', 'subject': {'kind': 'company', 'id': 'company:synthetic'},
                 'name': 'Alpha Corporation', 'symbol': 'ALP', 'references': references[:2]}
        other = {'id': 'separate-token', 'subject': None, 'name': 'Acme token',
                 'symbol': 'ACMET', 'references': references[2:]}
        order = {ref['native_ref']['provider']: [ranking.native_key(ref['native_ref'])]
                 for ref in references}
        for name, symbol in (('Alpha Corporation', 'ALP'), ('Acme', 'ACME')):
            with self.subTest(display_name=name):
                group.update(name=name, symbol=symbol)
                found = ranking.rank('Acme', [other, group], order,
                                     dict.fromkeys(order, 'text'), dict.fromkeys(order, 'prominence'))
                self.assertEqual([row['id'] for row in found], ['confirmed-group', 'separate-token'])
                self.assertEqual(found[0]['references'], references[:2])

    def test_round_ties_respect_search_semantics_without_connector_specific_rules(self):
        self.enabled = dict.fromkeys(('broad', 'catalogue', 'symbol-only'), True)
        self.declarations = {'broad': {'modes': ['text']}, 'catalogue': {'modes': ['text']},
                             'symbol-only': {'modes': ['symbol']}}
        self.ordering = {'broad': 'relevance', 'catalogue': 'prominence', 'symbol-only': 'prominence'}
        self.rows = {provider: [{**self.row(provider, 'NVDA'), 'name': 'Nvidia product'}]
                     for provider in self.enabled}
        found = self.search(query='NVDA')['data']['results']
        self.assertEqual([row['references'][0]['native_ref']['provider'] for row in found],
                         ['broad', 'catalogue', 'symbol-only'])
        self.rows['broad'][0].update(name='Ethereum USD', symbol='ETH-USD')
        self.rows['catalogue'][0].update(name='Ethereum', symbol='ETH')
        self.rows['symbol-only'][0].update(name='Unrelated token', symbol='ETHEREUM')
        found = self.search(query='Ethereum')['data']['results']
        self.assertEqual([row['references'][0]['native_ref']['provider'] for row in found],
                         ['catalogue', 'broad', 'symbol-only'])

    def test_legacy_undeclared_search_does_not_claim_general_text_relevance(self):
        self.enabled = {'declared': True, 'legacy': True}
        self.declarations = {'declared': {'modes': ['text']}}
        self.ordering = {'declared': 'relevance'}
        self.rows = {'declared': [{**self.row('declared', 'AAPL'), 'name': 'Apple Inc.'}],
                     'legacy': [{**self.row('legacy', 'APPLE'), 'name': 'Unrelated token'}]}
        found = self.search()['data']['results']
        self.assertEqual([row['symbol'] for row in found], ['AAPL', 'APPLE'])

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
        self.failures['other'] = {'schema_version': 1, 'outcome': 'error', 'data': None, 'issues': [retry]}
        response = self.search()
        self.assertEqual(response['outcome'], 'partial')
        self.assertEqual(len(response['data']['results']), 1)
        self.assertEqual(response['data']['coverage'][0]['issues'], [retry])

    def test_confirmed_instruments_stay_separate_by_native_reference(self):
        a, b = native(1), native(2, venue='VENUE_B', currency='EUR')
        self.enabled = {'ibkr': True}
        self.rows = {'ibkr': [{'provider_ref': ref, 'name': 'Synthetic Apple', 'kind': 'instrument',
                              'evidence': evidence(ref, standard=isin(5), version='1')} for ref in (a, b)]}
        for row in self.rows['ibkr']:
            self.adopt(row)
        found = self.search()['data']['results']
        self.assertEqual(len(found), 2)
        self.assertEqual({row['currency'] for row in found}, {'USD', 'EUR'})
        self.assertTrue(all(len(row['references']) == 1 for row in found))

    def qualified_equity(self, provider, symbol, figi='BBG000000001'):
        row = self.row(provider, symbol)
        row.update(kind='listing', currency='USD', venue='SYNTHETIC')
        record = evidence(native(701), version='1')[0]
        row['evidence'] = [{**record, 'id': 'evidence:' + provider + '-' + symbol,
                            'provider_ref': row['provider_ref'], 'scope': 'instrument', 'scheme': 'figi',
                            'value': figi, 'identifier_context': {'authority': 'openfigi', 'level': 'share_class',
                                'security_type': 'Common Stock', 'market_sector': 'Equity',
                                'adapter_version': '1', 'reference_id': figi}}]
        return row

    def test_search_and_selection_never_invoke_external_qualification(self):
        self.enabled = {'first': True, 'second': True}
        a, b = self.qualified_equity('first', 'AAA'), self.qualified_equity('second', 'BBB')
        self.rows = {'first': [a], 'second': [b]}
        def unexpected(*_args, **_kwargs):
            self.fail('Discovery and ordinary selection must not reconcile sources')
        self.backend.qualify_candidates = unexpected
        found = self.search()['data']['results']
        self.assertEqual(len(found), 2)
        self.assertEqual({row['kind'] for row in found}, {'listing'})
        self.assertEqual(set(self.calls), {('first', 'search'), ('second', 'search')})
        saved = self.adopt(a, scope='listing')['data']
        self.assertEqual(saved['binding'], a['provider_ref'])

    def test_group_adoption_revalidates_every_source_and_returns_shared_binding(self):
        self.enabled = {'first': True, 'second': True}
        a, b = self.qualified_equity('first', 'AAA'), self.qualified_equity('second', 'BBB')
        self.rows = {'first': [a], 'second': [b]}
        request = {'action': 'adopt_search', 'native_ref': a['provider_ref'], 'scope': 'instrument',
                   'references': [a['provider_ref'], b['provider_ref']]}
        result = self.backend.handle(request)['data']
        self.assertEqual(result['subject'], result['binding'])
        bindings = self.backend.identity.bindings(result['subject'])['mappings']
        self.assertEqual({row['provider_ref']['provider'] for row in bindings}, {'first', 'second'})
        self.assertEqual(self.calls, [('first', 'details'), ('second', 'details')])
        before = self.backend.identity.cache_token()
        b['evidence'][0]['value'] = 'BBG000000002'
        denied = self.backend.handle(request)
        self.assertEqual(denied['outcome'], 'error')
        self.assertEqual(denied['issues'][-1]['code'], 'identity_not_qualified')
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
        self.assertEqual(backend.handle({**args, 'binding_mode': 'preferred'})['data']['binding'], selected['subject'])
        explicit = backend.handle({**args, 'binding_mode': 'source'})['data']
        self.assertEqual(explicit['binding'], sources.refs['ibkr'])
        self.assertEqual(explicit['subject'], selected['subject'])
        with self.assertRaises(import_module(f'{PACKAGE}.wire').WireError):
            backend.handle({**args, 'binding_mode': 'source', 'references': [sources.refs['ibkr']]})

    def test_adoption_does_not_write_after_qualification_access_change_or_cancellation(self):
        original = self.backend.qualify_candidates
        def change_access(candidates, **kwargs):
            result = original(candidates, **kwargs)
            self.enabled['synthetic'] = False
            return result
        self.backend.qualify_candidates = change_access
        before = self.backend.identity.cache_token()
        result = self.backend.handle({'action': 'resolve_save', 'native_ref': self.rows['synthetic'][0]['provider_ref'], 'scope': 'instrument'})
        self.assertEqual(result['issues'][0]['code'], 'access_changed')
        self.assertEqual(self.backend.identity.cache_token(), before)
        self.enabled['synthetic'] = True
        event = threading.Event()
        def cancel_after_qualification(candidates, **kwargs):
            result = original(candidates, **kwargs)
            event.set()
            return result
        self.backend.qualify_candidates = cancel_after_qualification
        token = context.cancel_signal.set(event.is_set)
        try:
            with self.assertRaises(ReadCancelled):
                self.backend.handle({'action': 'resolve_save', 'native_ref': self.rows['synthetic'][0]['provider_ref'], 'scope': 'instrument'})
        finally:
            context.cancel_signal.reset(token)
        self.assertEqual(self.backend.identity.cache_token(), before)

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
