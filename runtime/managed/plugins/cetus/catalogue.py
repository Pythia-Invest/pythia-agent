"""Cetus CLMM pools as identity claim batches (ADR 0038, contract version 2).

The plugin describes Cetus's own records; core's ingest joins or introduces the subjects they name.

- Cetus CLMM is one `protocol`, keyed by the original package id of its `pool::Pool<A, B>` type (`sui_package`).
- A pool is a `market` keyed by its object id (`sui_object`, also its native reference), `part_of` the protocol, with
  `market_asset` edges to its two coins. Coin A is the `base` and coin B the `quote` in the pool's own price (the price
  of A in B), not a trading convention. The fee tier is part of a pool's identity (one pool per pair and tier) and is
  stated in its name: core has no fee attribute.
- Cetus lists 44,000 pools, nearly all launch-pad dust. Only pools with more than TVL_FLOOR dollars of liquidity are
  subjects; the list is read in descending TVL order and reading stops at the first page that ends below the floor.
"""
from bisect import bisect_right
from decimal import Decimal, InvalidOperation

PROVIDER, PLUGIN, ADAPTER_VERSION = 'cetus', 'pythia-cetus', '1'
PROTOCOL_ID, PROTOCOL_NAME = 'cetus-clmm', 'Cetus CLMM'
PACKAGE = '0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb'  # original package of `pool::Pool<A, B>`
ORIGINS = ('https://api-sui.cetus.zone',)
URL = ORIGINS[0] + '/v2/sui/stats_pools?order_by=-tvl&limit=100&offset='  # the offset follows
PAGE, MAX_PAGES = 100, 20     # pools a request returns; requests a read may make (2,000 pools, far past the floor)
TVL_FLOOR = 1000.0            # US dollars, Cetus's `pure_tvl_in_usd`: the reserves priced by Cetus
PAGE_CLAIMS = 2000            # well under core's 5,000 claims a batch


def url(offset):
    return f'{URL}{offset}'


def normalized(scheme, value):
    """`value` in the form core joins on (`pythia_platform.identifiers`), or None when core would refuse it."""
    from pythia_platform import identifiers  # published by core, which registers before this plugin
    try:
        return identifiers.normalize_identifier(scheme, value) if isinstance(value, str) else None
    except identifiers.IdentifierError:
        return None


def sui_caip19(coin_type):
    return normalized('caip19', f'sui:mainnet/coin:{coin_type}')


def _text(value, maximum=120):
    return (isinstance(value, str) and 0 < len(value) <= maximum and value == value.strip()
            and not any(ord(char) < 32 or ord(char) == 127 for char in value))


def _symbol(coin):
    """A coin's symbol without stray spaces: Cetus lists "PNUT " (2026-09-30), a label and never an identifier."""
    symbol = coin.get('symbol')
    return symbol.strip() if isinstance(symbol, str) and _text(symbol.strip()) else None


def _pool(item):
    a, b, chain = item.get('coin_a'), item.get('coin_b'), item.get('object')
    if not (isinstance(a, dict) and isinstance(b, dict) and isinstance(chain, dict) and isinstance(item.get('fee'), str)):
        return None
    try:
        fee, tvl = Decimal(item['fee']), float(item['pure_tvl_in_usd'])
    except (KeyError, TypeError, ValueError, InvalidOperation):
        return None
    pool = normalized('sui_object', item.get('address'))
    symbols = [_symbol(a), _symbol(b)]
    if not (pool and fee.is_finite() and fee >= 0 and 0 <= tvl < float('inf') and all(symbols)
            and isinstance(item.get('is_closed'), bool)
            and isinstance(chain.get('is_pause'), bool) and type(chain.get('fee_rate')) is int):
        return None
    return {'pool': pool, 'tvl': tvl, 'fee': f'{fee.normalize():f}', 'matches': fee * 10000 == chain['fee_rate'],
            'inactive': item['is_closed'] or chain['is_pause'],
            'coins': [{'symbol': symbol, 'key': sui_caip19(item[name])}
                      for symbol, name in zip(symbols, ('coin_a_address', 'coin_b_address'))]}


