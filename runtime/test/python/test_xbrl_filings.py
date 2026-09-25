"""Synthetic filings API/xBRL-JSON examples; no retained provider responses.

https://filings.xbrl.org/docs/api
https://www.xbrl.org/Specification/xbrl-json/REC-2021-10-13/xbrl-json-REC-2021-10-13.html
"""
from copy import deepcopy
import importlib
import importlib.util
import json
from pathlib import Path
import sys
import unittest

from test_gleif_connector import SkillContext, register_with_market_data
from test_market_data_identity import wire

ROOT = Path(__file__).resolve().parents[2] / 'managed/plugins/xbrl-filings'
spec = importlib.util.spec_from_file_location('xbrl_fixture', ROOT / '__init__.py', submodule_search_locations=[str(ROOT)])
plugin = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = plugin
spec.loader.exec_module(plugin)
identity = importlib.import_module('xbrl_fixture.identity')
reports = importlib.import_module('xbrl_fixture.reports')
facts = importlib.import_module('xbrl_fixture.facts')
connector = importlib.import_module(wire.__package__ + '.connector')
STAMP = '2026-09-24T10:00:00Z'


def test_lei(seed='A'):
    prefix = 'ZZZZ00' + seed * 12
    return next(prefix + f'{i:02}' for i in range(100)
                if int(''.join(str(int(c, 36)) for c in prefix + f'{i:02}')) % 97 == 1)


LEI, OTHER = test_lei(), test_lei('B')
REF = identity.reference(LEI)


def filing(identifier=LEI, report_id='1', digest='a' * 64, errors=0, json_available=True, period='2025-12-31'):
    path = f'/{identifier}/{period}/ESEF/ZZ/0/'
    return {'type': 'filing', 'id': report_id, 'attributes': {
        'sha256': digest, 'period_end': period, 'fxo_id': f'{identifier}-{period}-ESEF-ZZ-0',
        'error_count': errors, 'viewer_url': path + 'report/ixbrlviewer.html',
        'report_url': path + 'report/report.xhtml', 'package_url': path + 'report.zip',
        'json_url': path + 'report.json' if json_available else None,
        'date_added': '2026-02-10 15:00:00', 'country': 'ZZ'},
        'relationships': {'entity': {'links': {'related': '/api/entities/' + identifier}}}}


def metadata(*rows):
    return {'data': list(rows) or [filing()], 'meta': {'count': len(rows) or 1},
            'links': {'next': 'https://filings.xbrl.org/api/filings?page[number]=2'}}


def entity(identifier=LEI):
    return {'data': {'type': 'entity', 'id': '9', 'attributes': {'identifier': identifier, 'name': 'Synthetic Reports'}}}


def fact(value='12345678901234567890.00', concept='Assets', period='2026-01-01T00:00:00', **dimensions):
    return {'value': value, 'decimals': -3, 'dimensions': {'concept': 'ifrs:' + concept,
        'entity': 'lei:' + LEI, 'period': period, 'unit': 'iso4217:EUR', **dimensions}}


def document(*rows):
    return {'documentInfo': {'documentType': 'https://xbrl.org/2021/xbrl-json',
        'namespaces': {'ifrs': 'https://xbrl.ifrs.org/taxonomy/2025-03-27/ifrs-full',
            'lei': 'http://standards.iso.org/iso/17442', 'iso4217': 'http://www.xbrl.org/2003/iso4217',
            'custom': 'https://example.invalid/taxonomy'}},
        'facts': {f'f{i}': row for i, row in enumerate(rows or [fact()])}}


class FakeTransport:
    def __init__(self, payloads):
        self.payloads, self.requests = iter(payloads), []

    def run_worker(self, _command, request, _environment, **_options):
        self.requests.append(request)
        value = next(self.payloads)
        if isinstance(value, Exception):
            raise value
        return {'data': value, 'observed_at': STAMP, 'issues': []}


