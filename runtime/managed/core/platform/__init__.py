"""Pythia's shared platform support inside core: the protected HTTP adapter and the plugin interface.

Plugins never import this package. They import `pythia_platform`, the interface module `v1` that `publish` binds.
"""
import sys

NAME = 'pythia_platform'


def register(ctx):
    from .http import register as register_http
    register_http(ctx)


def publish(ctx):
    """Bind `import pythia_platform` to interface v1 (ADR 0045) until this core unloads.

    Hermes runs core's register() before the register() of any plugin that declares `requires_plugins: [pythia]`.
    Each registration rebinds and unloading unbinds, so a reload or a disabled core never leaves a stale alias."""
    from . import v1
    sys.modules[NAME] = v1

    def unpublish():
        if sys.modules.get(NAME) is v1:
            del sys.modules[NAME]
    ctx.on_unload(unpublish)
