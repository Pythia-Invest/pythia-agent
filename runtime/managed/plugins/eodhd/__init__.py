"""Native EODHD provider; configuration checks never probe entitlement or network."""
import importlib
import json
import hashlib
import os
from pathlib import Path

from .configuration import Configuration
from .definition import SHARED, TOOLS, TOOLSET, schemas
from .identity import candidates, reference, isin, mapping_records
from .series import MODES, STREAM_MODES, definition, selector
from .results import envelope, base, issue, read, window
from .catalogue_pages import catalogue_page


def helpers(ctx):
    from hermes_cli.plugins import get_plugin_manager
    loaded = get_plugin_manager()._plugins.get('pythia-market-data')
    if not ctx.has_plugin('pythia-market-data') or loaded is None or not loaded.enabled or loaded.module is None:
        raise RuntimeError('unavailable')
    namespace = loaded.module.__name__
    wire, process, dependency = (importlib.import_module(namespace + '.' + name) for name in ('wire', 'process', '_platform'))
    return wire, process, dependency.platform().configuration


def paths():
    root = os.environ.get('PYTHIA_MANAGED_ROOT', '')
    node = os.environ.get('PYTHIA_NODE', '')
    worker = Path(root) / 'runner' / 'dist' / 'eodhd-market-data.js'
    if not root or not node or not Path(root).is_absolute() or not Path(node).is_absolute() or not Path(node).is_file() or not worker.is_file():
        raise RuntimeError('unavailable')
    return node, str(worker)


