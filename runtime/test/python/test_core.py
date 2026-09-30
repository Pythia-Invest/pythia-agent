"""Core registration through the native Hermes context contract."""
import importlib.util
import json
from pathlib import Path
import sys
import unittest

from native_plugin_fixtures import keep_platform_binding

CORE = Path(__file__).parents[2] / "managed/core/__init__.py"
SPEC = importlib.util.spec_from_file_location("pythia_core_fixture", CORE)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class RegistryContractContext:
    def __init__(self):
        self.sections = []
        self.tools = {}
        self.platform_handlers = []
        self.skills = {}
        self.unloads = []

    def on_unload(self, callback):
        self.unloads.append(callback)

    def register_platform_handler(self, *args):
        self.platform_handlers.append(args)

    def register_skill(self, name, path, **options):
        self.skills[name] = (path, options)

    def register_system_prompt_section(self, *args, **kwargs):
        self.sections.append((args, kwargs))

    def register_tool(self, **kwargs):
        self.tools[kwargs['name']] = kwargs


class CoreTest(unittest.TestCase):
    def setUp(self):
        keep_platform_binding(self)

    def test_core_registers_desk_dispatch_and_platform_transport(self):
        context = RegistryContractContext()
        MODULE.register(context)
        handler = context.tools['pythia_desk_view']['handler']
        result = json.loads(handler({'view_reference': 'invalid'}, session_id='synthetic'))
        self.assertFalse(result['available'])
        self.assertEqual(result['reason'], 'invalid_reference')
        self.assertTrue(any(name == 'api_server' for name, _ in context.platform_handlers))
        self.assertTrue(context.sections)
        self.assertTrue(context.skills['identity-data'][0].is_file())  # the skill `pythia_instrument` points to

    def test_operating_section_fits_its_budget_on_every_platform(self):
        # Hermes skips, not truncates, a section longer than max_chars (hermes_cli/plugins.py
        # render_system_prompt_sections); every Desk chat then reads as carrying earlier instructions.
        context = RegistryContractContext()
        MODULE.register(context)
        (_, render), options = next(item for item in context.sections if item[0][0] == 'pythia.operating')
        for platform in ('api_server', 'cli', 'cron'):
            with self.subTest(platform=platform):
                self.assertLessEqual(len(render({'platform': platform}).strip()), options['max_chars'])


if __name__ == '__main__':
    unittest.main()
