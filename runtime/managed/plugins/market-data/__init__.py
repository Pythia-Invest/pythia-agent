"""Native market-data feature: one backend entry for tools and non-model callers."""
import json
from threading import RLock

from .definition import SCHEMA, TOOL_NAME, TOOLSET


def register(ctx):
    # Discovery describes schemas only; one lazy backend belongs to this native
    # feature context and is shared by its tool and HTTP handler. A standalone
    # CLI creates its own context using the same implementation and durable state.
    backend = None
    backend_lock = RLock()

    def feature_backend():
        nonlocal backend
        with backend_lock:
            if backend is None:
                from .backend import Backend
                backend = Backend(ctx.state.data_dir)
            return backend

    def handle(arguments, **_context):
        from .execution import dispatch
        from .request_context import cancel_signal
        from tools.interrupt import is_thread_interrupted
        from threading import get_ident
        caller = get_ident()
        inherited = cancel_signal.get()
        provided = _context.get('cancelled')
        # Native agent cancellation belongs to its calling thread. Carry that
        # signal into coordinated child threads alongside HTTP cancellation.
        token = cancel_signal.set(lambda: bool((inherited and inherited()) or
            (provided and provided()) or is_thread_interrupted(caller)))
        try:
            if _context.get('_subscription') is not None:
                from .subscriptions import watch
                return json.dumps(watch(feature_backend(), arguments, _context['_subscription']))
            if _context.get('_http_delivery'):
                from .delivery import deliver
                return json.dumps(deliver(arguments, feature_backend, _context.get('_reuse_scope')), allow_nan=False)
            return json.dumps(dispatch(arguments, backend_factory=feature_backend), allow_nan=False, ensure_ascii=False)
        finally:
            cancel_signal.reset(token)

    ctx.register_tool(name=TOOL_NAME, toolset=TOOLSET, schema=SCHEMA, handler=handle)
    from .http_transport import register as register_http
    def resource_scope(resource):
        if resource['operation'] != 'market-data':
            return None
        arguments = resource['arguments']
        reads = arguments.get('reads', [arguments])
        preferred = arguments.get('action') == 'get_preferences' or any(
            item.get('request', {}).get('view', {}).get('kind') == 'pythia' for item in reads)
        if not preferred:
            return None
        owner = feature_backend()
        return [owner.preferences.get()['revision'], owner.identity.cache_token()]
    register_http(ctx, resource_scope=resource_scope)

    def setup(parser):
        parser.add_argument("--platform", required=True, choices=["cli", "api_server"],
                            help="Native caller platform whose tool choices apply")
        parser.add_argument("--request", required=True, help="Shared request as JSON (no credentials)")
        parser.add_argument("--reuse-scope", help="Conditional reuse of unexpired caller-held read results")

    def command(args):
        from gateway.session_context import set_session_vars, clear_session_vars
        from .execution import dispatch, failure
        tokens = set_session_vars(platform=args.platform)
        try:
            try:
                request = json.loads(args.request)
                from .delivery import deliver
                result = deliver(request, feature_backend, getattr(args, 'reuse_scope', None))
            except (ValueError, TypeError, RecursionError):
                result = failure("invalid_request")
            print(json.dumps(result, allow_nan=False, ensure_ascii=False))
        finally:
            clear_session_vars(tokens)

    ctx.register_cli_command("market-data", "Inspect and read connected market data", setup, command)
