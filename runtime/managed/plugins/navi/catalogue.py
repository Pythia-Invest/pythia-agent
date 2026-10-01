"""NAVI Protocol's lending reserves as identity claim batches (ADR 0038, contract version 2).

The plugin describes NAVI's own records; core's ingest joins or introduces the subjects they name.

- NAVI Lending is one `protocol` with the native id `navi-lending`, which also states the original package id of NAVI's
  `lending_core` (`sui_package`), so every Sui source naming that package joins it.
- A reserve (one coin in one market) is a `market` keyed by its `Pool<T>` object id (`sui_object`, also its native
  reference), `part_of` the protocol and `market_asset` of the coin it holds. The id is an on-chain object id that names
  the coin in its own type, so it verifies without NAVI and joins every source naming the same object; `uniqueId`
  (`main-10`) and the coin type alone are not keys, since a coin has a reserve in up to nine markets. A market is part of
  a reserve's name, not a subject: no relation joins a reserve to a market.
- A Sui coin type is a token deployment, a `listing` keyed by CAIP-19 in Pythia's Sui profile (ADR 0037): two coin
  types are two subjects whatever their symbols. A generic type or one past CAIP-19's 128 characters has no key; it is
  left out, since core refuses a batch with a malformed identifier.
"""
from bisect import bisect_right
from collections import Counter
import re

PROVIDER, PLUGIN, ADAPTER_VERSION = 'navi', 'pythia-navi', '1'
PROTOCOL_ID, PROTOCOL_NAME = 'navi-lending', 'NAVI Lending'
PACKAGE = '0xd899cf7d2b5db716bd2cf55599fb0d5ee38a3061e7b6bb6eebf73fa5bc4c81ca'  # original package of `lending_core`
ORIGINS = ('https://open-api.naviprotocol.io',)
URL = ORIGINS[0] + '/api/navi/pools?env=prod&market='  # the market keys follow, comma-separated, as the app sends them
# The keys are the ones in the SDK's `MARKETS` constant (@naviprotocol/lending 2.0.12, `market.ts`) and the display names
# the ones `/api/navi/markets` answers with (2026-09-30), which differ from the SDK's ("lzWBTC/USDC Market", no spaces
# around the slash). The plugin does not read that list: a market NAVI launches later is invisible until its key is in
# the `navi_markets` setting, and a key not named here is displayed by the key itself.
MARKETS = {'main': 'Main Market', 'ember': 'eACRED/USDC Market', 'rwa': 'Matrixdock Market',
           'sui-eco': 'Sui Eco Market', 'sui-usdc': 'SUI/USDC Market', 'wbtc-usdc': 'lzWBTC/USDC Market',
           'xbtc-usdc': 'xBTC/USDC Market', 'vsui-usdc': 'vSUI/USDC Market', 'vsui-sui': 'vSUI/SUI Market',
           'hasui-sui': 'haSUI/SUI Market', 'high-usdc': 'HIGH/USDC Market'}
PAGE_CLAIMS = 2000                   # well under core's 5,000 claims a batch
MAX_ROWS = 10_000
MARKET_KEY = re.compile(r'^[a-z0-9][a-z0-9-]{0,39}\Z')
POOL_ID = re.compile(r'^0x[0-9a-f]{64}\Z')
BRIDGES = (('isSuiBridge', 'Sui Bridge'), ('isWormhole', 'Wormhole'), ('isLayerZero', 'LayerZero'))


def markets(value):
    """The `navi_markets` setting as market keys: a list or comma-separated text of keys as NAVI writes them. Unset,
    empty or null is every market the SDK names."""
    items = [] if value is None else value.split(',') if isinstance(value, str) else value
    if not isinstance(items, (list, tuple)) or not all(isinstance(item, str) for item in items):
        raise ValueError('invalid_configuration')
    keys = tuple(dict.fromkeys(item.strip().casefold() for item in items if item.strip()))
    if not all(MARKET_KEY.match(key) for key in keys):
        raise ValueError('invalid_configuration')
    return keys or tuple(MARKETS)


def url(wanted):
    return URL + ','.join(wanted)


def _text(value, maximum=120):
    return (isinstance(value, str) and 0 < len(value) <= maximum and value == value.strip()
            and not any(ord(char) < 32 or ord(char) == 127 for char in value))


