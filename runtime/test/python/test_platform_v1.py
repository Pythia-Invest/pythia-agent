"""The plugin platform interface v1 (ADR 0045): core publishes `pythia_platform`, and plugins register through it alone.

Registration uses stand-ins for the pinned PluginContext; the assembled qualification loads the same plugins
through the real Hermes loader.
"""
import importlib.util
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from native_plugin_fixtures import Context, keep_platform_binding
from test_core import MODULE as core, RegistryContractContext

PLUGINS = Path(__file__).resolve().parents[2] / 'managed/plugins'
# Frozen: v1 only gains names. Removing one or changing its meaning is v2.
V1 = ['API_VERSION', 'require', 'access', 'admission', 'configuration', 'request_context', 'subscription',
      'declare_operation', 'register_read_command', 'register_agent_tool', 'register_widget_presentation',
      'read_bundled_asset', 'price_sources', 'check_read', 'read_document', 'validate_live_market']


def plugin(directory):
    """A plugin package as Hermes imports it: its own name, its module body run, register() not yet called."""
    name = 'platform_v1_' + directory.replace('-', '_')
    spec = importlib.util.spec_from_file_location(name, PLUGINS / directory / '__init__.py',
                                                  submodule_search_locations=[str(PLUGINS / directory)])
    module = sys.modules[name] = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


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

    def test_the_interface_is_flat_versioned_and_frozen(self):
        import pythia_platform
        self.assertEqual(pythia_platform.__all__, V1)
        self.assertTrue(all(hasattr(pythia_platform, name) for name in V1))
        pythia_platform.require(1)
        with self.assertRaisesRegex(RuntimeError, 'v1, not v2'):
            pythia_platform.require(2)
        # Not a package: a submodule import fails instead of loading a second copy of core's files.
        with self.assertRaisesRegex(ModuleNotFoundError, 'not a package'):
            import pythia_platform.access  # noqa: F401


class PluginsRegisterThroughTheInterface(unittest.TestCase):
    """With Hermes's plugin manager unreachable, plugins still register; without the interface, they refuse."""

    def register(self, directory, plugin_id):
        module, ctx = plugin(directory), Loader(plugin_id, directory)
        with mock.patch.dict(sys.modules, {'hermes_cli.plugins': None, 'tools.registry': ctx.registry_module}):
            module.register(ctx)
        with mock.patch.dict(sys.modules, {'pythia_platform': None}), self.assertRaises(ImportError):
            module.register(Loader(plugin_id, directory))
        return ctx

    def test_market_data(self):
        ctx = self.register('market-data', 'pythia-market-data')
        self.assertEqual(set(ctx.tools), {'pythia_market_data', 'pythia_market_data_widgets'})
        marker = json.loads(ctx.registrations['pythia_market_data']['schema']['parameters']['$comment'])
        self.assertEqual(marker['pythia_http_operation']['operation'], 'query')

    def test_hyperliquid(self):
        ctx = self.register('hyperliquid', 'pythia-hyperliquid')
        self.assertIn('pythia_hyperliquid_live_market', ctx.tools)
        marker = json.loads(ctx.registrations['pythia_hyperliquid_live_market']['schema']['parameters']['$comment'])
        self.assertEqual(marker['pythia_http_operation']['operation'], 'live_market')
        self.assertEqual(len(ctx.unloads), 1)  # its streams close when it unloads


if __name__ == '__main__':
    unittest.main()
