"""The plugin platform interface v1 (ADR 0045): core publishes `pythia_platform`, and plugins register through it alone.

Registration uses stand-ins for the pinned PluginContext; the assembled qualification loads the same plugins
through the real Hermes loader.
"""
import importlib.util
from itertools import takewhile
import json
import sys
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest import mock

from native_plugin_fixtures import Context, keep_platform_binding, without_market_data
from test_core import MODULE as core, RegistryContractContext

PLUGINS = Path(__file__).resolve().parents[2] / 'managed/plugins'
# Frozen: v1 only gains names. Removing one or changing its meaning is v2.
V1 = ['API_VERSION', 'require', 'access', 'admission', 'configuration', 'request_context', 'subscription',
      'declare_operation', 'register_read_command', 'register_agent_tool', 'register_widget_presentation',
      'price_sources', 'check_read', 'read_document', 'validate_live_market',
      'connector', 'wire', 'process', 'FilingKind',
      'dispatch', 'tool_schemas', 'interrupted', 'session', 'session_platform']
# Frozen with them: the members each exported module offers. A plugin may use these and nothing else in the module.
MEMBERS = {
    'access': ['ContextUnavailable', 'eligible_tools', 'native_access_scope', 'owned_tools'],
    'admission': ['AdmissionError'],
    'configuration': ['needs_configuration', 'value'],
    'request_context': ['cancel_signal', 'cancelled', 'usage'],
    'subscription': ['Subscription'],
    'connector': ['NativeBatch', 'ReadCache', 'ReadCancelled', 'ResidentTransport', 'SourceFailure', 'StreamingWorker',
                  'Transport', 'WorkerReads', 'connection', 'detail', 'emit', 'failed_item',
                  'item_failures', 'parallel', 'qualify_failure', 'qualify_items', 'retry_after', 'worker_batch',
                  'worker_failure', 'worker_item'],
    'wire': ['CRITERIA', 'WireError', 'parameter_schema', 'require', 'validate', 'validate_parameters',
             'validate_read_result'],
    'process': ['WorkerError', 'run_worker'],
}


def plugin(directory):
    """A plugin package as Hermes imports it: its own name, its module body run, register() not yet called."""
    name = 'platform_v1_' + directory.replace('-', '_')
    spec = importlib.util.spec_from_file_location(name, PLUGINS / directory / '__init__.py',
                                                  submodule_search_locations=[str(PLUGINS / directory)])
    module = sys.modules[name] = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def requires(directory):
    """The plugins a manifest's `requires_plugins` list names."""
    lines = iter((PLUGINS / directory / 'plugin.yaml').read_text().splitlines())
    next(line for line in lines if line == 'requires_plugins:')
    return [line[4:] for line in takewhile(lambda line: line.startswith('  - '), lines)]


class Loader(Context):
    """The PluginContext calls market-data's register makes beyond the fixture's."""

    def __init__(self, plugin_id, directory):
        super().__init__(plugin_id)
        self.manifest = SimpleNamespace(path=str((PLUGINS / directory).resolve()))
        self.unloads = []

    def register_platform_handler(self, *_args):
        pass

    def on_unload(self, callback):
        self.unloads.append(callback)


