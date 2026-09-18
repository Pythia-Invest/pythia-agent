"""Resolve the declared core dependency from the actual native loaded modules."""


def platform():
    from hermes_cli.plugins import get_plugin_manager
    plugins = [item for item in get_plugin_manager()._plugins.values()
               if item.manifest.name == 'pythia' and item.enabled and item.module is not None]
    support = getattr(plugins[0].module, 'platform', None) if len(plugins) == 1 else None
    if support is None or getattr(support, 'API_VERSION', None) != 1:
        raise RuntimeError('market-data requires one enabled native Pythia core with platform support v1')
    return support
