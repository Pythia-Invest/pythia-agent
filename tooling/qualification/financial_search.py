"""Synthetic native source registration and shared-search assembled checks."""
import json

from gateway.session_context import set_session_vars, clear_session_vars
from tools.registry import registry


def register_sources(ctx, counts):
    # Called by the disposable plugin's actual register(ctx), so native ownership
    # and discovery apply. This qualification helper is never a release payload.
    for suffix in ('a', 'b'):
        provider = 'synthetic-search-' + suffix
        contribution = {'schema_version': 1, 'provider': provider,
            'adapter_version': '1', 'subject_kinds': ['instrument'],
            'operations': [{'operation': op, 'tool': 'synthetic_' + suffix + '_' + op, 'effect': 'read'}
                           for op in ('search', 'details')]}
        for operation in ('search', 'details'):
            name = 'synthetic_' + suffix + '_' + operation
            field = 'query' if operation == 'search' else 'native_ref'
            ref_schema = {'type': 'object', 'additionalProperties': False,
                'required': ['provider', 'native_id', 'native_scope'],
                'properties': {key: {'type': 'string'} for key in ('provider', 'native_id', 'native_scope')}}
            parameters = {'type': 'object', 'additionalProperties': False,
                'required': [field], 'properties': {field: {'type': 'string'} if field == 'query' else ref_schema},
                '$comment': json.dumps({'pythia_market_data': contribution})}
            def source(arguments, _provider=provider, _operation=operation, **_context):
                counts[_operation] = counts.get(_operation, 0) + 1
                native = {'provider': _provider, 'native_id': 'SYNTHETIC', 'native_scope': 'catalogue'}
                return json.dumps({'schema_version': 1, 'outcome': 'ok', 'issues': [],
                    'data': [{'provider_ref': native, 'kind': 'instrument', 'name': 'Synthetic investment',
                              'symbol': 'SYNTHETIC', 'evidence': []}]})
            ctx.register_tool(name=name, toolset='synthetic', schema={'name': name, 'parameters': parameters}, handler=source)


async def qualify_shared_search(post, tool_name, counts):
    result = await (await post({'action': 'search_catalogue', 'query': 'Synthetic'}, read_only=True)).json()
    assert result['outcome'] == 'ok' and len(result['data']['results']) == 2, result
    assert counts['search'] == 2 and counts.get('details', 0) == 0, counts
    chosen = result['data']['results'][0]
    assert chosen['subject'] is None and chosen['identity_status'] == 'unresolved', chosen
    request = {'action': 'adopt_search', 'native_ref': chosen['references'][0]['native_ref'], 'scope': chosen['kind']}
    denied = await post(request, read_only=True)
    assert denied.status == 403 and counts.get('details', 0) == 0
    tokens = set_session_vars(platform='api_server')
    try:
        adopted = json.loads(registry.dispatch(tool_name, request))
    finally:
        clear_session_vars(tokens)
    assert adopted.get('effect') == 'local_write' and adopted['data']['identity_status'] == 'unresolved', adopted
    assert adopted['data']['binding'] == request['native_ref'], adopted
    repeated = await (await post(request)).json()
    assert repeated['data'] == adopted['data'], repeated
    # Synthetic producer payloads flow to the actual TS consumer schema check.
    return {'search': {key: value for key, value in result.items() if key != 'delivery'},
            'adopt': adopted}
