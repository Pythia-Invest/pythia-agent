"""Synthetic FCA NSM search answers; no provider responses retained.

The NSM search is undocumented. Field names and meanings follow the NSM page's own column list ("Filing Date/Time"
is `submitted_date`, "Publication Date/Time" `publication_date`, "Disclosing Organisation LEI" `lei`) and the shape
measured in docs/sources/nsm.md. Identifiers are invented and checksummed.
"""
from copy import deepcopy
import importlib
import importlib.util
import json
from pathlib import Path
import sys
import unittest

from market_data_fixture import wire
from native_plugin_fixtures import Context
from test_gleif_connector import register_with_market_data
from test_plugin_contracts import checked_batch

ROOT = Path(__file__).resolve().parents[2] / 'managed/plugins/nsm'
spec = importlib.util.spec_from_file_location('nsm_fixture', ROOT / '__init__.py', submodule_search_locations=[str(ROOT)])
plugin = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = plugin
spec.loader.exec_module(plugin)
records = importlib.import_module('nsm_fixture.records')
connector = importlib.import_module(wire.__package__ + '.connector')
STAMP = '2026-09-28T12:00:00+00:00'


def test_lei(seed):
    prefix = 'ZZZZ00' + seed * 12
    return next(prefix + f'{i:02}' for i in range(100)
                if int(''.join(str(int(c, 36)) for c in prefix + f'{i:02}')) % 97 == 1)


LEI, OTHER = test_lei('A'), test_lei('B')
REF = records.reference(LEI)


def disclosure(number=1, *, code='POS', kind='Transaction in Own Shares', leis=LEI, company='EXAMPLE PLC', **extra):
    ident = f'00000000-0000-4000-8000-{number:012d}'
    return {'_index': 'fca-nsm-searchdata', '_id': ident, '_source': {
        'disclosure_id': ident, 'seq_id': ident, 'hist_seq': '1', 'latest_flag': 'Y', 'lei': leis,
        'company': company, 'related_org': [], 'lei_remediation_flag': 'N', 'headline': kind, 'type': kind,
        'type_code': code, 'category_group': 'Corporate actions', 'classifications': '', 'classifications_code': '',
        'tag_esef': '', 'source': 'RNS', 'document_format': 'Plain text',
        'download_link': f'NSM/RNS/{ident}.html', 'submitted_date': f'2026-09-{29 - number}T10:16:55Z',
        'publication_date': f'2026-09-{29 - number}T10:15:10.500Z', 'document_date': '2026-09-28T10:16:55Z',
        'last_updated_date': '2026-09-28T10:16:55.123456789Z', **extra}}


def answer(*hits, total=None):
    return {'took': 3, 'timed_out': False, '_shards': {'total': 4, 'successful': 4, 'skipped': 0, 'failed': 0},
            'hits': {'total': {'value': len(hits) if total is None else total, 'relation': 'eq'}, 'hits': list(hits)}}


class Transport:
    def __init__(self, *payloads):
        self.payloads, self.requests = list(payloads), []

    def run_worker(self, _command, request, _environment, **_options):
        self.requests.append(deepcopy(request))
        value = self.payloads.pop(0)
        if isinstance(value, Exception):
            raise value
        return {'data': deepcopy(value), 'observed_at': STAMP, 'issues': []}


def reader(*payloads):
    transport = Transport(*payloads)
    return plugin.Reader(wire, connector, transport=transport), transport


