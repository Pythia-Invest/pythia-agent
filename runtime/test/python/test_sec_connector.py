"""Synthetic SEC fixtures shaped by the public EDGAR APIs; no provider response is kept.

Shapes: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
(company_tickers_exchange.json, submissions/CIK##########.json, companyfacts).
CIKs, names and tickers below are invented.
"""
from copy import deepcopy
import gzip
import importlib
import importlib.util
import io
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from market_data_fixture import wire
from test_plugin_contracts import checked_batch

ROOT = Path(__file__).resolve().parents[2] / 'managed/plugins/sec'
spec = importlib.util.spec_from_file_location('sec_fixture', ROOT / '__init__.py', submodule_search_locations=[str(ROOT)])
plugin = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = plugin
spec.loader.exec_module(plugin)
identity = importlib.import_module('sec_fixture.identity')
financials = importlib.import_module('sec_fixture.financials')
filings = importlib.import_module('sec_fixture.filings')
client = importlib.import_module('sec_fixture.client')
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


def settings(status='configured', value=CONTACT):
    """Stands in for core configuration holding one sec_identity value."""
    blocked = None if status == 'configured' else {'schema_version': 1, 'outcome': 'error', 'data': None, 'issues': [
        {'code': 'needs_configuration', 'severity': 'error', 'fields': [{'key': 'sec_identity', 'status': status}]}]}
    return SimpleNamespace(needs_configuration=lambda _ctx: blocked,
                           value=lambda _ctx, _key: (status, value if status == 'configured' else None))


def reader(documents=None, configuration=None):
    transport, configuration = Transport(documents or {}), configuration or settings()
    return plugin.Reader(wire, connector, lambda: configuration, None, transport=transport), transport


class SecIdentity(unittest.TestCase):
    def test_ticker_lines_keep_sec_labels_with_operating_mics_under_the_filer_cik(self):
        example, stale = identity.directory_matches(DIRECTORY, STAMP, 'EXA')
        self.assertEqual(example['native_ref'], REF)
        self.assertEqual(example['identifiers'], [{'scheme': 'cik', 'value': CIK, 'level': 'issuer', 'authority': 'source_asserted'}])
        self.assertEqual(example['listings'][1], {'ticker': {'symbol': 'EXA-B'}, 'venue': {'provider_code': 'NYSE', 'operating_mic': 'XNYS'}})
        self.assertEqual(stale['listings'], [{'ticker': {'symbol': 'EXA'}}])
        other = identity.directory_matches(DIRECTORY, STAMP, 'OTHR')[0]
        self.assertEqual(other['listings'][0]['venue'], {'provider_code': 'OTC', 'operating_mic': 'OTCM'})
        for broken in ({**DIRECTORY, 'fields': ['cik', 'ticker']}, {**DIRECTORY, 'data': [[0, 'Zero', 'Z', 'NYSE']]}):
            with self.subTest(broken=broken['fields']), self.assertRaisesRegex(ValueError, 'invalid_response'):
                identity.directory_matches(broken, STAMP, 'Z')

    def test_resolve_by_ticker_is_exact_filters_by_operating_mic_and_keeps_ambiguity(self):
        instance, transport = reader({'directory': DIRECTORY})
        both = identity.directory_matches(DIRECTORY, STAMP, 'exa')
        self.assertEqual([row['native_ref']['native_id'] for row in both], [CIK, '0000345678'])
        nasdaq = instance.invoke('resolve', {'identifiers': {'ticker_mic': 'EXA@XNAS'}})
        claim, = checked_batch('sec', nasdaq).claims
        self.assertEqual((claim.native_ref.native_id, claim.attributes.name), (CIK, 'Example Holdings'))
        self.assertEqual(instance.invoke('resolve', {'identifiers': {'ticker_mic': 'EX@XNAS'}})['outcome'], 'empty')
        self.assertEqual(instance.invoke('resolve', {'identifiers': {'ticker_mic': 'EXA@XAMS'}})['outcome'], 'empty')
        self.assertEqual(len(transport.calls), 1)  # The retained ticker file serves later resolves.
        for arguments in ({}, {'identifiers': {}}, {'identifiers': {'ticker_mic': 'EXA'}}, {'identifiers': {'cik': '0'}}):
            with self.subTest(arguments=arguments):
                self.assertEqual(instance.invoke('resolve', arguments)['issues'][0]['code'], 'invalid_request')

    def test_resolve_by_cik_echoes_names_listings_and_foreign_incorporation(self):
        instance, transport = reader({'submissions': SUBMISSIONS})
        claim, = checked_batch('sec', instance.invoke('resolve', {'identifiers': {'cik': '123456'}})).claims
        self.assertEqual((claim.level, [item.value for item in claim.identifiers]), ('issuer', [CIK]))
        self.assertEqual(transport.calls[0]['cik'], CIK)
        record = identity.submission_record(SUBMISSIONS, CIK, STAMP)
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
        result = filings.filings(raw, CIK, STAMP)
        self.assertFalse(result['coverage']['complete'])
        self.assertEqual((result['filings'][0]['filed_at'], result['filings'][0]['period_end']), ('2025-08-01', '2025-06-30'))
        self.assertEqual(result['filings'][0]['title'], 'Foreign issuer report')
        self.assertEqual(result['source'], {'label': 'SEC EDGAR', 'url': 'https://www.sec.gov/edgar/browse/?CIK=' + CIK})
        for unsafe in ('../outside.htm', '/outside.htm', 'https://example.invalid/doc'):
            with self.subTest(unsafe=unsafe), self.assertRaises(ValueError):
                financials.filing_url(CIK, '0000123456-25-000001', unsafe)


