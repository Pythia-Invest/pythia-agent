"""Synthetic SEC fixtures shaped by the public EDGAR APIs; no provider response is kept.

Shapes: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
(company_tickers_exchange.json, submissions/CIK##########.json, companyfacts).
CIKs, names and tickers below are invented.
"""
from copy import deepcopy
import importlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from test_market_data_identity import wire

ROOT = Path(__file__).resolve().parents[2] / 'managed/plugins/sec'
spec = importlib.util.spec_from_file_location('sec_fixture', ROOT / '__init__.py', submodule_search_locations=[str(ROOT)])
plugin = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = plugin
spec.loader.exec_module(plugin)
identity = importlib.import_module('sec_fixture.identity')
financials = importlib.import_module('sec_fixture.financials')
catalogue = importlib.import_module('sec_fixture.catalogue')
client = importlib.import_module('sec_fixture.client')
shim = importlib.import_module('sec_fixture.configuration_shim')
connector = importlib.import_module(wire.__package__ + '.connector')

STAMP = '2026-09-24T10:00:00+00:00'
CIK = '0000123456'
REF = identity.reference(CIK)
CONTACT = 'Example Research research@example.invalid'
DIRECTORY = {'fields': ['cik', 'name', 'ticker', 'exchange'], 'data': [
    [123456, 'Example Holdings', 'EXA', 'Nasdaq'],
    [123456, 'Example Holdings', 'EXA-B', 'NYSE'],
    [789012, 'Other Company', 'OTHR', 'OTC'],
    [345678, 'Stale Registrant', 'EXA', None],
]}
SUBMISSIONS = {'cik': '123456', 'name': 'Example Holdings N.V.', 'tickers': ['EXA', 'EXAF'],
               'exchanges': ['Nasdaq', 'OTC'], 'stateOfIncorporation': 'P7',
               'stateOfIncorporationDescription': 'Netherlands',
               'formerNames': [{'name': 'Example Lithography Holding N.V.',
                                'from': '1995-03-01T00:00:00.000Z', 'to': '2012-07-11T00:00:00.000Z'}]}


def observation(value, *, start='2024-07-01', end='2025-06-30', filed='2025-08-01', accession='0000123456-25-000001', form='10-K'):
    return {'val': value, **({'start': start} if start else {}), 'end': end, 'filed': filed,
            'accn': accession, 'form': form, 'fy': 2025, 'fp': 'FY'}


def companyfacts(units, taxonomy='us-gaap', concept='Revenues'):
    return {'cik': 123456, 'entityName': 'Example Holdings', 'facts': {taxonomy: {concept: {'units': units}}}}


class Transport:
    """Serves one synthetic document per SEC resource and records requests."""

    def __init__(self, documents):
        self.documents, self.calls = documents, []

    def run_worker(self, _command, request, _environment, **_options):
        self.calls.append(deepcopy(request))
        return {'data': deepcopy(self.documents[request['operation']]), 'observed_at': STAMP, 'issues': []}


def reader(documents=None, contact=('configured', CONTACT)):
    transport = Transport(documents or {})
    return plugin.Reader(wire, connector, lambda _key: contact, transport=transport), transport


