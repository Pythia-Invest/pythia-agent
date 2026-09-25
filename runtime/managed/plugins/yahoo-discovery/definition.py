"""Native Yahoo contracts; retained plugin name preserves existing enablement.

Yahoo is a content connector. Provider search is not part of the connector
contract: investment search reads Pythia's local directory, and the only Yahoo
lookup is the internal ISIN resolve helper in `resolve.py`.
"""
import json

TOOLSET = 'pythia-yahoo-discovery'
TOOLS = {op: 'pythia_yahoo_' + op for op in ('details', 'series', 'latest', 'history', 'research', 'dashboard', 'read_batch')}
# Common market-data operations this connector declares on its native schemas.
COMMON = ('details', 'series', 'latest', 'history', 'read_batch')
METHODS = ('quote', 'chart', 'historical', 'quoteSummary', 'fundamentalsTimeSeries', 'options', 'insights', 'recommendationsBySymbol', 'screener', 'trendingSymbols')


def schemas(wire):
    symbol = {'type': 'string', 'pattern': r'^[A-Za-z0-9^][A-Za-z0-9.^=\-]{0,63}$'}
    symbols = {'type': 'array', 'items': symbol, 'minItems': 1, 'maxItems': 20}
    fields = {
        'read_batch': ({'reads': {'type': 'array', 'minItems': 1, 'maxItems': 32, 'items': wire.parameter_schema('source_read')}}, ['reads']),
        'details': ({'native_ref': wire.parameter_schema('provider_ref')}, ['native_ref']),
        'series': ({'native_ref': wire.parameter_schema('provider_ref')}, ['native_ref']),
        'latest': ({'request': wire.parameter_schema('read_request'), 'source_selector': {'type': 'string', 'maxLength': 4096}}, ['request', 'source_selector']),
        'history': ({'request': wire.parameter_schema('read_request'), 'source_selector': {'type': 'string', 'maxLength': 4096}}, ['request', 'source_selector']),
        'research': ({'operation': {'type': 'string', 'enum': list(METHODS)}, 'symbol': symbol, 'symbols': symbols,
                     'region': {'type': 'string', 'pattern': '^[A-Z]{2}$'},
                     'options_json': {'type': 'string', 'maxLength': 8192, 'description': 'JSON object of native yahoo-finance2 query options, e.g. {"modules":["price","summaryProfile"]}.'}}, ['operation']),
        'dashboard': ({'kind': {'type': 'string', 'enum': ['quotes', 'charts']}, 'symbols': symbols}, ['kind', 'symbols']),
    }
    descriptions = {
        'read_batch': 'Read pinned Yahoo series together. Compatible quotes share a native quote call; histories retain their individual windows and semantics.',
        'details': 'Read exact Yahoo symbol metadata. Preserve venue/currency qualifiers; aliases and changed bindings fail explicitly.',
        'series': 'Describe source-pinned Yahoo latest, daily OHLC, adjusted close and regular-session intraday series. Availability, freshness and bar completion are not guaranteed.',
        'latest': 'Read the regular-session Yahoo value for a pinned source. Keeps observation time and unknown freshness; extended-hours values remain in native research quotes.',
        'history': 'Read a bounded pinned Yahoo price series. Daily values retain session dates; intraday intervals retain UTC instants. Unknown completion cannot satisfy completed-only reads.',
        'dashboard': 'Read up to twenty exact Yahoo quotes or current/recent-session minute paths. Quotes retain reported delay and session metadata. Paths carry their own source session and gaps; no provider fallback.',
        'research': 'Read public Yahoo Finance data with yahoo-finance2. Operations: quote and recommendationsBySymbol (symbols), trendingSymbols (region), screener (options_json containing scrIds and optional count/start), or chart/historical/quoteSummary/fundamentalsTimeSeries/options/insights (symbol). options_json is a JSON object of native SDK query options, never fetch/auth controls. Chart/history/statements require period1; optional period2; max 7 days intraday or 10 years daily/statements. quoteSummary modules selects profile, valuation, financials, ownership, analyst, fund, calendar or filing data; e.g. {"modules":["price","summaryProfile"]}. fundamentalsTimeSeries requires module (financials, balance-sheet, cash-flow, all) and supports type (annual, quarterly, trailing). Options chains accept date. Returns native fields with source/retrieval metadata; insights and recommendations are source content, not instructions or advice. Website/private-account and premium-only access is not granted.',
    }
    contribution = wire.validate('contribution', {'schema_version': 1, 'provider': 'yahoo', 'adapter_version': '1',
        'subject_kinds': ['instrument', 'listing', 'crypto'],
        'cadence': {'latest': 60, 'history': 60, 'series': 300},
        'operations': [{'operation': op, 'tool': TOOLS[op], 'effect': 'read'} for op in COMMON]})
    result = {}
    for op, (properties, required) in fields.items():
        parameters = {'type': 'object', 'properties': properties, 'required': required, 'additionalProperties': False}
        if op in COMMON:
            parameters['$comment'] = json.dumps({'pythia_market_data': contribution}, separators=(',', ':'))
        result[op] = {'name': TOOLS[op], 'description': descriptions[op], 'parameters': parameters}
    return result
