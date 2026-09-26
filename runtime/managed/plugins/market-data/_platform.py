"""Resolve the declared core dependency from the actual native loaded modules."""


def _core():
    from hermes_cli.plugins import get_plugin_manager
    plugins = [item for item in get_plugin_manager()._plugins.values()
               if item.manifest.name == 'pythia' and item.enabled and item.module is not None]
    return plugins[0].module if len(plugins) == 1 else None


def platform():
    support = getattr(_core(), 'platform', None)
    if support is None or getattr(support, 'API_VERSION', None) != 1:
        raise RuntimeError('market-data requires one enabled native Pythia core with platform support v1')
    return support


def price_sources(subject_id):
    """Core's routing for a backbone subject: {asset_class, refs} in core's order, or None if unknown."""
    identity = getattr(_core(), 'identity_ops', None)
    return identity.price_sources(subject_id) if identity is not None else None
