"""Synthetic revocation cases shaped by pinned Hermes plugins.py ownership.

The pinned manager uses path-derived keys, bare-name compatibility and explicit
deny precedence, with tool handles in _registration_order. No providers, native
profiles or credentials are used; the copied qualification tests that real seam.
"""
import contextlib
import importlib
import io
import json
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

from test_market_data_identity import PACKAGE, PLATFORM

contributions = importlib.import_module(PACKAGE + '.contributions')
execution = importlib.import_module(PACKAGE + '.execution')
access = importlib.import_module(PLATFORM + '.access')
operations = importlib.import_module(PLATFORM + '.operations')
transport = importlib.import_module(PLATFORM + '.http')
specialist = importlib.import_module(PLATFORM + '.specialist')
definition = importlib.import_module(PACKAGE + '.definition')
wire = importlib.import_module(PACKAGE + '.wire')


class NativeAccessTests(unittest.TestCase):
    def setUp(self):
        self.feature_key, self.provider_key = 'features/pythia-market-data', 'finance/synthetic'
        self.config = {'plugins': {'enabled': [self.feature_key, self.provider_key]}}
        self.schemas = {definition.TOOL_NAME: {'name': definition.TOOL_NAME, 'parameters': {
            'type': 'object', 'properties': {'action': {'type': 'string'}},
            'required': ['action'], 'additionalProperties': False}}}
        operations.declare_operation(self.schemas[definition.TOOL_NAME],
            plugin=self.feature_key, operation='query')
        self.manager = SimpleNamespace(_plugins={}, _registration_order=[])
        self.add_plugin(self.feature_key, 'pythia-market-data', definition.TOOL_NAME)
        self.add_plugin(self.provider_key, 'synthetic', 'synthetic_search')
        marker = {'schema_version': 1, 'provider': 'synthetic', 'adapter_version': 'test-1',
                  'operations': [{'operation': 'search', 'tool': 'synthetic_search', 'effect': 'read'}],
                  'subject_kinds': ['instrument']}
        self.schemas['synthetic_search'] = {'name': 'synthetic_search', 'parameters': {
            'type': 'object', 'properties': {}, 'additionalProperties': False,
            '$comment': json.dumps({contributions.MARKER: marker, operations.MARKER: {
                'operation': 'synthetic-read', 'plugin': 'synthetic', 'cache_seconds': 0}})}}
        self.dispatches = []
        self.entries = {}
        self.handler = lambda: {'schema_version': 1, 'outcome': 'ok', 'data': {'value': 7}, 'issues': []}
        self.registry = SimpleNamespace(get_all_tool_names=lambda: list(self.schemas),
            get_schema=lambda name: self.schemas.get(name), dispatch=self.dispatch,
            get_entry=lambda name: self.entries.setdefault(name, SimpleNamespace(handler=lambda *_args, **_kwargs: None)))
        modules = {}
        for name, attrs in {
            'gateway': {}, 'gateway.session_context': {
                'get_session_env': lambda _key, _default='': 'api_server',
                'set_session_vars': lambda **_kwargs: None, 'clear_session_vars': lambda _tokens: None},
            'hermes_cli': {}, 'hermes_cli.config': {'load_config_readonly': lambda: self.config},
            'hermes_cli.plugins': {'get_plugin_manager': lambda: self.manager},
            'hermes_cli.tools_config': {'_get_platform_tools': lambda *_args, **_kwargs: {'financial'}},
            'agent': {}, 'agent.skill_utils': {'parse_config_string_list': lambda value: value},
            'model_tools': {'get_tool_definitions': lambda **_kwargs: [
                {'function': {'name': name}} for name in self.schemas], '_clear_tool_defs_cache': lambda: None},
            'tools': {}, 'tools.registry': {'registry': self.registry, 'invalidate_check_fn_cache': lambda: None},
            'tools.interrupt': {'is_interrupted': lambda: False, 'is_thread_interrupted': lambda _thread: False},
            # Validation itself is already exercised separately. Ordinary
            # provider-free tests do not install the native HTTP dependency.
            'jsonschema': {'Draft202012Validator': lambda schema: SimpleNamespace(
                validate=lambda value: wire.validate_parameters(schema, value)), 'ValidationError': wire.WireError},
        }.items():
            modules[name] = ModuleType(name)
            modules[name].__dict__.update(attrs)
        self.enterContext(patch.dict(sys.modules, modules))
        self.enterContext(patch.object(access, 'canonical_access_revision', return_value=[1, 2]))
        access._eligibility.clear()
        self.addCleanup(access._eligibility.clear)

    def add_plugin(self, key, name, tool):
        # Actual registration is intentionally absent from provides_tools.
        self.manager._plugins[key] = SimpleNamespace(enabled=True, manifest=SimpleNamespace(
            key=key, name=name, provides_tools=[], source='user', kind='standalone'))
        self.manager._registration_order.append(SimpleNamespace(
            active=True, kind='tool', key=tool, plugin_key=key))

    def dispatch(self, name, _arguments, **_context):
        self.dispatches.append(name)
        return json.dumps(self.handler())

    def test_native_category_keys_and_legacy_names_reach_shared_and_specialist_reads(self):
        for enabled in ([self.feature_key, self.provider_key], ['pythia-market-data', 'synthetic']):
            with self.subTest(enabled=enabled):
                self.config['plugins']['enabled'] = enabled
                self.assertEqual(execution.call_source('synthetic', 'search', {})['data'], {'value': 7})
                self.assertEqual(operations.resolve(self.feature_key, 'query', {'action': 'describe'})[0], definition.TOOL_NAME)
                self.assertEqual(operations.resolve('synthetic', 'synthetic-read', {})[0], 'synthetic_search')

    def test_explicit_deny_wins_for_actual_registered_tools_by_key_or_name(self):
        for disabled in (self.provider_key, 'synthetic'):
            with self.subTest(disabled=disabled):
                self.config['plugins']['disabled'] = [disabled]
                self.assertEqual(execution.call_source('synthetic', 'search', {})['issues'][0]['code'], 'unavailable')
                with self.assertRaises(transport.Rejected) as caught:
                    operations.resolve('synthetic', 'synthetic-read', {})
                self.assertEqual(caught.exception.status, 403)
        self.assertEqual(self.dispatches, [])
        self.config['plugins']['disabled'] = ['pythia-market-data']
        with self.assertRaises(transport.Rejected) as caught:
            operations.resolve(self.feature_key, 'query', {'action': 'describe'})
        self.assertEqual(caught.exception.status, 403)

    def test_loaded_state_and_current_registration_override_are_authoritative(self):
        self.assertIn('synthetic_search', contributions.eligible_tools())
        self.manager._plugins[self.provider_key].enabled = False
        self.assertNotIn('synthetic_search', contributions.eligible_tools())
        self.manager._plugins[self.provider_key].enabled = True
        self.add_plugin('finance/replacement', 'replacement', 'synthetic_search')
        self.assertNotIn('synthetic_search', contributions.eligible_tools())
        self.manager._registration_order[-1].active = False
        self.assertIn('synthetic_search', contributions.eligible_tools())

    def test_specialist_annotation_cannot_claim_another_enabled_plugin(self):
        schema = self.schemas['synthetic_search']['parameters']
        meta = json.loads(schema['$comment'])
        meta[operations.MARKER]['plugin'] = 'pythia-market-data'
        schema['$comment'] = json.dumps(meta)
        with self.assertRaises(transport.Rejected) as caught:
            operations.resolve('synthetic', 'synthetic-read', {})
        self.assertEqual(caught.exception.status, 404)

    def add_operation(self, key, name, tool):
        self.add_plugin(key, name, tool)
        self.config['plugins']['enabled'].append(key)
        self.schemas[tool] = {'name': tool, 'parameters': {
            'type': 'object', 'properties': {}, 'additionalProperties': False}}
        operations.declare_operation(self.schemas[tool], plugin=name, operation='synthetic-read')

    def test_same_operation_name_is_scoped_to_each_native_plugin(self):
        alternate_key, alternate_name, alternate_tool = 'finance/alternate', 'alternate', 'alternate_search'
        self.add_operation(alternate_key, alternate_name, alternate_tool)
        for plugin, expected in ((self.provider_key, 'synthetic_search'), ('synthetic', 'synthetic_search'),
                                 (alternate_key, alternate_tool), (alternate_name, alternate_tool)):
            with self.subTest(plugin=plugin):
                self.assertEqual(operations.resolve(plugin, 'synthetic-read', {})[0], expected)

    def test_ambiguous_bare_names_require_a_key_or_one_eligible_native_owner(self):
        alternate_key, alternate_tool = 'other/synthetic', 'alternate_search'
        self.add_operation(alternate_key, 'synthetic', alternate_tool)
        with self.assertRaises(transport.Rejected) as caught:
            operations.resolve('synthetic', 'synthetic-read', {})
        self.assertEqual(caught.exception.status, 404)
        self.assertEqual(operations.resolve(self.provider_key, 'synthetic-read', {})[0], 'synthetic_search')
        self.assertEqual(operations.resolve(alternate_key, 'synthetic-read', {})[0], alternate_tool)
        # A disabled plugin loses authority immediately, without native unload.
        for disabled, expected in ((self.provider_key, alternate_tool), (alternate_key, 'synthetic_search')):
            with self.subTest(disabled=disabled):
                self.config['plugins']['disabled'] = [disabled]
                self.assertEqual(operations.resolve('synthetic', 'synthetic-read', {})[0], expected)
        self.config['plugins']['disabled'] = ['synthetic']
        with self.assertRaises(transport.Rejected) as caught:
            operations.resolve('synthetic', 'synthetic-read', {})
        self.assertEqual(caught.exception.status, 403)

    def test_two_active_declarations_from_one_native_owner_are_ambiguous(self):
        other_tool = 'synthetic_second_read'
        self.schemas[other_tool] = {'name': other_tool, 'parameters': {
            'type': 'object', 'properties': {}, 'additionalProperties': False}}
        operations.declare_operation(self.schemas[other_tool], plugin=self.provider_key, operation='synthetic-read')
        self.manager._registration_order.append(SimpleNamespace(
            active=True, kind='tool', key=other_tool, plugin_key=self.provider_key))
        with self.assertRaises(transport.Rejected) as caught:
            operations.resolve(self.provider_key, 'synthetic-read', {})
        self.assertEqual(caught.exception.status, 404)
        self.manager._registration_order[-1].active = False
        self.assertEqual(operations.resolve(self.provider_key, 'synthetic-read', {})[0], 'synthetic_search')

    def test_unowned_marker_cannot_bypass_native_plugin_access(self):
        self.manager._registration_order.pop()
        result = execution.call_source('synthetic', 'search', {})
        self.assertEqual(result['issues'][0]['code'], 'unavailable')
        self.assertEqual(self.dispatches, [])
        with self.assertRaises(transport.Rejected) as caught:
            operations.resolve('synthetic', 'synthetic-read', {})
        self.assertEqual(caught.exception.status, 404)

    def revoke_during_read(self):
        self.config['plugins']['disabled'] = [self.provider_key]
        return {'schema_version': 1, 'outcome': 'ok', 'data': {'must_not_publish': 7}, 'issues': []}

    def test_direct_source_read_rejects_raw_success_after_access_revocation(self):
        self.handler = self.revoke_during_read
        result = execution.dispatch({'action': 'call', 'provider': 'synthetic', 'operation': 'search', 'arguments': {}})
        self.assertEqual(result['issues'][0]['code'], 'unavailable')
        self.assertNotIn('data', result)
        self.assertEqual(self.dispatches, ['synthetic_search'])

    def test_specialist_cli_rejects_raw_success_with_and_without_cache_delivery(self):
        for max_age in (0, 60):
            with self.subTest(max_age=max_age):
                self.config['plugins'].pop('disabled', None)
                commands = []
                ctx = SimpleNamespace(plugin_id=self.provider_key,
                    register_cli_command=lambda *_args: commands.append(_args[-1]))
                specialist.register_read_command(ctx, 'synthetic-read', 'synthetic_search', 'Synthetic read', cache_seconds=max_age)
                self.handler = self.revoke_during_read
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    commands[0](SimpleNamespace(platform='cli', request='{}', reuse_scope=None))
                result = json.loads(output.getvalue())
                self.assertEqual(result['issues'][0]['code'], 'unavailable')
                self.assertNotIn('data', result)
                self.assertNotIn('delivery', result)

    def test_uncached_specialist_cli_never_advertises_or_honors_reuse(self):
        commands = []
        ctx = SimpleNamespace(plugin_id=self.provider_key,
            register_cli_command=lambda *_args: commands.append(_args[-1]))
        specialist.register_read_command(ctx, 'synthetic-read', 'synthetic_search', 'Synthetic read', cache_seconds=0)
        # An opaque matching receipt must not suppress execution for an
        # operation whose declared cache lifetime is zero.
        with patch.object(specialist, 'fingerprint', return_value='synthetic-matching-receipt'):
            for receipt in (None, 'synthetic-matching-receipt'):
                with self.subTest(receipt=receipt):
                    before = len(self.dispatches)
                    output = io.StringIO()
                    with contextlib.redirect_stdout(output):
                        commands[0](SimpleNamespace(platform='cli', request='{}', reuse_scope=receipt))
                    result = json.loads(output.getvalue())
                    self.assertEqual(len(self.dispatches), before + 1)
                    self.assertEqual(result['data'], {'value': 7})
                    self.assertNotIn('delivery', result)
                    self.assertNotIn('reuse', result)

    def test_owner_classifies_nested_partial_failures_for_delivery_and_cli(self):
        financial_cli = importlib.import_module(PACKAGE + '.specialist')
        commands = []
        ctx = SimpleNamespace(plugin_id=self.provider_key,
                              register_cli_command=lambda *_args: commands.append(_args[-1]))
        financial_cli.register_read_command(ctx, 'synthetic-read', 'synthetic_search', 'Synthetic read',
                                           cache_seconds=5, schema=self.schemas['synthetic_search'])
        batch = {'quotes': [{'symbol': 'ONE', 'price': 7}, {'symbol': 'TWO', 'error': 'Limited',
                 'failure': {'code': 'rate_limit', 'retry_after_seconds': 180, 'origin': 'provider'}}]}
        self.handler = lambda: {'schema_version': 1, 'outcome': 'partial', 'data': batch, 'issues': []}
        result = json.loads(transport.execute(self.provider_key, 'synthetic-read', {}, None, lambda: False))
        self.assertEqual(result['data'], batch)
        self.assertEqual(result['delivery']['max_age_seconds'], 180)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            commands[0](SimpleNamespace(platform='cli', request='{}', reuse_scope=None))
        self.assertEqual(json.loads(output.getvalue())['data'], batch)
        self.assertNotIn('delivery', json.loads(output.getvalue()))

    def test_malformed_transport_issue_metadata_is_rejected(self):
        for issues in ('failure', [{'code': 'rate_limit', 'retry_after_seconds': -1}]):
            with self.subTest(issues=issues):
                self.handler = lambda: {'schema_version': 1, 'data': {}, 'issues': issues}
                with self.assertRaises(transport.Rejected) as caught:
                    transport.execute(self.provider_key, 'synthetic-read', {}, None, lambda: False)
                self.assertEqual(caught.exception.code, 'invalid_response')

    def test_automatic_reads_require_owner_declaration_even_with_reuse_receipt(self):
        for receipt in (None, 'a' * 64):
            with self.subTest(receipt=receipt):
                with self.assertRaises(transport.Rejected) as caught:
                    transport.execute(self.provider_key, 'synthetic-read', {}, receipt, lambda: False, read_only=True)
                self.assertEqual(caught.exception.code, 'read_only_required')
        self.assertEqual(self.dispatches, [])
        operations.declare_operation(self.schemas['synthetic_search'], plugin=self.provider_key,
                                     operation='synthetic-read', read_only=True)
        result = json.loads(transport.execute(self.provider_key, 'synthetic-read', {}, None, lambda: False, read_only=True))
        self.assertEqual(result['data'], {'value': 7})

    def test_mixed_financial_operation_keeps_explicit_mutations_but_rejects_automatic_ones(self):
        FinancialDelivery = importlib.import_module(PACKAGE + '.transport').FinancialDelivery
        backend = SimpleNamespace(preferences=SimpleNamespace(get=lambda: {'revision': 1}),
                                  identity=SimpleNamespace(cache_token=lambda: 1))
        entry = self.registry.get_entry(definition.TOOL_NAME)
        entry.handler.pythia_operation_support = FinancialDelivery(lambda: backend)
        mutation = {'action': 'set_preferences'}
        with self.assertRaises(transport.Rejected) as caught:
            transport.execute(self.feature_key, 'query', mutation, 'b' * 64, lambda: False, read_only=True)
        self.assertEqual(caught.exception.code, 'read_only_required')
        self.assertEqual(self.dispatches, [])
        ordinary = json.loads(transport.execute(self.feature_key, 'query', mutation, None, lambda: False))
        self.assertEqual(ordinary['data'], {'value': 7})
        read = json.loads(transport.execute(self.feature_key, 'query', {'action': 'get_preferences'}, None,
                                           lambda: False, read_only=True))
        self.assertEqual(read['data'], {'value': 7})

    def test_worker_rechecks_read_only_after_admission_and_scopes_reuse(self):
        operations.declare_operation(self.schemas['synthetic_search'], plugin=self.provider_key,
                                     operation='synthetic-read', read_only=True)
        resource = {'plugin': self.provider_key, 'operation': 'synthetic-read', 'arguments': {}, 'read_only': True}
        operations.inspect_resource(resource)
        operations.declare_operation(self.schemas['synthetic_search'], plugin=self.provider_key,
                                     operation='synthetic-read', read_only=False)
        with self.assertRaises(transport.Rejected):
            transport.execute(self.provider_key, 'synthetic-read', {}, None, lambda: False, read_only=True)
        self.assertEqual(self.dispatches, [])
        context = importlib.import_module(PLATFORM + '.request_context')
        unrestricted = access.native_access_scope()
        token = context.read_only_required.set(True)
        try:
            self.assertNotEqual(unrestricted, access.native_access_scope())
        finally:
            context.read_only_required.reset(token)

    def test_updates_require_read_only_even_when_operation_opts_into_updates(self):
        operations.declare_operation(self.schemas['synthetic_search'], plugin=self.provider_key,
                                     operation='synthetic-read', updates=True)
        with self.assertRaises(transport.Rejected) as caught:
            operations.inspect_resource({'plugin': self.provider_key, 'operation': 'synthetic-read', 'arguments': {}},
                                        updates=True)
        self.assertEqual(caught.exception.code, 'read_only_required')

    def test_disabling_financial_feature_preserves_specialist_http_and_cli(self):
        self.config['plugins']['disabled'] = [self.feature_key]
        with self.assertRaises(contributions.ContextUnavailable):
            contributions.eligible_tools()
        with self.assertRaises(transport.Rejected) as caught:
            operations.resolve(self.feature_key, 'query', {'action': 'describe'})
        self.assertEqual(caught.exception.status, 403)
        result = json.loads(transport.execute('synthetic', 'synthetic-read', {}, None, lambda: False))
        self.assertEqual(result['data'], {'value': 7})
        commands = []
        ctx = SimpleNamespace(plugin_id=self.provider_key,
            register_cli_command=lambda *_args: commands.append(_args[-1]))
        specialist.register_read_command(ctx, 'synthetic-read', 'synthetic_search', 'Synthetic read')
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            commands[0](SimpleNamespace(platform='cli', request='{}', reuse_scope=None))
        self.assertEqual(json.loads(output.getvalue())['data'], {'value': 7})
        self.assertEqual(self.dispatches, ['synthetic_search', 'synthetic_search'])


if __name__ == '__main__':
    unittest.main()