def submissions_block(forms, start_year):
    """A columnar submissions block of the given forms, newest first, one filing a week from the start's end."""
    from datetime import date, timedelta
    dates = [(date(start_year, 12, 31) - timedelta(days=7 * index)).isoformat() for index in range(len(forms))]
    return {'accessionNumber': [f'0000123456-{day[2:4]}-{index:06d}' for index, day in enumerate(dates)],
            'form': list(forms), 'filingDate': dates, 'reportDate': [''] * len(forms),
            'primaryDocument': ['doc.htm'] * len(forms), 'acceptanceDateTime': [day + 'T12:00:00.000Z' for day in dates],
            'items': [''] * len(forms), 'primaryDocDescription': [''] * len(forms),
            'isInlineXBRL': [0] * len(forms), 'size': [1000] * len(forms)}


class SecFormsSearch(unittest.TestCase):
    """An annual report crowded out of the most recent filings is still found (agent eval F3)."""

    def test_a_10k_behind_many_recent_filings_is_found_in_the_whole_recent_list(self):
        recent = submissions_block(['4'] * 300 + ['8-K'] * 60 + ['10-K'] + ['8-K'] * 40, 2026)
        raw = {'cik': 123456, 'filings': {'recent': recent, 'files': []}}
        instance, transport = reader({'submissions': raw})
        plain = instance.invoke('filings', {'native_ref': REF, 'limit': 50})
        self.assertEqual({row['form'] for row in plain['data']['filings']}, {'8-K'})
        found = instance.invoke('filings', {'native_ref': REF, 'limit': 5, 'forms': ['10-K', '20-F']})
        self.assertEqual([row['form'] for row in found['data']['filings']], ['10-K'])
        self.assertEqual(found['data']['coverage']['scanned'], 401)

    def test_a_default_read_leaves_out_ownership_forms_unless_they_are_named(self):
        # Apple's newest 10-K sat at position 65 of its recent list, behind hundreds of Forms 4 and 144.
        forms = ['4', '144', 'SC 13G/A', '4/A', 'SCHEDULE 13G/A', '3', '5', '144/A', 'SCHEDULE 13G'] * 7 + ['10-K', '8-K']
        raw = {'cik': 123456, 'filings': {'recent': submissions_block(forms, 2026), 'files': []}}
        instance, _ = reader({'submissions': raw})
        plain = instance.invoke('filings', {'native_ref': REF, 'limit': 20})
        self.assertEqual([row['form'] for row in plain['data']['filings']], ['10-K', '8-K'])
        coverage = plain['data']['coverage']
        self.assertEqual((coverage['omitted'], coverage['complete']), (63, True))
        self.assertEqual(coverage['omitted_forms'], ['144', '3', '4', '5', 'SC 13G', 'SCHEDULE 13G'])
        named = instance.invoke('filings', {'native_ref': REF, 'limit': 20, 'forms': ['4', 'SCHEDULE 13G']})
        self.assertEqual({row['form'] for row in named['data']['filings']}, {'4', '4/A', 'SCHEDULE 13G/A', 'SCHEDULE 13G'})
        self.assertIsNone(named['data']['coverage']['omitted_forms'])

    def test_older_pages_are_read_back_five_years_at_most_three(self):
        recent = submissions_block(['4'] * 60, 2026)  # the recent list reaches back only a few months
        files = [{'name': f'CIK{CIK}-submissions-{index:03d}.json', 'filingCount': 10,
                  'filingFrom': f'{2025 - index}-01-01', 'filingTo': f'{2025 - index}-12-31'} for index in range(1, 9)]
        page = submissions_block(['4', '10-K/A', '4'], 2025)
        raw = {'cik': 123456, 'filings': {'recent': recent, 'files': files}}
        instance, transport = reader({'submissions': raw, 'submissions_page': page})
        found = instance.invoke('filings', {'native_ref': REF, 'limit': 5, 'forms': ['10-K']})
        pages = [call['page'] for call in transport.calls if call['operation'] == 'submissions_page']
        self.assertEqual(pages, [f'CIK{CIK}-submissions-001.json', f'CIK{CIK}-submissions-002.json',
                                 f'CIK{CIK}-submissions-003.json'])
        self.assertEqual({row['form'] for row in found['data']['filings']}, {'10-K/A'})
        self.assertEqual(found['data']['coverage']['scope'], 'recent_and_older_submissions')
        # A failed older page keeps what was read and says the search is incomplete.
        broken, _ = reader({'submissions': raw})
        broken.reads.read = (lambda original: lambda paths, request, *args, **kwargs: (
            (_ for _ in ()).throw(connector.SourceFailure({'error': 'missing_observation'}))
            if request['operation'] == 'submissions_page' else original(paths, request, *args, **kwargs)))(broken.reads.read)
        kept = broken.invoke('filings', {'native_ref': REF, 'limit': 5, 'forms': ['4']})
        self.assertEqual((kept['outcome'], len(kept['data']['filings'])), ('ok', 5))
        self.assertEqual([issue['code'] for issue in kept['issues']], [])  # enough found without paging
        missing = broken.invoke('filings', {'native_ref': REF, 'limit': 5, 'forms': ['10-K']})
        self.assertEqual((missing['outcome'], missing['data']['coverage']['complete']), ('ok', False))
        self.assertEqual([issue['code'] for issue in missing['issues']], ['incomplete'])
        with self.assertRaises(ValueError):  # only the filer's own page names reach a URL
            identity.submissions_page_url(CIK, '../CIK0000000001.json')


