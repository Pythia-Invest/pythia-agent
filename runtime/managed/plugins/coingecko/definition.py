"""Native provider schemas; separate toolset preserves legacy daily tool choice.

Only standard read operations carry the market-data contribution marker. The
catalogue and dashboard are connector-owned tools outside that contract; there
is no provider search operation.
"""
import json

TOOLSET = 'pythia-coingecko-market-data'
OPERATIONS = ('catalogue', 'resolve', 'details', 'series', 'latest', 'history', 'dashboard', 'read_batch')
TOOLS = {operation: 'pythia_coingecko_' + operation for operation in OPERATIONS}
UNMARKED = ('catalogue', 'resolve', 'dashboard')


def closed(properties, required):
    return {'type': 'object', 'properties': properties, 'required': required, 'additionalProperties': False}


def schemas(wire):
    text = lambda limit: {'type': 'string', 'minLength': 1, 'maxLength': limit}
    properties = {
        'read_batch': ({'reads': {'type': 'array', 'minItems': 1, 'maxItems': 32, 'items': wire.parameter_schema('source_read')}}, ['reads']),
        'catalogue': ({'scope': {'type': 'string', 'enum': ['coins']},
                       'cursor': {'type': 'string', 'pattern': '^(0|[1-9][0-9]{0,5})$'},
                       'limit': {'type': 'integer', 'minimum': 1, 'maximum': 1000}}, ['scope']),
        'resolve': ({'native_id': text(128)}, ['native_id']),
        'details': ({'native_ref': wire.parameter_schema('provider_ref')}, ['native_ref']),
        'series': ({'native_ref': wire.parameter_schema('provider_ref')}, ['native_ref']),
        'latest': ({'request': wire.parameter_schema('read_request'), 'source_selector': text(4096)}, ['request', 'source_selector']),
        'history': ({'request': wire.parameter_schema('read_request'), 'source_selector': text(4096)}, ['request', 'source_selector']),
        'dashboard': ({'kind': {'type': 'string', 'enum': ['quotes', 'charts']}, 'symbols': {'type': 'array', 'minItems': 1, 'maxItems': 3,
            'items': {'type': 'string', 'minLength': 1, 'maxLength': 128}}, 'range': {'type': 'string', 'enum': ['1d', '7d', '30d']}}, ['kind', 'symbols']),
    }
    contribution = wire.validate('contribution', {'schema_version': 1, 'provider': 'coingecko', 'adapter_version': '1',
        'subject_kinds': ['crypto'], 'cadence': {'latest': 300, 'history': 900, 'series': 300},
        'operations': [{'operation': op, 'tool': name, 'effect': 'read'} for op, name in TOOLS.items() if op not in UNMARKED]})
    descriptions = {
        'read_batch': 'Read bounded pinned series together. Compatible aggregate quotes share one native price response; history retains separate source windows and semantics.',
        'catalogue': 'Read a bounded page of active CoinGecko coins: coin ID, symbol, name and source-asserted platform contracts with source chain identifiers, plus USD market-cap rank and size for the top 250 when available. Pages share one 30-minute source snapshot; derived local metadata may be kept for one day. Works with or without a key. Symbols, contracts and ranks do not prove cross-provider identity.',
        'resolve': 'State what CoinGecko records for one exact coin ID (name, symbol) as an identity claim batch for Pythia\'s core; never a match with another provider.',
        'details': 'Read exact CoinGecko coin metadata and network-scoped contract facts.',
        'series': 'Describe CoinGecko source series using exact coin metadata; configuration does not prove entitlements.',
        'latest': 'Read a pinned CoinGecko aggregate scalar quote, preserving source time and unknown completion.',
        'history': 'Read pinned CoinGecko scalar samples or close-anchored OHLC without volume; intervals are fixed by the selected definition.',
        'dashboard': 'Read up to three exact CoinGecko coin IDs as batched aggregate quotes with rolling 24-hour changes, or timestamped price samples. Charts accept range 1d (default, five-minute samples), 7d or 30d (hourly samples); range is not a quote argument. Requires a Demo or paid API key; uses configured currency. These are snapshots, not exchange execution prices; no alternate source or access mode is selected.',
    }
    result = {}
    for operation, (fields, required) in properties.items():
        parameters = closed(fields, required)
        if operation not in UNMARKED:
            parameters['$comment'] = json.dumps({'pythia_market_data': contribution}, separators=(',', ':'))
        result[operation] = {'name': TOOLS[operation], 'description': descriptions[operation], 'parameters': parameters}
    return result
