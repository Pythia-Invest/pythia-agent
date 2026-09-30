"""Synthetic mapping jobs shaped by https://www.openfigi.com/api/documentation.

ZZ-prefixed ISINs and BBGZZ FIGIs below are fabricated identifiers, not securities. The Toyota answer is built by hand
in the shape OpenFIGI gave on 2026-09-30 (country composite lines beside venue lines, one share-class FIGI); only its
ISIN is real, and no provider response is kept. Exchange codes are real Bloomberg codes; the vocabulary decides what
each is.
"""
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

from market_data_fixture import connector, platform_module, wire
from native_plugin_fixtures import without_market_data
from test_plugin_contracts import checked_batch, identity

ROOT = Path(__file__).resolve().parents[2] / 'managed/plugins/openfigi'
spec = importlib.util.spec_from_file_location('openfigi_fixture', ROOT / '__init__.py', submodule_search_locations=[str(ROOT)])
plugin = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = plugin
spec.loader.exec_module(plugin)
mapping = importlib.import_module('openfigi_fixture.mapping')
client = importlib.import_module('openfigi_fixture.client')
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


def figi(stem):
    """A fabricated FIGI with the check digit core verifies."""
    for digit in '0123456789':
        try:
            return identity.normalize_identifier('figi', stem + digit)
        except ValueError:
            pass


TOYOTA = 'JP3633400001'
SHARE_CLASS, OTHER_CLASS = figi('BBGZZ0000S0'), figi('BBGZZ0000S2')
JP, JT, JU, GR, GF, GS, X1, GM = (figi(stem) for stem in ('BBGZZ0000C1', 'BBGZZ0000L1', 'BBGZZ0000L2', 'BBGZZ0000C2',
                                                          'BBGZZ0000L3', 'BBGZZ0000L4', 'BBGZZ0000L5', 'BBGZZ0000L6'))


def line(exch, number, composite, ticker, share_class=SHARE_CLASS):
    return {'figi': number, 'compositeFIGI': composite, 'shareClassFIGI': share_class, 'ticker': ticker,
            'exchCode': exch, 'name': 'TOYOTA MOTOR CORP', 'securityType': 'Common Stock', 'marketSector': 'Equity',
            'securityType2': 'Common Stock', 'securityDescription': ticker}


# The Japan (JP) and Germany (GR) composites, Tokyo (JT), Frankfurt (GF) and Stuttgart (GS) lines, Japannext's second
# book (JU), and a trade-report line without a share-class FIGI (X1).
TOYOTA_LINES = [line('JP', JP, JP, '7203'), line('JT', JT, JP, '7203'), line('JU', JU, JP, '7203'),
                line('GR', GR, GR, 'TOM'), line('GF', GF, GR, 'TOM'), line('GS', GS, GR, 'TOM/A'),
                line('X1', X1, figi('BBGZZ0000C3'), '7203USD', share_class=None)]


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