def _amount(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if 0 <= number < float('inf') else None


def _reserve(item):
    from pythia_platform import identifiers  # published by core, which registers before this plugin
    token, contract = item.get('token'), item.get('contract')
    if not (isinstance(token, dict) and isinstance(contract, dict) and isinstance(contract.get('pool'), str)
            and POOL_ID.match(contract['pool']) and _text(item.get('market'), 40) and _text(token.get('symbol'))
            and isinstance(item.get('isDeprecated'), bool) and isinstance(item.get('suiCoinType'), str)
            and all(isinstance(item.get(flag, False), bool) for flag, _tag in BRIDGES)):
        return None
    # TVL as DeFiLlama defines it for lending, supplied minus borrowed, in the SDK's own units: `totalSupplyAmount` and
    # `borrowedAmount` are in 1e-9 of the coin, priced by the oracle. Without all three, no rank rather than a wrong one.
    supply, borrowed = _amount(item.get('totalSupplyAmount')), _amount(item.get('borrowedAmount'))
    oracle = item.get('oracle')
    price = _amount(oracle.get('price')) if isinstance(oracle, dict) else None
    tag = next((name for flag, name in BRIDGES if item.get(flag)), None)
    return {'pool': contract['pool'], 'market': item['market'], 'symbol': token['symbol'], 'tag': tag,
            'coin': item['suiCoinType'], 'key': identifiers.sui_caip19(item['suiCoinType']), 'inactive': item['isDeprecated'],
            'tvl': max(supply - borrowed, 0) * price / 1e9 if None not in (supply, borrowed, price) else None}


def reserve_rows(data, wanted):
    """`/pools` projected to what the catalogue keeps, with the drift counted: records left out as malformed, for a
    market nobody asked for, or sharing a Pool object id (two records for one id name no one reserve, so neither is
    kept); reserves whose coin type has no CAIP-19 key; and requested markets that came back empty. Nothing is
    coerced. An answer of another shape, or with no reserve at all, is refused: an empty complete scope would tell
    core every reserve is gone."""
    if not isinstance(data, dict) or data.get('code') != 0 or not isinstance(data.get('data'), list) \
            or len(data['data']) > MAX_ROWS:
        raise ValueError('invalid_response')
    parsed = [_reserve(item) if isinstance(item, dict) else None for item in data['data']]
    valid = [row for row in parsed if row is not None]
    asked = [row for row in valid if row['market'] in wanted]
    counts = Counter(row['pool'] for row in asked)
    rows = [row for row in asked if counts[row['pool']] == 1]
    if not rows:
        raise ValueError('invalid_response')
    return {'rows': rows, 'rejected': len(parsed) - len(valid), 'unrequested': len(valid) - len(asked),
            'duplicated': len(asked) - len(rows), 'unkeyed': sum(row['key'] is None for row in rows),
            'empty': [key for key in wanted if key not in {row['market'] for row in rows}]}


def _ref(scope, native_id):
    return {'provider': PROVIDER, 'native_scope': scope, 'native_id': native_id}


def page(scope, projection, cursor, observed_at, wanted):
    """One page of a scope: (ClaimBatch wire form, next cursor).

    Reserves are ordered by Pool object id and the cursor is the last id a page emitted, so a sync whose snapshot is
    refreshed between pages never skips a reserve both snapshots hold; the last page is `complete`."""
    provenance = {'plugin': PLUGIN, 'source': PROVIDER, 'adapter_version': ADAPTER_VERSION,
                  'retrieved_at': observed_at, 'source_record': url(wanted)}
    claims, following = [], None
    if scope == 'protocols':
        claims = [{'level': 'protocol', 'identifiers': [{'scheme': 'sui_package', 'value': PACKAGE}],
                   'native_ref': _ref('protocol', PROTOCOL_ID),
                   'attributes': {'name': PROTOCOL_NAME, 'status': 'active', 'aliases': ['NAVI', 'NAVI Protocol']},
                   'provenance': provenance}]
    else:
        rows = sorted(projection['rows'], key=lambda row: row['pool'])
        labels, emitted = _labels(rows), set()
        for index in range(bisect_right([row['pool'] for row in rows], cursor) if cursor else 0, len(rows)):
            own = _reserve_claims(rows[index], emitted, labels, provenance)
            if claims and len(claims) + len(own) > PAGE_CLAIMS:
                following = rows[index - 1]['pool']
                break
            claims.extend(own)
            emitted.update(filter(None, [rows[index]['key']]))
    batch = {'plugin': PLUGIN, 'provider': PROVIDER, 'adapter_version': ADAPTER_VERSION, 'origin': 'catalogue',
             'scope': scope, 'complete': following is None, 'claims': claims}
    return batch, following


def _label(row):
    return f"{row['symbol']} ({row['tag']})" if row['tag'] else row['symbol']


def _labels(rows):
    """A label per coin type, as NAVI shows its coin: the symbol and, for a bridged coin, its bridge ("suiUSDT (Sui
    Bridge)"), so two coins NAVI both calls wBTC stay distinguishable. The most common one across reserves; ties go
    alphabetically. A label is never evidence."""
    counts = {}
    for row in rows:
        if row['key']:
            counts.setdefault(row['key'], Counter())[_label(row)] += 1
    return {key: min(found, key=lambda label: (-found[label], label)) for key, found in counts.items()}


def _reserve_claims(row, emitted, labels, provenance):
    """A reserve's record, its token record if this page has not emitted it yet, and its relations."""
    pool = _ref('reserve', row['pool'])
    market = MARKETS.get(row['market'], row['market'])
    detail = f"{row['tag']}, {market}" if row['tag'] else market
    attributes = {'name': f"{PROTOCOL_NAME} {row['symbol']} ({detail})"[:512], 'asset_class': 'crypto',
                  'status': 'inactive' if row['inactive'] else 'active',
                  **({'rank': {'tvl_usd': row['tvl']}} if row['tvl'] is not None else {})}
    record = {'level': 'market', 'identifiers': [{'scheme': 'sui_object', 'value': row['pool']}], 'native_ref': pool,
              'attributes': attributes, 'provenance': provenance}
    relations = [{'type': 'part_of', 'from_key': pool, 'to_key': _ref('protocol', PROTOCOL_ID),
                  'provenance': provenance}]
    key, tokens = row['key'], []
    if key:
        if key not in emitted:
            tokens = [{'level': 'listing', 'identifiers': [{'scheme': 'caip19', 'value': key}],
                       'attributes': {'asset_class': 'crypto', 'name': labels[key][:512]},
                       'provenance': provenance}]
        relations.append({'type': 'market_asset', 'from_key': pool, 'to_key': {'scheme': 'caip19', 'value': key},
                          'provenance': provenance})
    return [record, *tokens, *relations]