class NsmSemantics(unittest.TestCase):
    def test_registers_only_read_operations_in_cores_hidden_toolset(self):
        ctx = Context('pythia-nsm')
        register_with_market_data(self, plugin, ctx, Transport(answer(disclosure())), iter([{'scope': 'a'}] * 2))
        self.assertEqual(set(ctx.tools), {'pythia_nsm_resolve', 'pythia_nsm_filings', 'pythia_nsm_news'})
        for name, entry in ctx.registrations.items():
            declared = json.loads(entry['schema']['parameters']['$comment'])['pythia_http_operation']
            self.assertEqual((declared['plugin'], declared['read_only'], entry['toolset']),
                             ('pythia-nsm', True, 'pythia-core'), name)
            self.assertIn('undocumented', entry['schema']['description'])
        batch = checked_batch('nsm', ctx.tools['pythia_nsm_resolve']({'identifiers': {'lei': LEI}}))
        self.assertEqual((batch.claims[0].native_ref.native_id, batch.claims[0].attributes.name),
                         (LEI, 'EXAMPLE PLC'))

    def test_one_page_search_as_the_nsm_page_sends_it_serves_filings_and_news(self):
        nsm, transport = reader(answer(disclosure(1), disclosure(2, code='DSH', kind='Director/PDMR Shareholding')))
        filings = nsm.invoke('filings', {'native_ref': REF})
        news = nsm.invoke('news', {'native_ref': REF, 'limit': 1})
        self.assertEqual(len(transport.requests), 1)  # the retained answer serves both
        request, = transport.requests
        self.assertEqual((request['url'], request['json']['size']), (records.SEARCH_URL, 100))
        self.assertEqual(request['json']['criteriaObj']['criteria'],
                         [{'name': 'company_lei', 'value': ['', LEI, 'disclose_org', '']},
                          {'name': 'latest_flag', 'value': 'Y'}])
        row = filings['data']['filings'][0]
        self.assertEqual((row['accession'], row['form'], row['kind'], row['filed_at'], row['accepted_at']),
                         ('00000000-0000-4000-8000-000000000001', 'POS', 'other', '2026-09-28', '2026-09-28T10:16:55Z'))
        self.assertEqual((row['format'], row['via'], row['period_end'], row['basis'], row['language']),
                         ('text', 'RNS', None, None, None))
        self.assertEqual(row['url'], 'https://data.fca.org.uk/artefacts/NSM/RNS/00000000-0000-4000-8000-000000000001.html')
        self.assertEqual(filings['data']['filings'][1]['kind'], 'ownership')
        item, = news['data']['news']
        self.assertEqual((item['title'], item['published_at'], item['publisher'], item['kind'], item['via']),
                         ('Transaction in Own Shares', '2026-09-28T10:15:10Z', 'FCA NSM', 'regulatory', 'RNS'))

    def test_a_joint_disclosure_names_every_filer_and_the_issuers_own_name_resolves(self):
        joint = disclosure(1, code='PDI', kind='Base Prospectus', leis=f'{LEI};{OTHER}',
                           company='EXAMPLE PLC;EXAMPLE FINANCE B.V.;')
        nsm, _ = reader(answer(joint, disclosure(2, company='Example plc')))
        row = nsm.invoke('filings', {'native_ref': REF})['data']['filings'][0]
        self.assertEqual((row['kind'], [party['id'] for party in row['parties']]), ('prospectus', [LEI, OTHER]))
        claim, = checked_batch('nsm', nsm.invoke('resolve', {'identifiers': {'lei': LEI}})).claims
        self.assertEqual(claim.attributes.name, 'Example plc')  # the joint disclosure's first name is not taken

    def test_an_lei_the_nsm_does_not_list_resolves_to_nothing(self):
        nsm, _ = reader(answer())
        self.assertEqual(nsm.invoke('resolve', {'identifiers': {'lei': LEI}})['outcome'], 'empty')

    def test_kinds_with_headline_codes_search_the_whole_archive(self):
        annual = disclosure(1, code='ACS', kind='Annual Financial Report', document_format='Tagged', tag_esef='Tagged')
        nsm, transport = reader(answer(annual, disclosure(2, code='POS')))
        result = nsm.invoke('filings', {'native_ref': REF, 'kinds': ['annual', 'half_year']})
        self.assertEqual(transport.requests[0]['json']['criteriaObj']['criteria'][2],
                         {'name': 'type_code', 'value': ['ACS', 'IR']})
        self.assertEqual([row['form'] for row in result['data']['filings']], ['ACS'])  # the filter did not hold
        self.assertEqual((result['data']['filings'][0]['format'], result['issues'][0]['code']), ('ixbrl', 'source_drift'))
        inside = disclosure(3, code='MSCL', kind='Miscellaneous', classifications_code='3.1;2.2')
        self.assertEqual(records.disclosures(answer(inside), LEI)['rows'][0]['kind'], 'event')
        nsm, transport = reader(answer(disclosure(1), inside))
        events = nsm.invoke('filings', {'native_ref': REF, 'kinds': ['event'], 'limit': 1})
        self.assertEqual(len(transport.requests[0]['json']['criteriaObj']['criteria']), 2)  # no code: the newest page
        self.assertEqual([row['kind'] for row in events['data']['filings']], ['event'])  # filtered before the limit
        # A mixed set searches the archive for the coded kinds and the newest page for the rest, once each row.
        nsm, transport = reader(answer(annual), answer(disclosure(1), inside, annual))
        mixed = nsm.invoke('filings', {'native_ref': REF, 'kinds': ['annual', 'event']})
        self.assertEqual([len(request['json']['criteriaObj']['criteria']) for request in transport.requests], [3, 2])
        self.assertEqual([row['form'] for row in mixed['data']['filings']], ['ACS', 'MSCL'])

    def test_unexpected_input_is_counted_never_coerced(self):
        rows = [disclosure(1, NewField='x'), disclosure(2, leis=OTHER), disclosure(3, latest_flag='N'),
                disclosure(4, IsTestSubmission=True), disclosure(5, submitted_date='28/09/2026 10:16'),
                disclosure(6, download_link='https://elsewhere.example/x.html'), disclosure(7, source='NEWWIRE')]
        del rows[6]['_source']['headline']
        parsed = records.disclosures(answer(*rows), LEI)
        self.assertEqual([row['id'][-1] for row in parsed['rows']], ['1'])
        self.assertEqual(parsed['drift'], {'unknown_field': {'NewField': 1}, 'foreign_lei': {'row': 1},
                                           'not_latest': {'row': 1}, 'test_submission': {'row': 1},
                                           'malformed_time': {'row': 1}, 'malformed_link': {'row': 1},
                                           'missing_field': {'headline': 1}})
        nsm, _ = reader(answer(*rows))
        result = nsm.invoke('news', {'native_ref': REF})
        self.assertEqual((result['outcome'], len(result['data']['news'])), ('ok', 1))
        self.assertIn('6 NSM disclosure(s)', result['issues'][0]['message'])

    def test_a_changed_envelope_or_refused_search_is_an_error_never_no_disclosures(self):
        changed = answer(disclosure(1))
        changed['hits']['total'] = 1
        nsm, _ = reader(changed)
        self.assertEqual(nsm.invoke('filings', {'native_ref': REF})['issues'][0]['code'], 'invalid_response')
        refused = connector.SourceFailure({'error': 'missing_observation', 'limit_origin': 'provider'})
        nsm, _ = reader(refused)  # the NSM answers a query it cannot run with 404 "Unable to search the data"
        result = nsm.invoke('news', {'native_ref': REF})
        self.assertEqual((result['outcome'], result['issues'][0]['code']), ('error', 'source_drift'))

    def test_an_issuer_listed_earlier_that_now_lists_nothing_raises_the_alarm(self):
        nsm, _ = reader(answer(disclosure(1)), answer())
        self.assertEqual(nsm.invoke('news', {'native_ref': REF})['outcome'], 'ok')
        result = nsm.invoke('news', {'native_ref': REF, 'refresh': True})
        self.assertEqual((result['outcome'], result['issues'][0]['code']), ('error', 'source_drift'))
        fresh, _ = reader(answer())  # an issuer never seen with disclosures is simply empty
        self.assertEqual(fresh.invoke('news', {'native_ref': REF})['data']['news'], [])

    def test_references_are_checked_leis(self):
        for bad in ({**REF, 'native_id': LEI[:-2] + '00'}, {**REF, 'provider': 'sec'}, {**REF, 'qualifiers': {'x': 1}}):
            with self.assertRaises(ValueError):
                records.from_reference(bad)


if __name__ == '__main__':
    unittest.main()