def register(ctx):
    wire, process, core = helpers(ctx)
    configuration = Configuration(ctx, core)
    definitions = schemas(wire)
    budgets = failures = batching = importlib.import_module(wire.__package__ + '.connector')
    reads = failures.WorkerReads(process)
    quote_batch = batching.NativeBatch(size=32, age=60)
    from .stream import Streams
    streams = Streams(ctx, wire, configuration)

    ctx.register_skill('eodhd', Path(__file__).parent / 'skills/eodhd/SKILL.md',
        description='Use EODHD source series, identifier mappings, catalogue, news, fundamentals, specialist quotes and explicitly enabled EDGX streams.')
    ctx.on_unload(streams.close)

    def stream_setup(parser):
        parser.add_argument('--mode', choices=('disabled', 'demo', 'account'))
    def stream_config(args):
        if args.mode is not None: ctx.set_config('streaming', args.mode)
        print(json.dumps({'streaming': streams.mode()}))
    ctx.register_cli_command('eodhd-streaming', 'Explicitly enable Cboe EDGX demo or account streaming; does not change existing series', stream_setup, stream_config)
    metadata_cache = importlib.import_module(wire.__package__ + '.cache').ReadCache(max_entries=128, ttl_seconds=300)

    def installed():
        try:
            helpers(ctx)
            paths()
            return True
        except Exception:
            return False

    def invoke(operation, arguments, cancelled=None, quotes=None):
        valid_request = None
        try:
            clean = wire.validate_parameters(definitions[operation]['parameters'], arguments)
            if operation in ('latest', 'history'):
                valid_request = wire.validate('read_request', clean['request'])
                if valid_request['operation'] != operation:
                    raise ValueError('invalid_request')
            blocked = configuration.needs_configuration()
            if blocked:
                # No provider request. The market-data backend's strict issue schema rejects `fields`.
                if operation in SHARED: raise RuntimeError('needs_configuration')
                return blocked
            if not installed():
                raise RuntimeError('unavailable')
            state, token = configuration.eodhd_token()
            if state != 'configured':
                raise RuntimeError('needs_configuration')
            node, worker = paths()
            env = {key: os.environ[key] for key in ('PATH', 'LANG', 'LC_ALL') if key in os.environ}
            def call(endpoint, args):
                if endpoint == 'latest' and quotes is not None:
                    raw = batching.worker_item(quotes, args['symbol'])
                    return {**raw, 'data': (raw.get('data') or {}).get(args['symbol'], [])}
                fresh = bool(valid_request and valid_request['requirements']['freshness'] == 'fresh') or any(item['request']['requirements']['freshness'] == 'fresh' for item in clean.get('reads', []))
                if endpoint in ('latest', 'latest_batch'):
                    symbols = args.get('symbols', [args.get('symbol')])
                    raw = batching.worker_batch(quote_batch, process, [node, '--max-old-space-size=128', worker],
                        {'token': token, 'operation': 'latest_batch', 'arguments': {}}, env, symbols,
                        argument='symbols', fresh=fresh, cancelled=cancelled, timeout=12,
                        budget=budgets.connection('eodhd', token, per_minute=ctx.get_config('requests_per_minute', 60)))
                    if endpoint == 'latest':
                        raw = batching.worker_item(raw, args['symbol'])
                        return {**raw, 'data': (raw.get('data') or {}).get(args['symbol'], [])}
                    return raw
                def fetch():
                    return reads.read([node, '--max-old-space-size=128', worker],
                        {'token': token, 'operation': endpoint, 'arguments': args}, env,
                        timeout=45 if endpoint in ('reverse', 'identifiers', 'catalogue_snapshot') else 25 if endpoint == 'fundamentals' else 12, cancelled=cancelled,
                        age=0 if fresh and endpoint != 'details' else 86400 if endpoint == 'catalogue_snapshot' else 3600 if endpoint == 'fundamentals' else 300 if endpoint in ('details', 'identifiers', 'news') else 60,
                        budget=budgets.connection('eodhd', token, per_minute=ctx.get_config('requests_per_minute', 60)))
                if endpoint != 'details': return fetch()
                key = hashlib.sha256(json.dumps([node, worker, token, args], sort_keys=True).encode()).hexdigest()
                def describe():
                    cached = metadata_cache.get(key)
                    if cached is not None: return cached
                    raw = fetch()
                    if raw.get('data') and not raw.get('issues'): metadata_cache.put(key, raw)
                    return raw
                return metadata_cache.coalesce(key, describe)
            def nonread(data, raw):
                result = envelope(data, errors(raw))
                if raw.get('retry_after') is not None:
                    result['retry_after_seconds'] = raw['retry_after']
                return failures.qualify_failure(result, raw)
            def errors(raw):
                return [issue(code, source_code=raw.get('http_status')) for code in raw.get('issues', [])]
            def nonread_result(raw):
                return nonread(raw['data'], raw)
            if operation == 'catalogue':
                raw = call('catalogue_snapshot', {'scope': clean['scope']})
                return nonread(catalogue_page(raw['data'], clean) if raw.get('data') is not None else None, raw)
            if operation in ('news', 'fundamentals'):
                reference(clean['native_ref'])
                raw = call(operation, clean)
                if operation == 'fundamentals' and raw.get('issues') == ['access_denied'] and raw.get('http_status') == 403:
                    # Fundamentals are a separately licensed dataset. A plan
                    # without it is a visible capability gap: not a failed read
                    # and not absent data. It never authorizes another source.
                    return {**envelope(None, [issue('not_entitled', 'warning', source_code=403)]), 'outcome': 'empty',
                            'capability': {'dataset': 'fundamentals', 'status': 'not_entitled'}}
                return nonread_result(raw)
            if operation == 'read_batch':
                if any(selector(item['source_selector'])[1] in STREAM_MODES for item in clean['reads']):
                    parallel = importlib.import_module(wire.__package__ + '.coordinated').parallel
                    return envelope(parallel(lambda item: invoke(item['request']['operation'], item, cancelled), clean['reads']))
                symbols = set()
                for item in clean['reads']:
                    native, mode = selector(item['source_selector'])
                    if item['request']['view'] != {'kind': 'source', 'series_id': definition(native, mode)['id']} or (mode == 'latest') != (item['request']['operation'] == 'latest'):
                        raise ValueError('binding_mismatch')
                    if mode == 'latest': symbols.add(reference(native))
                replies = {'data': {}, 'issues': []}
                if symbols:
                    raw = call('latest_batch', {'symbols': sorted(symbols)})
                    replies = raw
                parallel = importlib.import_module(wire.__package__ + '.coordinated').parallel
                return envelope(parallel(lambda item: invoke(item['request']['operation'], item, cancelled, replies), clean['reads']))
            if operation == 'dashboard':
                return failures.qualify_items(nonread_result(call(operation, clean)))
            if operation in ('reverse', 'identifiers'):
                if operation == 'reverse' and not isin(clean['isin']):
                    raise ValueError('invalid_request')
                raw = call(operation, clean if operation == 'reverse' else {'symbol': reference(clean['native_ref'])})
                return nonread(None if raw['data'] is None else {'records': mapping_records(raw['data']), 'complete': raw['complete']}, raw)
            if operation in ('latest', 'history'):
                native, mode = selector(clean['source_selector'])
                native = wire.validate('provider_ref', native)
                if (mode in ('latest', 'edgx_latest')) != (operation == 'latest'):
                    raise ValueError('invalid_request')
                controls = {} if mode in STREAM_MODES else window(valid_request, mode)
            else:
                native, mode, controls = clean['native_ref'], None, None
            symbol = reference(native)
            raw = call('details', {'symbol': symbol})
            choices = candidates(raw['data'] or [])
            if operation == 'details':
                return nonread(choices, raw)
            exact = [item for item in choices if item['provider_type'] == 'Common Stock' and all(item['provider_ref'].get('qualifiers', {}).get(key) == value for key, value in native.get('qualifiers', {}).items())]
            if len(exact) != 1 or raw['issues']:
                issues = errors(raw) or [issue('identity_unresolved')]
                return base(valid_request, issues) if valid_request else envelope([], issues)
            if operation == 'series':
                native = exact[0]['provider_ref']
                modes = STREAM_MODES if clean.get('criteria', {}).get('venue') == 'XEDX' and streams.mode() != 'disabled' else MODES
                if modes == STREAM_MODES and (not symbol.endswith('.US') or native.get('qualifiers', {}).get('currency') != 'USD'):
                    return envelope([])
                return envelope([wire.validate('series', definition(native, value)) for value in modes])
            if exact[0]['provider_ref'] != native:
                raise ValueError('binding_mismatch')
            series = wire.validate('series', definition(native, mode))
            view = valid_request['view']
            if (view['kind'] == 'source' and view['series_id'] != series['id']) or (view['kind'] == 'pythia' and view['subject'] != native):
                raise ValueError('binding_mismatch')
            if mode in STREAM_MODES:
                return streams.snapshot(clean, cancelled)
            endpoint = 'latest' if mode == 'latest' else 'eod' if mode.startswith('daily') else 'intraday'
            raw = call(endpoint, {'symbol': symbol, **controls})
            return wire.validate_read_result(failures.qualify_failure(read(valid_request, series, mode, raw), raw))
        except process.WorkerError as error:
            code = str(error)
        except wire.WireError:
            code = 'invalid_request'
        except (ValueError, RuntimeError) as error:
            code = str(error)
        except (KeyError, TypeError, OSError):
            code = 'invalid_response'
        return base(valid_request, [issue(code)]) if valid_request else envelope(None, [issue(code)])

    for operation, schema in definitions.items():
        def handler(arguments, _operation=operation, **context):
            if context.get('_subscription') is not None and _operation in ('latest', 'history'):
                try:
                    clean = wire.validate_parameters(definitions[_operation]['parameters'], arguments)
                    native, mode = selector(clean['source_selector'])
                    evidence = invoke('series', {'native_ref': native, 'criteria': {'venue': 'XEDX'}}, context.get('cancelled'))
                    if not any(row['id'] == clean['request']['view'].get('series_id') for row in evidence.get('data') or []):
                        raise ValueError('binding_mismatch')
                    streams.subscribe(clean, context['_subscription'])
                    return json.dumps({'schema_version': 1, 'mode': 'push'})
                except (ValueError, RuntimeError, wire.WireError):
                    return json.dumps({'schema_version': 1, 'mode': 'unavailable'})
            return json.dumps(invoke(_operation, arguments, context.get('cancelled')), allow_nan=False)
        # Installed tools stay callable while unconfigured so callers get the
        # explicit needs-configuration result; no provider call is made.
        ctx.register_tool(name=TOOLS[operation], toolset=TOOLSET, schema=schema, handler=handler, check_fn=installed)

    specialist = importlib.import_module(wire.__package__ + '.specialist')
    specialist.register_read_command(ctx, 'eodhd-dashboard', TOOLS['dashboard'], 'Read EODHD dashboard quotes or recent minute bars', cache_seconds=60, schema=definitions['dashboard'], plugin='pythia-eodhd')
    for operation in ('news', 'fundamentals', 'catalogue'):
        specialist.register_read_command(ctx, 'eodhd-' + operation, TOOLS[operation],
            definitions[operation]['description'], cache_seconds=300,
            schema=definitions[operation], plugin='pythia-eodhd')
