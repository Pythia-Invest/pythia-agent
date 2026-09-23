"""Synthetic OpenFIGI v3 mapping shapes exercise optional reference boundaries."""
import copy
from importlib import import_module
import tempfile
import unittest

from test_market_data_identity import PACKAGE

Backend = import_module(f'{PACKAGE}.backend').Backend
qualify = import_module(f'{PACKAGE}.identity_resolution').qualify_candidates
validate = import_module(f'{PACKAGE}.wire').validate


class ResolutionTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.enabled = True
        self.sources_enabled = True
        self.calls = []
        self.hook = None
        self.reference_version = '2'
        self.details_row = None
        self.record = {'ticker': 'SYN', 'figi': 'BBG000000001', 'compositeFIGI': 'BBG000000002',
                       'shareClassFIGI': 'BBG000000003', 'marketSector': 'Equity', 'securityType': 'Common Stock', 'exchCode': 'UW'}
        self.backend = Backend(directory.name, source_call=self.call, source_projection=self.project,
                               access_scope=lambda: {'cacheable': True})

    def project(self):
        return [{'contribution': {'provider': provider, 'adapter_version': self.reference_version if provider == 'openfigi' else '2'},
                 'operations': [{'operation': operation, 'available': self.enabled if provider == 'openfigi' else self.sources_enabled}
                                for operation in operations]}
                for provider, operations in [('yahoo', ['details']), ('eodhd', ['identifiers', 'details']), ('openfigi', ['identify'])]], False

    def call(self, provider, operation, arguments):
        self.calls.append((provider, arguments))
        if self.hook:
            self.hook()
        if operation == 'details':
            data = [copy.deepcopy(self.details_row)]
        elif provider == 'eodhd':
            data = {'complete': True, 'records': [{'symbol': arguments['native_ref']['native_id'], 'figi': 'BBG000000002'}]}
        else:
            data = [{'data': [dict(self.record)]} for _ in arguments['jobs']]
        return {'outcome': 'ok', 'data': data}

    def row(self, provider='yahoo', symbol='SYN'):
        native = {'provider': provider, 'native_scope': 'symbol' if provider == 'yahoo' else 'catalogue',
                  'native_id': symbol, 'qualifiers': {'venue': 'NMS'}}
        return {'provider_ref': native, 'category': 'equity', 'evidence': []}

    def resolve_then_adopt(self):
        row = self.row()
        row['kind'] = 'instrument'
        row['evidence'] = [{
            'schema_version': 1, 'id': 'evidence:source-original',
            'provider_ref': row['provider_ref'], 'scope': 'instrument',
            'scheme': 'native', 'value': row['provider_ref']['native_id'],
            'qualifiers': {'share_class': 'ordinary'}, 'authority': 'source_asserted',
            'adapter_version': '2', 'observed_at': None,
            'retrieved_at': '2026-01-05T12:00:00Z', 'effective': {'start': None, 'end': None},
        }]
        self.details_row = row
        request = {'native_ref': row['provider_ref'], 'scope': 'instrument'}
        saved = self.backend.handle({'action': 'resolve_save', **request})['data']
        self.assertEqual(saved['mapping']['status'], 'confirmed')
        self.assertEqual(len(saved['evidence']), 2)
        self.calls.clear()
        return request, saved

    def test_ordinary_adoption_preserves_prior_qualification_without_reference_calls(self):
        request, saved = self.resolve_then_adopt()
        # A new observation of the same assertions must not erase separate proof.
        self.details_row['evidence'][0].update(id='evidence:source-later', retrieved_at='2026-01-06T12:00:00Z')
        adopted = self.backend.handle({'action': 'adopt_search', **request})['data']
        self.assertEqual(adopted['identity_status'], 'confirmed')
        self.assertEqual(adopted['subject'], saved['intent_subject'])
        self.assertEqual(adopted['binding'], request['native_ref'])
        current = self.backend.identity.inspect(saved['mapping']['id'])
        self.assertEqual(current['evidence'][0]['id'], 'evidence:source-later')
        self.assertEqual(current['evidence'][1], saved['evidence'][1])
        self.assertEqual(self.calls, [('yahoo', {'native_ref': request['native_ref']})])

    def test_ordinary_adoption_does_not_preserve_proof_across_changed_source_assertions(self):
        request, saved = self.resolve_then_adopt()
        self.details_row['evidence'][0].update(id='evidence:source-changed', value='OTHER')
        adopted = self.backend.handle({'action': 'adopt_search', **request})['data']
        self.assertEqual(adopted['identity_status'], 'conflicting')
        self.assertEqual(self.backend.identity.bindings(saved['intent_subject'])['mappings'], [])
        self.assertEqual(self.calls, [('yahoo', {'native_ref': request['native_ref']})])

    def test_ordinary_adoption_keeps_reference_version_repair_pending(self):
        request, saved = self.resolve_then_adopt()
        self.reference_version = '3'
        adopted = self.backend.handle({'action': 'adopt_search', **request})['data']
        self.assertEqual(adopted['identity_status'], 'unresolved')
        current = self.backend.identity.inspect(saved['mapping']['id'])
        self.assertEqual(current['repair'], 'pending_evidence_refresh')
        self.assertEqual(current['evidence'], saved['evidence'])
        self.assertEqual(self.backend.identity.bindings(saved['intent_subject'])['mappings'], [])
        self.assertEqual(self.calls, [('yahoo', {'native_ref': request['native_ref']})])

    def test_same_share_class_proof_preserves_native_refs_and_cache(self):
        rows = [self.row(), self.row('eodhd', 'SYN.US')]
        result = qualify(self.backend, rows)
        for row in result:
            validate('evidence', row['evidence'][0])
        self.assertEqual([row['evidence'][0]['value'] for row in result], ['BBG000000003'] * 2)
        self.assertEqual([row['provider_ref'] for row in result], [row['provider_ref'] for row in rows])
        self.assertEqual(rows[0]['evidence'], [])
        qualify(self.backend, [rows[0]])  # Different batch reuses individual reference.
        self.assertEqual(len(self.calls), 2)
        self.enabled = False
        self.assertEqual(qualify(self.backend, rows), rows)

    def test_wrong_security_or_ticker_and_ambiguous_responses_do_not_prove_identity(self):
        self.record['securityType'] = 'Depositary Receipt'
        self.assertFalse(qualify(self.backend, [self.row()])[0]['evidence'])
        self.backend.metadata_cache.clear()
        self.record['securityType'] = 'Common Stock'
        self.record['ticker'] = 'OTHER'
        self.assertFalse(qualify(self.backend, [self.row()])[0]['evidence'])

    def test_native_figi_must_match_returned_record(self):
        self.record['compositeFIGI'] = 'BBG000000009'
        self.assertFalse(qualify(self.backend, [self.row('eodhd', 'SYN.US')])[0]['evidence'])

    def test_ticker_lookup_requires_returned_venue_not_just_request_constraint(self):
        self.record['exchCode'] = 'UN'
        self.assertFalse(qualify(self.backend, [self.row()])[0]['evidence'])

    def test_one_source_cannot_starve_the_other_source_qualification_budget(self):
        rows = [self.row(symbol=f'SYN{index}') for index in range(9)] + [self.row('eodhd', 'SYN.US')]
        result = qualify(self.backend, rows)
        self.assertTrue(result[-1]['evidence'])
        self.assertEqual(len(next(args['jobs'] for provider, args in self.calls if provider == 'openfigi')), 8)

    def test_unexpected_failure_is_logged_without_provider_payload(self):
        def fail():
            raise RuntimeError('private provider contents')
        self.hook = fail
        with self.assertLogs('tools.pythia.connectors', level='WARNING') as logs:
            result = qualify(self.backend, [self.row()])
        self.assertFalse(result[0]['evidence'])
        self.assertNotIn('private provider contents', ''.join(logs.output))
        self.assertIn('identity_qualification_failed', ''.join(logs.output))

    def test_unknown_exchange_does_not_guess_and_missing_currency_is_not_defaulted(self):
        row = self.row()
        row['provider_ref']['qualifiers']['venue'] = 'UNKNOWN'
        self.assertEqual(qualify(self.backend, [row]), [row])
        self.assertEqual(self.calls, [])
        qualify(self.backend, [self.row()])
        self.assertNotIn('currency', self.calls[0][1]['jobs'][0])

    def test_access_change_during_reference_read_discards_proof(self):
        self.hook = lambda: setattr(self, 'enabled', False)
        row = self.row()
        self.assertEqual(qualify(self.backend, [row]), [row])

    def test_disabled_saved_source_cannot_be_enriched_through_reference_connector(self):
        rows = [self.row(), self.row('eodhd', 'SYN.US')]
        qualify(self.backend, rows)
        count = len(self.calls)
        self.sources_enabled = False
        self.assertEqual(qualify(self.backend, rows), rows)
        self.assertEqual(len(self.calls), count)

    def test_work_is_bounded(self):
        rows = [self.row(symbol=f'SYN{index}') for index in range(12)]
        results = qualify(self.backend, rows)
        self.assertEqual(len(self.calls[0][1]['jobs']), 8)
        self.assertEqual(results[-1]['identity_issues'][0]['code'], 'identity_qualification_limited')


if __name__ == '__main__':
    unittest.main()
