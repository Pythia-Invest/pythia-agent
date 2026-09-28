"""Shared platform support exported by the loaded native Pythia core plugin."""
from . import access, admission, configuration, request_context, subscription
from .operations import declare_operation
from .specialist import register_read_command
from .assets import read_bundled_asset
from .widgets import register_widget_presentation

API_VERSION = 1


def price_sources(subject_id):
    """Where a subject's market data comes from (core identity, ADR 0037).

    {"asset_class", "refs", "reason"}: the native references that serve its quote and
    chart in core's order, and why there are none ("no_reference_data",
    "unknown_subject", "core_unavailable"). Local only; never calls a provider."""
    from .. import identity_ops
    return identity_ops.price_sources(subject_id)


def check_read(subject_id, native_ref, stated):
    """Check what one read of a subject's routed reference states about itself (core identity, ADR 0037).

    `stated` holds what the source's own answer says: `isin`, `currency`, `venue` (its own
    venue code), `name`. Returns "verified", "refused" (the reference no longer serves the
    subject; a conflict is open in Repairs), "questioned" or "unchecked". Local only."""
    from .. import identity_ops
    return identity_ops.check_read(subject_id, native_ref, stated)


def register(ctx):
    from .http import register as register_http
    register_http(ctx)
