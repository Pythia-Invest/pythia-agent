"""Authenticated, bounded transport for deliberately exposed native operations."""
import asyncio
import json

from .access import (ContextUnavailable, eligible_tools, fingerprint, native_access_scope,
                     native_plugin_enabled)
from .admission import Admission, AdmissionError
from .configuration import declared as declared_configuration
from .operations import inspect_resource, resolve, result_issues, support_for
from .request_context import cancel_signal, dashboard_operation, read_only_required
from .subscription import Subscription

MAX_INPUT, MAX_OUTPUT = 65536, 16_000_000
Rejected = AdmissionError


@dashboard_operation
def execute(plugin, operation, arguments, reuse_scope, cancelled, *, read_only=False):
    from tools.registry import registry
    from gateway.session_context import set_session_vars, clear_session_vars
    tokens = set_session_vars(platform='api_server')
    token = cancel_signal.set(cancelled)
    requirement = read_only_required.set(read_only)
    try:
        inspect_resource({'plugin': plugin, 'operation': operation, 'arguments': arguments, 'read_only': read_only})
        name, age = resolve(plugin, operation, arguments)
        access = native_access_scope()
        raw = registry.dispatch(name, arguments, cancelled=cancelled,
                                _http_delivery=True, _reuse_scope=reuse_scope)
        if not isinstance(raw, str) or len(raw.encode()) > MAX_OUTPUT:
            raise Rejected('invalid_response', 502)
        result = json.loads(raw)
        if not isinstance(result, dict) or result.get('schema_version') != 1 or 'error' in result:
            raise Rejected('invalid_response', 502)
        if cancelled(): raise Rejected('cancelled', 499)
        if access != native_access_scope() or name not in eligible_tools():
            raise Rejected('access_changed', 409)
        failures = result_issues(result, support_for(name))
        if age:
            if failures:
                terminal = {'authentication_failed', 'access_denied', 'invalid_request', 'unsupported_window'}
                age = max(300 if any(row['code'] in terminal for row in failures) else 15,
                          max((row.get('retry_after_seconds', 0) for row in failures), default=0))
            result['delivery'] = {'max_age_seconds': age}
        encoded = json.dumps(result, allow_nan=False).encode()
        if len(encoded) > MAX_OUTPUT: raise Rejected('invalid_response', 502)
        return encoded
    finally:
        cancel_signal.reset(token)
        read_only_required.reset(requirement)
        clear_session_vars(tokens)


