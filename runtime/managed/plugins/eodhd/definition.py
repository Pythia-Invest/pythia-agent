"""Native provider schemas; separate toolset preserves legacy daily tool choice."""
import json

TOOLSET = 'pythia-eodhd-market-data'
# Shared market-data contributions. Provider search is deliberately absent:
# discovery is a local directory read owned by Pythia, not a connector call.
SHARED = ('details', 'series', 'latest', 'history', 'read_batch')
TOOLS = {operation: 'pythia_eodhd_' + operation for operation in SHARED}
TOOLS['reverse'] = 'pythia_eodhd_reverse_isin'
TOOLS['identifiers'] = 'pythia_eodhd_identifiers'
TOOLS['market_movers'] = 'pythia_eodhd_market_movers'
TOOLS['dashboard'] = 'pythia_eodhd_dashboard'
TOOLS['volume_ranking'] = 'pythia_eodhd_volume_ranking'
for _operation in ('news', 'fundamentals', 'catalogue'):
    TOOLS[_operation] = 'pythia_eodhd_' + _operation

# EODHD exchange codes enumerated by the exchange-symbol-list endpoint.
# AS is Euronext Amsterdam (operating MIC XAMS).
CATALOGUE_SCOPES = ['AS', 'NASDAQ', 'NYSE', 'LSE', 'XETRA', 'FOREX']


def closed(properties, required):
    return {'type': 'object', 'properties': properties, 'required': required, 'additionalProperties': False}


