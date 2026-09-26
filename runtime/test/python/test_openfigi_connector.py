"""Synthetic mapping jobs shaped by https://www.openfigi.com/api/documentation.

ZZ-prefixed ISINs and BBGZZ FIGIs below are fabricated identifiers, not securities.
"""
import importlib
import importlib.util
import io
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from urllib.error import HTTPError

from market_data_fixture import wire

ROOT = Path(__file__).resolve().parents[2] / 'managed/plugins/openfigi'
spec = importlib.util.spec_from_file_location('openfigi_fixture', ROOT / '__init__.py', submodule_search_locations=[str(ROOT)])
plugin = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = plugin
spec.loader.exec_module(plugin)
mapping = importlib.import_module('openfigi_fixture.mapping')
client = importlib.import_module('openfigi_fixture.client')
connector = importlib.import_module(wire.__package__ + '.connector')
governor = importlib.import_module(wire.__package__ + '.governor')

ISIN = 'ZZ1234567895'
FAKE_KEY = 'synthetic-test-key'


def candidate(n, exch='NA'):
    return {'figi': f'BBGZZ{n:07d}', 'compositeFIGI': f'BBGZZ{n + 1:07d}', 'shareClassFIGI': 'BBGZZ9999999',
            'ticker': 'SYN', 'exchCode': exch, 'name': 'SYNTHETIC NV', 'securityType': 'Common Stock',
            'marketSector': 'Equity', 'securityType2': 'Common Stock', 'securityDescription': 'SYN'}


class Opener:
    """Answers each POST in order; records headers and job counts only."""

    def __init__(self, answers):
        self.answers, self.requests = list(answers), []

    def open(self, request, timeout):
        jobs = json.loads(request.data)
        self.requests.append({'jobs': len(jobs), 'key': request.get_header('X-openfigi-apikey')})
        answer = self.answers.pop(0)
        if isinstance(answer, int):
            raise HTTPError(request.full_url, answer, 'Throttled', {'ratelimit-reset': '7'}, io.BytesIO())
        body = json.dumps(answer(jobs) if callable(answer) else answer).encode()
        response = io.BytesIO(body)
        response.status = 200
        return response


def found(jobs):
    return [{'data': [candidate(index)]} for index, _ in enumerate(jobs)]


def resolver(opener, key=('missing', None)):
    transport = client.Transport(connector, opener=opener)
    configuration = SimpleNamespace(value=lambda _ctx, _key: key)  # Stands in for core configuration.
    return plugin.Resolver(wire, connector, lambda: configuration, None, transport=transport)


class OpenFigiJobs(unittest.TestCase):
    def test_identifiers_are_checked_before_provider_work(self):
        valid = [{'idType': 'ID_ISIN', 'idValue': ISIN}, {'idType': 'ID_ISIN', 'idValue': ISIN, 'micCode': 'XAMS'},
                 {'idType': 'TICKER', 'idValue': 'SYN', 'micCode': 'XNAS'}, {'idType': 'TICKER', 'idValue': 'SYN', 'exchCode': 'NA'}]
        self.assertEqual(mapping.validate(valid), valid)
        for job in ({'idType': 'ID_ISIN', 'idValue': 'ZZ1234567894'}, {'idType': 'ID_CUSIP', 'idValue': 'ZZ0000000'},
                    {'idType': 'TICKER', 'idValue': 'SYN'}, {'idType': 'ID_ISIN', 'idValue': ISIN, 'micCode': 'XAMS', 'exchCode': 'NA'},
                    {'idType': 'ID_ISIN', 'idValue': ISIN, 'micCode': 'xams'}, {'idType': 'NAME', 'idValue': 'Synthetic'}):
            with self.subTest(job=job), self.assertRaisesRegex(ValueError, 'invalid_request'):
                mapping.validate([job])
        with self.assertRaisesRegex(ValueError, 'invalid_request'):
            mapping.validate([valid[0]] * 101)

    def test_results_keep_every_candidate_and_distinguish_no_match_from_errors(self):
        rows = mapping.rows([{'data': [candidate(1), candidate(3, 'GY')]}, {'warning': 'No identifier found.'},
                             {'error': 'Synthetic job error'}], 3)
        results = [mapping.result({'n': index}, row) for index, row in enumerate(rows)]
        self.assertEqual([row['outcome'] for row in results], ['found', 'not_found', 'error'])
        self.assertEqual([item['exchCode'] for item in results[0]['candidates']], ['NA', 'GY'])
        self.assertEqual(results[0]['candidates'][0]['shareClassFIGI'], 'BBGZZ9999999')
        for broken in ([], [{'data': [{**candidate(1), 'figi': 'not-a-figi'}]}]):
            with self.subTest(broken=broken), self.assertRaisesRegex(ValueError, 'invalid_response'):
                [mapping.result({}, row) for row in mapping.rows(broken, 1)]


