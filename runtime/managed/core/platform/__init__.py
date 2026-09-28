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


def register_agent_tool(ctx, name, tool, description, check_fn=None, operations=None):
    """Expose one of the calling plugin's operation tools to the agent as a native tool (docs/architecture/agent-tools.md)."""
    try:
        from ..agent_depth import register_agent_tool as register
    except ImportError:  # this package loaded without its core (provider-free plugin tests): no agent tools
        return None
    return register(ctx, name, tool, description, check_fn, operations)


def read_document(response, check=lambda: None):
    """Core's document reader for a filings plugin's `read` operation (ADR 0040, the document reader amendment).

    The plugin opens the filing document it may read (its URL scope, pacing and budget) and passes the open
    response; core streams it, decoding gzip, and returns {"title", "text", "bytes", "sections", "outline_method"}.
    `check` runs between chunks and may raise to stop. A document past core's caps raises RuntimeError
    ("output_limit"); an unreadable body raises ValueError."""
    from ..document_text import extract
    return extract(response, check)


def check_read(subject_id, native_ref, stated):
    """Check what one read of a subject's routed reference states about itself (core identity, ADR 0037).

    `subject_id` is None for an explicit reference: core checks it for the subject it last
    served it for. `stated` holds what the source's own answer says: `currency` and `venue`
    (its own venue code). Returns {"status", "label"}: status "verified", "unverified"
    (served, with the label, e.g. "venue differs"), "refused" (an enforced difference: the
    source is not used) or "unchecked". Local only; a failure is "unchecked"."""
    from .. import identity_ops, read_checks
    core = identity_ops.CURRENT
    return read_checks.check_read(core, subject_id, native_ref, stated) if core else {"status": "unchecked", "label": None}


def register(ctx):
    from .http import register as register_http
    register_http(ctx)