def schemas(wire):
    import importlib
    criteria = importlib.import_module(wire.__package__ + '.selection').CRITERIA
    text = lambda limit: {'type': 'string', 'minLength': 1, 'maxLength': limit}
    properties = {
        'news': ({'native_ref': wire.parameter_schema('provider_ref'), 'limit': {'type': 'integer', 'minimum': 1, 'maximum': 30},
            'from': {'type': 'string', 'format': 'date'}, 'to': {'type': 'string', 'format': 'date'}}, ['native_ref']),
        'fundamentals': ({'native_ref': wire.parameter_schema('provider_ref'), 'limit': {'type': 'integer', 'minimum': 1, 'maximum': 30}}, ['native_ref']),
        'catalogue': ({'scope': {'type': 'string', 'enum': CATALOGUE_SCOPES},
            'cursor': {**text(80), 'pattern': '^[a-f0-9]{64}:[0-9]{1,6}$'},
            'limit': {'type': 'integer', 'minimum': 1, 'maximum': 1000}}, ['scope']),
        'read_batch': ({'reads': {'type': 'array', 'minItems': 1, 'maxItems': 32, 'items': wire.parameter_schema('source_read')}}, ['reads']),
        'dashboard': ({'kind': {'type': 'string', 'enum': ['quotes', 'charts']}, 'symbols': {'type': 'array', 'minItems': 1, 'maxItems': 10, 'items': {'type': 'string', 'pattern': '^[A-Z][A-Z0-9-]{0,15}\\.(US|INDX)$'}}}, ['kind', 'symbols']),
        'market_movers': ({'kind': {'type': 'string', 'enum': ['gainers', 'losers', 'active']}, 'limit': {'type': 'integer', 'minimum': 1, 'maximum': 10}}, ['kind', 'limit']),
        'volume_ranking': ({'exchange': {'type': 'string', 'pattern': '^[A-Z0-9]{1,16}$'},
                    'limit': {'type': 'integer', 'minimum': 1, 'maximum': 50}}, ['exchange', 'limit']),
        'details': ({'native_ref': wire.parameter_schema('provider_ref')}, ['native_ref']),
        'series': ({'native_ref': wire.parameter_schema('provider_ref'), 'criteria': criteria}, ['native_ref']),
        'latest': ({'request': wire.parameter_schema('read_request'), 'source_selector': text(4096)}, ['request', 'source_selector']),
        'history': ({'request': wire.parameter_schema('read_request'), 'source_selector': text(4096)}, ['request', 'source_selector']),
        'reverse': ({'isin': {'type': 'string', 'pattern': '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'}}, ['isin']),
        'identifiers': ({'native_ref': wire.parameter_schema('provider_ref')}, ['native_ref']),
    }
    contribution = wire.validate('contribution', {'schema_version': 1, 'provider': 'eodhd', 'adapter_version': '2',
        'subject_kinds': ['instrument'], 'cadence': {'latest': 60, 'history': 900, 'series': 300},
        'operations': [{'operation': op, 'tool': TOOLS[op], 'effect': 'read'} for op in SHARED]})
    descriptions = {
        'news': 'Read EODHD ticker-linked headlines in an explicit date window, defaulting to the preceding 30 days through today in UTC. Optional from/to dates support up to 366 days. Returned window and limitations distinguish a bounded feed from exhaustive news history. A mention is not exclusive company ownership. No article bodies are retained. Requires news access; a denial does not authorize another source.',
        'fundamentals': 'Read EODHD annual and quarterly statement facts with provider taxonomy, currency and period labels. Period starts are unknown where not supplied. Requires separate fundamentals entitlement; a plan without it returns a not_entitled capability gap, not missing data.',
        'catalogue': 'Enumerate an explicitly selected EODHD exchange metadata snapshot. Rows carry source-asserted ISINs as typed identifiers for Pythia to join; a row never proves cross-provider identity. Local personal metadata storage follows EODHD personal-use terms; this operation grants no redistribution rights. Continuation cursors bind to the same snapshot. Does not fetch prices.',
        'read_batch': 'Read bounded pinned prices together. Compatible delayed quotes use one native real-time request; histories keep their individual series and windows.',
        'market_movers': 'Read an EODHD Screener ranking of US NYSE/Nasdaq listings with reported market cap over USD 1 billion and last-day volume over 100,000 shares. Gainers/losers use last-day percentage change; active uses share volume. These are latest known completed-session values, not live rankings. Preserve each row date; missing fundamentals exclude listings. No canonical matching.',
        'dashboard': 'Read up to ten explicit EODHD references: US or INDX delayed quotes in one request, or US-only recent closed Cboe EDGX minute bars. Does not resolve canonical identity or guarantee complete session coverage. Quotes and charts are distinct feeds. No streaming.',
        'volume_ranking': 'Rank Common Stock listings by share volume from one EODHD whole-exchange EOD snapshot plus its current native catalogue. Use an explicit exchange code such as US or XETRA. Preserves session dates and coverage; excludes funds, stale rows and missing volumes. This Pythia calculation is separate from EODHD Screener. Each read costs 100 bulk API credits plus the catalogue request; no polling or fallback.',
        'details': 'Read exact EODHD catalogue candidates. Source-asserted ISINs are typed identifiers, not identity proof: they may identify an underlying security rather than this product.',
        'identifiers': 'Read exact-symbol EODHD identifier mapping records as typed identifiers. FIGI grain and whether ISIN describes this instrument require qualification; issuer identifiers do not establish security equivalence.',
        'series': 'Describe EODHD source series using exact stock metadata; configuration does not prove entitlements. Explicit venue XEDX criteria expose the separate Cboe EDGX live series when streaming is enabled. These are not consolidated or delayed REST prices.',
        'latest': 'Read a pinned delayed EODHD scalar quote, preserving source time and unknown completion.',
        'history': 'Read pinned EODHD daily or intraday history; raw OHLC and adjusted close are different series.',
        'reverse': 'Read bounded reverse ISIN mapping records as typed identifiers, retaining distinct assertions and explicit pagination limits.',
    }
    result = {}
    for operation, (fields, required) in properties.items():
        parameters = closed(fields, required)
        if operation in SHARED:
            parameters['$comment'] = json.dumps({'pythia_market_data': contribution, **({'pythia_updates': True} if operation in ('latest', 'history') else {})}, separators=(',', ':'))
        result[operation] = {'name': TOOLS[operation], 'description': descriptions[operation], 'parameters': parameters}
    return result