def periodic_submissions(*rows):
    """A submissions document listing (accession, form, isXBRL) filings, newest first."""
    return {'cik': '123456', 'filings': {'files': [], 'recent': {
        'accessionNumber': [item[0] for item in rows], 'form': [item[1] for item in rows],
        'filingDate': ['2026-06-10'] * len(rows), 'isXBRL': [item[2] for item in rows],
        'primaryDocument': ['doc.htm'] * len(rows)}}}


class SecFilingFields(unittest.TestCase):
    """The submissions fields a filing keeps, as the EDGAR submissions API defines them."""

    def block(self, **columns):
        return {'cik': 123456, 'filings': {'files': [], 'recent': {
            'accessionNumber': ['0000123456-26-000003', '0000123456-26-000002', '0000123456-26-000001'],
            'form': ['8-K', 'EFFECT', '10-K'], 'filingDate': ['2026-09-24', '2026-09-01', '2026-08-01'],
            'reportDate': ['2026-09-22', '', '2026-06-30'],
            'primaryDocument': ['ex-8k.htm', 'xslEFFECT/primary_doc.xml', 'ex-20260630.htm'],
            'acceptanceDateTime': ['2026-09-24T08:25:27.000Z', '2026-09-01T12:00:00.000Z', '2026-08-01T10:01:26.000Z'],
            'items': ['2.02,9.01', '20260901', ''], 'primaryDocDescription': ['FORM 8-K', '', '10-K'],
            'isInlineXBRL': [1, 0, 1], 'size': [412345, 1500, 9392337], **columns}}}

    def test_acceptance_time_8k_items_description_inline_xbrl_and_submission_size_are_kept(self):
        eight_k, effect, annual = filings.filings(self.block(), CIK, STAMP)['filings']
        self.assertEqual((eight_k['items'], eight_k['description']), (['2.02', '9.01'], 'FORM 8-K'))
        # Until SEC's nightly rebuild, a filing dated the reading day carries Eastern time labelled Z.
        self.assertEqual((eight_k['accepted_at'], annual['accepted_at']), ('2026-09-24T12:25:27Z', '2026-08-01T10:01:26Z'))
        self.assertEqual((annual['inline_xbrl'], annual['submission_bytes'], annual['items']), (True, 9392337, None))
        # Other forms put dates or form names in `items`; only 8-K item numbers are read.
        self.assertEqual((effect['items'], effect['description']), (None, None))

    def test_after_eastern_midnight_the_previous_days_acceptance_time_is_left_out(self):
        # SEC rewrites Eastern times to UTC at an unknown hour after midnight; until 06:00 ET only the date is sure.
        block = self.block(filingDate=['2026-09-25', '2026-09-24', '2026-09-23'],
                           acceptanceDateTime=['2026-09-25T00:10:00.000Z', '2026-09-24T21:00:00.000Z',
                                               '2026-09-23T14:00:00.000Z'])
        night = filings.filings(block, CIK, '2026-09-25T05:00:00+00:00')  # 01:00 ET
        self.assertEqual([row['accepted_at'] for row in night['filings']],
                         ['2026-09-25T04:10:00Z', None, '2026-09-23T14:00:00Z'])
        self.assertEqual(night['filings'][1]['filed_at'], '2026-09-24')
        self.assertNotIn('drift', night)
        morning = filings.filings(block, CIK, '2026-09-25T11:00:00+00:00')  # 07:00 ET
        self.assertEqual(morning['filings'][1]['accepted_at'], '2026-09-24T21:00:00Z')

    def test_missing_or_malformed_fields_are_counted_as_drift_never_reinterpreted(self):
        result = filings.filings(self.block(size=[1, 'large', 3], items=['2.02,10.01', '', '']), CIK, STAMP)
        self.assertEqual(result['filings'][1]['submission_bytes'], None)
        self.assertEqual(result['drift'], {'malformed': {'size': 1}, 'unknown_8k_item': {'10.01': 1}})
        missing = filings.filings(self.block(acceptanceDateTime=None), CIK, STAMP)
        self.assertEqual(missing['drift'], {'missing_field': {'acceptanceDateTime': 1}})
        self.assertEqual({row['accepted_at'] for row in missing['filings']}, {None})
        with self.assertRaisesRegex(ValueError, 'invalid_response'):  # a column of another length is a broken shape
            filings.filings(self.block(size=[1, 2]), CIK, STAMP)

    def test_an_unknown_form_is_only_logged_while_a_malformed_field_warns(self):
        raw = self.block(form=['8-K', 'SCHEDULE 13Z', '10-K'])
        instance, _ = reader({'submissions': raw})
        result = instance.invoke('filings', {'native_ref': REF})
        self.assertEqual(result['outcome'], 'ok')
        self.assertEqual(result['data']['filings'][1]['title'], 'SCHEDULE 13Z')
        self.assertEqual(result['data']['drift'], {'unknown_form': {'SCHEDULE 13Z': 1}})
        self.assertEqual(result['issues'], [])  # logged for maintainers only: the row is unchanged
        malformed = instance.invoke('filings', {'native_ref': REF, 'refresh': True})
        self.assertEqual(malformed['issues'], [])
        broken, _ = reader({'submissions': self.block(size=[1, 'large', 3])})
        issue, = broken.invoke('filings', {'native_ref': REF})['issues']
        self.assertEqual((issue['code'], issue['severity']), ('drift', 'warning'))
        self.assertIn('size', issue['message'])

    def test_titles_cover_renamed_ownership_schedules_and_offering_forms(self):
        self.assertEqual({form: filings.filing_title(form) for form in
                          ('SCHEDULE 13G/A', 'SC 13G', '144', '424B2', 'FWP', 'PX14A6G', 'SD')}, {
            'SCHEDULE 13G/A': 'Passive investor ownership report (amended)',
            'SC 13G': 'Passive investor ownership report',
            '144': 'Notice of proposed sale of restricted securities', '424B2': 'Prospectus',
            'FWP': 'Free writing prospectus', 'PX14A6G': 'Exempt proxy solicitation notice',
            'SD': 'Specialized disclosure report'})