class XbrlSemantics(unittest.TestCase):
    def test_registers_only_owned_read_operations_and_rechecks_access(self):
        ctx = SkillContext('pythia-xbrl-filings')
        register_with_market_data(self, plugin, ctx, FakeTransport([entity(), entity()]),
                                  iter([{'scope': 'a'}] * 3 + [{'scope': 'b'}]))
        self.assertEqual(set(ctx.tools), {'pythia_xbrl_filings_resolve', 'pythia_xbrl_filings_filings',
                                          'pythia_xbrl_filings_fundamentals', 'pythia_xbrl_filings_facts'})
        self.assertEqual(ctx.skills, ['xbrl-filings'])
        for name, entry in ctx.registrations.items():
            declared = json.loads(entry['schema']['parameters']['$comment'])
            self.assertEqual(set(declared), {'pythia_http_operation'}, name)
            self.assertEqual((declared['pythia_http_operation']['plugin'], declared['pythia_http_operation']['read_only']),
                             ('pythia-xbrl-filings', True))
        self.assertEqual(json.loads(ctx.tools['pythia_xbrl_filings_resolve']({'lei': LEI}))['data']['status'], 'resolved')
        changed = json.loads(ctx.tools['pythia_xbrl_filings_resolve']({'lei': LEI, 'refresh': True}))
        self.assertEqual((changed['data'], changed['issues'][0]['code']), (None, 'unavailable'))

    def test_resolve_echoes_the_repository_lei_and_rejects_another_entity(self):
        transport = FakeTransport([entity(), entity(OTHER)])
        reader = plugin.Reader(wire, connector, transport=transport)
        result = reader.invoke('resolve', {'lei': LEI})
        self.assertEqual(result['outcome'], 'ok', result)
        self.assertEqual((result['data']['status'], result['data']['native_level']), ('resolved', 'issuer'))
        self.assertEqual(result['data']['native_ref'], REF)
        self.assertEqual(result['data']['echoed'], {'lei': LEI})
        self.assertEqual(transport.requests[0]['url'], identity.entity_url(LEI))
        rejected = reader.invoke('resolve', {'lei': LEI, 'refresh': True})
        self.assertEqual(rejected['issues'][0]['code'], 'invalid_response')
        for native in ({**REF, 'qualifiers': {'currency': 'EUR'}}, {**REF, 'native_id': LEI[:-2] + '00'}):
            with self.assertRaises(ValueError):
                identity.from_reference(native)

    def test_report_links_dates_and_scope_preserved_without_trusting_unscoped_pagination(self):
        raw = metadata()
        raw['data'][0]['attributes']['warning_count'] = 2
        raw['data'][0]['attributes']['inconsistency_count'] = 1
        result = reports.filings(raw, LEI, STAMP, 10)
        row = result['filings'][0]
        self.assertNotIn('filed_at', row)
        self.assertEqual((row['period_end'], row['form'], row['country']), ('2025-12-31', 'ESEF', 'ZZ'))
        base = f'https://filings.xbrl.org/{LEI}/2025-12-31/ESEF/ZZ/0/'
        self.assertEqual(row['links'], {'viewer': base + 'report/ixbrlviewer.html', 'report': base + 'report/report.xhtml',
                                        'package': base + 'report.zip', 'json': base + 'report.json'})
        self.assertEqual(row['url'], row['links']['viewer'])
        self.assertTrue(row['machine_readable'])
        self.assertEqual(result['latest'], {'period_end': '2025-12-31', 'report_ids': ['1'], 'status': 'unique'})
        self.assertEqual(row['source_detail']['values']['added_raw'], '2026-02-10 15:00:00')
        self.assertEqual(row['source_detail']['values']['validation_warnings'], '2')
        summary = facts.read(document(), LEI, reports.select(raw, LEI), STAMP)
        self.assertTrue(any('1 validation inconsistencies' in note for note in summary['limitations']))
        self.assertIn('/entities/' + LEI + '/filings?', identity.reports_url(LEI, 10, 2))
        with self.assertRaises(ValueError):
            reports.records(metadata(filing(identifier=OTHER)), LEI)
        for bad in ('https://other.invalid/report.json', '/' + LEI + '/../report.json', '/' + LEI + '/%2e%2e/report.json'):
            with self.assertRaises(ValueError):
                identity.report_url(bad, LEI)

    def test_ambiguous_latest_report_is_visible_with_candidates_and_never_picked(self):
        variants = metadata(filing(), filing(report_id='2', digest='b' * 64), filing(report_id='3', period='2024-12-31'))
        listed = reports.filings(variants, LEI, STAMP, 10)
        self.assertEqual(listed['latest'], {'period_end': '2025-12-31', 'report_ids': ['1', '2'], 'status': 'ambiguous'})
        transport = FakeTransport([variants])
        result = plugin.Reader(wire, connector, transport=transport).invoke('fundamentals', {'native_ref': REF})
        self.assertEqual(result['outcome'], 'error')
        issue = result['issues'][0]
        self.assertEqual(issue['code'], 'ambiguous_report')
        self.assertEqual([item['report_id'] for item in issue['candidates']], ['1', '2'])
        self.assertEqual(issue['candidates'][0]['period_end'], '2025-12-31')
        self.assertEqual(len(transport.requests), 1)
        selected = reports.select(variants, LEI, '2')
        self.assertEqual(selected['id'], '2')
        for row in (filing(errors=2), filing(json_available=False)):
            with self.assertRaisesRegex(ValueError, 'unavailable_report'):
                reports.select(metadata(row), LEI)

    def test_precision_period_context_and_taxonomy_are_lossless(self):
        report = reports.select(metadata(), LEI)
        result = facts.read(document(fact(), fact(value='34.00', concept='Revenue',
            period='2025-01-01T00:00:00/2026-01-01T00:00:00')), LEI, report, STAMP)
        assets, revenue = result['facts']
        self.assertEqual(assets['value'], '12345678901234567890.00')
        self.assertEqual(assets['decimals'], -3)
        self.assertEqual(assets['period'], {'kind': 'instant', 'end': '2025-12-31'})
        self.assertEqual(revenue['period'], {'kind': 'duration', 'start': '2025-01-01', 'end': '2025-12-31', 'frequency': 'annual'})
        self.assertEqual(assets['source_detail']['values']['taxonomy_uri'], 'https://xbrl.ifrs.org/taxonomy/2025-03-27/ifrs-full')
        self.assertEqual(assets['entity'], {'scheme': 'lei', 'value': LEI})

    def test_dimensions_never_become_consolidated_metrics_and_native_read_keeps_them(self):
        raw = document(fact(**{'ifrs:ProductsAxis': 'custom:DeviceMember'}))
        report = reports.select(metadata(), LEI)
        self.assertEqual(facts.read(raw, LEI, report, STAMP)['facts'], [])
        native = facts.read(raw, LEI, report, STAMP, concepts=['ifrs:Assets'])
        self.assertEqual(native['facts'][0]['dimensions'], {
            '{https://xbrl.ifrs.org/taxonomy/2025-03-27/ifrs-full}ProductsAxis': 'custom:DeviceMember'})
        self.assertEqual(json.loads(native['facts'][0]['source_detail']['values']['namespaces'])['custom'], 'https://example.invalid/taxonomy')

    def test_duplicate_conflicting_and_spoofed_taxonomy_values_are_not_summarized(self):
        report = reports.select(metadata(), LEI)
        self.assertEqual(len(facts.read(document(fact(), fact()), LEI, report, STAMP)['facts']), 1)
        result = facts.read(document(fact(), fact(value='2')), LEI, report, STAMP)
        self.assertEqual(result['facts'], [])
        self.assertTrue(any('conflicting' in note for note in result['limitations']))
        raw = document()
        raw['documentInfo']['namespaces']['ifrs'] = 'https://example.invalid/not-ifrs'
        self.assertEqual(facts.read(raw, LEI, report, STAMP)['facts'], [])
        wrong = document(fact(entity='lei:' + OTHER))
        with self.assertRaises(ValueError):
            facts.read(wrong, LEI, report, STAMP)

    def test_midday_period_is_qualified_not_truncated_to_date(self):
        result = facts.read(document(fact(period='2025-12-31T12:00:00')), LEI, reports.select(metadata(), LEI), STAMP)
        self.assertEqual(result['facts'], [])
        self.assertTrue(any('non-date' in note for note in result['limitations']))

    def test_shared_worker_reuses_report_and_resolve_refresh_bypasses_cache(self):
        transport = FakeTransport([entity(), entity(), metadata(), document()])
        reader = plugin.Reader(wire, connector, transport=transport)
        for refresh in (False, False, True):
            self.assertEqual(reader.invoke('resolve', {'lei': LEI, 'refresh': refresh})['outcome'], 'ok')
        self.assertEqual(len(transport.requests), 2)
        for _ in range(2):
            result = reader.invoke('fundamentals', {'native_ref': REF})
            self.assertEqual(result['outcome'], 'ok', result)
        self.assertEqual(len(transport.requests), 4)

    def test_explicit_report_scope_and_transport_retry_are_enforced(self):
        transport = FakeTransport([{'data': filing(identifier=OTHER)}])
        reader = plugin.Reader(wire, connector, transport=transport)
        result = reader.invoke('fundamentals', {'native_ref': REF, 'report_id': '1'})
        # Another issuer's report ID is missing for this issuer, not a response to retry.
        self.assertEqual((result['outcome'], result['issues'][0]['code']), ('error', 'missing_observation'))
        self.assertEqual(len(transport.requests), 1)
        failure = connector.SourceFailure({'error': 'rate_limit', 'retry_after': 12, 'limit_origin': 'provider'})
        reader = plugin.Reader(wire, connector, transport=FakeTransport([failure]))
        result = reader.invoke('filings', {'native_ref': REF})
        self.assertEqual(result['issues'][0]['retry_after_seconds'], 12)
        self.assertEqual(result['issues'][0]['code'], 'rate_limit')

    def test_filings_and_fundamentals_share_one_metadata_request(self):
        transport = FakeTransport([metadata(), document()])
        reader = plugin.Reader(wire, connector, transport=transport)
        filing_result = reader.invoke('filings', {'native_ref': REF, 'limit': 3})
        self.assertEqual(filing_result['data']['filings'][0]['report_id'], '1')
        self.assertEqual(reader.invoke('fundamentals', {'native_ref': REF})['outcome'], 'ok')
        self.assertEqual(len(transport.requests), 2)

    def test_malformed_metadata_and_report_are_not_cached_as_success(self):
        transport = FakeTransport([metadata(filing(identifier=OTHER)), metadata(), {'facts': {}}, document()])
        reader = plugin.Reader(wire, connector, transport=transport)
        first = reader.invoke('fundamentals', {'native_ref': REF})
        self.assertEqual(first['issues'][0]['code'], 'invalid_response')
        second = reader.invoke('fundamentals', {'native_ref': REF})
        self.assertEqual(second['issues'][0]['code'], 'invalid_response')
        third = reader.invoke('fundamentals', {'native_ref': REF})
        self.assertEqual(third['outcome'], 'ok', third)
        self.assertEqual(len(transport.requests), 4)

    def test_filing_without_any_document_link_is_rejected(self):
        row = filing()
        for key in ('viewer_url', 'report_url', 'package_url'):
            row['attributes'][key] = None
        with self.assertRaisesRegex(ValueError, 'invalid_response'):
            reports.records(metadata(row), LEI)

    def test_distinct_report_revisions_do_not_reuse_normalized_facts(self):
        transport = FakeTransport([{'data': filing()}, document(fact(value='1')),
            {'data': filing(report_id='2', digest='b' * 64)}, document(fact(value='2'))])
        reader = plugin.Reader(wire, connector, transport=transport)
        first = reader.invoke('fundamentals', {'native_ref': REF, 'report_id': '1'})
        second = reader.invoke('fundamentals', {'native_ref': REF, 'report_id': '2'})
        self.assertEqual(first['data']['facts'][0]['value'], '1')
        self.assertEqual(second['data']['facts'][0]['value'], '2')
        self.assertEqual(len(transport.requests), 4)

    def test_unknown_entity_is_not_found_but_missing_selected_report_remains_error(self):
        for operation in ('resolve', 'fundamentals'):
            failure = connector.SourceFailure({'error': 'missing_observation'})
            reader = plugin.Reader(wire, connector, transport=FakeTransport([failure]))
            arguments = {'lei': LEI} if operation == 'resolve' else {'native_ref': REF}
            result = reader.invoke(operation, arguments)
            self.assertEqual(result['outcome'], 'empty' if operation == 'resolve' else 'error')
        self.assertEqual(result['issues'][0]['code'], 'missing_observation')

    def test_invalid_arguments_never_reach_provider(self):
        transport = FakeTransport([])
        reader = plugin.Reader(wire, connector, transport=transport)
        for operation, arguments in (('resolve', {'lei': LEI[:-1] + str((int(LEI[-1]) + 1) % 10)}),
                                     ('resolve', {'query': 'Synthetic'}), ('filings', {'native_ref': {**REF, 'native_scope': 'cik'}}),
                                     ('facts', {'native_ref': REF, 'report_id': '1', 'concepts': []})):
            result = reader.invoke(operation, deepcopy(arguments))
            self.assertEqual(result['issues'][0]['code'], 'invalid_request', (operation, arguments))
        self.assertEqual(transport.requests, [])


if __name__ == '__main__':
    unittest.main()
