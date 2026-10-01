"""Core's only reads of the pinned Hermes plugin manager's private state (runtime/contracts/hermes.md).

At Hermes 29112bef the public `list_plugins()` omits each plugin's path and loaded objects, and nothing public
finds which plugin registered a tool, so core reads `PluginManager._plugins` and `_registration_order` here and
nowhere else. Recheck this file when the pin changes. `tooling/check-boundaries.mjs` keeps these names out of the
rest of core and out of every plugin.
"""


def plugins():
    """{plugin key: loaded plugin} as the manager holds them, copied so a concurrent load cannot change it."""
    from hermes_cli.plugins import get_plugin_manager
    return dict(get_plugin_manager()._plugins)


def tool_owners():
    """{tool name: (plugin key, loaded plugin)} for each active tool registration: the actual native owner."""
    from hermes_cli.plugins import get_plugin_manager
    manager = get_plugin_manager()
    loaded = dict(manager._plugins)
    return {registration.key: (registration.plugin_key, loaded[registration.plugin_key])
            for registration in tuple(manager._registration_order)
            if registration.active and registration.kind == 'tool' and registration.plugin_key in loaded}
