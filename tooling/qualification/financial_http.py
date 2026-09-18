"""Exercise copied Pythia handlers on the pinned native API app, without providers.

Synthetic bounded specialist work verifies isolation, HTTP admission and cleanup.
The real financial backend verifies shared tool/HTTP lifetime and durable prefs.
"""
import asyncio
import copy
import importlib
import json
from pathlib import Path
import secrets
import sys
import threading
from unittest.mock import patch

from aiohttp import ClientSession, ClientTimeout
from gateway.config import PlatformConfig
from gateway.platforms.api_server import APIServerAdapter
from gateway.session_context import set_session_vars, clear_session_vars
from hermes_cli.plugins import get_plugin_manager, PluginContext
from tools.registry import registry
from native_hermes_source import validate_source_binding


async def qualify_agent_cancellation(backend, tool_name, pin_args, package):
    """A native caller's interrupt must reach its coordinated source threads."""
    from tools.interrupt import set_interrupt
    request_context = importlib.import_module(package + '.request_context')
    entered = threading.Event()
    caller = []
    original = backend._call
    read = copy.deepcopy(pin_args)
    read.pop('action')
    read['request']['requirements']['freshness'] = 'fresh'

    def waiting_source(*_args):
        entered.set()
        for _ in range(200):
            if request_context.cancelled():
                return {'schema_version': 1, 'outcome': 'error', 'issues': []}
            threading.Event().wait(0.01)
        raise AssertionError('Agent interrupt did not reach source worker')

    def agent_read():
        caller.append(threading.get_ident())
        tokens = set_session_vars(platform='api_server')
        try:
            return json.loads(registry.dispatch(tool_name, {'action': 'read_many', 'reads': [read]}))
        finally:
            set_interrupt(False)
            clear_session_vars(tokens)

    backend._call = waiting_source
    task = asyncio.create_task(asyncio.to_thread(agent_read))
    try:
        assert await asyncio.to_thread(entered.wait, 2)
        set_interrupt(True, thread_id=caller[0])
        result = await asyncio.wait_for(task, timeout=3)
        assert result['data'][0]['outcome'] == 'error', result
        assert any(issue['code'] == 'cancelled' for issue in result['data'][0]['issues']), result
    finally:
        if caller:
            set_interrupt(True, thread_id=caller[0])
        await asyncio.gather(task, return_exceptions=True)
        if caller:
            set_interrupt(False, thread_id=caller[0])
        backend._call = original