class SecFactsFreshness(unittest.TestCase):
    """companyfacts must include the latest periodic report (it silently lacked 2026 20-F statements)."""

    def facts(self, accession, taxonomy='ifrs-full'):
        raw = companyfacts({'JPY': [observation(100, form='20-F', accession=accession)]}, taxonomy, 'Revenue')
        raw['facts']['dei'] = {'EntityCommonStockSharesOutstanding': {'units': {'shares': [
            observation(5, start=None, form='20-F', accession='0000123456-26-000009')]}}}
        return raw

    def test_the_latest_periodic_accession_must_carry_statement_facts(self):
        submissions = periodic_submissions(('0000123456-26-000010', '6-K', 0), ('0000123456-26-000011', '20-F/A', 1),
                                           ('0000123456-26-000009', '20-F', 1), ('0000123456-25-000001', '20-F', 1))
        stale = financials.freshness(submissions, self.facts('0000123456-25-000001'), CIK, STAMP)
        self.assertEqual((stale['status'], stale['latest_filing']['accession']), ('stale', '0000123456-26-000009'))
        self.assertIn('0000123456-26-000009', stale['reason'])
        fresh = financials.freshness(submissions, self.facts('0000123456-26-000009', 'us-gaap'), CIK, STAMP)
        self.assertEqual((fresh['status'], fresh['reason']), ('fresh', None))
        self.assertIsNone(financials.freshness(periodic_submissions(('0000123456-26-000010', '6-K', 0)),
                                               self.facts('0000123456-25-000001'), CIK, STAMP))
        unflagged = periodic_submissions(('0000123456-26-000009', '20-F', 1))
        del unflagged['filings']['recent']['isXBRL']
        self.assertEqual(financials.freshness(unflagged, self.facts('0000123456-25-000001'), CIK, STAMP)['status'], 'unknown')

    def test_stale_fundamentals_say_so_in_the_result_and_its_issues(self):
        submissions = periodic_submissions(('0000123456-26-000009', '20-F', 1))
        instance, transport = reader({'companyfacts': self.facts('0000123456-25-000001'), 'submissions': submissions})
        result = instance.invoke('fundamentals', {'native_ref': REF})
        self.assertEqual((result['outcome'], result['data']['freshness']['status']), ('ok', 'stale'))
        self.assertEqual([(issue['code'], issue['severity']) for issue in result['issues']], [('stale', 'warning')])
        self.assertTrue(result['data']['limitations'][0].startswith('Stale:'))
        self.assertEqual(result['data']['facts'][0]['value'], '100')  # still served, marked stale
        unread, _ = reader({'companyfacts': self.facts('0000123456-25-000001')})
        unknown = unread.invoke('fundamentals', {'native_ref': REF})
        self.assertEqual((unknown['data']['freshness']['status'], unknown['issues'][0]['code']),
                         ('unknown', 'freshness_unknown'))
        current, _ = reader({'companyfacts': self.facts('0000123456-26-000009'), 'submissions': submissions})
        fresh = current.invoke('fundamentals', {'native_ref': REF})
        self.assertEqual((fresh['issues'], fresh['data']['freshness']['status']), ([], 'fresh'))


