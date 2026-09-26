"""Synthetic GLEIF JSON:API records, shaped by its official endpoint docs.

https://documenter.getpostman.com/view/7679680/SVYrrxuU
Invented checksummed identifiers and entities; no provider responses retained.
"""
from copy import deepcopy
import importlib
import importlib.util
import json
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

from native_plugin_fixtures import Context
from test_market_data_identity import PACKAGE, wire, isin

ROOT = Path(__file__).resolve().parents[2] / 'managed/plugins/gleif'
spec = importlib.util.spec_from_file_location('gleif_fixture', ROOT / '__init__.py', submodule_search_locations=[str(ROOT)])
plugin = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = plugin
spec.loader.exec_module(plugin)
records = importlib.import_module('gleif_fixture.records')
profiles = importlib.import_module('gleif_fixture.profile')
connector = importlib.import_module(wire.__package__ + '.connector')
STAMP = '2026-09-24T10:00:00+00:00'


def lei(seed):
    prefix = f'ZZZZ00{seed:012d}'
    for check in range(100):
        candidate = prefix + str(check).zfill(2)
        try:
            return records.lei(candidate)
        except ValueError:
            pass
    raise AssertionError('no checksum')


FIRST, SECOND = lei(1), lei(2)


def record(identifier=FIRST, name='Example Holdings', *, registration='LAPSED', authority='RA000463'):
    return {'type': 'lei-records', 'id': identifier, 'attributes': {
        'lei': identifier, 'entity': {'legalName': {'name': name, 'language': 'zz'}, 'status': 'ACTIVE',
            'jurisdiction': 'ZZ', 'registeredAt': {'id': authority}, 'registeredAs': '123456',
            'otherNames': [{'name': 'Previous Example Holdings', 'type': 'PREVIOUS_LEGAL_NAME', 'language': 'zz'}],
            'legalAddress': {'addressLines': ['1 Example Lane'], 'city': 'Example City', 'country': 'ZZ'}},
        'registration': {'status': registration, 'corroborationLevel': 'FULLY_CORROBORATED',
                         'lastUpdateDate': STAMP}}, 'relationships': {}}


def payload(rows):
    return {'data': rows, 'meta': {'pagination': {'total': len(rows)}}, 'links': {}}


def parent(*, status='ACTIVE', target=SECOND, source=FIRST):
    return {'data': {'type': 'relationship-records', 'attributes': {
        'validFrom': '2020-01-01T00:00:00Z', 'validTo': None,
        'relationship': {'startNode': {'type': 'LEI', 'id': source},
            'endNode': {'type': 'LEI', 'id': target}, 'type': 'IS_DIRECTLY_CONSOLIDATED_BY',
            'status': status, 'periods': [{'type': 'ACCOUNTING_PERIOD', 'startDate': '2024-01-01', 'endDate': '2024-12-31'}]},
        'registration': {'status': 'LAPSED', 'corroborationLevel': 'ENTITY_SUPPLIED_ONLY'}}}}


class Transport:
    def __init__(self, responses):
        self.responses, self.calls = responses, []

    def run_worker(self, _command, request, _environment, **options):
        self.calls.append((request, options))
        value = self.responses[request['url']]
        if isinstance(value, Exception):
            raise value
        return {'data': deepcopy(value), 'observed_at': STAMP, 'issues': []}


def isin_url(identifier):
    return records.endpoint(**{'filter[isin]': identifier, 'page[size]': 10})


class SkillContext(Context):
    def __init__(self, plugin_id):
        super().__init__(plugin_id)
        self.skills = []

    def register_skill(self, name, path, **_options):
        assert Path(path).is_file(), path
        self.skills.append(name)


def register_with_market_data(test, module, ctx, transport, scopes):
    """Register through the resolved market-data helpers with a synthetic transport."""
    manager = ModuleType('hermes_cli.plugins')
    manager.get_plugin_manager = lambda: SimpleNamespace(_plugins={
        'pythia-market-data': SimpleNamespace(enabled=True, module=sys.modules[PACKAGE])})
    selection = importlib.import_module(PACKAGE + '.selection')
    connector_module = importlib.import_module(PACKAGE + '.connector')
    for patcher in (patch.dict(sys.modules, {'hermes_cli.plugins': manager}),
                    patch.object(connector_module, 'Transport', return_value=transport),
                    patch.object(selection, 'native_access_scope', side_effect=lambda: next(scopes))):
        patcher.start()
        test.addCleanup(patcher.stop)
    module.register(ctx)


