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
import textwrap
from unittest.mock import patch

import yaml

from aiohttp import ClientSession, ClientTimeout
from gateway.config import PlatformConfig
from gateway.platforms.api_server import APIServerAdapter
from gateway.session_context import set_session_vars, clear_session_vars
from hermes_cli.plugins import get_plugin_manager, PluginContext
from tools.registry import registry
from native_hermes_source import validate_source_binding
from plugin_configuration import qualify_configuration
from widget_presentations import qualify_widget_presentations

FINANCIAL_PATH = '/v1/pythia/plugins/pythia-market-data/query'
SYNTHETIC_PATH = '/v1/pythia/plugins/synthetic/query'


def synthetic_plugin(root):
    """An ordinary unrelated native plugin uses only the copied core helper."""
    target = root / 'plugins/research/synthetic'
    target.mkdir(parents=True, mode=0o700)
    (target / 'plugin.yaml').write_text('name: synthetic\nversion: 1.0.0\nrequires_plugins: [pythia]\n')
    (target / 'configuration.json').write_text(json.dumps({'schema_version': 1, 'fields': [
        {'key': 'synthetic_api_token', 'kind': 'secret', 'label': 'Synthetic token', 'required': True}]}))
    (target / '__init__.py').write_text(textwrap.dedent('''\
        import importlib
        import json
        import threading

        started, stopped, release = threading.Event(), threading.Event(), threading.Event()
        counts = {'query': 0, 'slow': 0, 'undeclared': 0, 'unclassified': 0, 'snapshot_only': 0}

        def register(ctx):
            from hermes_cli.plugins import get_plugin_manager
            core = next(plugin.module for plugin in get_plugin_manager()._plugins.values()
                        if plugin.enabled and plugin.manifest.name == 'pythia' and plugin.module is not None)
            platform = importlib.import_module(core.__name__ + '.platform')
            schema = {'name': 'synthetic_query', 'parameters': {
                'type': 'object', 'properties': {'wait': {'type': 'boolean'}}, 'additionalProperties': False}}
            def query(arguments, **context):
                counts['query'] += 1
                if arguments.get('wait'):
                    counts['slow'] += 1
                    started.set()
                    while not release.wait(0.01):
                        if context['cancelled']():
                            stopped.set()
                            return json.dumps({'schema_version': 1, 'outcome': 'error', 'issues': []})
                return json.dumps({'schema_version': 1, 'outcome': 'ok',
                                   'data': {'value': 1, 'plugin': 'synthetic'}, 'issues': []})
            handler = platform.declare_operation(schema, plugin=ctx.plugin_id, operation='query',
                                                 handler=query, cache_seconds=0, updates=True, read_only=True)
            ctx.register_tool(name='synthetic_query', toolset='synthetic', schema=schema, handler=handler)
            # Exposure alone never grants automatic read-only execution.
            unclassified_schema = {'name': 'synthetic_unclassified', 'parameters': {
                'type': 'object', 'properties': {}, 'additionalProperties': False}}
            def unclassified(_arguments, **_context):
                counts['unclassified'] += 1
                return json.dumps({'schema_version': 1, 'outcome': 'ok', 'data': {'value': 2}, 'issues': []})
            unclassified_handler = platform.declare_operation(unclassified_schema, plugin=ctx.plugin_id,
                operation='unclassified', handler=unclassified, updates=True)
            ctx.register_tool(name='synthetic_unclassified', toolset='synthetic',
                schema=unclassified_schema, handler=unclassified_handler)
            snapshot_schema = {'name': 'synthetic_snapshot', 'parameters': {
                'type': 'object', 'properties': {}, 'additionalProperties': False}}
            def snapshot(_arguments, **_context):
                counts['snapshot_only'] += 1
                return json.dumps({'schema_version': 1, 'outcome': 'ok', 'data': {'value': 3}, 'issues': []})
            snapshot_handler = platform.declare_operation(snapshot_schema, plugin=ctx.plugin_id,
                operation='snapshot', handler=snapshot, read_only=True)
            ctx.register_tool(name='synthetic_snapshot', toolset='synthetic',
                schema=snapshot_schema, handler=snapshot_handler)
            ctx.register_tool(name='synthetic_undeclared', toolset='synthetic',
                schema={'name': 'synthetic_undeclared', 'parameters': {'type': 'object'}},
                handler=lambda *_args, **_kwargs: counts.update(undeclared=counts['undeclared'] + 1))
        '''))


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
    synthetic_plugin(root)
    manager = get_plugin_manager()
    manager.discover_and_load()
    assert not {'pythia_sec_company', 'pythia_eod_prices'} & set(registry.get_all_tool_names())
    feature_key = 'finance/pythia-market-data'
    feature = manager._plugins[feature_key]
    package = feature.module.__name__
    backend_module = importlib.import_module(package + '.backend')
    core = manager._plugins['pythia']
    transport = importlib.import_module(core.module.__name__ + '.platform.http')
    schemas = importlib.import_module(package + '.definition')
    instances = []
    real_backend = backend_module.Backend

    class CountedBackend(real_backend):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            instances.append(self)

    # This plugin's same-named operation has its own native identity and grants.
    unrelated = manager._plugins['research/synthetic']
    assert feature.enabled and core.enabled and unrelated.enabled, manager.list_plugins()
    started, stopped, release = unrelated.module.started, unrelated.module.stopped, unrelated.module.release
    counts = unrelated.module.counts
    # Short deadlines/one slot qualify the same adapter without a long test.
    core_key = core.manifest.key or core.manifest.name
    manager._platform_handler_factories['api_server'] = [
        entry for entry in manager._platform_handler_factories.get('api_server', []) if entry[1] != core_key]
    transport.register(PluginContext(core.manifest, manager), workers=1, timeout=0.5)
    key = secrets.token_hex(32)
    adapter = APIServerAdapter(PlatformConfig(enabled=True, extra={'host': '127.0.0.1', 'port': 0, 'key': key}))
    adapter._port = 0  # Native constructor treats port zero as its default.
    with patch.object(backend_module, 'Backend', CountedBackend):
        assert await adapter.connect()
        port = adapter._site._server.sockets[0].getsockname()[1]
        base = f'http://127.0.0.1:{port}'
        headers = {'Authorization': 'Bearer ' + key}
        config = root / 'config.yaml'
        initial_config = config.read_text()

        def disable(*names):
            value = yaml.safe_load(initial_config)
            value['plugins']['disabled'] = list(names)
            config.write_text(yaml.safe_dump(value))

        try:
            async with ClientSession() as client:
                async def post(arguments, path=FINANCIAL_PATH, auth=headers, *, read_only=None, reuse_scope=None, **kwargs):
                    body = {'arguments': arguments}
                    if read_only is not None:
                        body['read_only'] = read_only
                    if reuse_scope is not None:
                        body['reuse_scope'] = reuse_scope
                    return await client.post(base + path, headers=auth, json=body, **kwargs)
                with patch('subprocess.Popen', side_effect=AssertionError('No command or model subprocess is allowed')):
                    await qualify_widget_presentations(post, disable, root)
                    await qualify_configuration(client, base, headers, disable)
                    for auth in ({}, {'Authorization': 'Bearer wrong'}):
                        assert (await post({'action': 'get_preferences'}, auth=auth)).status == 401
                    adapter._api_key = ''
                    assert (await post({'action': 'get_preferences'})).status == 401
                    adapter._api_key = key
                    assert instances == []
                    assert (await post({'action': 'get_preferences'}, '/p/not-served' + FINANCIAL_PATH)).status == 404
                    assert (await post({}, '/v1/pythia/plugins/synthetic/synthetic_undeclared')).status == 404
                    assert counts['undeclared'] == 0
                    unrelated_value = await (await post({}, SYNTHETIC_PATH)).json()
                    assert unrelated_value['data'] == {'value': 1, 'plugin': 'synthetic'}, unrelated_value
                    unclassified_path = '/v1/pythia/plugins/synthetic/unclassified'
                    denied = await post({}, unclassified_path, read_only=True)
                    assert denied.status == 403 and (await denied.json())['error']['code'] == 'read_only_required'
                    assert counts['unclassified'] == 0
                    assert (await post({}, unclassified_path)).status == 200
                    assert counts['unclassified'] == 1
                    invalid = await client.post(base + FINANCIAL_PATH, headers=headers, data=b'x' * 70000, skip_auto_headers={'Content-Type'})
                    assert invalid.status == 415
                    invalid = await client.post(base + FINANCIAL_PATH, headers={**headers, 'Content-Type': 'application/json'}, data=b'x' * 70000)
                    assert invalid.status == 413
                    assert (await post({'action': 'get_preferences', 'profile': 'another'})).status == 400
                    first = await post({'action': 'get_preferences'})
                    assert first.status == 200, await first.text()
                    assert len(instances) == 1
                    # Real native SSE route: two browsers share one resource,
                    # auth and revocation are enforced on retained snapshots.
                    subscription = {'resources': [{'plugin': 'pythia-market-data', 'operation': 'query',
                                                   'arguments': {'action': 'get_preferences'}}]}
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
                    disable(feature_key)
                    revoked = await update(stream_b)
                    assert revoked['type'] == 'reset' and 'data' not in revoked, revoked
                    stream_b.close()
                    assert (await post({'action': 'get_preferences'})).status == 403
                    independent = await post({}, SYNTHETIC_PATH)
                    assert independent.status == 200, await independent.text()
                    assert (await independent.json())['data']['plugin'] == 'synthetic'
                    other_subscription = {'resources': [
                        {'plugin': 'synthetic', 'operation': 'query', 'arguments': {}},
                        {'plugin': 'synthetic', 'operation': 'unclassified', 'arguments': {}},
                        {'plugin': 'synthetic', 'operation': 'snapshot', 'arguments': {}}]}
                    other_stream = await client.post(base + '/v1/pythia/updates', headers=headers, json=other_subscription)
                    try:
                        events, by_index = [], {}
                        async with asyncio.timeout(4):
                            while set(by_index) != {0, 1, 2}:
                                event = await update(other_stream)
                                events.append(event)
                                by_index[event['index']] = event
                        assert by_index[0]['data']['data']['plugin'] == 'synthetic', events
                        assert by_index[1]['type'] == 'reset' and by_index[1]['code'] == 'read_only_required', events
                        assert 'data' not in by_index[1] and counts['unclassified'] == 1
                        assert by_index[2]['type'] == 'reset' and by_index[2]['code'] == 'unsupported_operation', events
                        assert 'data' not in by_index[2] and counts['snapshot_only'] == 0
                    finally:
                        other_stream.close()
                    config.write_text(initial_config)
                    disable('synthetic')
                    assert (await post({}, SYNTHETIC_PATH)).status == 403
                    assert (await post({'action': 'get_preferences'})).status == 200
                    config.write_text(initial_config)
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
                    # Automatic reads have a narrower grant and reuse receipt.
                    # Even a valid receipt cannot authorize a mutating action.
                    pin_read = {key: value for key, value in pin_args.items() if key != 'action'}
                    many = {'action': 'read_many', 'reads': [pin_read]}
                    ordinary = await (await post(many)).json()
                    assert ordinary['outcome'] == 'ok', ordinary
                    ordinary_receipt = ordinary['delivery']['reuse_scope']
                    readonly = await (await post(many, read_only=True, reuse_scope=ordinary_receipt)).json()
                    assert readonly['outcome'] == 'ok' and readonly['data'][0]['outcome'] == 'ok', readonly
                    readonly_receipt = readonly['delivery']['reuse_scope']
                    assert ordinary_receipt != readonly_receipt
                    reused = await (await post(many, read_only=True, reuse_scope=readonly_receipt)).json()
                    assert reused == {'schema_version': 1, 'reuse': readonly_receipt}, reused
                    before_preferences = (await (await post({'action': 'get_preferences'})).json())['data']
                    mutation = {'action': 'set_preferences', 'operation': 'latest', 'providers': ['synthetic']}
                    for receipt in (None, readonly_receipt):
                        denied = await post(mutation, read_only=True, reuse_scope=receipt)
                        assert denied.status == 403 and (await denied.json())['error']['code'] == 'read_only_required'
                        unchanged = await (await post({'action': 'get_preferences'})).json()
                        assert unchanged['data'] == before_preferences, unchanged
                    assert (await post(mutation)).status == 200
                    changed = await (await post({'action': 'get_preferences'})).json()
                    assert changed['data']['orders']['latest'] == ['synthetic'], changed
                    await qualify_agent_cancellation(backend, schemas.TOOL_NAME, pin_args, package)
                    # Concurrent health remains responsive while provider work waits.
                    slow_request = asyncio.create_task(post({'wait': True}, SYNTHETIC_PATH))
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
                    disconnected = asyncio.create_task(post({'wait': True}, SYNTHETIC_PATH, timeout=ClientTimeout(total=0.15)))
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
                    disable('pythia-market-data')
                    denied = await post(pin_args)
                    assert denied.status == 403, await denied.text()
                    assert (await post({}, SYNTHETIC_PATH)).status == 200
                    disable('pythia')
                    assert (await post({}, SYNTHETIC_PATH)).status == 403
                    config.write_text(initial_config)
                    assert len(instances) == 1
        finally:
            release.set()
            await adapter.disconnect()
    print(json.dumps({'http_and_tool_backends': len(instances), 'auth_profile_disable_limits_timeout_and_event_loop': 'passed',
                      'native_category_key_and_explicit_deny': 'passed',
                      'unrelated_plugin_query_and_updates_without_financial_access': 'passed',
                      'read_only_admission_receipts_and_resource_isolation': 'passed', 'model_or_cli_subprocesses': 0}))


asyncio.run(main())