class SecFactsCacheSkew(unittest.TestCase):
    def test_a_retained_copy_older_than_the_filing_is_read_once_more_before_it_is_called_stale(self):
        old, new = SecFactsFreshness.facts(None, '0000123456-25-000001'), SecFactsFreshness.facts(None, '0000123456-26-000009')
        submissions = periodic_submissions(('0000123456-26-000009', '10-Q', 1))
        submissions['filings']['recent']['acceptanceDateTime'] = ['2026-06-10T06:00:00.000Z']  # 10:00 UTC, filed that day

        class Copies(Transport):
            def __init__(self, copies):
                super().__init__({'submissions': submissions})
                self.copies = copies

            def run_worker(self, _command, request, _environment, **_options):
                if request['operation'] != 'companyfacts':
                    return {**super().run_worker(_command, request, _environment), 'observed_at': '2026-06-10T12:00:00+00:00'}
                self.calls.append(deepcopy(request))
                data, observed = self.copies.pop(0)
                return {'data': deepcopy(data), 'observed_at': observed, 'issues': []}
        transport = Copies([(old, '2026-06-10T09:00:00+00:00'), (new, '2026-06-10T12:00:00+00:00')])
        instance = plugin.Reader(wire, connector, settings, None, transport=transport)
        for _ in range(2):  # the re-read happens once per filing; the second call reuses it
            result = instance.invoke('fundamentals', {'native_ref': REF})
            self.assertEqual((result['data']['freshness']['status'], result['issues']), ('fresh', []))
        self.assertEqual([call['operation'] for call in transport.calls].count('companyfacts'), 2)
        # A copy read after the filing and still lacking it is SEC's lag: stale, with no second read.
        lagging = Copies([(old, '2026-06-10T11:00:00+00:00')])
        stale = plugin.Reader(wire, connector, settings, None, transport=lagging).invoke('fundamentals', {'native_ref': REF})
        self.assertEqual(stale['data']['freshness']['status'], 'stale')
        self.assertEqual([call['operation'] for call in lagging.calls].count('companyfacts'), 1)