async def main():
    root = Path(sys.argv[1])
    repository = Path(__file__).resolve().parents[2]
    pin = json.loads((repository / 'runtime/versions.json').read_text())['dependencies']['hermes_agent']
    validate_source_binding(Path(sys.prefix).resolve().parent, pin, None)
    manager = get_plugin_manager()
    manager.discover_and_load()
    feature_key = 'finance/pythia-market-data'
    feature = manager._plugins[feature_key]
    package = feature.module.__name__
    backend_module = importlib.import_module(package + '.backend')
    transport = importlib.import_module(package + '.http_transport')
    schemas = importlib.import_module(package + '.definition')
    instances = []
    real_backend = backend_module.Backend

    class CountedBackend(real_backend):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            instances.append(self)

    # Test-only native specialist declaration; no arbitrary tool exposure.
    started, stopped, release = threading.Event(), threading.Event(), threading.Event()
    counts = {'slow': 0, 'undeclared': 0}

    def slow(arguments, **context):
        counts['slow'] += 1
        started.set()
        while not release.wait(0.01):
            if context['cancelled']():
                stopped.set()
                return json.dumps({'schema_version': 1, 'outcome': 'error', 'issues': []})
        return json.dumps({'schema_version': 1, 'outcome': 'ok', 'data': {'value': 1}, 'issues': []})

    context = PluginContext(feature.manifest, manager)
    context.register_tool(name='synthetic_financial_slow', toolset='pythia-market-data',
        schema={'name': 'synthetic_financial_slow', 'parameters': {'type': 'object', 'properties': {}, 'additionalProperties': False,
            '$comment': json.dumps({transport.MARKER: {'operation': 'synthetic-slow', 'plugin': 'pythia-market-data', 'cache_seconds': 0}})}}, handler=slow)
    context.register_tool(name='synthetic_undeclared', toolset='pythia-market-data', schema={'name': 'synthetic_undeclared', 'parameters': {'type': 'object'}},
                      handler=lambda *_args, **_kwargs: counts.update(undeclared=counts['undeclared'] + 1))
    # Short deadlines/one slot qualify the same adapter without a long test.
    manager._platform_handler_factories['api_server'] = []
    transport.register(context, workers=1, timeout=0.5)
    key = secrets.token_hex(32)
    adapter = APIServerAdapter(PlatformConfig(enabled=True, extra={'host': '127.0.0.1', 'port': 0, 'key': key}))
    adapter._port = 0  # Native constructor treats port zero as its default.
    with patch.object(backend_module, 'Backend', CountedBackend):
        assert await adapter.connect()
        port = adapter._site._server.sockets[0].getsockname()[1]
        base = f'http://127.0.0.1:{port}'
        headers = {'Authorization': 'Bearer ' + key}
        try:
            async with ClientSession() as client:
                async def post(arguments, path='/v1/pythia/financial', auth=headers, **kwargs):
                    return await client.post(base + path, headers=auth, json={'arguments': arguments}, **kwargs)
                with patch('subprocess.Popen', side_effect=AssertionError('No command or model subprocess is allowed')):
                    for auth in ({}, {'Authorization': 'Bearer wrong'}):
                        assert (await post({'action': 'get_preferences'}, auth=auth)).status == 401
                    adapter._api_key = ''
                    assert (await post({'action': 'get_preferences'})).status == 401
                    adapter._api_key = key
                    assert instances == []
                    assert (await post({'action': 'get_preferences'}, '/p/not-served/v1/pythia/financial')).status == 404
                    assert (await post({}, '/v1/pythia/plugins/synthetic_undeclared')).status == 404
                    assert counts['undeclared'] == 0
                    invalid = await client.post(base + '/v1/pythia/financial', headers=headers, data=b'x' * 70000, skip_auto_headers={'Content-Type'})
                    assert invalid.status == 415
                    invalid = await client.post(base + '/v1/pythia/financial', headers={**headers, 'Content-Type': 'application/json'}, data=b'x' * 70000)
                    assert invalid.status == 413
                    assert (await post({'action': 'get_preferences', 'profile': 'another'})).status == 400
                    first = await post({'action': 'get_preferences'})
                    assert first.status == 200, await first.text()
                    assert len(instances) == 1
                    # Real native SSE route: two browsers share one resource,
                    # auth and revocation are enforced on retained snapshots.
                    subscription = {'resources': [{'operation': 'market-data', 'arguments': {'action': 'get_preferences'}}]}
                    assert (await client.post(base + '/v1/pythia/updates', json=subscription)).status == 401
                    async def update(response):
                        while True:
                            line = await asyncio.wait_for(response.content.readline(), timeout=4)
                            if not line: raise AssertionError('SSE ended before an update')
                            if line.startswith(b'data: '): return json.loads(line[6:])
                    stream_a = await client.post(base + '/v1/pythia/updates', headers=headers, json=subscription)
                    stream_b = await client.post(base + '/v1/pythia/updates', headers=headers, json=subscription)
                    a, b = await update(stream_a), await update(stream_b)
                    assert a['data'] == b['data'] and a['generation'] == b['generation']
                    stream_a.close()
                    config = root / 'config.yaml'
                    previous = config.read_text()
                    config.write_text(previous.replace(f'  enabled: [{feature_key}]', f'  enabled: [{feature_key}]\n  disabled: [{feature_key}]'))
                    revoked = await update(stream_b)
                    assert revoked['type'] == 'reset' and 'data' not in revoked, revoked
                    stream_b.close()
                    config.write_text(previous)
                    await post({'action': 'set_preferences', 'operation': 'latest', 'providers': ['coingecko']})
                    tokens = set_session_vars(platform='api_server')
                    try:
                        agent = json.loads(registry.dispatch(schemas.TOOL_NAME, {'action': 'get_preferences'}))
                    finally:
                        clear_session_vars(tokens)
                    assert agent['data']['orders']['latest'] == ['coingecko']
                    assert len(instances) == 1
                    # Exercise the real reader's memory caches and pin semantics
                    # with a synthetic source; the transport/registry stay native.
                    example = next(item['value'] for item in json.loads((Path(__file__).parents[2] / 'packages/market-data/examples/valid.json').read_text()) if item['name'] == 'latest_unknown_time')
                    series = copy.deepcopy(example['series'])
                    native = series['provider_ref']
                    series['subject'] = native
                    series['source_detail'] = {'namespace': native['provider'], 'values': {'read_selector': 'synthetic'}}
                    backend = instances[0]
                    counts.update(metadata=0, prices=0)
                    backend._project = lambda: ([{'contribution': {'provider': native['provider'], 'adapter_version': 'synthetic-1'},
                        'operations': [{'operation': op, 'available': True} for op in ['latest', 'series']]}], False)
                    def source(_provider, operation, arguments):
                        if operation == 'series':
                            counts['metadata'] += 1
                            return {'schema_version': 1, 'outcome': 'ok', 'data': [copy.deepcopy(series)], 'issues': []}
                        counts['prices'] += 1
                        result = copy.deepcopy(example)
                        result['request'] = arguments['request']
                        result['selection']['view'] = arguments['request']['view']
                        result['series'] = copy.deepcopy(series)
                        return result
                    backend._call = source
                    read = copy.deepcopy(example['request'])
                    read['view'] = {'kind': 'pythia', 'subject': native}
                    arguments = {'action': 'read', 'request': read, 'criteria': {'measurement': 'aggregate_price'}}
                    for _ in range(2):
                        result = await (await post(arguments)).json()
                        assert result['outcome'] == 'ok', result
                    assert counts['metadata'] == 1 and counts['prices'] == 1, counts
                    pinned = copy.deepcopy(read)
                    pinned['view'] = {'kind': 'source', 'series_id': series['id']}
                    pin_args = {'action': 'read', 'request': pinned, 'series': series}
                    before = await (await post(pin_args)).json()
                    await post({'action': 'set_preferences', 'operation': 'latest', 'providers': ['yahoo']})
                    after = await (await post(pin_args)).json()
                    assert before == after and after['outcome'] == 'ok'
                    assert counts['prices'] == 2
                    assert (await post(pin_args, auth={'Authorization': 'Bearer wrong'})).status == 401
                    assert counts['prices'] == 2
                    await qualify_agent_cancellation(backend, schemas.TOOL_NAME, pin_args, package)
                    # Concurrent health remains responsive while provider work waits.
                    slow_request = asyncio.create_task(post({}, '/v1/pythia/plugins/synthetic-slow'))
                    assert await asyncio.to_thread(started.wait, 2)
                    assert (await client.get(base + '/health')).status == 200
                    queued = asyncio.create_task(post({'action': 'get_preferences'}))
                    assert (await slow_request).status == 504
                    assert (await queued).status in (200, 504)  # Queue wait shares the caller deadline.
                    assert await asyncio.to_thread(stopped.wait, 2)
                    # Allow the completed-worker callback to release admission.
                    for _ in range(20):
                        response = await post({'action': 'get_preferences'})
                        if response.status != 429:
                            break
                        await asyncio.sleep(0.01)
                    assert response.status == 200
                    started.clear()
                    stopped.clear()
                    disconnected = asyncio.create_task(post({}, '/v1/pythia/plugins/synthetic-slow', timeout=ClientTimeout(total=0.15)))
                    assert await asyncio.to_thread(started.wait, 2)
                    try:
                        await disconnected
                        raise AssertionError('Client should disconnect before completion')
                    except asyncio.TimeoutError:
                        pass
                    assert await asyncio.to_thread(stopped.wait, 2)
                    for _ in range(20):
                        response = await post({'action': 'get_preferences'})
                        if response.status != 429:
                            break
                        await asyncio.sleep(0.01)
                    assert response.status == 200
                    # Native disabled state is enforced before existing instances.
                    config = root / 'config.yaml'
                    previous = config.read_text()
                    config.write_text(previous.replace(f'  enabled: [{feature_key}]', f'  enabled: [{feature_key}]\n  disabled: [pythia-market-data]'))
                    denied = await post(pin_args)
                    assert denied.status == 403, await denied.text()
                    config.write_text(previous)
                    assert len(instances) == 1
        finally:
            release.set()
            await adapter.disconnect()
    print(json.dumps({'http_and_tool_backends': len(instances), 'auth_profile_disable_limits_timeout_and_event_loop': 'passed',
                      'native_category_key_and_explicit_deny': 'passed', 'model_or_cli_subprocesses': 0}))


asyncio.run(main())
