"""Pythia's platform interface for plugins, version 1 (ADR 0045).

Core publishes this module as `pythia_platform` when it registers (`publish` in this package). A plugin declares
`requires_plugins: [pythia]` and, inside its own `register(ctx)`, runs `import pythia_platform as platform` and
`platform.require(1)`. `__all__` and each exported module's member list below are the frozen surface: names are only
added within a version; removing one or changing its meaning is version 2.
"""
from contextlib import contextmanager

from . import access as _access, admission as _admission, configuration as _configuration
from . import connector as _connector, request_context as _request_context, subscription as _subscription
from .connector import process as _process, wire as _wire
from .operations import declare_operation
from .specialist import register_read_command
from .widgets import register_widget_presentation
from ..identity import schemes as _schemes
from ..identity.concepts import FilingKind

API_VERSION = 1

__all__ = [
    'API_VERSION', 'require',
    'access', 'admission', 'configuration', 'request_context', 'subscription',
    'declare_operation', 'register_read_command', 'register_agent_tool', 'register_widget_presentation',
    'price_sources', 'check_read', 'read_document', 'validate_live_market',
    'connector', 'wire', 'process', 'identifiers', 'FilingKind',
    'dispatch', 'tool_schemas', 'interrupted', 'session', 'session_platform',
]


class _Module:
    """A core module as v1 exports it: only its frozen members, looked up on each use."""

    def __init__(self, module, *members):
        self._module, self._members = module, frozenset(members)

    def __getattr__(self, name):  # reads __dict__ directly: a copy made without __init__ must not recurse
        state = self.__dict__
        if name in state.get('_members', ()):
            return getattr(state['_module'], name)
        raise AttributeError(f'pythia_platform v{API_VERSION} does not export {name!r} from this module')

    def __dir__(self):
        return sorted(self._members)


access = _Module(_access, 'ContextUnavailable', 'eligible_tools', 'native_access_scope', 'owned_tools')
admission = _Module(_admission, 'AdmissionError')
configuration = _Module(_configuration, 'value', 'needs_configuration')
request_context = _Module(_request_context, 'cancel_signal', 'cancelled', 'usage')
subscription = _Module(_subscription, 'Subscription')
# The connector toolkit: bounded worker and HTTPS reads, budgets, caching, batching and safe failures.
connector = _Module(_connector, 'NativeBatch', 'ReadCache', 'ReadCancelled', 'ResidentTransport', 'SourceFailure',
                    'StreamingWorker', 'Transport', 'WorkerReads', 'connection', 'detail', 'emit', 'failed_item',
                    'item_failures', 'parallel', 'qualify_failure', 'qualify_items', 'retry_after', 'worker_batch',
                    'worker_failure', 'worker_item')
wire = _Module(_wire, 'CRITERIA', 'WireError', 'parameter_schema', 'require', 'validate', 'validate_parameters',
               'validate_read_result')
process = _Module(_process, 'WorkerError', 'run_worker')  # the default worker transport for WorkerReads
# Core's identifier forms, so a plugin states an identifier exactly as core joins on it (a Sui coin type as CAIP-19, a Sui
# package or object ID in 64-digit lowercase form): `normalize_identifier(scheme, value)` returns the canonical value or
# raises `IdentifierError`.
identifiers = _Module(_schemes, 'IdentifierError', 'normalize_identifier')


def require(version):
    """Raise RuntimeError unless this core serves platform interface `version`."""
    if version != API_VERSION:
        raise RuntimeError(f'this Pythia core serves platform interface v{API_VERSION}, not v{version}')


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


def validate_live_market(document):
    """Check a live market snapshot against core's `live_market` schema (ADR 0043).

    Returns the document; raises ValueError naming the first bad path."""
    from ..identity import validate_live_market as validate
    return validate(document)


# What a plugin that coordinates other plugins' reads (market-data) needs from the harness, and nothing more.
def dispatch(tool, arguments, **context):
    """Run one native tool in this process and return its raw result. Never exposed over HTTP; the caller checks
    first that the tool is one it may run (`access.eligible_tools`)."""
    from tools.registry import registry
    return registry.dispatch(tool, arguments, **context)


def tool_schemas():
    """{tool name: native schema} for every registered tool, whether or not it is available."""
    from tools.registry import registry
    return {name: registry.get_schema(name) for name in registry.get_all_tool_names()}


def interrupted(thread=None):
    """Whether the agent asked the native call on this thread, or on `thread` (a thread ident), to stop."""
    from tools.interrupt import is_interrupted, is_thread_interrupted
    return is_interrupted() if thread is None else is_thread_interrupted(thread)


@contextmanager
def session(platform):
    """Run a command-line read as the native caller `platform` ("cli" or "api_server"), whose tool choices apply."""
    from gateway.session_context import clear_session_vars, set_session_vars
    tokens = set_session_vars(platform=platform)
    try:
        yield
    finally:
        clear_session_vars(tokens)


def session_platform():
    """The native caller platform of the current call, or "" outside a trusted native call."""
    from gateway.session_context import get_session_env
    return get_session_env('HERMES_SESSION_PLATFORM', '')