class OpenFigiClaims(unittest.TestCase):
    """Core's single-ISIN lookup (ADR 0044, note of 2026-09-30): an ISIN's lines as listing claims."""

    def setUp(self):
        governor._owners.clear()

    def claims(self, lines, isin=TOYOTA):
        result = resolver(Opener([[{'data': lines}]])).invoke({'identifiers': {'isin': isin}}, operation='resolve')
        self.assertEqual(result['outcome'], 'ok', result)
        return {claim.native_ref.native_id: claim for claim in checked_batch('openfigi', result).claims}

    def test_every_line_is_a_figi_keyed_listing_claim_under_the_isin_and_none_is_dropped(self):
        claims = self.claims(TOYOTA_LINES)
        self.assertEqual(set(claims), {JP, JT, JU, GR, GF, GS, X1})
        tokyo = claims[JT]
        self.assertEqual({(item.scheme, item.value, item.role) for item in tokyo.identifiers},
                         {('figi', JT, 'self'), ('composite_figi', JP, 'self'), ('share_class_figi', SHARE_CLASS, 'self'),
                          ('isin', TOYOTA, 'self')})
        self.assertEqual((tokyo.level, tokyo.attributes.operating_mic, tokyo.attributes.ticker,
                          tokyo.attributes.asset_class), ('listing', 'XJPX', '7203', 'equity'))
        # Only an order book (an exchange code) names an operating MIC; every other line says why it names none.
        self.assertEqual({figi: (claims[figi].attributes.operating_mic, claims[figi].attributes.venue_note)
                          for figi in claims},
                         {JT: ('XJPX', None), GF: ('XFRA', None), GS: ('XSTU', None),
                          JP: (None, 'venue code JP is the JP composite, not a venue'),
                          GR: (None, 'venue code GR is the DE composite, not a venue'),
                          JU: (None, 'venue code JU is a second book on SBIJ (Japannext - X - Market); JE is the line there'),
                          X1: (None, 'venue code X1 is a trade report (Tradecho Eu Apa), not an order book')})
        # A ticker is evidence only: never a key or identifier, and left out outside core's grammar.
        self.assertEqual({claim.native_ref.native_scope for claim in claims.values()}, {'figi'})
        self.assertFalse(any(item.scheme == 'ticker_mic' for claim in claims.values() for item in claim.identifiers))
        self.assertEqual((claims[GF].attributes.ticker, claims[GS].attributes.ticker), ('TOM', None))
        self.assertNotIn('share_class_figi', {item.scheme for item in claims[X1].identifiers})

    def test_a_line_that_is_no_order_book_keeps_its_code_and_the_reason_in_the_vocabulary_words(self):
        codes = ['GD', 'QT', 'XV', 'L3', 'GR', 'ER', 'ZZ', 'TT (Taiwan Stock Exchange)', 'BSE', None]
        lines = [line(code, figi(f'BBGZZ0001{index:02d}'), None, 'SYN') for index, code in enumerate(codes)]
        claims = list(self.claims(lines, isin=ISIN).values())
        self.assertEqual([(claim.attributes.provider_venue, claim.attributes.operating_mic, claim.attributes.venue_note)
                          for claim in claims],
                         [('GD', 'XDUS', None),
                          ('QT', None, 'venue code QT is a second book on XDUS (Boerse Duesseldorf - Quotrix); GD is the line there'),
                          ('XV', None, 'venue code XV is a trade report (Cboe Europe BOTC), not an order book'),
                          ('L3', None, 'venue code L3 is a dark venue (Tp Icap Uk Mtf - Liquidnet Cash Equity), not a public order book'),
                          ('GR', None, 'venue code GR is the DE composite, not a venue'),
                          ('ER', None, "venue code ER is unknown: no MIC resolved it through OpenFIGI's micCode filter"),
                          ('ZZ', None, 'venue code ZZ is not in the vocabulary'),
                          ('TT', 'XTAI', None),  # the descriptive suffix is not part of the code
                          ('BSE', None, 'venue code BSE is unknown: a descriptive string on bond or structured lines, not an exchange code'),
                          (None, None, 'the line carries no venue code')])

    def test_a_differing_share_class_figi_stays_the_lines_own(self):
        # One line OpenFIGI files under another share class keeps it beside the ISIN, so core's join sees both.
        claims = self.claims([*TOYOTA_LINES, line('GM', GM, GR, 'TOM', OTHER_CLASS)])
        other = {(item.scheme, item.value, item.role) for item in claims[GM].identifiers}
        self.assertLessEqual({('share_class_figi', OTHER_CLASS, 'self'), ('isin', TOYOTA, 'self')}, other)
        self.assertIn(('share_class_figi', SHARE_CLASS, 'self'),
                      {(item.scheme, item.value, item.role) for item in claims[GF].identifiers})

    def test_au_is_australias_composite_and_at_is_the_asx_line(self):
        asx, composite = figi('BBGZZ0000B1'), figi('BBGZZ0000B2')
        claims = self.claims([line('AU', composite, composite, 'SYN'), line('AT', asx, composite, 'SYN')], isin=ISIN)
        self.assertEqual({number: (claim.attributes.operating_mic, claim.attributes.venue_note)
                          for number, claim in claims.items()},
                         {composite: (None, 'venue code AU is the AU composite, not a venue'), asx: ('XASX', None)})

    def test_no_match_is_empty_a_provider_error_is_an_error_and_a_malformed_isin_is_refused(self):
        opener = Opener([[{'warning': 'No identifier found.'}], [{'error': 'Synthetic job error'}]])
        empty = resolver(opener).invoke({'identifiers': {'isin': TOYOTA}}, operation='resolve')
        self.assertEqual((empty['outcome'], empty['data']), ('empty', None))
        governor._owners.clear()
        failed = resolver(opener).invoke({'identifiers': {'isin': ISIN}}, operation='resolve')
        self.assertEqual((failed['outcome'], failed['data'], failed['issues'][0]['code']), ('error', None, 'provider_error'))
        refused = resolver(opener).invoke({'identifiers': {'isin': 'JP3633400002'}}, operation='resolve')
        self.assertEqual(refused['issues'][0]['code'], 'invalid_request')
        self.assertEqual(len(opener.requests), 2)  # the malformed ISIN never reached OpenFIGI


