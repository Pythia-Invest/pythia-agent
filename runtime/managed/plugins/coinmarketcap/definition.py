"""Native tool schemas. No provider search: discovery reads the local directory,
which this connector feeds through `catalogue`."""
import json

from .catalogue import RANK_DEPTH

TOOLSET = 'pythia-coinmarketcap'
OPERATIONS = ('catalogue', 'profile', 'details', 'series', 'latest', 'history', 'read_batch')
TOOLS = {operation: 'pythia_coinmarketcap_' + operation for operation in OPERATIONS}
# Common market-data reads; the market-data owner discovers these by marker.
COMMON = ('details', 'series', 'latest', 'history', 'read_batch')
CATALOGUE_PAGE = 2000


def closed(properties, required):
    return {'type': 'object', 'properties': properties, 'required': required, 'additionalProperties': False}


def schemas(wire):
    text = lambda limit: {'type': 'string', 'minLength': 1, 'maxLength': limit}
    ref = wire.parameter_schema('provider_ref')
    properties = {
        'catalogue': ({'scope': {'type': 'string', 'enum': ['coins']},
                       'cursor': {'type': 'string', 'pattern': '^(0|[1-9][0-9]{0,5})$'},
                       'limit': {'type': 'integer', 'minimum': 1, 'maximum': CATALOGUE_PAGE}}, ['scope']),
        'profile': ({'native_ref': ref}, ['native_ref']),
        'details': ({'native_ref': ref}, ['native_ref']),
        'series': ({'native_ref': ref}, ['native_ref']),
        'latest': ({'request': wire.parameter_schema('read_request'), 'source_selector': text(4096)}, ['request', 'source_selector']),
        'history': ({'request': wire.parameter_schema('read_request'), 'source_selector': text(4096)}, ['request', 'source_selector']),
        'read_batch': ({'reads': {'type': 'array', 'minItems': 1, 'maxItems': 32, 'items': wire.parameter_schema('source_read')}}, ['reads']),
    }
    contribution = wire.validate('contribution', {
        'schema_version': 1, 'provider': 'coinmarketcap', 'adapter_version': '1', 'subject_kinds': ['crypto'],
        'cadence': {'latest': 600, 'history': 900, 'series': 3600},
        'operations': [{'operation': op, 'tool': TOOLS[op], 'effect': 'read'} for op in COMMON]})
    descriptions = {
        'catalogue': ('Read one page of active CoinMarketCap coins ordered by permanent coin ID, for the local directory. '
                      'Rows carry source-asserted identifiers (CoinMarketCap ID, slug, symbol, main platform contract), '
                      'CoinMarketCap rank and, for the top %d coins, market cap. Continue with next_cursor until it is null. '
                      'Symbols and contracts do not prove identity with another provider.' % RANK_DEPTH),
        'profile': ('Read the CoinMarketCap profile of one exact coin ID: description, logo, links, tags, launch date and '
                    'every listed contract deployment. Source text, labelled with CoinMarketCap and retrieval time.'),
        'details': 'Read identity evidence for an exact CoinMarketCap coin ID: the native ID and network-scoped contract addresses.',
        'series': 'Describe pinned CoinMarketCap aggregate latest and 15-minute, hourly or daily price-sample series in the configured currency.',
        'latest': 'Read a pinned CoinMarketCap aggregate quote. Keeps price precision and source time; freshness and completion stay unknown.',
        'history': ('Read pinned CoinMarketCap aggregate price samples, not OHLC bars. Use aware start/end instants: at most '
                    'seven days intraday or ninety days daily; the account plan may allow less.'),
        'read_batch': 'Read several pinned CoinMarketCap series together. Compatible quotes share one native request.',
    }
    result = {}
    for operation, (fields, required) in properties.items():
        parameters = closed(fields, required)
        if operation in COMMON:
            parameters['$comment'] = json.dumps({'pythia_market_data': contribution}, separators=(',', ':'))
        result[operation] = {'name': TOOLS[operation], 'description': descriptions[operation], 'parameters': parameters}
    return result
