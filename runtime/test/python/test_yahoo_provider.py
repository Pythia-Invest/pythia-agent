"""Semantic and native-boundary checks using synthetic Yahoo-shaped values."""
import importlib
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch
from native_plugin_fixtures import bind_feature_platform, Context

ROOT = Path(__file__).resolve().parents[2] / 'managed/plugins'
for name, directory in (('test_yahoo', 'yahoo-discovery'), ('test_yahoo_feature', 'market-data')):
    package = types.ModuleType(name)
    package.__path__ = [str(ROOT / directory)]
    sys.modules[name] = package
identity = importlib.import_module('test_yahoo.identity')
series = importlib.import_module('test_yahoo.series')
results = importlib.import_module('test_yahoo.results')
definition = importlib.import_module('test_yahoo.definition')
resolve = importlib.import_module('test_yahoo.resolve')
wire = importlib.import_module('test_yahoo_feature.wire')
bind_feature_platform('test_yahoo_feature')


class Yahoo(unittest.TestCase):
    def test_registered_content_tools_have_no_provider_search(self):
        provider = importlib.import_module('test_yahoo.__init__')
        connector = importlib.import_module('test_yahoo_feature.connector')
        metadata = {'symbol': 'SYNTH.AS', 'type': 'EQUITY', 'currency': 'EUR', 'exchange': 'AMS'}
        calls = []
        def worker(_command, request, _environment, **_kwargs):
            calls.append(request)
            return {'data': {'common': {'SYNTH.AS': {'metadata': dict(metadata)}},
                'display': {'quotes': [], 'retrieved_at': '2026-01-01T00:00:00Z'}}, 'issues': []}
        process = types.SimpleNamespace(run_worker=worker, shutdown=lambda: None)
        ctx = Context('pythia-yahoo-discovery')
        plugins = types.ModuleType('hermes_cli.plugins')
        plugins.get_plugin_manager = lambda: types.SimpleNamespace(_plugins={
            'pythia-market-data': types.SimpleNamespace(enabled=True, module=sys.modules['test_yahoo_feature'])})
        native = {'provider': 'yahoo', 'native_id': 'SYNTH.AS', 'native_scope': 'symbol'}
        batch = connector.NativeBatch(size=20, age=60)
        self.addCleanup(batch.pool.shutdown)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            worker_path = root / 'runner/dist/yahoo.js'
            worker_path.parent.mkdir(parents=True)
            worker_path.touch()
            node = root / 'node'
            node.touch()
            with patch.dict(sys.modules, {'hermes_cli.plugins': plugins, 'tools.registry': ctx.registry_module}), \
                    patch.object(connector, 'ResidentTransport', return_value=process), \
                    patch.object(connector, 'NativeBatch', return_value=batch), \
                    patch.dict(os.environ, {'PYTHIA_MANAGED_ROOT': directory, 'PYTHIA_NODE': str(node)}):
                provider.register(ctx)
                self.assertEqual(set(ctx.tools), {*provider.TOOLS.values(), 'pythia_yahoo_trending'})
                self.assertNotIn('pythia_yahoo_search', ctx.tools)
                declared = {op['operation'] for schema in provider.schemas(wire).values() if '$comment' in schema['parameters']
                            for op in json.loads(schema['parameters']['$comment'])['pythia_market_data']['operations']}
                self.assertEqual(declared, {'details', 'series', 'latest', 'history', 'read_batch'})
                research = json.loads(ctx.tools[provider.TOOLS['research']]({'operation': 'search', 'symbol': 'SYNTH'}))
                self.assertEqual(research['issues'][0]['code'], 'invalid_request')
                details = json.loads(ctx.tools[provider.TOOLS['details']]({'native_ref': native}))['data'][0]
                # Exact metadata adds Yahoo's venue/currency but asserts no identity evidence.
                self.assertEqual(details['provider_ref']['qualifiers'], {'currency': 'EUR', 'venue': 'AMS'})
                self.assertEqual(details['evidence'], [])
        self.assertEqual(calls, [{'operation': 'quote_bundle', 'arguments': {'symbols': ['SYNTH.AS']}}])

    def test_isin_resolve_is_a_verified_query_only_hint(self):
        isin = 'NL0010273215'
        metadata = {'symbol': 'SYNTH.AS', 'type': 'EQUITY', 'currency': 'EUR', 'exchange': 'AMS'}
        def reply(rows, meta=metadata):
            calls = []
            def call(endpoint, args):
                calls.append((endpoint, args))
                if endpoint == 'resolve_isin':
                    return {'data': {'result': {'isin': isin, 'quotes': rows}}, 'issues': []}
                return {'data': dict(meta), 'issues': []}
            return call, calls
        call, calls = reply([{'symbol': 'SYNTH.AS', 'exchange': 'AMS', 'quoteType': 'EQUITY'},
                             {'symbol': isin + '.SG', 'exchange': 'STU', 'quoteType': 'EQUITY'}])
        self.assertEqual(resolve.by_isin(isin, call), {'status': 'resolved', 'native_level': 'listing', 'echoed': {},
            'native_ref': {'provider': 'yahoo', 'native_scope': 'symbol', 'native_id': 'SYNTH.AS',
                           'qualifiers': {'currency': 'EUR', 'venue': 'AMS'}},
            'query': {'scheme': 'isin', 'value': isin, 'authority': 'query_only'}})
        self.assertEqual(calls, [('resolve_isin', {'isin': isin}), ('metadata', {'symbol': 'SYNTH.AS'})])
        call, _ = reply([])
        self.assertEqual(resolve.by_isin(isin, call)['status'], 'not_found')
        call, calls = reply([{'symbol': 'ONE', 'exchange': 'NMS'}, {'symbol': 'TWO', 'exchange': 'PNK'}])
        ambiguous = resolve.by_isin(isin, call)
        self.assertEqual([ref['native_id'] for ref in ambiguous['candidates']], ['ONE', 'TWO'])
        self.assertEqual(len(calls), 1)
        call, _ = reply([{'symbol': 'SYNTH.AS'}], {**metadata, 'symbol': 'OTHER.AS'})
        with self.assertRaises(ValueError):
            resolve.by_isin(isin, call)
        for value in ('NL0010273216', 'ASML', 'nl0010273215', None):
            with self.subTest(value=value), self.assertRaises(ValueError):
                resolve.by_isin(value, lambda *_: self.fail('invalid input reached Yahoo'))

    def test_identity_and_units_do_not_infer_equivalence_or_index_currency(self):
        metadata = {'symbol': 'SYNTH', 'type': 'EQUITY', 'currency': 'USD', 'exchange': 'SYN'}
        candidate = identity.candidate(metadata)
        self.assertEqual(candidate['evidence'], [])
        self.assertEqual((candidate['symbol'], candidate['kind']), ('SYNTH', 'listing'))
        self.assertEqual(candidate['metadata']['product_type'], 'Equity')
        receipt = identity.candidate({**metadata, 'short_name': 'Synthetic CEDEAR',
            'full_exchange_name': 'Synthetic Exchange', 'currency': 'GBp'})
        self.assertEqual(receipt['metadata']['short_name'], 'Synthetic CEDEAR')
        self.assertEqual(receipt['metadata']['native_currency'], 'GBp')
        self.assertNotIn('currency', receipt['provider_ref'].get('qualifiers', {}))
        self.assertEqual(receipt['venue'], 'Synthetic Exchange')
        # Search quoteType and details type must expose the same shared scope.
        searched = identity.candidate({'symbol': 'SYNTH', 'quoteType': 'EQUITY'})
        self.assertEqual(searched['kind'], candidate['kind'])
        self.assertIsNone(identity.candidate({'symbol': 'SYNTH', 'quoteType': 'NEW_TYPE'})['kind'])
        with self.assertRaises(ValueError):
            identity.candidate({'name': 'Non-instrument search result'})
        native = candidate['provider_ref']
        for mode in series.MODES:
            value = wire.validate('series', series.definition(native, mode, metadata))
            self.assertEqual(series.selector(value['source_detail']['values']['read_selector']), (native, mode))
        stock = series.definition(native, 'daily', metadata)
        index = series.definition(native, 'daily', {**metadata, 'type': 'INDEX'})
        self.assertNotEqual(stock['id'], index['id'])
        self.assertEqual(index['fields']['close']['unit']['kind'], 'unknown')
        self.assertEqual(stock['fields']['close']['unit']['code'], 'USD')

    def test_common_reads_keep_session_dates_and_unknown_completion(self):
        meta = {'symbol': 'SYNTH', 'type': 'EQUITY', 'currency': 'USD'}
        value = series.definition(identity.candidate(meta)['provider_ref'], 'daily', meta)
        request = {'schema_version': 1, 'operation': 'history', 'view': {'kind': 'source', 'series_id': value['id']},
                   'window': {'start': {'kind': 'session_date', 'value': '2026-01-02'}, 'end': {'kind': 'session_date', 'value': '2026-01-03'}},
                   'limit': 10, 'requirements': {'freshness': 'any', 'completion': 'any', 'coverage': 'any'}}
        row = {'time': '2026-01-02', 'open': 0.0000001, 'high': 2, 'low': 0, 'close': 1}
        raw = {'data': {'rows': [row]}, 'issues': []}
        read = wire.validate_read_result(results.read(request, value, 'daily', raw))
        self.assertEqual(read['observations'][0]['time'], request['window']['start'])
        self.assertEqual(read['observations'][0]['open'], '0.0000001')
        raw['data']['rows'].append(row)
        self.assertEqual(wire.validate_read_result(results.read(request, value, 'daily', raw))['outcome'], 'error')
        raw['data']['rows'] = [row]
        request['requirements']['completion'] = 'completed'
        read = wire.validate_read_result(results.read(request, value, 'daily', raw))
        self.assertEqual(read['observations'], [])
        self.assertFalse(read['requirements_satisfied'])

    def test_native_options_remain_bounded_data_not_schema_or_fetch_controls(self):
        schemas = definition.schemas(wire)
        for op, args in [('research', {'operation': 'quoteSummary', 'symbol': 'SYNTH', 'options_json': '{"modules":["price"]}'}),
                         ('dashboard', {'kind': 'quotes', 'symbols': ['SYNTH']})]:
            wire.validate_parameters(schemas[op]['parameters'], args)
            with self.assertRaises(wire.WireError):
                wire.validate_parameters(schemas[op]['parameters'], {**args, 'fetch': 'https://example.test'})
