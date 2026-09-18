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

from test_market_data_identity import PACKAGE

contributions = importlib.import_module(PACKAGE + '.contributions')
execution = importlib.import_module(PACKAGE + '.execution')
transport = importlib.import_module(PACKAGE + '.http_transport')
specialist = importlib.import_module(PACKAGE + '.specialist')
selection = importlib.import_module(PACKAGE + '.selection')
definition = importlib.import_module(PACKAGE + '.definition')
wire = importlib.import_module(PACKAGE + '.wire')


class NativeAccessTests(unittest.TestCase):
    def setUp(self):
        self.feature_key, self.provider_key = 'features/pythia-market-data', 'finance/synthetic'
        self.config = {'plugins': {'enabled': [self.feature_key, self.provider_key]}}
        self.schemas = {definition.TOOL_NAME: {'name': definition.TOOL_NAME, 'parameters': {
            'type': 'object', 'properties': {'action': {'type': 'string'}},
            'required': ['action'], 'additionalProperties': False}}}
        self.manager = SimpleNamespace(_plugins={}, _registration_order=[])
        self.add_plugin(self.feature_key, 'pythia-market-data', definition.TOOL_NAME)
        self.add_plugin(self.provider_key, 'synthetic', 'synthetic_search')
        marker = {'schema_version': 1, 'provider': 'synthetic', 'adapter_version': 'test-1',
                  'operations': [{'operation': 'search', 'tool': 'synthetic_search', 'effect': 'read'}],
                  'subject_kinds': ['instrument']}
        self.schemas['synthetic_search'] = {'name': 'synthetic_search', 'parameters': {
            'type': 'object', 'properties': {}, 'additionalProperties': False,
            '$comment': json.dumps({contributions.MARKER: marker, transport.MARKER: {
                'operation': 'synthetic-read', 'plugin': 'synthetic', 'cache_seconds': 0}})}}
        self.dispatches = []
        self.handler = lambda: {'schema_version': 1, 'outcome': 'ok', 'data': {'value': 7}, 'issues': []}
        self.registry = SimpleNamespace(get_all_tool_names=lambda: list(self.schemas),
            get_schema=lambda name: self.schemas.get(name), dispatch=self.dispatch)
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
        self.enterContext(patch.object(selection, 'canonical_access_revision', return_value=[1, 2]))
        contributions._eligibility.clear()
        self.addCleanup(contributions._eligibility.clear)

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
                self.assertEqual(transport.resolve('market-data', {'action': 'describe'})[0], definition.TOOL_NAME)
                self.assertEqual(transport.resolve('synthetic-read', {})[0], 'synthetic_search')

    def test_explicit_deny_wins_for_actual_registered_tools_by_key_or_name(self):
        for disabled in (self.provider_key, 'synthetic'):
            with self.subTest(disabled=disabled):
                self.config['plugins']['disabled'] = [disabled]
                self.assertEqual(execution.call_source('synthetic', 'search', {})['issues'][0]['code'], 'unavailable')
                with self.assertRaises(transport.Rejected) as caught:
                    transport.resolve('synthetic-read', {})
                self.assertEqual(caught.exception.status, 403)
        self.assertEqual(self.dispatches, [])
        self.config['plugins']['disabled'] = ['pythia-market-data']
        with self.assertRaises(contributions.ContextUnavailable):
            transport.resolve('market-data', {'action': 'describe'})

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
        meta[transport.MARKER]['plugin'] = 'pythia-market-data'
        schema['$comment'] = json.dumps(meta)
        with self.assertRaises(transport.Rejected) as caught:
            transport.resolve('synthetic-read', {})
        self.assertEqual(caught.exception.status, 404)

    def test_specialist_collision_counts_only_currently_eligible_native_owners(self):
        alternate_key, alternate_name, alternate_tool = 'finance/alternate', 'alternate', 'alternate_search'
        self.add_plugin(alternate_key, alternate_name, alternate_tool)
        self.config['plugins']['enabled'].append(alternate_key)
        self.schemas[alternate_tool] = {'name': alternate_tool, 'parameters': {
            'type': 'object', 'properties': {}, 'additionalProperties': False,
            '$comment': json.dumps({transport.MARKER: {
                'operation': 'synthetic-read', 'plugin': alternate_name, 'cache_seconds': 0}})}}
        # A genuine active collision is ambiguous. Disabling either loaded
        # plugin removes its authority immediately, without a native unload.
        with self.assertRaises(transport.Rejected) as caught:
            transport.resolve('synthetic-read', {})
        self.assertEqual(caught.exception.status, 404)
        for disabled, expected in ((self.provider_key, alternate_tool), ('synthetic', alternate_tool),
                                   (alternate_key, 'synthetic_search'), (alternate_name, 'synthetic_search')):
            with self.subTest(disabled=disabled):
                self.config['plugins']['disabled'] = [disabled]
                self.assertEqual(transport.resolve('synthetic-read', {})[0], expected)

    def test_unowned_marker_cannot_bypass_native_plugin_access(self):
        self.manager._registration_order.pop()
        result = execution.call_source('synthetic', 'search', {})
        self.assertEqual(result['issues'][0]['code'], 'unavailable')
        self.assertEqual(self.dispatches, [])
        with self.assertRaises(transport.Rejected) as caught:
            transport.resolve('synthetic-read', {})
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
                ctx = SimpleNamespace(register_cli_command=lambda *_args: commands.append(_args[-1]))
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
        ctx = SimpleNamespace(register_cli_command=lambda *_args: commands.append(_args[-1]))
        specialist.register_read_command(ctx, 'synthetic-read', 'synthetic_search', 'Synthetic read', cache_seconds=0)
        # An opaque matching receipt must not suppress execution for an
        # operation whose declared cache lifetime is zero.
        with patch.object(selection, 'fingerprint', return_value='synthetic-matching-receipt'):
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


if __name__ == '__main__':
    unittest.main()
