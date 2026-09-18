"""Platform-owned authentication/admission on the native API application."""
import asyncio
import json

from .admission import Admission, AdmissionError
from .contributions import eligible_tools, owns_tool, ContextUnavailable
from .definition import TOOL_NAME
from .request_context import cancel_signal, dashboard_operation
from .selection import native_access_scope, fingerprint
from .wire import WireError
from .failures import item_failures

MARKER = 'pythia_http_operation'
MAX_INPUT = 65536
MAX_OUTPUT = 16_000_000
Rejected = AdmissionError


def declaration(schema):
    try:
        return json.loads(schema['parameters'].get('$comment', '{}')).get(MARKER)
    except (KeyError, TypeError, ValueError):
        return None


def resolve(operation, arguments):
    """Resolve only deliberately exposed native operations; never arbitrary tools."""
    from tools.registry import registry
    from jsonschema import Draft202012Validator, ValidationError
    eligible = eligible_tools()
    if operation == 'market-data':
        name, age = TOOL_NAME, 0
    else:
        candidates, declared = [], False
        for candidate in registry.get_all_tool_names():
            meta = declaration(registry.get_schema(candidate))
            if (isinstance(meta, dict) and meta.get('operation') == operation
                    and owns_tool(candidate, meta.get('plugin'))):
                declared = True
                if candidate in eligible:
                    candidates.append((candidate, meta))
        if declared and not candidates:
            raise Rejected('unavailable', 403)
        if len(candidates) != 1:
            raise Rejected('unsupported_operation', 404)
        name, meta = candidates[0]
        age = meta.get('cache_seconds', 0)
        for override in meta.get('cache_overrides', []):
            if all(arguments.get(key) == value for key, value in override['when'].items()):
                age = override['seconds']
        if type(age) is not int or not 0 <= age <= 86400:
            raise Rejected('invalid_operation', 503)
    if name not in eligible:
        raise Rejected('unavailable', 403)
    try:
        Draft202012Validator(registry.get_schema(name)['parameters']).validate(arguments)
    except ValidationError:
        raise Rejected('invalid_request', 400) from None
    return name, age


@dashboard_operation
def execute(operation, arguments, reuse_scope, cancelled):
    """Worker entry; access is rechecked even for cached results."""
    from tools.registry import registry
    from gateway.session_context import set_session_vars, clear_session_vars
    tokens = set_session_vars(platform='api_server')
    token = cancel_signal.set(cancelled)
    try:
        name, age = resolve(operation, arguments)
        access = native_access_scope()
        raw = registry.dispatch(name, arguments, cancelled=cancelled,
                                _http_delivery=operation == 'market-data', _reuse_scope=reuse_scope)
        if not isinstance(raw, str) or len(raw.encode()) > MAX_OUTPUT:
            raise Rejected('invalid_response', 502)
        result = json.loads(raw)
        if not isinstance(result, dict) or result.get('schema_version') != 1 or 'error' in result:
            raise Rejected('invalid_response', 502)
        if cancelled():
            raise Rejected('cancelled', 499)
        if access != native_access_scope() or name not in eligible_tools():
            raise Rejected('access_changed', 409)
        if age:
            failures = item_failures(result.get('data'))
            if failures:
                terminal = {'authentication_failed', 'access_denied', 'invalid_request', 'unsupported_window'}
                age = max(300 if any(row['code'] in terminal for row in failures) else 15,
                          max((row.get('retry_after_seconds', 0) for row in failures), default=0))
            result['delivery'] = {'max_age_seconds': age}
        encoded = json.dumps(result, allow_nan=False).encode()
        if len(encoded) > MAX_OUTPUT:
            raise Rejected('invalid_response', 502)
        return encoded
    finally:
        cancel_signal.reset(token)
        clear_session_vars(tokens)