class Publication(unittest.TestCase):
    def setUp(self):
        keep_platform_binding(self)

    def test_core_publishes_v1_rebinds_on_register_and_unbinds_on_unload(self):
        core.register(RegistryContractContext())
        v1 = sys.modules[core.__name__ + '.platform.v1']
        import pythia_platform
        self.assertIs(pythia_platform, v1)
        sys.modules['pythia_platform'] = object()  # a stale alias from an earlier load
        context = RegistryContractContext()
        core.register(context)
        self.assertIs(sys.modules['pythia_platform'], v1)
        for callback in context.unloads:
            callback()
        self.assertNotIn('pythia_platform', sys.modules)
        with self.assertRaises(ModuleNotFoundError):
            import pythia_platform  # noqa: F401, F811

    def test_unloading_a_core_leaves_another_cores_binding(self):
        context = RegistryContractContext()
        core.register(context)
        later = sys.modules['pythia_platform'] = ModuleType('later_interface')  # bound after this core's
        for callback in context.unloads:
            callback()
        self.assertIs(sys.modules['pythia_platform'], later)

    def test_a_second_core_refuses_while_another_publishes(self):
        other = sys.modules['pythia_platform'] = ModuleType('other_interface')
        other._published = True  # another core in this process, still registered
        with self.assertRaisesRegex(RuntimeError, 'another Pythia core'):
            core.register(RegistryContractContext())
        self.assertIs(sys.modules['pythia_platform'], other)

    def test_the_interface_is_flat_versioned_and_frozen(self):
        import pythia_platform
        self.assertEqual(pythia_platform.__all__, V1)
        self.assertTrue(all(hasattr(pythia_platform, name) for name in V1))
        for name, members in MEMBERS.items():
            with self.subTest(module=name):
                exported = getattr(pythia_platform, name)
                self.assertEqual(dir(exported), members)
                self.assertTrue(all(hasattr(exported, member) for member in members))
        # A module's other contents are not the interface: this one returns Hermes's own plugin objects.
        with self.assertRaisesRegex(AttributeError, 'does not export'):
            pythia_platform.access.native_tool_owners  # noqa: B018
        self.assertEqual([kind.value for kind in pythia_platform.FilingKind][0], 'annual')
        pythia_platform.require(1)
        with self.assertRaisesRegex(RuntimeError, 'v1, not v2'):
            pythia_platform.require(2)
        # Not a package: a submodule import fails instead of loading a second copy of core's files.
        with self.assertRaisesRegex(ModuleNotFoundError, 'not a package'):
            import pythia_platform.access  # noqa: F401


class PluginsRegisterThroughTheInterface(unittest.TestCase):
    """With Hermes's plugin manager unreachable, plugins still register; without the interface, they refuse.

    Connectors also register with no copy of market-data importable: they depend on core alone."""

    def register(self, directory, plugin_id, *, alone=True):
        module, ctx = plugin(directory), Loader(plugin_id, directory)
        with mock.patch.dict(sys.modules, {'tools.registry': ctx.registry_module}):
            if alone:
                without_market_data(self)
            module.register(ctx)
        with mock.patch.dict(sys.modules, {'pythia_platform': None}), self.assertRaises(ImportError):
            module.register(Loader(plugin_id, directory))
        return module, ctx

    def test_market_data(self):
        _module, ctx = self.register('market-data', 'pythia-market-data', alone=False)
        self.assertEqual(set(ctx.tools), {'pythia_market_data', 'pythia_market_data_widgets'})
        marker = json.loads(ctx.registrations['pythia_market_data']['schema']['parameters']['$comment'])
        self.assertEqual(marker['pythia_http_operation']['operation'], 'query')

    def test_hyperliquid(self):
        _module, ctx = self.register('hyperliquid', 'pythia-hyperliquid')
        self.assertIn('pythia_hyperliquid_live_market', ctx.tools)
        marker = json.loads(ctx.registrations['pythia_hyperliquid_live_market']['schema']['parameters']['$comment'])
        self.assertEqual(marker['pythia_http_operation']['operation'], 'live_market')
        self.assertEqual(len(ctx.unloads), 1)  # its streams close when it unloads

    def test_connectors(self):
        for directory in ('sec', 'gleif', 'openfigi', 'xbrl-filings', 'nsm',
                          'eodhd', 'yahoo-discovery', 'coingecko', 'coinmarketcap', 'defillama'):
            with self.subTest(plugin=directory):
                # Hermes orders loading by `requires_plugins` but never enforces it: the manifest names core alone.
                self.assertEqual(requires(directory), ['pythia'])
                module, ctx = self.register(directory, 'pythia-' + directory)
                tools = getattr(module, 'TOOLS', None) or {'mapping': module.TOOL}
                self.assertLessEqual(set(tools.values()), set(ctx.tools))


if __name__ == '__main__':
    unittest.main()