class SecIdentity(unittest.TestCase):
    def test_ticker_lines_are_typed_listing_rows_under_the_filer_cik(self):
        rows = identity.directory_records(DIRECTORY, STAMP)
        self.assertEqual([row['rank'] for row in rows], [1, 2, 3, 4])
        self.assertEqual(rows[0]['native_ref'], REF)
        self.assertEqual(rows[0]['identifiers'], [{'scheme': 'cik', 'value': CIK, 'level': 'issuer', 'authority': 'source_asserted'}])
        self.assertEqual(rows[1]['venue'], {'provider_code': 'NYSE', 'operating_mic': 'XNYS'})
        self.assertEqual(rows[2]['venue'], {'provider_code': 'OTC', 'operating_mic': 'OTCM'})
        self.assertNotIn('venue', rows[3])
        for broken in ({**DIRECTORY, 'fields': ['cik', 'ticker']}, {**DIRECTORY, 'data': [[0, 'Zero', 'Z', 'NYSE']]}):
            with self.subTest(broken=broken['fields']), self.assertRaisesRegex(ValueError, 'invalid_response'):
                identity.directory_records(broken, STAMP)

    def test_catalogue_pages_are_bound_to_one_file_version(self):
        first = catalogue.page(DIRECTORY, STAMP, limit=3)
        self.assertEqual((len(first['rows']), first['total']), (3, 4))
        second = catalogue.page(DIRECTORY, STAMP, limit=3, cursor=first['next_cursor'])
        self.assertEqual([row['rank'] for row in second['rows']], [4])
        self.assertIsNone(second['next_cursor'])
        changed = deepcopy(DIRECTORY)
        changed['data'][0][1] = 'Renamed Example'
        instance, _ = reader({'directory': changed})
        result = instance.invoke('catalogue', {'scope': 'company-tickers-exchange', 'cursor': first['next_cursor']})
        self.assertEqual(result['issues'][0]['code'], 'snapshot_changed')

    def test_resolve_by_ticker_is_exact_filters_by_operating_mic_and_keeps_ambiguity(self):
        instance, transport = reader({'directory': DIRECTORY})
        both = instance.invoke('resolve', {'ticker': 'exa'})
        self.assertEqual(both['outcome'], 'ok')
        self.assertEqual([row['native_ref']['native_id'] for row in both['data']], [CIK, '0000345678'])
        self.assertEqual(both['issues'][0]['code'], 'ambiguous')
        nasdaq = instance.invoke('resolve', {'ticker': 'EXA', 'mic': 'XNAS'})
        self.assertEqual(len(nasdaq['data']), 1)
        self.assertEqual([line['ticker']['symbol'] for line in nasdaq['data'][0]['listings']], ['EXA', 'EXA-B'])
        self.assertEqual(instance.invoke('resolve', {'ticker': 'EX'})['outcome'], 'empty')
        self.assertEqual(len(transport.calls), 1)  # The retained ticker file serves later resolves.
        for arguments in ({}, {'cik': CIK, 'ticker': 'EXA'}, {'mic': 'XNAS'}, {'cik': '0'}):
            with self.subTest(arguments=arguments):
                self.assertEqual(instance.invoke('resolve', arguments)['issues'][0]['code'], 'invalid_request')

    def test_resolve_by_cik_echoes_names_listings_and_foreign_incorporation(self):
        instance, transport = reader({'submissions': SUBMISSIONS})
        record = instance.invoke('resolve', {'cik': '123456'})['data'][0]
        self.assertEqual(transport.calls[0]['cik'], CIK)
        self.assertEqual(record['former_names'], [{'name': 'Example Lithography Holding N.V.', 'from': '1995-03-01', 'to': '2012-07-11'}])
        self.assertEqual(record['listings'][0], {'ticker': {'symbol': 'EXA'}, 'venue': {'provider_code': 'Nasdaq', 'operating_mic': 'XNAS'}})
        self.assertEqual(record['incorporation'], {'edgar_code': 'P7', 'description': 'Netherlands'})
        with self.assertRaisesRegex(ValueError, 'invalid_response'):
            identity.submission_record(SUBMISSIONS, '0000789012', STAMP)