class SecConfiguration(unittest.TestCase):
    def test_missing_or_unusable_contact_needs_configuration_and_makes_no_request(self):
        for configuration in (settings('missing'), settings('invalid'), settings(value='no-email-contact'),
                              settings(value='research@example.invalid'),
                              settings(value='\u00c9mile Research emile@example.invalid')):
            with self.subTest(configuration=configuration.value(None, 'sec_identity')):
                instance, transport = reader({}, configuration)
                issue = instance.invoke('filings', {'native_ref': REF})['issues'][0]
                self.assertEqual((issue['code'], issue['fields'][0]['key']), ('needs_configuration', 'sec_identity'))
                self.assertEqual(transport.calls, [])

    def test_reads_stay_visible_and_report_configuration_when_called(self):
        tools = {}
        ctx = SimpleNamespace(register_tool=lambda **tool: tools.update({tool['name']: tool}))
        selection = SimpleNamespace(native_access_scope=lambda: {'cacheable': True, 'scope': 'fixture'})
        platform = SimpleNamespace(platform=lambda: SimpleNamespace(configuration=settings('missing')))
        self.enterContext(patch.object(plugin, 'helpers', return_value=(wire, connector, selection, platform)))
        plugin.register(ctx)
        self.assertTrue(all(tool['check_fn']() for tool in tools.values()))
        result = json.loads(tools['pythia_sec_resolve']['handler']({'identifiers': {'cik': CIK}}))
        self.assertEqual(result['issues'][0]['code'], 'needs_configuration')


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

    def test_gzip_responses_are_inflated_within_the_size_limit(self):
        def serve(_request, timeout):
            response = io.BytesIO(gzip.compress(json.dumps(SUBMISSIONS).encode()))
            response.status, response.headers = 200, {'Content-Encoding': 'gzip'}
            return response
        transport = client.Transport(connector, opener=SimpleNamespace(open=serve))

        def read():
            return transport.run_worker([], {'operation': 'submissions', 'cik': CIK, 'contact': CONTACT}, {},
                cancelled=lambda: False, budget=connector.connection('sec-test-gzip', concurrency=1, per_minute=10))
        self.assertEqual(read()['data'], SUBMISSIONS)
        with patch.object(client, 'MAX_BYTES', 64), self.assertRaisesRegex(RuntimeError, 'output_limit'):
            read()

    def test_successful_reads_are_retained_but_failures_and_refresh_are_not(self):
        class Flaky(Transport):
            fail = False

            def run_worker(self, *args, **options):
                if self.fail:
                    self.calls.append('failed')
                    raise connector.SourceFailure({'error': 'rate_limit', 'retry_after': 30, 'limit_origin': 'provider'})
                return super().run_worker(*args, **options)
        transport = Flaky({'companyfacts': companyfacts({'USD': [observation(100)]}),
                           'submissions': periodic_submissions(('0000123456-25-000001', '10-K', 1))})
        instance = plugin.Reader(wire, connector, settings, None, transport=transport)
        for _ in range(2):
            self.assertEqual(instance.invoke('fundamentals', {'native_ref': REF})['outcome'], 'ok')
        self.assertEqual(len(transport.calls), 2)  # companyfacts and submissions, each once
        transport.fail = True
        for _ in range(2):
            issue = instance.invoke('fundamentals', {'native_ref': REF, 'refresh': True})['issues'][0]
            self.assertEqual((issue['code'], issue['retry_after_seconds']), ('rate_limit', 30))
        self.assertEqual(len(transport.calls), 4)


if __name__ == '__main__':
    unittest.main()