def pool_rows(data):
    """One `stats_pools` page projected to the pools over the floor, with the drift counted: records left out as
    malformed, or whose fee label does not match the pool's on-chain fee rate (a pool's fee is part of its name, so a
    wrong one would mislead). `end` says the floor is reached, so no further page is needed. Nothing is coerced."""
    lp = data['data']['lp_list'] if isinstance(data, dict) and data.get('code') == 0 and isinstance(
        data.get('data'), dict) else None
    if not isinstance(lp, list) or len(lp) > PAGE:
        raise ValueError('invalid_response')
    parsed = [_pool(item) if isinstance(item, dict) else None for item in lp]
    valid = [row for row in parsed if row is not None]
    matching = [row for row in valid if row['matches']]
    return {'rows': [row for row in matching if row['tvl'] >= TVL_FLOOR], 'rejected': len(parsed) - len(valid),
            'mismatched': len(valid) - len(matching),
            'end': len(lp) < PAGE or not valid or valid[-1]['tvl'] < TVL_FLOOR}


def merge(pages):
    """The pages of one read as one projection, a pool once however many pages it moved across between requests. An
    answer with no pool over the floor is refused: an empty complete scope would tell core every pool is gone."""
    rows = {}
    for found in pages:
        for row in found['rows']:
            rows.setdefault(row['pool'], row)
    rows = list(rows.values())
    if not rows:
        raise ValueError('invalid_response')
    return {'rows': rows, 'rejected': sum(found['rejected'] for found in pages),
            'mismatched': sum(found['mismatched'] for found in pages),
            'unkeyed': sum(coin['key'] is None for row in rows for coin in row['coins']), 'capped': not pages[-1]['end']}


def _ref(scope, native_id):
    return {'provider': PROVIDER, 'native_scope': scope, 'native_id': native_id}


def page(scope, projection, cursor, observed_at):
    """One page of a scope: (ClaimBatch wire form, next cursor).

    Pools are ordered by object id and the cursor is the last id a page emitted, so a sync whose snapshot is refreshed
    between pages never skips a pool both snapshots hold; the last page is `complete`."""
    provenance = {'plugin': PLUGIN, 'source': PROVIDER, 'adapter_version': ADAPTER_VERSION,
                  'retrieved_at': observed_at, 'source_record': ORIGINS[0] + '/v2/sui/stats_pools'}
    claims, following = [], None
    if scope == 'protocols':
        claims = [{'level': 'protocol', 'identifiers': [{'scheme': 'sui_package', 'value': PACKAGE}],
                   'native_ref': _ref('protocol', PROTOCOL_ID),
                   'attributes': {'name': PROTOCOL_NAME, 'status': 'active', 'aliases': ['Cetus']},
                   'provenance': provenance}]
    else:
        labels = {coin['key']: coin['symbol'] for row in reversed(projection['rows']) for coin in row['coins']
                  if coin['key']}  # the symbol of the coin's largest pool
        rows, emitted = sorted(projection['rows'], key=lambda row: row['pool']), set()
        for index in range(bisect_right([row['pool'] for row in rows], cursor) if cursor else 0, len(rows)):
            own = _pool_claims(rows[index], emitted, labels, provenance)
            if claims and len(claims) + len(own) > PAGE_CLAIMS:
                following = rows[index - 1]['pool']
                break
            claims.extend(own)
            emitted.update(coin['key'] for coin in rows[index]['coins'] if coin['key'])
    batch = {'plugin': PLUGIN, 'provider': PROVIDER, 'adapter_version': ADAPTER_VERSION, 'origin': 'catalogue',
             'scope': scope, 'complete': following is None, 'claims': claims}
    return batch, following


def _pool_claims(row, emitted, labels, provenance):
    """A pool's record, the token records this page has not emitted yet, and its relations."""
    pool = _ref('pool', row['pool'])
    base, quote = row['coins']
    record = {'level': 'market', 'identifiers': [{'scheme': 'sui_object', 'value': row['pool']}], 'native_ref': pool,
              'attributes': {'name': f"Cetus {base['symbol']}/{quote['symbol']} {row['fee']}%", 'asset_class': 'crypto',
                             'status': 'inactive' if row['inactive'] else 'active', 'rank': {'tvl_usd': row['tvl']}},
              'provenance': provenance}
    tokens, relations = [], [{'type': 'part_of', 'from_key': pool, 'to_key': _ref('protocol', PROTOCOL_ID),
                              'provenance': provenance}]
    for role, coin in (('base', base), ('quote', quote)):
        if coin['key']:
            if coin['key'] not in emitted:
                tokens.append({'level': 'listing', 'identifiers': [{'scheme': 'caip19', 'value': coin['key']}],
                               'attributes': {'asset_class': 'crypto', 'name': labels[coin['key']][:512]},
                               'provenance': provenance})
            relations.append({'type': 'market_asset', 'from_key': pool,
                              'to_key': {'scheme': 'caip19', 'value': coin['key']}, 'role': role,
                              'provenance': provenance})
    return [record, *tokens, *relations]