class SecFinancials(unittest.TestCase):
    def test_foreign_private_issuer_ifrs_facts_keep_units_and_annual_periods(self):
        raw = companyfacts({'EUR': [observation(100, form='20-F'), observation(60, start='2025-01-01', form='6-K')],
                            'USD': [observation(3, form='20-F')]}, 'ifrs-full', 'Revenue')
        raw['facts']['ifrs-full']['ProfitLoss'] = {'units': {'EUR': [observation(20, form='20-F')]}}
        summary = financials.fundamentals(raw, CIK, STAMP)
        self.assertEqual({(row['taxonomy'], row['concept'], row['unit']) for row in summary['facts']},
                         {('ifrs-full', 'Revenue', 'EUR'), ('ifrs-full', 'Revenue', 'USD'), ('ifrs-full', 'ProfitLoss', 'EUR')})
        self.assertNotIn('60', [row['value'] for row in summary['facts']])
        self.assertTrue(all(row['period']['frequency'] == 'annual' for row in summary['facts']))
        self.assertIn('IFRS concepts retain', ' '.join(summary['limitations']))

    def test_latest_annual_fact_keeps_revision_and_never_picks_between_conflicts(self):
        raw = companyfacts({'USD': [observation(100), observation(110, filed='2025-09-01', accession='0000123456-25-000002'),
                                    observation(40, start='2025-04-01', filed='2025-09-01')]})
        usd = financials.fundamentals(raw, CIK, STAMP)['facts'][0]
        self.assertEqual((usd['value'], usd['accession']), ('110', '0000123456-25-000002'))
        conflict = financials.fundamentals(companyfacts({'USD': [observation(100), observation(200)]}), CIK, STAMP)
        self.assertEqual(conflict['facts'], [])
        self.assertIn('conflicting', conflict['limitations'][0])

    def test_facts_operation_accepts_valid_concepts_and_rejects_duplicates(self):
        raw = companyfacts({'EUR': [observation(100, form='20-F')]}, 'ifrs-full', 'Revenue')
        instance, transport = reader({'companyfacts': raw})
        result = instance.invoke('facts', {'native_ref': REF, 'taxonomy': 'ifrs-full', 'concepts': ['Revenue']})
        self.assertEqual(result['outcome'], 'ok', result)
        self.assertEqual(result['data']['facts'][0]['unit'], 'EUR')
        duplicate = instance.invoke('facts', {'native_ref': REF, 'taxonomy': 'ifrs-full', 'concepts': ['Revenue', 'Revenue']})
        self.assertEqual(duplicate['issues'][0]['code'], 'invalid_request')
        self.assertEqual(len(transport.calls), 1)

    def test_filings_keep_filed_date_period_and_safe_document_links(self):
        raw = {'cik': 123456, 'filings': {'recent': {
            'accessionNumber': ['0000123456-25-000001'], 'form': ['20-F'],
            'filingDate': ['2025-08-01'], 'reportDate': ['2025-06-30'],
            'primaryDocument': ['example-20250630.htm']}, 'files': [{'name': 'older.json'}]}}
        result = financials.filings(raw, CIK, STAMP)
        self.assertFalse(result['coverage']['complete'])
        self.assertEqual((result['filings'][0]['filed_at'], result['filings'][0]['period_end']), ('2025-08-01', '2025-06-30'))
        self.assertEqual(result['filings'][0]['title'], 'Foreign issuer report')
        for unsafe in ('../outside.htm', '/outside.htm', 'https://example.invalid/doc'):
            with self.subTest(unsafe=unsafe), self.assertRaises(ValueError):
                financials.filing_url(CIK, '0000123456-25-000001', unsafe)


