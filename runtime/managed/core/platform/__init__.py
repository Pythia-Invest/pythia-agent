"""Pythia's shared platform support inside core: the protected HTTP adapter, the connector toolkit and the plugin
interface.

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
    Each registration rebinds and unloading unbinds, so a reload or a disabled core never leaves a stale alias.
    One core serves a process: while another core's interface is still published, this one refuses to register."""
    from . import v1
    bound = sys.modules.get(NAME)
    if bound is not None and bound is not v1 and getattr(bound, '_published', False):
        raise RuntimeError('another Pythia core already publishes pythia_platform in this process')
    sys.modules[NAME] = v1
    v1._published = True

    def unpublish():
        v1._published = False
        if sys.modules.get(NAME) is v1:
            del sys.modules[NAME]
    ctx.on_unload(unpublish)
