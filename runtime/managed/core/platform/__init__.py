"""Shared platform support exported by the loaded native Pythia core plugin."""
from . import access, admission, configuration, request_context, subscription
from .operations import declare_operation
from .specialist import register_read_command
from .assets import read_bundled_asset
from .widgets import register_widget_presentation

API_VERSION = 1


def price_sources(subject_id):
    """Where a subject's market data comes from (core identity, ADR 0037).

    {"asset_class", "refs", "named", "reason"}: the native references that serve its quote
    and chart in core's order, the providers the investor named in `source_order`, and
    why there are none ("no_reference_data",
    "unknown_subject", "core_unavailable"). Local only; never calls a provider."""
    from .. import identity_ops
    return identity_ops.price_sources(subject_id)


def register_agent_tool(ctx, name, tool, description, check_fn=None):
    """Expose one of the calling plugin's operation tools to the agent as a native tool (docs/architecture/agent-tools.md)."""
    try:
        from ..agent_depth import register_agent_tool as register
    except ImportError:  # this package loaded without its core (provider-free plugin tests): no agent tools
        return None
    return register(ctx, name, tool, description, check_fn)


def register(ctx):
    from .http import register as register_http
    register_http(ctx)