class OpenFigiVocabulary(unittest.TestCase):
    """The vocabulary says what every code is; the contract maps only its exchanges, and the two agree."""

    def setUp(self):
        self.codes = json.loads((ROOT / 'vocabulary.json').read_text())['codes']
        self.venues = json.loads((ROOT / 'contract.json').read_text())['addressing']['venue_codes']

    def test_the_contract_maps_exactly_the_exchange_codes(self):
        exchanges = {code: entry['mic'] for code, entry in self.codes.items() if entry['kind'] == 'exchange'}
        self.assertEqual(self.venues, exchanges)

    def test_every_entry_has_what_its_reason_reads_and_a_second_book_names_a_real_main_on_its_mic(self):
        fields = {'exchange': {'mic', 'name'}, 'second_book': {'mic', 'name', 'of'}, 'trade_report': {'mic', 'name'},
                  'dark': {'mic', 'name'}, 'composite': {'name'}, 'unknown': {'note'}}
        for code, entry in self.codes.items():
            with self.subTest(code=code):
                self.assertEqual(set(entry), {'kind'} | fields[entry['kind']])
                if entry['kind'] == 'second_book':
                    main = self.codes[entry['of']]
                    self.assertEqual((main['kind'], main['mic']), ('exchange', entry['mic']))


class OpenFigiRegistration(unittest.TestCase):
    def test_registers_through_core_alone_and_answers_a_mapping(self):
        tools, opener = {}, Opener([found, [{'data': TOYOTA_LINES}]])
        ctx = SimpleNamespace(register_tool=lambda **tool: tools.update({tool['name']: tool}))
        without_market_data(self)
        self.enterContext(patch.object(platform_module.access, 'native_access_scope',
                                       return_value={'cacheable': False, 'scope': 'fixture'}))
        self.enterContext(patch.object(platform_module, 'configuration',
                                       SimpleNamespace(value=lambda _ctx, _key: ('missing', None))))
        self.enterContext(patch.object(plugin, 'Transport', side_effect=lambda helpers: client.Transport(
            helpers, opener=opener)))
        plugin.register(ctx)
        self.assertEqual(set(plugin.TOOLS.values()) - set(tools), set())
        self.assertIsNone(tools[plugin.TOOLS['mapping']].get('check_fn'))
        result = json.loads(tools[plugin.TOOLS['mapping']]['handler']({'jobs': [{'idType': 'ID_ISIN', 'idValue': ISIN}]}))
        self.assertEqual((result['outcome'], result['data']['results'][0]['outcome']), ('ok', 'found'))
        # Core dispatches `resolve` with the subject's identifiers and reads a claim batch back.
        batch = checked_batch('openfigi', tools[plugin.TOOLS['resolve']]['handler']({'identifiers': {'isin': TOYOTA}}))
        self.assertEqual(len(batch.claims), 7)
        self.assertEqual(opener.requests, [{'jobs': 1, 'key': None}] * 2)


if __name__ == '__main__':
    unittest.main()
