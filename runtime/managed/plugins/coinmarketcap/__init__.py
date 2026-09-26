"""CoinMarketCap native connector: catalogue, aggregate quotes and coin profiles.

Each HTTPS read runs in one isolated standard-library worker process under the
market-data connector budgets. There is no provider search operation: discovery
reads the local directory, which `catalogue` feeds.
"""
import importlib
import json
import os
import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from . import config
from .catalogue import RANK_DEPTH, market_caps, page as catalogue_page
from .definition import TOOLS, TOOLSET, schemas
from .identity import candidate, reference
from .profile import profile as coin_profile
from .series import (INTERVALS, MODES, coins, currency_quote, definition, envelope, issue, now, read_result,
                     samples, selector, timestamp)

WORKER = Path(__file__).with_name('worker.py')
# Local request budget per account connection; the free Basic plan allows 50.
PER_MINUTE = 30
CACHE = {'map': 0, 'listings': 3600, 'info': 21600, 'history': 900}


def dependencies(ctx):
    from hermes_cli.plugins import get_plugin_manager
    loaded = [item for item in get_plugin_manager()._plugins.values()
              if item.manifest.name == 'pythia-market-data' and item.enabled and item.module is not None]
    if not ctx.has_plugin('pythia-market-data') or len(loaded) != 1:
        raise RuntimeError('unavailable')
    package = loaded[0].module.__name__
    return [importlib.import_module(package + '.' + name) for name in ('wire', 'process', 'credentials', 'connector', '_platform')]