def register(ctx, *, workers=4, timeout=30):
    def factory(app, adapter):
        from aiohttp import web
        from hermes_constants import get_hermes_home
        owner = get_hermes_home().resolve()
        admission = Admission(workers=workers)
        histories = Admission(workers=2, limit=32)
        control = Admission(workers=2, limit=128)
        bodies, readers = set(), {}

        def host_enabled():
            from hermes_cli.config import load_config_readonly
            from hermes_cli.plugins import get_plugin_manager
            plugin = get_plugin_manager()._plugins.get(ctx.plugin_id)
            return plugin is not None and native_plugin_enabled(ctx.plugin_id, plugin, load_config_readonly())

        def error(code, status):
            return web.json_response({'error': {'code': code, 'message': {
                'unauthorized': 'Authentication required.', 'profile_unavailable': 'This profile is not served here.',
                'busy': 'Requests are busy; try again shortly.', 'timeout': 'The request timed out.',
                'invalid_request': 'Invalid plugin request.', 'request_too_large': 'The request is too large.',
                'unavailable': 'The requested operation is disabled or unavailable.',
                'read_only_required': 'Automatic reads cannot invoke a mutating operation.',
            }.get(code, 'The plugin request could not be completed.')}}, status=status,
                headers={'Cache-Control': 'no-store', **({'Retry-After': '1'} if status == 429 else {})})

        def authorize(request):
            if not adapter._expected_api_key(): return error('unauthorized', 401)
            rejected = adapter._check_auth(request)
            if rejected is not None: return rejected
            if get_hermes_home().resolve() != owner: return error('profile_unavailable', 404)
            if not host_enabled(): return error('unavailable', 403)
            return None

        async def read_body(request):
            if request.content_type != 'application/json': raise Rejected('invalid_request', 415)
            if len(bodies) >= 32: raise Rejected('busy', 429)
            marker = object()
            bodies.add(marker)
            async def read():
                data = bytearray()
                async for chunk in request.content.iter_chunked(8192):
                    data.extend(chunk)
                    if len(data) > MAX_INPUT: raise Rejected('request_too_large', 413)
                return json.loads(data, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
            try: return await asyncio.wait_for(read(), timeout=5)
            finally: bodies.discard(marker)

        async def inspect(resource, *, updates=False):
            @dashboard_operation
            def check(_cancelled):
                from gateway.session_context import set_session_vars, clear_session_vars
                tokens = set_session_vars(platform='api_server')
                requirement = read_only_required.set(updates or resource.get('read_only', False))
                try:
                    if not host_enabled(): raise Rejected('unavailable', 403)
                    name, domain = inspect_resource(resource, updates=updates)
                    return {'scope': fingerprint({'access': native_access_scope(), 'domain': domain.get('scope')}),
                            'lane': domain.get('lane', 'ordinary'), 'name': name}
                except ContextUnavailable:
                    raise Rejected('unavailable', 403) from None
                finally:
                    read_only_required.reset(requirement)
                    clear_session_vars(tokens)
            return await control.run(('inspect', updates, fingerprint(resource)), check, timeout=timeout)

        async def run(plugin, operation, arguments, reuse, disconnected=lambda: False, *, read_only=False):
            resource = {'plugin': plugin, 'operation': operation, 'arguments': arguments, 'read_only': read_only}
            plan = await inspect(resource)
            key = fingerprint({'resource': resource, 'scope': plan['scope'], 'reuse': reuse})
            lane = histories if plan['lane'] == 'history' else admission
            return await lane.run(key, lambda cancelled: execute(plugin, operation, arguments, reuse, cancelled, read_only=read_only),
                                  timeout=timeout, disconnected=disconnected)

        async def access(resource):
            return (await inspect(resource, updates=True))['scope']

        async def poll(resource):
            plan = await inspect(resource, updates=True)
            support = support_for(plan['name'])
            if support and hasattr(support, 'create_reader'):
                key = (plan['name'], id(support))
                if key not in readers:
                    async def bound(arguments, reuse=None, disconnected=lambda: False):
                        return await run(resource['plugin'], resource['operation'], arguments, reuse, disconnected, read_only=True)
                    readers[key] = support.create_reader(bound)
                return await readers[key].read(resource)
            return json.loads(await run(resource['plugin'], resource['operation'], resource['arguments'], None, read_only=True))

        async def subscribe(resource, publish):
            plan = await inspect(resource, updates=True)
            support = support_for(plan['name'])
            if not support or not getattr(support, 'push', False): return None
            lifetime = Subscription(publish, resource.get('window'))
            @dashboard_operation
            def start(_cancelled):
                from tools.registry import registry
                from gateway.session_context import set_session_vars, clear_session_vars
                tokens = set_session_vars(platform='api_server')
                requirement = read_only_required.set(True)
                try:
                    arguments = support.materialize(resource)
                    name, _ = inspect_resource({**resource, 'arguments': arguments, 'read_only': True}, updates=True)
                    raw = registry.dispatch(name, arguments, _subscription=lifetime, cancelled=lifetime.closed.is_set)
                    return json.loads(raw) if isinstance(raw, str) else {}
                finally:
                    read_only_required.reset(requirement)
                    clear_session_vars(tokens)
            try:
                ack = await control.run(('subscribe', fingerprint(resource)), start, timeout=timeout)
                if ack.get('mode') == 'push': return lifetime.close
                await asyncio.to_thread(lifetime.close)
                if ack.get('mode') != 'poll': raise Rejected('unsupported_updates', 422)
                return None
            except BaseException:
                await asyncio.to_thread(lifetime.close)
                raise

        async def handler(request):
            denied = authorize(request)
            if denied is not None: return denied
            try:
                body = await read_body(request)
                if not isinstance(body, dict) or not {'arguments'} <= set(body) <= {'arguments', 'reuse_scope', 'read_only'} or not isinstance(body['arguments'], dict):
                    raise Rejected('invalid_request', 400)
                if type(body.get('read_only', False)) is not bool:
                    raise Rejected('invalid_request', 400)
                reuse = body.get('reuse_scope')
                if reuse is not None and (not isinstance(reuse, str) or len(reuse) != 64 or any(c not in '0123456789abcdef' for c in reuse)):
                    raise Rejected('invalid_request', 400)
                result = await run(request.match_info['plugin'], request.match_info['operation'], body['arguments'], reuse,
                                   lambda: request.transport is None or request.transport.is_closing(), read_only=body.get('read_only', False))
                return web.Response(body=result, content_type='application/json', headers={'Cache-Control': 'no-store'})
            except Rejected as rejected: return error(rejected.code, rejected.status)
            except asyncio.TimeoutError: return error('timeout', 504)
            except ContextUnavailable: return error('unavailable', 403)
            except (ValueError, TypeError, RecursionError): return error('invalid_request', 400)
            except asyncio.CancelledError: raise
            except Exception: return error('unavailable', 503)

        async def configuration(request):
            # Static declarations only: custody values are never read or returned here.
            denied = authorize(request)
            if denied is not None: return denied
            try:
                rows = await control.run(('configuration',), lambda _cancelled: declared_configuration(), timeout=timeout)
                return web.json_response({'schema_version': 1, 'data': {'plugins': rows}},
                                         headers={'Cache-Control': 'no-store'})
            except Rejected as rejected: return error(rejected.code, rejected.status)
            except asyncio.CancelledError: raise
            except Exception: return error('unavailable', 503)

        from .live_http import install
        install(app, authorize, read_body, error, poll, access, subscribe)

        async def cleanup(_app):
            for reader in readers.values(): await reader.close()
            await admission.close()
            await histories.close()
            await control.close()
        app.on_cleanup.append(cleanup)
        path = '/v1/pythia/plugins/{plugin:.+}/{operation}'
        app.router.add_post(path, handler)
        app.router.add_post('/p/{profile}' + path, handler)
        app.router.add_get('/v1/pythia/configuration', configuration)
        app.router.add_get('/p/{profile}/v1/pythia/configuration', configuration)
    ctx.register_platform_handler('api_server', factory)