class SecConfiguration(unittest.TestCase):
    def test_unconfigured_contact_is_explicit_and_makes_no_request(self):
        for setting, status in ((('missing', None), 'missing'), (('configured', 'no-email-contact'), 'invalid'),
                                (('configured', 'research@example.invalid'), 'invalid')):
            with self.subTest(setting=setting):
                instance, transport = reader({}, contact=setting)
                result = instance.invoke('filings', {'native_ref': REF})
                self.assertEqual(result['issues'][0]['code'], 'not_configured')
                self.assertEqual(result['issues'][0]['message'], plugin.UNCONFIGURED[status])
                self.assertEqual(instance.check()['data']['status'], 'invalid')
                self.assertEqual(transport.calls, [])
        self.assertEqual(reader({})[0].check(), {'schema_version': 1, 'data': {'status': 'valid'}})

    def test_registration_hides_reads_until_configured_but_keeps_the_check(self):
        setting = ['missing', None]
        tools = {}
        ctx = SimpleNamespace(register_tool=lambda **tool: tools.update({tool['name']: tool}))
        selection = SimpleNamespace(native_access_scope=lambda: {'cacheable': True, 'scope': 'fixture'})
        platform = SimpleNamespace(platform=lambda: SimpleNamespace(configuration=SimpleNamespace(value=lambda _ctx, _key: tuple(setting))))
        self.enterContext(patch.object(plugin, 'helpers', return_value=(wire, connector, selection, platform)))
        plugin.register(ctx)
        self.assertFalse(tools['pythia_sec_filings']['check_fn']())
        self.assertTrue(tools['pythia_sec_check_configuration']['check_fn']())
        self.assertEqual(json.loads(tools['pythia_sec_check_configuration']['handler']({}))['data']['status'], 'invalid')
        setting[:] = ['configured', CONTACT]
        self.assertTrue(tools['pythia_sec_filings']['check_fn']())

    def test_shim_reads_only_private_stores(self):
        with tempfile.TemporaryDirectory() as root:
            os.chmod(root, 0o700)
            path = Path(root) / 'settings.json'
            path.write_text(json.dumps({'schema_version': 1, 'sec_identity': CONTACT}))
            with patch.dict(os.environ, {'PYTHIA_CONFIG_ROOT': root}):
                os.chmod(path, 0o600)
                self.assertEqual(shim.value(None, 'sec_identity'), ('configured', CONTACT))
                self.assertEqual(shim.missing(None), [])
                os.chmod(path, 0o644)
                self.assertEqual(shim.value(None, 'sec_identity'), ('invalid', None))
                self.assertEqual(shim.missing(None), ['sec_identity'])


class SecExecution(unittest.TestCase):
    def test_request_declares_the_contact_and_maps_provider_denial(self):
        requests = []

        def fail(request, timeout):
            requests.append(request)
            raise HTTPError(request.full_url, 403, 'Denied', {'Retry-After': '45'}, io.BytesIO())
        transport = client.Transport(connector, opener=SimpleNamespace(open=fail))
        with self.assertRaises(connector.SourceFailure) as caught:
            transport.run_worker([], {'operation': 'companyfacts', 'cik': CIK, 'contact': CONTACT}, {},
                cancelled=lambda: False, budget=connector.connection('sec-test-denial', concurrency=1, per_minute=10))
        self.assertEqual((caught.exception.raw['error'], caught.exception.raw['retry_after']), ('access_denied', 45))
        self.assertEqual(requests[0].full_url, 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000123456.json')
        self.assertEqual(requests[0].get_header('User-agent'), CONTACT)

    def test_successful_reads_are_retained_but_failures_and_refresh_are_not(self):
        class Flaky(Transport):
            fail = False

            def run_worker(self, *args, **options):
                if self.fail:
                    self.calls.append('failed')
                    raise connector.SourceFailure({'error': 'rate_limit', 'retry_after': 30, 'limit_origin': 'provider'})
                return super().run_worker(*args, **options)
        transport = Flaky({'companyfacts': companyfacts({'USD': [observation(100)]})})
        instance = plugin.Reader(wire, connector, lambda _key: ('configured', CONTACT), transport=transport)
        for _ in range(2):
            self.assertEqual(instance.invoke('fundamentals', {'native_ref': REF})['outcome'], 'ok')
        self.assertEqual(len(transport.calls), 1)
        transport.fail = True
        for _ in range(2):
            issue = instance.invoke('fundamentals', {'native_ref': REF, 'refresh': True})['issues'][0]
            self.assertEqual((issue['code'], issue['retry_after_seconds']), ('rate_limit', 30))
        self.assertEqual(len(transport.calls), 3)


if __name__ == '__main__':
    unittest.main()