class OpenFigiResolve(unittest.TestCase):
    def setUp(self):
        governor._owners.clear()  # Connection budgets are process-wide; isolate each case.

    def jobs(self, count):
        return [{'idType': 'ID_ISIN', 'idValue': ISIN, 'exchCode': f'Z{index}'} for index in range(count)]

    def test_request_size_follows_key_mode_and_the_key_is_only_a_header(self):
        keyless = Opener([found] * 3)
        result = resolver(keyless).invoke({'jobs': self.jobs(25)})
        self.assertEqual(result['outcome'], 'ok')
        self.assertEqual([request['jobs'] for request in keyless.requests], [10, 10, 5])
        self.assertTrue(all(request['key'] is None for request in keyless.requests))
        self.assertEqual([row['job']['exchCode'] for row in result['data']['results']], [job['exchCode'] for job in self.jobs(25)])
        keyed = Opener([found])
        answer = resolver(keyed, ('configured', FAKE_KEY)).invoke({'jobs': self.jobs(25)})
        self.assertEqual(keyed.requests, [{'jobs': 25, 'key': FAKE_KEY}])
        self.assertNotIn(FAKE_KEY, json.dumps(answer))

    def test_throttled_later_batch_keeps_earlier_answers_and_is_not_retained(self):
        opener = Opener([found, 429, found, found])
        instance = resolver(opener)
        result = instance.invoke({'jobs': self.jobs(15)})
        self.assertEqual(result['outcome'], 'partial')
        self.assertEqual([row['outcome'] for row in result['data']['results']], ['found'] * 10 + ['unanswered'] * 5)
        self.assertEqual((result['issues'][0]['code'], result['issues'][0]['retry_after_seconds']), ('rate_limit', 7))
        # The provider throttle also pauses the shared budget; nothing more is sent.
        self.assertEqual(instance.invoke({'jobs': self.jobs(15)})['issues'][0]['code'], 'rate_limit')
        self.assertEqual(len(opener.requests), 2)
        governor._owners.clear()  # After the cooldown the partial answer is not reused.
        self.assertEqual(instance.invoke({'jobs': self.jobs(15)})['outcome'], 'ok')
        self.assertEqual(len(opener.requests), 4)

    def test_unreadable_later_batch_keeps_earlier_answers(self):
        def unreadable(jobs):
            return [{'data': [{**candidate(1), 'figi': 'not-a-figi'}]} for _ in jobs]
        result = resolver(Opener([found, unreadable])).invoke({'jobs': self.jobs(15)})
        self.assertEqual(result['outcome'], 'partial')
        self.assertEqual([row['outcome'] for row in result['data']['results']], ['found'] * 10 + ['unanswered'] * 5)
        self.assertEqual(result['issues'][0]['code'], 'invalid_response')

    def test_success_is_retained_and_an_invalid_key_falls_back_to_keyless_limits(self):
        opener = Opener([found])
        instance = resolver(opener, ('invalid', None))
        first = instance.invoke({'jobs': self.jobs(2)})
        self.assertEqual(first['issues'][0]['code'], 'invalid_configuration')
        self.assertEqual(instance.invoke({'jobs': self.jobs(2)})['data'], first['data'])
        self.assertEqual(opener.requests, [{'jobs': 2, 'key': None}])

    def test_first_request_failure_is_a_qualified_error(self):
        result = resolver(Opener([429])).invoke({'jobs': self.jobs(1)})
        self.assertEqual(result['outcome'], 'error')
        self.assertEqual(result['issues'][0]['code'], 'rate_limit')
        self.assertEqual(result['issues'][0]['limit_origin'], 'provider')

    def test_pacing_defers_instead_of_exceeding_the_documented_window(self):
        now = [100.0]
        transport = client.Transport(connector, opener=Opener([]), clock=lambda: now[0])
        for _ in range(25):
            transport._pace(lambda: False, deadline=101.0)
        with self.assertRaises(connector.SourceFailure) as caught:
            transport._pace(lambda: False, deadline=101.0)
        self.assertEqual((caught.exception.raw['error'], caught.exception.raw['retry_after']), ('rate_limit', 6))
        now[0] = 106.5
        transport._pace(lambda: False, deadline=107.0)


if __name__ == '__main__':
    unittest.main()