class GleifSemantics(unittest.TestCase):
    def test_registers_only_owned_read_operations_and_rechecks_access(self):
        ctx = SkillContext('pythia-gleif')
        transport = Transport({records.endpoint(FIRST): {'data': record()}})
        register_with_market_data(self, plugin, ctx, transport, iter([{'scope': 'a'}] * 3 + [{'scope': 'b'}]))
        self.assertEqual(set(ctx.tools), {'pythia_gleif_resolve', 'pythia_gleif_profile'})
        self.assertEqual(ctx.skills, ['gleif'])
        for name, entry in ctx.registrations.items():
            # Not a market-data search source: only a deliberate read-only export.
            declared = json.loads(entry['schema']['parameters']['$comment'])
            self.assertEqual(set(declared), {'pythia_http_operation'}, name)
            self.assertEqual((declared['pythia_http_operation']['plugin'], declared['pythia_http_operation']['read_only']),
                             ('pythia-gleif', True))
        self.assertEqual(json.loads(ctx.tools['pythia_gleif_resolve']({'lei': FIRST}))['data']['status'], 'resolved')
        # A result completed under a different native access scope is not published.
        changed = json.loads(ctx.tools['pythia_gleif_resolve']({'lei': FIRST}))
        self.assertEqual((changed['data'], changed['issues'][0]['code']), (None, 'unavailable'))

    def test_isin_resolves_to_one_issuer_with_echoed_identifiers(self):
        identifier = isin(8)
        transport = Transport({isin_url(identifier): payload([record(authority='RA000665')])})
        result = plugin.Reader(wire, connector, transport=transport).invoke('resolve', {'isin': identifier})
        self.assertEqual(result['outcome'], 'ok', result)
        data = result['data']
        self.assertEqual(data['status'], 'resolved')
        self.assertEqual(data['native_ref'], records.reference(FIRST))
        self.assertEqual(data['native_level'], 'issuer')
        self.assertEqual(data['echoed'], {'lei': FIRST, 'isin': identifier, 'cik': '0000123456'})
        self.assertEqual(data['source_url'], isin_url(identifier))
        self.assertEqual(data['request'], {'scheme': 'isin', 'value': identifier})

    def test_isin_resolve_does_not_require_profile_only_fields(self):
        identifier, row = isin(8), record()
        row['attributes']['registration']['lastUpdateDate'] = '2025-02-29'
        transport = Transport({isin_url(identifier): payload([row])})
        result = plugin.Reader(wire, connector, transport=transport).invoke('resolve', {'isin': identifier})
        self.assertEqual((result['outcome'], result['data']['status']), ('ok', 'resolved'), result)

    def test_several_issuers_for_one_isin_are_ambiguous_never_picked(self):
        identifier = isin(8)
        transport = Transport({isin_url(identifier): payload([record(), record(SECOND)])})
        result = plugin.Reader(wire, connector, transport=transport).invoke('resolve', {'isin': identifier})
        self.assertEqual(result['data']['status'], 'ambiguous')
        self.assertNotIn('native_ref', result['data'])
        self.assertEqual([item['native_ref']['native_id'] for item in result['data']['candidates']], [FIRST, SECOND])
        self.assertEqual({item['echoed']['isin'] for item in result['data']['candidates']}, {identifier})

    def test_unmapped_isin_and_unknown_lei_are_not_found_not_failures(self):
        identifier = isin(9)
        transport = Transport({isin_url(identifier): payload([]),
                               records.endpoint(SECOND): connector.SourceFailure({'error': 'missing_observation'})})
        reader = plugin.Reader(wire, connector, transport=transport)
        for arguments in ({'isin': identifier}, {'lei': SECOND}):
            result = reader.invoke('resolve', arguments)
            self.assertEqual((result['outcome'], result['data']['status']), ('empty', 'not_found'), result)
            self.assertEqual(result['issues'], [])

    def test_lei_resolve_verifies_the_returned_record(self):
        transport = Transport({records.endpoint(FIRST): {'data': record()}})
        result = plugin.Reader(wire, connector, transport=transport).invoke('resolve', {'lei': FIRST})
        self.assertEqual(result['data']['status'], 'resolved')
        self.assertEqual(result['data']['echoed'], {'lei': FIRST})
        transport.responses[records.endpoint(FIRST)] = {'data': record(SECOND)}
        result = plugin.Reader(wire, connector, transport=transport).invoke('resolve', {'lei': FIRST, 'refresh': True})
        self.assertEqual(result['issues'][0]['code'], 'invalid_response')

    def test_identifiers_validate_checksums_and_do_not_accept_arbitrary_refs(self):
        self.assertEqual(records.lei(FIRST), FIRST)
        self.assertEqual(records.isin(isin(8)), isin(8))
        for bad in (FIRST[:-1] + str((int(FIRST[-1]) + 1) % 10), FIRST.lower(), '../anything'):
            with self.assertRaises(ValueError):
                records.lei(bad)
        for bad in (isin(8)[:-1] + str((int(isin(8)[-1]) + 1) % 10), isin(8).lower()):
            with self.assertRaises(ValueError):
                records.isin(bad)
        with self.assertRaises(ValueError):
            records.from_reference({**records.reference(FIRST), 'qualifiers': {'ticker': 'EX'}})

    def test_same_name_entities_remain_distinct_and_only_explicit_sec_registry_is_cik(self):
        rows = [record(), record(SECOND, authority='RA000665')]
        candidates = [records.candidate(row) for row in rows]
        self.assertNotEqual(candidates[0]['native_ref'], candidates[1]['native_ref'])
        self.assertNotIn('cik', candidates[0]['echoed'])
        self.assertEqual(candidates[1]['echoed']['cik'], '0000123456')
        for value in ('0000000000', 'CIK123456'):
            rows[1]['attributes']['entity']['registeredAs'] = value
            self.assertNotIn('cik', records.candidate(rows[1])['echoed'])

    def test_malformed_or_wrong_native_record_cannot_confirm_requested_entity(self):
        with self.assertRaises(ValueError):
            records.record(record(), SECOND)
        malformed = record()
        malformed['attributes']['lei'] = 'NOT_A_LEI'
        with self.assertRaisesRegex(ValueError, 'invalid_response'):
            records.record(malformed)
        malformed = payload([record()])
        malformed['meta']['pagination']['total'] = True
        with self.assertRaises(ValueError):
            records.collection(malformed, 10)

    def test_profile_keeps_typed_names_statuses_and_record_identifiers(self):
        row = record(authority='RA000665')
        row['attributes']['entity']['transliteratedOtherNames'] = [
            {'name': 'EXAMPLE HOLDINGS', 'type': 'AUTO_ASCII_TRANSLITERATED_LEGAL_NAME', 'language': 'zz-Latn'}]
        summary = profiles.profile(row, STAMP)
        self.assertEqual(summary['identifiers'], {'lei': FIRST, 'cik': '0000123456'})
        self.assertEqual([(item['kind'], item['type'], item['language']) for item in summary['names']], [
            ('legal', None, 'zz'), ('other', 'PREVIOUS_LEGAL_NAME', 'zz'),
            ('transliterated', 'AUTO_ASCII_TRANSLITERATED_LEGAL_NAME', 'zz-Latn')])
        fields = {field['key']: field['value'] for field in summary['fields']}
        self.assertEqual(fields['entity_status'], 'ACTIVE')
        self.assertEqual(fields['registration_status'], 'LAPSED')
        self.assertEqual(fields['record_updated_at'], STAMP)
        self.assertEqual(summary['relationships'], [])
        row['attributes']['entity']['otherNames'] = [{'type': 'PREVIOUS_LEGAL_NAME'}]
        with self.assertRaisesRegex(ValueError, 'invalid_response'):
            profiles.profile(row, STAMP)

    def test_declared_successor_is_a_distinct_entity(self):
        row = record()
        row['attributes']['entity'].update(status='INACTIVE', successorEntity={'lei': SECOND, 'name': 'Successor'},
                                           expiration={'date': '2025-06-30T00:00:00Z', 'reason': 'CORPORATE_ACTION'})
        summary = profiles.profile(row, STAMP)
        self.assertEqual(summary['provider_ref'], records.reference(FIRST))
        self.assertEqual(summary['relationships'][0]['kind'], 'SUCCEEDED_BY')
        self.assertEqual(summary['relationships'][0]['target'], {'scheme': 'lei', 'value': SECOND, 'name': 'Successor'})
        fields = {field['key']: field for field in summary['fields']}
        self.assertEqual(fields['expiration_reason']['value'], 'CORPORATE_ACTION')
        self.assertEqual(fields['expired_at']['value_type'], 'instant')
        self.assertEqual(records.candidate(row)['successors'], [{'lei': SECOND, 'name': 'Successor'}])

    def test_branch_and_fund_metadata_distinguish_same_name_without_reclassifying_identity(self):
        main, branch, fund = record(), record(SECOND), record(lei(3))
        main['attributes']['entity'].update(category='GENERAL')
        branch['attributes']['entity'].update(category='BRANCH', registeredAt={'id': 'RA000189'}, registeredAs='654321')
        branch['attributes']['entity']['legalAddress'].update(city='Other City', country='XY')
        fund['attributes']['entity'].update(category='FUND')
        rows = [records.candidate(row) for row in (main, branch, fund)]
        self.assertEqual([row['entity_type'] for row in rows], ['Legal entity', 'Branch', 'Fund legal entity'])
        self.assertEqual({row['native_level'] for row in rows}, {'issuer'})
        summary = profiles.profile(branch, STAMP)
        fields = {field['key']: field['value'] for field in summary['fields']}
        self.assertEqual(fields['entity_type'], 'Branch')
        self.assertEqual(fields['native_category'], 'BRANCH')
        self.assertEqual(fields['jurisdiction'], 'ZZ')
        self.assertEqual(fields['legal_address_country'], 'XY')
        self.assertEqual(fields['registered_at'], 'RA000189')
        self.assertEqual(summary['relationships'], [])

    def test_accounting_parent_keeps_lapsed_corroboration_and_periods(self):
        summary = profiles.profile(record(), STAMP)
        url = records.endpoint(FIRST, 'direct-parent-relationship')
        profiles.add_parent(summary, 'direct', 'direct-parent-relationship', parent(), url)
        self.assertEqual(summary['relationships'][0]['target']['value'], SECOND)
        fields = {field['key']: field['value'] for field in summary['fields']}
        self.assertEqual(fields['direct_parent_registration'], 'LAPSED')
        self.assertEqual(fields['direct_parent_corroboration'], 'ENTITY_SUPPLIED_ONLY')
        self.assertEqual(fields['direct_parent_period_0_endDate'], '2024-12-31')
        expired = parent()
        expired['data']['attributes']['validTo'] = '2025-01-01T00:00:00Z'
        other = profiles.profile(record(), STAMP)
        profiles.add_parent(other, 'direct', 'direct-parent-relationship', expired, url)
        self.assertEqual(other['relationships'], [])
        with self.assertRaises(ValueError):
            profiles.add_parent(other, 'direct', 'direct-parent-relationship', parent(source=SECOND), url)

    def test_reporting_exception_does_not_assert_no_owner(self):
        summary = profiles.profile(record(), STAMP)
        exception = {'data': {'type': 'reporting-exceptions', 'attributes': {'lei': FIRST,
            'category': 'DIRECT_ACCOUNTING_CONSOLIDATION_PARENT', 'reason': 'NON_PUBLIC', 'validTo': None}}}
        profiles.add_parent(summary, 'direct', 'direct-parent-reporting-exception', exception, records.BASE)
        self.assertEqual(summary['relationships'], [])
        self.assertEqual(summary['fields'][-1]['value'], 'NON_PUBLIC')
        exception['data']['attributes']['lei'] = SECOND
        with self.assertRaises(ValueError):
            profiles.add_parent(summary, 'direct', 'direct-parent-reporting-exception', exception, records.BASE)

    def test_links_are_availability_not_arbitrary_fetch_authority(self):
        row = record()
        url = records.endpoint(FIRST, 'direct-parent-relationship')
        row['relationships']['direct-parent'] = {'links': {'relationship-record': url}}
        self.assertEqual(profiles.parent_requests(row), [('direct', 'direct-parent-relationship', url)])
        row['relationships']['direct-parent']['links']['relationship-record'] = 'https://unrelated.invalid/private'
        with self.assertRaises(ValueError):
            profiles.parent_requests(row)

    def test_shared_reads_reuse_but_refresh_and_access_scope_invalidate(self):
        url = records.endpoint(FIRST)
        transport = Transport({url: {'data': record()}})
        reader = plugin.Reader(wire, connector, transport=transport)
        for _ in range(2):
            self.assertEqual(reader.invoke('resolve', {'lei': FIRST}, cache_scope='a')['outcome'], 'ok')
        self.assertEqual(len(transport.calls), 1)
        self.assertEqual(reader.invoke('profile', {'native_ref': records.reference(FIRST)}, cache_scope='a')['outcome'], 'ok')
        self.assertEqual(len(transport.calls), 1)
        reader.invoke('resolve', {'lei': FIRST, 'refresh': True}, cache_scope='a')
        reader.invoke('resolve', {'lei': FIRST}, cache_scope='b')
        self.assertEqual(len(transport.calls), 3)

    def test_parent_failure_preserves_profile_and_retry_qualification(self):
        url = records.endpoint(FIRST)
        parent_url = records.endpoint(FIRST, 'direct-parent-relationship')
        row = record()
        row['relationships']['direct-parent'] = {'links': {'relationship-record': parent_url}}
        transport = Transport({url: {'data': row}, parent_url:
            connector.SourceFailure({'error': 'rate_limit', 'retry_after': 12, 'limit_origin': 'provider'})})
        result = plugin.Reader(wire, connector, transport=transport).invoke('profile', {'native_ref': records.reference(FIRST)})
        self.assertEqual(result['outcome'], 'partial')
        self.assertTrue(result['data']['fields'])
        self.assertEqual(result['issues'][0]['retry_after_seconds'], 12)
        self.assertEqual(result['issues'][0]['limit_origin'], 'provider')

    def test_invalid_arguments_never_reach_provider(self):
        transport = Transport({})
        reader = plugin.Reader(wire, connector, transport=transport)
        for arguments in ({}, {'lei': 'bad'}, {'lei': FIRST, 'isin': isin(8)},
                          {'lei': FIRST[:-1] + str((int(FIRST[-1]) + 1) % 10)},
                          {'isin': isin(8)[:-1] + str((int(isin(8)[-1]) + 1) % 10)}, {'query': 'Example'}):
            result = reader.invoke('resolve', arguments)
            self.assertEqual(result['issues'][0]['code'], 'invalid_request', arguments)
        result = reader.invoke('profile', {'native_ref': {**records.reference(FIRST), 'provider': 'other'}})
        self.assertEqual(result['issues'][0]['code'], 'invalid_request')
        self.assertEqual(transport.calls, [])

    def test_malformed_record_is_not_cached_and_retry_can_recover(self):
        url = records.endpoint(FIRST)
        transport = Transport({url: {'data': record(SECOND)}})
        reader = plugin.Reader(wire, connector, transport=transport)
        args = {'native_ref': records.reference(FIRST)}
        self.assertEqual(reader.invoke('profile', args)['issues'][0]['code'], 'invalid_response')
        transport.responses[url] = {'data': record()}
        self.assertEqual(reader.invoke('profile', args)['outcome'], 'ok')
        self.assertEqual(len(transport.calls), 2)
        # Resolve reads must not poison the shared profile record cache either.
        malformed = record()
        malformed['attributes']['entity']['legalAddress']['addressLines'] = 7
        transport.responses[url] = {'data': malformed}
        self.assertEqual(reader.invoke('resolve', {'lei': FIRST, 'refresh': True})['issues'][0]['code'], 'invalid_response')

    def test_parent_retry_recovers_without_refetching_successful_legal_record(self):
        url = records.endpoint(FIRST)
        parent_url = records.endpoint(FIRST, 'direct-parent-relationship')
        row = record()
        row['relationships']['direct-parent'] = {'links': {'relationship-record': parent_url}}
        transport = Transport({url: {'data': row}, parent_url: parent(source=SECOND)})
        reader = plugin.Reader(wire, connector, transport=transport)
        args = {'native_ref': records.reference(FIRST)}
        result = reader.invoke('profile', args)
        self.assertEqual(result['outcome'], 'partial')
        self.assertEqual(result['issues'][0]['code'], 'invalid_response')
        transport.responses[parent_url] = parent()
        result = reader.invoke('profile', args)
        self.assertEqual(result['outcome'], 'ok')
        self.assertEqual(result['data']['relationships'][0]['target']['value'], SECOND)
        self.assertEqual(len(transport.calls), 3)


if __name__ == '__main__':
    unittest.main()
