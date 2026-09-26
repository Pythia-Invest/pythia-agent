"""Provider-free fixture seams for Hermes 29112bef's native plugin API.

PluginContext.plugin_id/register_tool and tools.registry.get_entry return the
same handler/schema objects used by the shared platform's operation declaration.
Native discovery and ownership are exercised separately by assembled qualification.
"""
import sys
from types import ModuleType, SimpleNamespace

from test_market_data_identity import platform_module


def bind_feature_platform(package):
    dependency = ModuleType(package + '._platform')
    dependency.platform = lambda: platform_module
    sys.modules[dependency.__name__] = dependency


class Context:
    def __init__(self, plugin_id):
        self.plugin_id = plugin_id
        self.tools, self.checks, self.registrations = {}, {}, {}
        self.entries = {}
        self.registry_module = ModuleType('tools.registry')
        self.registry_module.registry = SimpleNamespace(get_entry=self.entries.get)

    def has_plugin(self, _name): return True
    def get_config(self, _name, default=None): return default
    def register_cli_command(self, *_args, **_kwargs): pass

    def register_tool(self, **entry):
        name = entry['name']
        self.registrations[name] = entry
        self.tools[name] = entry['handler']
        self.checks[name] = entry.get('check_fn')
        self.entries[name] = SimpleNamespace(**entry)
