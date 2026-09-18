"""Protected multiplexed snapshot stream on the existing native HTTP app."""
import asyncio
import json

from .live import LiveReads
from .live_batch import LiveBatch, validate_window
from .selection import fingerprint


def install(app, authorize, read_body, error, run, inspect, subscribe):
    from aiohttp import web
    streams = set()
    batch = LiveBatch(run)

    async def access(request):
        return await inspect(request)

    async def read(request):
        raw = await batch.read(request)
        result = raw['data'][0] if request['operation'] == 'market-data' and isinstance(raw.get('data'), list) and len(raw['data']) == 1 else raw
        if result.get('outcome') == 'error':
            from .admission import AdmissionError
            issues = [issue for issue in result.get('issues', []) if issue.get('severity', 'error') == 'error']
            terminal = ('unavailable', 'authentication_failed', 'access_denied', 'reauthorization_required', 'unsupported_series', 'invalid_request', 'invalid_window', 'unsupported_window')
            selected = next((issue for issue in issues if issue['code'] in terminal), None) or next((issue for issue in issues if issue['code'] == 'rate_limit'), None) or next(iter(issues), {'code': 'source_unavailable'})
            code = selected['code']
            failure = AdmissionError(code, 403 if code in terminal else 503)
            failure.retry_after = selected.get('retry_after_seconds', raw.get('retry_after_seconds'))
            failure.detail = {key: selected[key] for key in ('retry_after_seconds', 'limit_origin') if key in selected}
            raise failure
        age = raw.get('delivery', {}).get('max_age_seconds', 60)
        if isinstance(age, list):
            age = min(age, default=60)
        return raw, max(15, min(86400, age))

    hub = LiveReads(read, access, subscribe=subscribe)

    async def handler(request):
        denied = authorize(request)
        if denied is not None:
            return denied
        if len(streams) >= 16:
            return error('busy', 429)
        marker = object()
        streams.add(marker)
        handles = []
        pending, wake = {}, asyncio.Event()
        overflow = False
        try:
            body = await read_body(request)
            if not isinstance(body, dict) or set(body) != {'resources'}:
                return error('invalid_request', 400)
            resources = body['resources']
            if not isinstance(resources, list) or not 1 <= len(resources) <= 64:
                return error('invalid_request', 400)
            for resource in resources:
                if (not isinstance(resource, dict) or not {'operation', 'arguments'} <= set(resource) <= {'operation', 'arguments', 'window'}
                        or not isinstance(resource['operation'], str) or not isinstance(resource['arguments'], dict)):
                    return error('invalid_request', 400)
                if resource['operation'] == 'market-data' and resource['arguments'].get('action') not in ('read', 'read_many', 'get_preferences'):
                    return error('unsupported_operation', 400)
                validate_window(resource)
            if len({fingerprint(item) for item in resources}) != len(resources):
                return error('invalid_request', 400)

            async def publish(key, event):
                nonlocal overflow
                # Latest-state delivery: overwrite pending state for slow consumers.
                pending[key] = {'resource': key, **event}
                if sum(len(json.dumps(item)) for item in pending.values()) > 8_000_000:
                    pending.clear()
                    overflow = True
                wake.set()

            handles = await hub.attach(resources, publish)
            response = web.StreamResponse(headers={'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no'})
            await response.prepare(request)
            # Echo request indices rather than trusting client-provided resource IDs.
            keys = {fingerprint(resource): index for index, resource in enumerate(resources)}
            while request.transport and not request.transport.is_closing():
                denied = authorize(request)
                if denied is not None:
                    break
                try:
                    await asyncio.wait_for(wake.wait(), timeout=10)
                except asyncio.TimeoutError:
                    await asyncio.wait_for(response.write(b': heartbeat\n\n'), timeout=5)
                    continue
                wake.clear()
                if overflow:
                    break
                events = list(pending.values())
                pending.clear()
                for event in events:
                    event['index'] = keys[event.pop('resource')]
                    # Revalidate queued snapshots after any blocked client write.
                    try:
                        if await inspect(resources[event['index']]) != event.get('_scope'):
                            raise ValueError('access_changed')
                    except Exception:
                        event = {**event, 'type': 'reset', 'state': 'unavailable', 'code': 'access_changed'}
                        event.pop('data', None)
                    event.pop('_scope', None)
                    encoded = ('data: ' + json.dumps(event, allow_nan=False) + '\n\n').encode()
                    if len(encoded) > 16_000_000:
                        raise ValueError('response_limit')
                    await asyncio.wait_for(response.write(encoded), timeout=5)
            return response
        except asyncio.CancelledError:
            raise
        except Exception as failure:
            if 'response' in locals() and response.prepared:
                return response
            return error(getattr(failure, 'code', 'invalid_request'), getattr(failure, 'status', 400))
        finally:
            hub.detach(handles)
            streams.discard(marker)

    async def cleanup(_app):
        await hub.close()
        await batch.close()
    app.on_shutdown.append(cleanup)
    for path in ('/v1/pythia/updates', '/p/{profile}/v1/pythia/updates'):
        app.router.add_post(path, handler)
