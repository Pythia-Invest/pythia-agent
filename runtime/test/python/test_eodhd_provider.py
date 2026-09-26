"""Synthetic official-shaped values; no providers or ambient credential reads."""
import importlib
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
from native_plugin_fixtures import bind_feature_platform, Context

ROOT = Path(__file__).resolve().parents[2] / 'managed/plugins'
for name, directory in (('test_eodhd', 'eodhd'), ('test_eodhd_feature', 'market-data')):
    package = types.ModuleType(name)
    package.__path__ = [str(ROOT / directory)]
    sys.modules[name] = package
bind_feature_platform('test_eodhd_feature')
identity = importlib.import_module('test_eodhd.identity')
series = importlib.import_module('test_eodhd.series')
results = importlib.import_module('test_eodhd.results')
wire = importlib.import_module('test_eodhd_feature.wire')
credentials = importlib.import_module('test_eodhd_feature.credentials')


def request(definition, mode='history'):
    return {'schema_version': 1, 'operation': mode, 'view': {'kind': 'source', 'series_id': definition['id']},
        'window': {'start': None, 'end': None}, 'limit': 10,
        'requirements': {'freshness': 'any', 'completion': 'any', 'coverage': 'any'}}


class Provider(unittest.TestCase):
    def test_catalogue_pages_share_worker_snapshot_and_reject_version_drift(self):
        provider = importlib.import_module('test_eodhd.__init__')
        calls = []
        version = 'a' * 64
        def worker(*args, **kwargs):
            calls.append(args[1])
            # Synthetic rows shaped by the exchange-symbol-list fields the worker keeps.
            return {'data': {'scope': 'AS', 'version': version, 'observed_at': '2026-01-01T00:00:00Z',
                'rows': [{'symbol': 'SYNTH.AS', 'currency': 'EUR', 'name': 'Synthetic', 'type': 'Common Stock', 'isin': 'US0378331005', 'actual_venue': 'AS'},
                         {'symbol': 'OTHER.AS', 'currency': 'EUR', 'name': 'Other', 'type': 'ETF', 'isin': 'NOT-AN-ISIN', 'actual_venue': 'AS'}]}, 'issues': [], 'complete': True}
        process = types.SimpleNamespace(WorkerError=type('WorkerError', (Exception,), {}), run_worker=worker)
        local_credentials = types.SimpleNamespace(eodhd_token=lambda: ('configured', 'synthetic'))
        ctx = Context('pythia-eodhd')
        with patch.object(provider, 'helpers', return_value=(wire, process, local_credentials)), \
                patch.dict(sys.modules, {'tools.registry': ctx.registry_module}), \
                patch.object(provider, 'paths', return_value=('/synthetic/node', '/synthetic/worker')):
            provider.register(ctx)
            tool = ctx.tools[provider.TOOLS['catalogue']]
            first = json.loads(tool({'scope': 'AS', 'limit': 1}))
            second = json.loads(tool({'scope': 'AS', 'limit': 1, 'cursor': first['data']['next_cursor']}))
            changed = json.loads(tool({'scope': 'AS', 'cursor': 'b' * 64 + ':1'}))
        self.assertEqual(len(calls), 1)
        self.assertEqual(first['data']['rows'][0]['provider_ref']['native_id'], 'SYNTH.AS')
        self.assertEqual(first['data']['rows'][0]['venue'], 'AS')
        self.assertEqual(first['data']['rows'][0]['identifiers'], [
            {'scheme': 'isin', 'value': 'US0378331005', 'level': 'security', 'authority': 'source_asserted'}])
        # An invalid source value is dropped, never passed through as an identifier.
        self.assertEqual(second['data']['rows'][0]['identifiers'], [])
        self.assertIsNone(second['data']['next_cursor'])
        self.assertTrue(second['data']['complete'])
        self.assertEqual(changed['issues'][0]['code'], 'pagination_changed')

    def test_fundamentals_denial_is_a_visible_capability_gap(self):
        provider = importlib.import_module('test_eodhd.__init__')
        calls = []
        def worker(*args, **kwargs):
            calls.append(args[1])
            return {'data': None, 'issues': ['access_denied'], 'complete': False, 'http_status': 403}
        process = types.SimpleNamespace(WorkerError=type('WorkerError', (Exception,), {}), run_worker=worker)
        local_credentials = types.SimpleNamespace(eodhd_token=lambda: ('configured', 'synthetic'))
        ctx = Context('pythia-eodhd')
        with patch.object(provider, 'helpers', return_value=(wire, process, local_credentials)), \
                patch.dict(sys.modules, {'tools.registry': ctx.registry_module}), \
                patch.object(provider, 'paths', return_value=('/synthetic/node', '/synthetic/worker')):
            provider.register(ctx)
            reply = json.loads(ctx.tools[provider.TOOLS['fundamentals']]({'native_ref': identity.native('SYNTH.US'), 'limit': 12}))
            news = json.loads(ctx.tools[provider.TOOLS['news']]({'native_ref': identity.native('SYNTH.US')}))
        self.assertEqual([call['operation'] for call in calls], ['fundamentals', 'news'])
        self.assertEqual(calls[0]['arguments']['limit'], 12)
        self.assertEqual(reply['outcome'], 'empty')
        self.assertIsNone(reply['data'])
        self.assertEqual(reply['capability'], {'dataset': 'fundamentals', 'status': 'not_entitled'})
        self.assertEqual({key: reply['issues'][0][key] for key in ('code', 'severity', 'source_code')},
                         {'code': 'not_entitled', 'severity': 'warning', 'source_code': '403'})
        self.assertEqual((news['outcome'], news['issues'][0]['code']), ('error', 'access_denied'))

    def test_identifier_operation_is_explicit_and_preserves_denial(self):
        provider = importlib.import_module('test_eodhd.__init__')
        calls = []
        def worker(*args, **kwargs):
            calls.append(args[1])
            return {'data': None, 'issues': ['access_denied'], 'complete': False, 'http_status': 403}
        process = types.SimpleNamespace(WorkerError=type('WorkerError', (Exception,), {}), run_worker=worker)
        local_credentials = types.SimpleNamespace(eodhd_token=lambda: ('configured', 'synthetic'))
        ctx = Context('pythia-eodhd')
        with patch.object(provider, 'helpers', return_value=(wire, process, local_credentials)), \
                patch.dict(sys.modules, {'tools.registry': ctx.registry_module}), \
                patch.object(provider, 'paths', return_value=('/synthetic/node', '/synthetic/worker')):
            provider.register(ctx)
            result = json.loads(ctx.tools[provider.TOOLS['identifiers']]({'native_ref': identity.native('SYNTH.US')}))
        self.assertEqual(calls[0]['operation'], 'identifiers')
        self.assertEqual(calls[0]['arguments'], {'symbol': 'SYNTH.US'})
        self.assertEqual(result['outcome'], 'error')
        self.assertEqual(result['issues'][0]['code'], 'access_denied')

    def test_identifier_mapping_records_are_typed_claims(self):
        provider = importlib.import_module('test_eodhd.__init__')
        # Synthetic record with the id-mapping fields the worker keeps.
        record = {'symbol': 'SYNTH.AS', 'isin': 'US0378331005', 'figi': 'BBG000SYNTH1',
                  'lei': 'SYNTHETICLEI00000001', 'cusip': None, 'cik': '12345'}
        process = types.SimpleNamespace(WorkerError=type('WorkerError', (Exception,), {}),
            run_worker=lambda *args, **kwargs: {'data': [record], 'issues': [], 'complete': True})
        local_credentials = types.SimpleNamespace(eodhd_token=lambda: ('configured', 'synthetic'))
        ctx = Context('pythia-eodhd')
        with patch.object(provider, 'helpers', return_value=(wire, process, local_credentials)), \
                patch.dict(sys.modules, {'tools.registry': ctx.registry_module}), \
                patch.object(provider, 'paths', return_value=('/synthetic/node', '/synthetic/worker')):
            provider.register(ctx)
            result = json.loads(ctx.tools[provider.TOOLS['reverse']]({'isin': 'US0378331005'}))
        self.assertTrue(result['data']['complete'])
        [row] = result['data']['records']
        self.assertEqual(row['provider_ref'], identity.native('SYNTH.AS'))
        self.assertEqual({item['scheme']: (item['value'], item['level']) for item in row['identifiers']}, {
            'isin': ('US0378331005', 'security'), 'figi': ('BBG000SYNTH1', None),
            'lei': ('SYNTHETICLEI00000001', 'issuer'), 'cik': ('0000012345', 'issuer')})
        self.assertTrue(all(item['authority'] == 'source_asserted' for item in row['identifiers']))

    def test_no_provider_search_operation_is_registered(self):
        provider = importlib.import_module('test_eodhd.__init__')
        process = types.SimpleNamespace(WorkerError=type('WorkerError', (Exception,), {}), run_worker=None)
        local_credentials = types.SimpleNamespace(eodhd_token=lambda: ('configured', 'synthetic'))
        ctx = Context('pythia-eodhd')
        with patch.object(provider, 'helpers', return_value=(wire, process, local_credentials)), \
                patch.dict(sys.modules, {'tools.registry': ctx.registry_module}), \
                patch.object(provider, 'paths', return_value=('/synthetic/node', '/synthetic/worker')):
            provider.register(ctx)
        markers = [json.loads(entry['schema']['parameters'].get('$comment', '{}')) for entry in ctx.registrations.values()]
        contributions = {json.dumps(marker['pythia_market_data'], sort_keys=True) for marker in markers if 'pythia_market_data' in marker}
        [contribution] = [json.loads(value) for value in contributions]
        wire.validate('contribution', contribution)
        self.assertNotIn('search', {item['operation'] for item in contribution['operations']})
        self.assertFalse(any('search' in name for name in ctx.registrations))

    def test_unconfigured_connector_is_explicit_and_makes_no_provider_call(self):
        provider = importlib.import_module('test_eodhd.__init__')
        declared = json.loads((ROOT / 'eodhd/configuration.json').read_text())
        self.assertEqual([(f['key'], f['kind'], f['required']) for f in declared['fields']],
                         [('eodhd_api_token', 'secret', True)])
        calls = []
        process = types.SimpleNamespace(WorkerError=type('WorkerError', (Exception,), {}),
                                        run_worker=lambda *args, **kwargs: calls.append(args))
        definition = series.definition(identity.native('SYNTH.AS', 'EUR'), 'latest')
        for state in ('missing', 'invalid'):
            with self.subTest(state=state):
                local_credentials = types.SimpleNamespace(eodhd_token=lambda state=state: (state, None))
                ctx = Context('pythia-eodhd')
                with patch.object(provider, 'helpers', return_value=(wire, process, local_credentials)), \
                        patch.dict(sys.modules, {'tools.registry': ctx.registry_module}), \
                        patch.object(provider, 'paths', return_value=('/synthetic/node', '/synthetic/worker')):
                    provider.register(ctx)
                    # Installed tools stay callable and answer with the explicit state.
                    self.assertTrue(ctx.checks[provider.TOOLS['news']]())
                    news = json.loads(ctx.tools[provider.TOOLS['news']]({'native_ref': identity.native('SYNTH.AS')}))
                    latest = json.loads(ctx.tools[provider.TOOLS['latest']]({'request': request(definition, 'latest'),
                        'source_selector': definition['source_detail']['values']['read_selector']}))
                self.assertEqual((news['outcome'], news['issues'][0]['code']), ('error', 'needs_configuration'))
                self.assertIn('needs an API token', news['issues'][0]['message'])
                wire.validate_read_result(latest)
                self.assertEqual(latest['issues'][0]['code'], 'needs_configuration')
        self.assertEqual(calls, [])

    def test_identifiers_preserve_budget_and_provider_retry_provenance(self):
        provider = importlib.import_module('test_eodhd.__init__')
        for code, origin in (('busy', 'connector'), ('rate_limit', 'provider')):
            with self.subTest(code=code):
                process = types.SimpleNamespace(WorkerError=type('WorkerError', (Exception,), {}),
                    run_worker=lambda *args, **kwargs: {'data': None, 'issues': [code],
                        'retry_after': 7, 'failure': {'code': code, 'origin': origin}})
                local_credentials = types.SimpleNamespace(eodhd_token=lambda: ('configured', 'synthetic'))
                ctx = Context('pythia-eodhd')
                with patch.object(provider, 'helpers', return_value=(wire, process, local_credentials)), \
                        patch.dict(sys.modules, {'tools.registry': ctx.registry_module}), \
                        patch.object(provider, 'paths', return_value=('/synthetic/node', '/synthetic/worker')):
                    provider.register(ctx)
                    result = json.loads(ctx.tools[provider.TOOLS['identifiers']]({'native_ref': identity.native('SYNTH.US')}))
                self.assertEqual(result['outcome'], 'error')
                self.assertEqual(result['retry_after_seconds'], 7)
                self.assertEqual(result['issues'][0]['code'], code)
                self.assertEqual(result['issues'][0]['limit_origin'], origin)
                self.assertEqual(result['issues'][0]['retry_after_seconds'], 7)

    def test_evidence_only_exact_common_stock(self):
        row = {'symbol': 'SYNTH.US', 'currency': 'USD', 'name': 'Synthetic', 'type': 'Common Stock', 'isin': 'US0378331005'}
        candidate = identity.candidates([row])[0]
        for evidence in candidate['evidence']:
            wire.validate('evidence', evidence)
        self.assertEqual([e['scheme'] for e in candidate['evidence']], ['native'])
        # The ISIN is a typed claim, never identity evidence: it may describe an underlying.
        self.assertEqual(candidate['identifiers'], [
            {'scheme': 'isin', 'value': 'US0378331005', 'level': 'security', 'authority': 'source_asserted'}])
        self.assertNotIn('reported_isins', candidate['metadata'])
        self.assertEqual(candidate['provider_ref']['native_scope'], 'catalogue')
        self.assertEqual(candidate['symbol'], 'SYNTH')
        self.assertEqual(candidate['kind'], 'instrument')
        # Dots inside the returned exchange-local Code are significant.
        self.assertEqual(identity.candidates([{**row, 'symbol': 'SYNTH.B.US'}])[0]['symbol'], 'SYNTH.B')
        for kind in ('ETF', 'ADR', None):
            self.assertEqual(identity.candidates([{**row, 'type': kind}])[0]['evidence'], [])
        self.assertEqual(identity.candidates([row, {**row, 'type': 'ADR'}])[0]['evidence'], [])
        conflict = identity.candidates([row, {**row, 'isin': 'US5949181045'}])[0]
        self.assertEqual(len(conflict['evidence']), 1)
        self.assertEqual([item['value'] for item in conflict['identifiers']], ['US0378331005', 'US5949181045'])
        self.assertTrue(conflict['identifier_conflict'])

    def test_series_field_semantics_and_stable_window_free_ids(self):
        native = identity.native('SYNTH.US', 'USD')
        for mode in series.MODES:
            value = wire.validate('series', series.definition(native, mode))
            self.assertEqual(series.selector(value['source_detail']['values']['read_selector']), (native, mode))
        self.assertEqual(series.definition(identity.native('SYNTH.PA','EUR'),'daily_ohlc')['fields']['close']['unit'], {'kind':'currency','code':'EUR','scale':'1'})
        self.assertEqual(series.definition(identity.native('SYNTH.LSE','GBP'),'daily_ohlc')['fields']['volume']['unit']['kind'], 'shares')
        daily = series.definition(native, 'daily_ohlc')
        self.assertEqual(daily['fields']['close']['adjustment']['kind'], 'none')
        self.assertEqual(daily['fields']['volume']['adjustment']['kind'], 'split')
        adjusted = series.definition(native, 'daily_adjusted_close')
        self.assertEqual(adjusted['measurement'], 'close')
        self.assertNotEqual(daily['id'], adjusted['id'])
        self.assertEqual(set(adjusted['fields']), {'value'})
        self.assertEqual(adjusted['fields']['value']['adjustment']['kind'], 'split_dividend')
        self.assertEqual(series.definition(identity.native('SYNTH.LSE','GBP'),'daily_ohlc')['fields']['close']['unit']['kind'], 'unknown')

    def test_daily_invalid_row_partial_zero_and_missing_volume(self):
        definition = series.definition(identity.native('SYNTH.US','USD'), 'daily_ohlc')
        req = request(definition)
        row = {'date': '2026-09-09', 'open':'2', 'high':'3', 'low':'1', 'close':'2', 'volume':'0'}
        value = wire.validate_read_result(results.read(req, definition, 'daily_ohlc', {'data':[row, {**row,'date':'bad'}], 'issues':[]}))
        self.assertEqual(value['outcome'], 'partial')
        self.assertEqual(value['observations'][0]['volume'], '0')
        value = results.read(req, definition, 'daily_ohlc', {'data':[{**row,'volume':None}], 'issues':[]})
        self.assertNotIn('volume', value['observations'][0])
        req['requirements']['completion'] = 'completed'
        value = wire.validate_read_result(results.read(req, definition, 'daily_ohlc', {'data':[row], 'issues':[]}))
        self.assertFalse(value['requirements_satisfied'])
        self.assertEqual(value['observations'], [])

    def test_requirement_assessment_preserves_partial_and_empty_results(self):
        # Synthetic EOD daily rows shaped by the official historical-data API.
        definition = series.definition(identity.native('SYNTH.US', 'USD'), 'daily_ohlc')
        row = {'date': '2026-09-01', 'open': '2', 'high': '4', 'low': '1', 'close': '2'}
        conflict = {**row, 'close': '3'}
        valid = {**row, 'date': '2026-09-02'}
        cases = [
            ('conflict_with_useful_row', [row, conflict, valid], [], 'partial', 1, True),
            ('source_error_with_useful_row', [valid], ['provider_error'], 'partial', 1, True),
            ('conflicts_only', [row, conflict], [], 'error', 0, False),
            ('invalid_only', [{**row, 'date': 'bad'}], [], 'error', 0, False),
            ('empty', [], [], 'empty', 0, True),
        ]
        for name, rows, issues, outcome, count, satisfied in cases:
            with self.subTest(name=name):
                value = wire.validate_read_result(results.read(request(definition), definition,
                    'daily_ohlc', {'data': rows, 'issues': issues}))
                self.assertEqual((value['outcome'], len(value['observations']),
                    value['requirements_satisfied']), (outcome, count, satisfied))
                if name == 'conflict_with_useful_row':
                    self.assertEqual(value['observations'][0]['time']['value'], '2026-09-02')
                    self.assertTrue(any(i['severity'] == 'error' for i in value['issues']))
        for requirement, strict in [('freshness', 'fresh'), ('coverage', 'complete'), ('completion', 'completed')]:
            with self.subTest(requirement=requirement):
                req = request(definition)
                req['requirements'][requirement] = strict
                value = wire.validate_read_result(results.read(req, definition, 'daily_ohlc',
                    {'data': [row, conflict, valid], 'issues': []}))
                self.assertFalse(value['requirements_satisfied'])
                self.assertEqual(len(value['observations']), 0 if requirement == 'completion' else 1)
                self.assertTrue(any(i['code'] == 'requirements_unmet' for i in value['issues']))

    def test_registered_provider_preserves_conflicting_row_partial(self):
        provider = importlib.import_module('test_eodhd.__init__')
        definition = series.definition(identity.native('SYNTH.US', 'USD'), 'daily_ohlc')
        req = request(definition)
        req['window'] = {'start': {'kind': 'session_date', 'value': '2026-09-01'},
            'end': {'kind': 'session_date', 'value': '2026-09-02'}}
        row = {'date': '2026-09-01', 'open': '2', 'high': '4', 'low': '1', 'close': '2'}
        metadata = {'symbol': 'SYNTH.US', 'currency': 'USD', 'name': 'Synthetic',
            'type': 'Common Stock', 'isin': 'US0378331005'}
        payloads = iter([{'data': [metadata], 'issues': []},
            {'data': [row, {**row, 'close': '3'}, {**row, 'date': '2026-09-02'}], 'issues': []}])
        process = types.SimpleNamespace(WorkerError=type('WorkerError', (Exception,), {}),
            run_worker=lambda *args, **kwargs: next(payloads))
        local_credentials = types.SimpleNamespace(eodhd_token=lambda: ('configured', 'synthetic'))
        ctx = Context('pythia-eodhd')
        handlers = ctx.tools
        with patch.object(provider, 'helpers', return_value=(wire, process, local_credentials)), \
                patch.dict(sys.modules, {'tools.registry': ctx.registry_module}), \
                patch.object(provider, 'paths', return_value=('/synthetic/node', '/synthetic/worker')):
            provider.register(ctx)
            value = json.loads(handlers[provider.TOOLS['history']]({'request': req,
                'source_selector': definition['source_detail']['values']['read_selector']}))
        wire.validate_read_result(value)
        self.assertEqual(value['outcome'], 'partial')
        self.assertTrue(value['requirements_satisfied'])
        self.assertEqual([o['time']['value'] for o in value['observations']], ['2026-09-02'])
        self.assertEqual([i['code'] for i in value['issues']], ['invalid_value'])

    def test_latest_unknown_timestamp_preserves_price(self):
        definition = series.definition(identity.native('SYNTH.US','USD'), 'latest')
        value = wire.validate_read_result(results.read(request(definition,'latest'), definition, 'latest', {'data':[{'close':'3','timestamp':None}], 'issues':[]}))
        self.assertEqual(value['observations'][0]['value'], '3')
        self.assertEqual(value['observations'][0]['time'], {'kind':'unknown'})
        self.assertEqual(value['freshness']['status'], 'unknown')

    def test_intraday_utc_bounds_and_unknown_adjustment_completion(self):
        definition = series.definition(identity.native('SYNTH.US','USD'), 'intraday_1h')
        row = {'timestamp':1788955200,'gmtoffset':0,'datetime':'2026-09-09 12:00:00','open':'2','high':'3','low':'1','close':'2','volume':None}
        value = wire.validate_read_result(results.read(request(definition), definition, 'intraday_1h', {'data':[row], 'issues':[]}))
        self.assertEqual(len(value['observations']),1)
        self.assertEqual(value['observations'][0]['interval']['end']['value'], '2026-09-09T13:00:00+00:00')
        self.assertEqual(definition['fields']['close']['adjustment']['kind'], 'unknown')

    def test_canonical_credentials_private_bounded_no_ambient_fallback(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {'PYTHIA_CONFIG_ROOT':root,'EODHD_API_TOKEN':'ambient'}):
            path = Path(root) / 'secrets.json'
            self.assertEqual(credentials.eodhd_token(), ('missing',None))
            path.write_text(json.dumps({'schema_version':1,'eodhd_api_token':'synthetic'}));path.chmod(0o600)
            self.assertEqual(credentials.eodhd_token(), ('configured','synthetic'))
            path.chmod(0o644)
            self.assertEqual(credentials.eodhd_token(), ('invalid',None))
            path.chmod(0o600);path.write_text(' '*65537)
            self.assertEqual(credentials.eodhd_token(), ('invalid',None))


if __name__ == '__main__':
    unittest.main()
