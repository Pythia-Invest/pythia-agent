"""CoinGecko native provider: configured access, one owned process per HTTPS read."""
import importlib
import json
import os
import sys
import time
from pathlib import Path
from . import config
from .definition import TOOLS, TOOLSET, schemas
from .identity import candidate, reference
from .series import modes, definition, selector, bounds
from .results import issue, envelope, base, read
from .dashboard import read as dashboard
from .catalogue import page as catalogue_page


def helpers(ctx):
    from hermes_cli.plugins import get_plugin_manager
    loaded = get_plugin_manager()._plugins.get('pythia-market-data')
    if not ctx.has_plugin('pythia-market-data') or loaded is None or not loaded.enabled or loaded.module is None:
        raise RuntimeError('unavailable')
    return tuple(importlib.import_module(loaded.module.__name__ + '.' + name) for name in ('wire', 'process', '_platform'))


def paths():
    root, python = os.environ.get('PYTHIA_MANAGED_ROOT', ''), sys.executable
    worker = Path(root) / 'runner/coingecko/main.py'
    if not root or not python or not Path(root).is_absolute() or not Path(python).is_absolute() or not Path(python).is_file() or not worker.is_file():
        raise RuntimeError('unavailable')
    return python, str(worker)


def register(ctx):
    wire, process, feature_platform = helpers(ctx)
    read_key = config.key_reader(ctx, feature_platform.platform)
    definitions = schemas(wire)
    budgets = failures = batching = importlib.import_module(wire.__package__ + '.connector')
    reads = failures.WorkerReads(process)
    simple_batch, market_batch = batching.NativeBatch(size=32, age=300), batching.NativeBatch(size=3, age=300)
    # access -> (expires, snapshot). Pages are read-only slices of one packed
    # snapshot, so it is kept here uncopied rather than in the shared read
    # cache, which deep-copies every value on each read.
    snapshots = {}
    config.register_cli(ctx, read_key)
    demand = importlib.import_module(wire.__package__ + '.request_context')
    def requires_key(operation):
        # Automatic dashboard refresh is scheduled polling: keyless access is
        # documented as unsuitable for it. Explicit reads and syncs work keyless.
        return operation == 'dashboard' or (demand.usage.get() == 'dashboard' and operation in ('latest', 'history', 'read_batch'))

    def resolve():
        mode, currency = config.read(ctx)
        access, token = config.access(mode, read_key)
        return access, token, currency

    def source_failure(raw):
        error = issue(raw['error'])
        if raw.get('provider_code', raw.get('http_status')) is not None:
            error['source_code'] = str(raw.get('provider_code', raw.get('http_status')))
        result = envelope(None, [error])
        if raw.get('retry_after') is not None:
            result['retry_after_seconds'] = raw['retry_after']
        return failures.qualify_failure(result, raw)

    def ready(require_key=False):
        try:
            helpers(ctx)
            paths()
            access, _token, _currency = resolve()
            return not (require_key and access == 'keyless')
        except Exception:
            return False

    def invoke(operation, arguments, cancelled=None, quotes=None):
        request = None
        try:
            clean = wire.validate_parameters(definitions[operation]['parameters'], arguments)
            if operation in ('latest', 'history'):
                request = wire.validate('read_request', clean['request'])
                if request['operation'] != operation:
                    raise ValueError('invalid_request')
            if not ready(require_key=requires_key(operation)):
                raise ValueError('unavailable')
            access, token, currency = resolve()
            budget = budgets.connection('coingecko:' + access, token,
                per_minute=ctx.get_config('requests_per_minute', config.REQUESTS_PER_MINUTE[access]))
            python, worker = paths()
            env = {k: os.environ[k] for k in ('PATH', 'LANG', 'LC_ALL') if k in os.environ}
            def call(endpoint, args):
                if endpoint == 'latest' and quotes is not None:
                    return batching.worker_item(quotes[args['currency']], args['id'])
                fresh = bool(request and request['requirements']['freshness'] == 'fresh') or any(item['request']['requirements']['freshness'] == 'fresh' for item in clean.get('reads', []))
                if endpoint in ('latest', 'latest_batch', 'dashboard_quotes'):
                    ids = args.get('ids', [args.get('id')])
                    parameters = {key: value for key, value in args.items() if key != 'id'}
                    raw = batching.worker_batch(market_batch if endpoint == 'dashboard_quotes' else simple_batch, process,
                        [python, '-I', worker], {'mode': access, 'token': token, 'operation': 'dashboard_quotes' if endpoint == 'dashboard_quotes' else 'latest_batch', 'arguments': parameters}, env, ids,
                        argument='ids', row_id='id' if endpoint == 'dashboard_quotes' else None, fresh=fresh, cancelled=cancelled, timeout=12,
                        budget=budget)
                    return batching.worker_item(raw, args['id']) if endpoint == 'latest' else raw
                # The catalogue is two sequential bulk reads whose packed list
                # exceeds the default worker output bound (3.9 MB JSON measured).
                bulk = {'timeout': 45, 'output_limit': 8_000_000} if endpoint == 'catalogue' else {'timeout': 12}
                return reads.read([python, '-I', worker], {'mode': access, 'token': token, 'operation': endpoint, 'arguments': args}, env,
                    cancelled=cancelled, budget=budget, **bulk,
                    age=0 if endpoint == 'catalogue' or fresh else 900 if args.get('days', 1) != 1 else 300)
            if operation == 'catalogue':
                expires, snapshot = snapshots.get(access, (0, None))
                if time.monotonic() < expires:
                    return envelope(catalogue_page(snapshot, clean))
                raw = call('catalogue', {})
                if raw.get('error'):
                    return source_failure(raw)
                page = catalogue_page(raw['data'], clean)
                snapshots[access] = (time.monotonic() + 1800, raw['data'])
                return envelope(page)
            if operation == 'read_batch':
                groups = {}
                for item in clean['reads']:
                    native, mode, unit = selector(item['source_selector'], access)
                    expected = definition(native, mode, unit)
                    if item['request']['view'] != {'kind': 'source', 'series_id': expected['id']} or (mode == 'latest') != (item['request']['operation'] == 'latest'):
                        raise ValueError('unsupported_series')
                    if mode == 'latest':
                        groups.setdefault(unit.lower(), set()).add(reference(native))
                replies = {unit: call('latest_batch', {'ids': sorted(ids), 'currency': unit}) for unit, ids in groups.items()}
                from importlib import import_module
                parallel = import_module(wire.__package__ + '.coordinated').parallel
                return envelope(parallel(lambda item: invoke(item['request']['operation'], item, cancelled, replies), clean['reads']))
            if operation == 'dashboard':
                def dashboard_call(endpoint, arguments):
                    raw = call(endpoint, arguments)
                    if raw.get('error'): raise failures.SourceFailure(raw)
                    return raw
                return failures.qualify_items(envelope(dashboard(clean, currency, dashboard_call, failures)))
            if request:
                native, mode, currency = selector(clean['source_selector'], access)
                wire.validate('provider_ref', native)
                if (mode == 'latest') != (operation == 'latest'):
                    raise ValueError('invalid_request')
                endpoint, controls = bounds(request, mode, access=access)
                series = wire.validate('series', definition(native, mode, currency))
                view = request['view']
                if view['kind'] != 'source' or view['series_id'] != series['id']:
                    raise ValueError('unsupported_series')
                raw = call(endpoint, {'id': reference(native), 'currency': currency.lower(), **controls})
                result = failures.qualify_failure(read(request, series, mode, raw), raw)
                return wire.validate_read_result(result)
            native = clean['native_ref']
            raw = call('details', {'id': reference(native)})
            if raw.get('error'):
                return source_failure(raw)
            item = candidate(raw['data'], details=True)
            if item['provider_ref'] != native:
                raise ValueError('invalid_response')
            for evidence in item['evidence']:
                wire.validate('evidence', evidence)
            if operation == 'details':
                return envelope([item])
            return envelope([wire.validate('series', definition(native, mode, currency)) for mode in modes(access)])
        except failures.SourceFailure as error:
            return failures.qualify_failure(base(request, [issue(str(error))]) if request else envelope(None, [issue(str(error))]), error.raw)
        except process.WorkerError as error:
            code = str(error)
        except wire.WireError:
            code = 'invalid_request'
        except (ValueError, RuntimeError) as error:
            code = str(error)
        except (KeyError, TypeError, OSError):
            code = 'invalid_response'
        return base(request, [issue(code)]) if request else envelope(None, [issue(code)])

    for operation, schema in definitions.items():
        def handler(arguments, _operation=operation, **context):
            return json.dumps(invoke(_operation, arguments, context.get('cancelled')), allow_nan=False)
        ctx.register_tool(name=TOOLS[operation], toolset=TOOLSET, schema=schema, handler=handler,
                          check_fn=lambda _op=operation: ready(require_key=requires_key(_op)))
    from hermes_cli.plugins import get_plugin_manager
    feature = get_plugin_manager()._plugins['pythia-market-data']
    specialist = importlib.import_module(feature.module.__name__ + '.specialist')
    specialist.register_read_command(ctx, 'coingecko-dashboard', TOOLS['dashboard'], 'Read CoinGecko aggregate quotes or rolling charts',
        schema=definitions['dashboard'], plugin='pythia-coingecko',
        cache_seconds=300, cache_overrides=[{'when': {'kind': 'charts', 'range': period}, 'seconds': 900} for period in ('7d', '30d')])