def register(ctx):
    wire, process, credentials, connector, platform_module = dependencies(ctx)
    platform = platform_module.platform()
    definitions = schemas(wire)
    reads = connector.WorkerReads(process)
    quote_batch = connector.NativeBatch(size=10, age=600)
    config.register_cli(ctx)

    def ready():
        try:
            dependencies(ctx)
            return Path(sys.executable).is_absolute() and WORKER.is_file()
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
            if not ready():
                raise ValueError('unavailable')
            currency = config.currency(ctx)
            token, needed = config.api_key(ctx, platform, credentials)
            if needed:
                # Visible needs-configuration result; no provider request is made.
                if request:
                    return read_result(request, issues=[{k: item[k] for k in ('code', 'severity', 'message')}
                                                        for item in needed['issues']])
                return needed
            command = [sys.executable, '-I', str(WORKER)]
            env = {k: os.environ[k] for k in ('PATH', 'LANG', 'LC_ALL') if k in os.environ}
            budget = connector.connection('coinmarketcap', token, per_minute=PER_MINUTE)
            fresh = bool(request and request['requirements']['freshness'] == 'fresh') or any(
                item['request']['requirements']['freshness'] == 'fresh' for item in clean.get('reads', []))

            def call(endpoint, args):
                message = {'token': token, 'operation': endpoint, 'arguments': args}
                if endpoint != 'quotes':
                    return reads.read(command, message, env, age=0 if fresh else CACHE[endpoint], cancelled=cancelled,
                                      timeout=15, budget=budget)
                ids = args['id'].split(',')
                # Quotes coalesce into shared native requests of at most ten IDs;
                # a single read keeps only its own row and its own failure.
                raw = quotes[args['convert']] if quotes is not None else connector.worker_batch(
                    quote_batch, process, command, message, env, ids, argument='id', separator=',', row_id='id',
                    fresh=fresh, cancelled=cancelled, timeout=12, budget=budget)
                if len(ids) > 1:
                    return raw
                item = connector.worker_item(raw, ids[0])
                if item.get('error') or not isinstance(item.get('data'), list):
                    return item
                return {**item, 'data': [row for row in item['data'] if isinstance(row, dict) and str(row.get('id')) == ids[0]]}

            def checked(raw):
                if raw.get('error'):
                    raise connector.SourceFailure(raw)
                return raw

            def retrieved(raw):
                stamp = (raw.get('source_status') or {}).get('timestamp')
                return stamp if timestamp(stamp) is not None else now()

            if operation == 'catalogue':
                offset, limit = int(clean.get('cursor', '0')), clean.get('limit', 1000)
                raw = checked(call('map', {'start': offset + 1, 'limit': limit}))
                listing = call('listings', {'start': 1, 'limit': RANK_DEPTH, 'convert': currency})
                warnings = []
                if listing.get('error'):
                    warnings = [{**issue(listing['error']), 'severity': 'warning'}]
                    caps = None
                else:
                    caps = market_caps(listing['data'], currency)
                return envelope(catalogue_page(raw['data'], offset, limit, caps, retrieved(raw), currency), warnings)
            if operation in ('profile', 'details'):
                identifier = reference(clean['native_ref'])
                raw = checked(call('info', {'id': identifier}))
                row = coins(raw['data'], [identifier]).get(identifier)
                if row is None:
                    return envelope(None)
                if operation == 'profile':
                    return envelope(coin_profile(row, retrieved(raw)))
                item = candidate(row)
                if item['provider_ref'] != clean['native_ref']:
                    raise ValueError('invalid_response')
                for evidence in item['evidence']:
                    wire.validate('evidence', evidence)
                return envelope([item])
            if operation == 'series':
                reference(clean['native_ref'])
                return envelope([wire.validate('series', definition(clean['native_ref'], mode, currency)) for mode in MODES])
            if operation == 'read_batch':
                groups = {}
                for item in clean['reads']:
                    native, mode, unit = selector(item['source_selector'], config.CURRENCIES)
                    expected = definition(native, mode, unit)
                    if (item['request']['view'] != {'kind': 'source', 'series_id': expected['id']}
                            or (mode == 'latest') != (item['request']['operation'] == 'latest')):
                        raise ValueError('unsupported_series')
                    if mode == 'latest':
                        groups.setdefault(unit, set()).add(reference(native))
                replies = {unit: call('quotes', {'id': ','.join(sorted(ids)), 'convert': unit}) for unit, ids in groups.items()}
                parallel = importlib.import_module(wire.__package__ + '.coordinated').parallel
                return envelope(parallel(lambda item: invoke(item['request']['operation'], item, cancelled, replies), clean['reads']))
            native, mode, unit = selector(clean['source_selector'], config.CURRENCIES)
            series = wire.validate('series', definition(native, mode, unit))
            if (mode == 'latest') != (operation == 'latest') or request['view'] != {'kind': 'source', 'series_id': series['id']}:
                raise ValueError('unsupported_series')
            identifier = reference(native)
            if operation == 'latest':
                rows = coins(checked(call('quotes', {'id': identifier, 'convert': unit}))['data'], [identifier])
                if identifier not in rows:
                    return wire.validate_read_result(read_result(request, series, []))
                quote = currency_quote(rows[identifier], unit)
                price = Decimal(str(quote['price']))
                if not price.is_finite() or price <= 0:
                    raise ValueError('invalid_response')
                points = [(timestamp(quote.get('last_updated')), price)]
            else:
                start, end = request['window']['start'], request['window']['end']
                if not start or not end or start['kind'] != 'instant' or end['kind'] != 'instant':
                    raise ValueError('unsupported_window')
                raw = checked(call('history', {'id': identifier, 'convert': unit, 'time_start': start['value'],
                                               'time_end': end['value'], 'interval': INTERVALS[mode]}))
                rows = coins(raw['data'], [identifier])
                points = samples(rows[identifier], unit) if identifier in rows else []
            bounds = {name: timestamp(edge['value']) for name, edge in request['window'].items() if edge and edge['kind'] == 'instant'}
            observations = []
            for stamp, value in points:
                if stamp is not None and (stamp < bounds.get('start', stamp) or stamp > bounds.get('end', stamp)):
                    continue
                observations.append({'shape': 'scalar', 'value': format(value, 'f'), 'interval': None,
                    'time': {'kind': 'instant', 'value': datetime.fromtimestamp(stamp, timezone.utc).isoformat()} if stamp is not None else {'kind': 'unknown'},
                    'completion': {'state': 'unknown', 'basis': 'unknown'}})
            result = read_result(request, series, observations)
            if operation == 'latest':
                context = result['price_context'] = {'session': {'state': 'continuous', 'basis': 'source'}}
                change, stamp = quote.get('percent_change_24h'), timestamp(quote.get('last_updated'))
                if change is not None and Decimal(str(change)).is_finite():
                    context['change'] = {'percent': format(Decimal(str(change)), 'f'), 'baseline': {
                        'kind': 'rolling', 'duration_seconds': 86400,
                        'time': {'kind': 'instant', 'value': datetime.fromtimestamp(stamp - 86400, timezone.utc).isoformat()}
                        if stamp and stamp >= 86400 else {'kind': 'unknown'}}}
                for field in ('symbol', 'name'):
                    if isinstance(rows[identifier].get(field), str) and rows[identifier][field]:
                        context[field] = rows[identifier][field]
            return wire.validate_read_result(result)
        except connector.SourceFailure as error:
            problems = [issue(str(error))]
            return connector.qualify_failure(read_result(request, issues=problems) if request else envelope(None, problems), error.raw)
        except process.WorkerError as error:
            code = str(error)
        except wire.WireError:
            code = 'invalid_request'
        except (ValueError, RuntimeError) as error:
            code = str(error)
        except (KeyError, TypeError, OSError, ArithmeticError):
            code = 'invalid_response'
        return read_result(request, issues=[issue(code)]) if request else envelope(None, [issue(code)])

    for operation, schema in definitions.items():
        def handler(arguments, _operation=operation, **context):
            return json.dumps(invoke(_operation, arguments, context.get('cancelled')), allow_nan=False)
        ctx.register_tool(name=TOOLS[operation], toolset=TOOLSET, schema=schema, handler=handler, check_fn=ready)
