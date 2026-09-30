"""Core registration through the native Hermes context contract."""
import importlib.util
import json
from pathlib import Path
import sys
import unittest

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

    def register_platform_handler(self, *args):
        self.platform_handlers.append(args)

    def register_system_prompt_section(self, *args, **kwargs):
        self.sections.append((args, kwargs))

    def register_tool(self, **kwargs):
        self.tools[kwargs['name']] = kwargs


class CoreTest(unittest.TestCase):
    def test_core_registers_desk_dispatch_and_platform_transport(self):
        context = RegistryContractContext()
        MODULE.register(context)
        handler = context.tools['pythia_desk_view']['handler']
        result = json.loads(handler({'view_reference': 'invalid'}, session_id='synthetic'))
        self.assertFalse(result['available'])
        self.assertEqual(result['reason'], 'invalid_reference')
        self.assertTrue(any(name == 'api_server' for name, _ in context.platform_handlers))
        self.assertTrue(context.sections)


if __name__ == '__main__':
    unittest.main()