def register(ctx, *, workers=4, timeout=30, resource_scope=lambda _request: None):
    def factory(app, adapter):
        from aiohttp import web
        from hermes_constants import get_hermes_home
        owner = get_hermes_home().resolve()
        admission = Admission(workers=workers)
        histories = Admission(workers=2, limit=32)
        control = Admission(workers=2, limit=128)
        bodies = set()

        def error(code, status):
            return web.json_response({'error': {'code': code, 'message': {
                'unauthorized': 'Authentication required.', 'profile_unavailable': 'This profile is not served here.',
                'busy': 'Financial requests are busy; try again shortly.', 'timeout': 'Financial request timed out.',
                'invalid_request': 'Invalid financial request.', 'request_too_large': 'Financial request is too large.',
                'unavailable': 'The requested operation is disabled or unavailable.',
            }.get(code, 'Financial request could not be completed.')}}, status=status,
                headers={'Cache-Control': 'no-store', **({'Retry-After': '1'} if status == 429 else {})})

        def authorize(request):
            if not adapter._expected_api_key():
                return error('unauthorized', 401)
            rejected = adapter._check_auth(request)
            if rejected is not None:
                return rejected
            if get_hermes_home().resolve() != owner:
                return error('profile_unavailable', 404)
            return None

        async def read_body(request):
            if request.content_type != 'application/json':
                raise Rejected('invalid_request', 415)
            if len(bodies) >= 32:
                raise Rejected('busy', 429)
            marker = object()
            bodies.add(marker)
            async def read():
                data = bytearray()
                async for chunk in request.content.iter_chunked(8192):
                    data.extend(chunk)
                    if len(data) > MAX_INPUT:
                        raise Rejected('request_too_large', 413)
                return json.loads(data, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
            try:
                return await asyncio.wait_for(read(), timeout=5)
            finally:
                bodies.discard(marker)

        async def inspect(resource):
            @dashboard_operation
            def check(_cancelled):
                from gateway.session_context import set_session_vars, clear_session_vars
                tokens = set_session_vars(platform='api_server')
                try:
                    resolve(resource['operation'], resource['arguments'])
                    return fingerprint({'access': native_access_scope(), 'domain': resource_scope(resource)})
                except ContextUnavailable:
                    raise Rejected('unavailable', 403) from None
                finally:
                    clear_session_vars(tokens)
            return await control.run(('inspect', fingerprint(resource)), check, timeout=timeout)

        async def run(operation, arguments, reuse, disconnected=lambda: False):
            resource = {'operation': operation, 'arguments': arguments}
            scope = await inspect(resource)
            key = fingerprint({'resource': resource, 'scope': scope, 'reuse': reuse})
            # Reserve a separate bounded lane: history cannot occupy every
            # quote slot, and sustained quote traffic cannot starve charts.
            history = arguments.get('kind') == 'charts' or (arguments.get('reads') and all(item.get('request', {}).get('operation') == 'history' for item in arguments['reads'])) or arguments.get('request', {}).get('operation') == 'history'
            lane = histories if history else admission
            return await lane.run(key, lambda cancelled: execute(operation, arguments, reuse, cancelled),
                                       timeout=timeout, disconnected=disconnected)

        async def subscribe(resource, publish):
            if resource['operation'] != 'market-data':
                return None
            from .subscriptions import Subscription
            from .live_batch import materialize
            lifetime = Subscription(publish, resource.get('window'))
            @dashboard_operation
            def start(_cancelled):
                from tools.registry import registry
                from gateway.session_context import set_session_vars, clear_session_vars
                tokens = set_session_vars(platform='api_server')
                try:
                    arguments = materialize(resource)
                    name, _ = resolve('market-data', arguments)
                    raw = registry.dispatch(name, arguments, _subscription=lifetime, cancelled=lifetime.closed.is_set)
                    return json.loads(raw) if isinstance(raw, str) else {}
                finally:
                    clear_session_vars(tokens)
            try:
                ack = await control.run(('subscribe', fingerprint(resource)), start)
                if ack.get('mode') == 'push':
                    return lifetime.close
                await asyncio.to_thread(lifetime.close)
                if ack.get('mode') != 'poll':
                    raise Rejected('unsupported_updates', 422)
                return None
            except BaseException:
                await asyncio.to_thread(lifetime.close)
                raise

        async def handler(request):
            denied = authorize(request)
            if denied is not None:
                return denied
            try:
                body = await read_body(request)
                if not isinstance(body, dict) or not {'arguments'} <= set(body) <= {'arguments', 'reuse_scope'} or not isinstance(body['arguments'], dict):
                    raise Rejected('invalid_request', 400)
                reuse = body.get('reuse_scope')
                if reuse is not None and (not isinstance(reuse, str) or len(reuse) != 64 or any(c not in '0123456789abcdef' for c in reuse)):
                    raise Rejected('invalid_request', 400)
                result = await run(request.match_info.get('operation', 'market-data'), body['arguments'], reuse,
                                   lambda: request.transport is None or request.transport.is_closing())
                return web.Response(body=result, content_type='application/json', headers={'Cache-Control': 'no-store'})
            except Rejected as rejected:
                return error(rejected.code, rejected.status)
            except asyncio.TimeoutError:
                return error('timeout', 504)
            except ContextUnavailable:
                return error('unavailable', 403)
            except (ValueError, TypeError, WireError, RecursionError):
                return error('invalid_request', 400)
            except asyncio.CancelledError:
                raise
            except Exception:
                return error('unavailable', 503)

        from .live_http import install
        install(app, authorize, read_body, error, run, inspect, subscribe)

        async def cleanup(_app):
            from .process_stream import close_all
            await asyncio.to_thread(close_all)
            await admission.close()
            await histories.close()
            await control.close()
        app.on_cleanup.append(cleanup)
        for path in ('/v1/pythia/financial', '/v1/pythia/plugins/{operation}'):
            app.router.add_post(path, handler)
            app.router.add_post('/p/{profile}' + path, handler)
    ctx.register_platform_handler('api_server', factory)
