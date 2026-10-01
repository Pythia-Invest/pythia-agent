"""Core registration through the native Hermes context contract."""
import importlib.util
from itertools import takewhile
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
        skill = context.skills['identity-data'][0]  # the skill `pythia_instrument` points to, with its queries
        self.assertTrue(skill.is_file() and (skill.parent / 'references/queries.md').is_file())

    def test_the_manifest_lists_exactly_the_tools_core_registers(self):
        # Hermes shows `provides_tools` in its plugin list and uses it for the auth hint and the plugin lint; it is a
        # description of what registers (runtime/contracts/hermes.md), so a tool left out or left behind misleads.
        context = RegistryContractContext()
        MODULE.register(context)
        lines = iter((CORE.parent / 'plugin.yaml').read_text().splitlines())
        next(line for line in lines if line == 'provides_tools:')
        listed = [line[4:] for line in takewhile(lambda line: line.startswith('  - '), lines)]
        self.assertEqual(sorted(listed), sorted(context.tools))

    def test_prompt_sections_fit_their_budgets_on_every_platform(self):
        # Hermes skips, not truncates, a section longer than max_chars (hermes_cli/plugins.py
        # render_system_prompt_sections); every Desk chat then reads as carrying earlier instructions.
        context = RegistryContractContext()
        MODULE.register(context)
        for platform in ('api_server', 'cli', 'cron'):
            with self.subTest(platform=platform):
                rendered = [(args[0], len(args[1]({'platform': platform}).strip()), options['max_chars'])
                            for args, options in context.sections]
                for name, size, cap in rendered:
                    self.assertLessEqual(size, cap, name)
                # Hermes also caps the combined sections (runtime/contracts/hermes.md).
                self.assertLessEqual(sum(size for _, size, _ in rendered), 8000)
        routed = {platform: render({'platform': platform}).strip()
                  for platform in ('api_server', 'cli')
                  for (name, render), _ in context.sections if name == 'pythia.routing'}
        self.assertTrue(routed['api_server'])
        self.assertEqual(routed['cli'], '')  # Pythia's data tools serve Desk chat only


if __name__ == '__main__':
    unittest.main()
