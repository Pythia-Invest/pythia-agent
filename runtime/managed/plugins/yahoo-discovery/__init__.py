"""Public Yahoo Finance content connector; native Hermes owns execution and enablement."""
import importlib
import json
import os
from pathlib import Path
from .trending import read as trending
from .definition import TOOLS, TOOLSET, schemas
from .identity import candidate, reference
from .series import definition, selector, MODES
from .results import envelope, issue, base, read, window, now


def register(ctx):
    from hermes_cli.plugins import get_plugin_manager
    loaded = get_plugin_manager()._plugins.get('pythia-market-data')
    if not ctx.has_plugin('pythia-market-data') or loaded is None or not loaded.enabled or loaded.module is None:
        raise RuntimeError('unavailable')
    wire = importlib.import_module(loaded.module.__name__ + '.wire')
    specialist = importlib.import_module(loaded.module.__name__ + '.specialist')
    connector = importlib.import_module(loaded.module.__name__ + '.connector')
    process = connector.ResidentTransport()
    if hasattr(ctx, 'on_unload'): ctx.on_unload(process.shutdown)
    budgets = failures = connector
    reads = connector.WorkerReads(process)
    quote_batches = connector.NativeBatch(size=20, age=60)
    trending_cache = importlib.import_module(loaded.module.__name__ + '.cache').ReadCache(ttl_seconds=600)
    definitions = schemas(wire)

    def paths():
        root, node = os.environ.get('PYTHIA_MANAGED_ROOT', ''), os.environ.get('PYTHIA_NODE', '')
        worker = Path(root) / 'runner' / 'dist' / 'yahoo.js'
        if not Path(root).is_absolute() or not Path(node).is_absolute() or not Path(node).is_file() or not worker.is_file():
            raise RuntimeError('unavailable')
        return node, str(worker)

    def ready():
        try:
            paths()
            return True
        except (RuntimeError, OSError):
            return False

    def invoke(operation, arguments, cancelled=None, quotes=None):
        request = None
        try:
            clean = wire.validate_parameters(definitions[operation]['parameters'], arguments)
            if operation in ('latest', 'history'):
                request = wire.validate('read_request', clean['request'])
                if request['operation'] != operation: raise ValueError('invalid_request')
            node, worker = paths()
            env = {key: os.environ[key] for key in ('PATH', 'LANG', 'LC_ALL') if key in os.environ}
            def call(endpoint, args):
                if quotes is not None and endpoint in ('metadata', 'price_read') and args['symbol'] not in quotes:
                    return {'data': None, 'issues': ['source_unavailable']}
                if quotes is not None and endpoint in ('metadata', 'price_read') and args['symbol'] in quotes:
                    raw = quotes[args['symbol']]
                    if raw.get('error'): raise failures.SourceFailure(raw['error'])
                    return {'data': raw['metadata'] if endpoint == 'metadata' else raw, 'issues': []}
                quote_request = endpoint in ('metadata', 'price_batch') or (endpoint == 'price_read' and args.get('mode') == 'latest') or (endpoint == 'dashboard' and args.get('kind') == 'quotes')
                if quote_request:
                    symbols = args.get('symbols', [args.get('symbol')])
                    def fetch_batch(identifiers, abandoned):
                        try:
                            raw = process.run_worker([node, '--max-old-space-size=256', worker],
                                {'operation': 'quote_bundle', 'arguments': {'symbols': identifiers}}, env, timeout=35, cancelled=abandoned,
                                budget=budgets.connection('yahoo', per_minute=ctx.get_config('requests_per_minute', 60)))
                        except Exception as error:
                            raw = failures.worker_failure(error)
                        if raw.get('issues') or not raw.get('data'):
                            return {key: {'error': raw} for key in identifiers}
                        bundle = raw['data']
                        return {key: {'common': value, 'display': next((row for row in bundle['display']['quotes'] if row['symbol'] == key), None),
                                      'retrieved_at': bundle['display']['retrieved_at']} for key, value in bundle['common'].items()}
                    values = quote_batches.read(symbols, [node, worker, Path(worker).stat().st_mtime_ns], fetch_batch, cancellation=cancelled,
                        fresh=bool(request and request['requirements']['freshness'] == 'fresh') or any(item['request']['requirements']['freshness'] == 'fresh' for item in clean.get('reads', [])))
                    if endpoint == 'dashboard':
                        available = [value for value in values.values() if value and not value.get('error')]
                        failed = [failures.failed_item(key, failures.SourceFailure(value['error']), price=None)
                                  for key, value in values.items() if value and value.get('error')]
                        return {'data': {'retrieved_at': min((value['retrieved_at'] for value in available), default=now()),
                                         'quotes': [value['display'] for value in available if value['display']] + failed}, 'issues': []}
                    if endpoint == 'price_batch':
                        return {'data': {key: value if value.get('error') else value['common'] for key, value in values.items() if value}, 'issues': []}
                    value = values.get(args['symbol'])
                    if value and value.get('error'): raise failures.SourceFailure(value['error'])
                    return {'data': (value['common']['metadata'] if endpoint == 'metadata' else value['common']) if value else None,
                            'issues': [] if value else ['source_unavailable']}
                def fetch():
                    return reads.read([node, '--max-old-space-size=256', worker], {'operation': endpoint, 'arguments': args}, env, timeout=35, cancelled=cancelled,
                        age=0 if request and request['requirements']['freshness'] == 'fresh' else 60,
                        budget=budgets.connection('yahoo', per_minute=ctx.get_config('requests_per_minute', 60)))
                return fetch()
            if operation == 'read_batch':
                symbols = set()
                for item in clean['reads']:
                    native, mode = selector(item['source_selector'])
                    if (mode == 'latest') != (item['request']['operation'] == 'latest'): raise ValueError('invalid_request')
                    if mode == 'latest': symbols.add(reference(native))
                replies = {}
                if symbols:
                    replies = call('price_batch', {'symbols': sorted(symbols)})['data']
                parallel = importlib.import_module(wire.__package__ + '.coordinated').parallel
                return envelope(parallel(lambda item: invoke(item['request']['operation'], item, cancelled, replies if item['request']['operation'] == 'latest' else None), clean['reads']))
            if operation in ('research', 'dashboard'):
                args = {k: v for k, v in clean.items() if k != 'operation'}
                if operation == 'research':
                    args['options'] = json.loads(args.pop('options_json', '{}'))
                    if not isinstance(args['options'], dict): raise ValueError('invalid_request')
                raw = call(clean['operation'] if operation == 'research' else 'dashboard', args)
                return failures.qualify_items(failures.qualify_failure(envelope(raw['data'], [issue(code) for code in raw['issues']]), raw))
            if request:
                native, mode = selector(clean['source_selector'])
                wire.validate('provider_ref', native)
                if (mode == 'latest') != (operation == 'latest'): raise ValueError('invalid_request')
                controls = window(request, mode)
            else:
                native, mode, controls = clean['native_ref'], None, {}
            symbol = reference(native)
            raw = call('metadata', {'symbol': symbol})
            if raw['issues']:
                errors = [issue(code) for code in raw['issues']]
                return base(request, errors) if request else envelope(None, errors)
            if raw['data'].get('symbol') != symbol: raise ValueError('binding_mismatch')
            exact = candidate(raw['data'])
            # Bare references may be enriched once during describe; pinned reads
            # require the exact retained reference, including venue/currency.
            if any(exact['provider_ref'].get('qualifiers', {}).get(k) != v for k, v in native.get('qualifiers', {}).items()): raise ValueError('binding_mismatch')
            if operation == 'details': return envelope([exact])
            if operation == 'series':
                return envelope([wire.validate('series', definition(exact['provider_ref'], m, raw['data'])) for m in MODES])
            if exact['provider_ref'] != native: raise ValueError('binding_mismatch')
            series = wire.validate('series', definition(native, mode, raw['data']))
            view = request['view']
            if (view['kind'] == 'source' and view['series_id'] != series['id']) or (view['kind'] == 'pythia' and view['subject'] != native): raise ValueError('binding_mismatch')
            raw = call('price_read', {'symbol': symbol, 'mode': mode, **controls})
            if raw.get('data') and candidate(raw['data']['metadata'])['provider_ref'] != native: raise ValueError('binding_mismatch')
            if raw.get('data') and definition(native, mode, raw['data']['metadata'])['id'] != series['id']: raise ValueError('binding_mismatch')
            return wire.validate_read_result(failures.qualify_failure(read(request, series, mode, raw), raw))
        except failures.SourceFailure as error:
            return failures.qualify_failure(base(request, [issue(str(error))]) if request else envelope(None, [issue(str(error))]), error.raw)
        except ValueError as error:
            code = str(error) if str(error) in ('binding_mismatch', 'invalid_window') else 'invalid_request'
        except (wire.WireError, TypeError, KeyError):
            code = 'invalid_request'
        except (RuntimeError, OSError) as error:
            code = str(error)
        return base(request, [issue(code)]) if request else envelope(None, [issue(code)])

    for operation, schema in definitions.items():
        def handler(arguments, _op=operation, **context):
            return json.dumps(invoke(_op, arguments, context.get('cancelled')), allow_nan=False)
        ctx.register_tool(name=TOOLS[operation], toolset=TOOLSET, schema=schema, handler=handler, check_fn=ready)
    specialist.register_read_command(ctx, 'yahoo-finance', TOOLS['research'], 'Read public Yahoo Finance research', schema=definitions['research'], plugin='pythia-yahoo-discovery')
    specialist.register_read_command(ctx, 'yahoo-dashboard', TOOLS['dashboard'], 'Read Yahoo quotes or intraday charts', cache_seconds=60, schema=definitions['dashboard'], plugin='pythia-yahoo-discovery')
    name = 'pythia_yahoo_trending'
    schema = {'name': name, 'description': 'Read five US-region trending Yahoo Finance symbols from an undocumented public endpoint. Provider-defined popularity, not most traded stocks or investment recommendations. No prices or canonical identity matching; availability may change.',
              'parameters': {'type': 'object', 'properties': {}, 'additionalProperties': False}}

    def handler(arguments, **context):
        try:
            wire.validate_parameters(schema['parameters'], arguments)
            def fetch():
                cached = trending_cache.get('trending')
                if cached is not None: return cached
                budget = budgets.connection('yahoo', per_minute=ctx.get_config('requests_per_minute', 60))
                with budget.slot(context.get('cancelled') or (lambda: False)):
                    data = trending()
                trending_cache.put('trending', data)
                return data
            data = trending_cache.coalesce('trending', fetch)
            result = {'schema_version': 1, 'outcome': 'ok', 'data': data, 'issues': []}
        except Exception as error:
            failure = connector.detail(error)
            result = {'schema_version': 1, 'outcome': 'error', 'data': None, 'issues': [
                {'code': failure['code'], 'message': failure['message'], 'severity': 'error'}]}
            connector.qualify_failure(result, getattr(error, 'raw', {}))
        return json.dumps(result, allow_nan=False)

    ctx.register_tool(name=name, toolset='pythia-yahoo-discovery', schema=schema, handler=handler, check_fn=lambda: True)
    specialist.register_read_command(ctx, 'yahoo-trending', name, 'Read Yahoo US trending discovery', cache_seconds=600, schema=schema, plugin='pythia-yahoo-discovery')
