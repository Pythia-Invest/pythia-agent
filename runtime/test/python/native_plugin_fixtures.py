"""Provider-free fixture seams for Hermes 29112bef's native plugin API.

PluginContext.plugin_id/register_tool and tools.registry.get_entry return the
same handler/schema objects used by the shared platform's operation declaration.
Native discovery and ownership are exercised separately by assembled qualification.
"""
import sys
from types import ModuleType, SimpleNamespace

import market_data_fixture  # noqa: F401 - binds `pythia_platform` for the plugins under test


def keep_platform_binding(test):
    """Registering a core copy publishes its own `pythia_platform`; give the suite's binding back after `test`."""
    test.addCleanup(sys.modules.__setitem__, 'pythia_platform', sys.modules['pythia_platform'])


class Context:
    def __init__(self, plugin_id):
        self.plugin_id = plugin_id
        self.tools, self.checks, self.registrations = {}, {}, {}
        self.entries = {}
        self.registry_module = ModuleType('tools.registry')
        self.registry_module.registry = SimpleNamespace(get_entry=self.entries.get)

    def register_skill(self, *_args, **_kwargs): pass
    def on_unload(self, *_args, **_kwargs): pass
    def has_plugin(self, _name): return True
    def get_config(self, _name, default=None): return default
    def register_cli_command(self, *_args, **_kwargs): pass

    def register_tool(self, **entry):
        name = entry['name']
        self.registrations[name] = entry
        self.tools[name] = entry['handler']
        self.checks[name] = entry.get('check_fn')
        self.entries[name] = SimpleNamespace(**entry)
