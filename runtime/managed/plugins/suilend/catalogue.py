"""Suilend's lending markets as identity claim batches (ADR 0038, contract version 2).

The plugin describes Suilend's own records; core's ingest joins or introduces the subjects they name.

- Suilend is one `protocol`, keyed by the original package id of its `LendingMarket<P>` type (`sui_package`).
- A market (Main Market, an isolated market: a separate risk silo) is a `market` keyed by its `LendingMarket` object id
  (`sui_object`, also its native reference), `part_of` the protocol, with a `market_asset` edge of role `supply` to each
  coin it lists a reserve for. A reserve is a field inside the market object, not an object, and the API names no id
  for it, so the market is the subject and its reserves are its edges. Whether a reserve can be borrowed or posted as
  collateral is reserve configuration the API does not carry, so no such role is stated.
- The API names no coin (only coin types), so the plugin introduces no token: a link lands on a token another source holds.
- Prices are never stated. Suilend's on-chain reserve price is a placeholder for some reserves (a raw sum of main market
  supply reads US$1.9 trillion); the plugin reads none of it, and asks Suilend's own price service only to alarm on a
  listed coin that has no usable price there.
"""
from collections import Counter
import re

PROVIDER, PLUGIN, ADAPTER_VERSION = 'suilend', 'pythia-suilend', '1'
PROTOCOL_ID, PROTOCOL_NAME = 'suilend', 'Suilend'
PACKAGE = '0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf'  # original package of `LendingMarket<P>`
ORIGINS = ('https://lending.api.sui-prod.bluefin.io',)
MARKETS_URL = ORIGINS[0] + '/markets'
PRICES_URL = ORIGINS[0] + '/proxy/prices?addresses='  # coin types follow, comma-separated
PRICE_CHUNK = 50                # coin types a price request names (about 4 KB of URL; the transport allows 8 KB)
MAX_ROWS = 200
COIN_TYPE = re.compile(r'^0x[0-9a-f]{1,64}::[A-Za-z_]\w{0,63}::[A-Za-z_]\w{0,63}\Z')


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


def _market(item):
    market, coins = normalized('sui_object', item.get('id')), item.get('reserveOrder')
    if not (market and _text(item.get('name'), 60) and isinstance(item.get('isHidden'), bool)
            and (coins is None or (isinstance(coins, list) and all(isinstance(coin, str) for coin in coins)))):
        return None
    return {'market': market, 'name': item['name'], 'hidden': item['isHidden'], 'listed': coins is not None,
            'coins': list(dict.fromkeys(coins or []))}


def market_rows(data):
    """`/markets` projected to what the catalogue keeps, with the drift counted: records left out as malformed or
    sharing an object id (two records for one id name no one market, so neither is kept), markets whose reserves the
    API does not list (two of the seven today), and coin types with no CAIP-19 key. Nothing is coerced. An answer of
    another shape, or with no market, is refused: an empty complete scope would tell core every market is gone."""
    if not isinstance(data, list) or len(data) > MAX_ROWS:
        raise ValueError('invalid_response')
    parsed = [_market(item) if isinstance(item, dict) else None for item in data]
    valid = [row for row in parsed if row is not None]
    counts = Counter(row['market'] for row in valid)
    rows = [row for row in valid if counts[row['market']] == 1]
    if not rows:
        raise ValueError('invalid_response')
    keys = {coin: sui_caip19(coin) for row in rows for coin in row['coins']}
    return {'rows': rows, 'keys': keys, 'rejected': len(parsed) - len(valid), 'duplicated': len(valid) - len(rows),
            'unlisted': sum(not row['listed'] for row in rows), 'unkeyed': sum(key is None for key in keys.values())}


def price_requests(projection):
    """(URL, coin types asked) for the price service, each request under the URL limit."""
    coins = sorted(coin for coin in projection['keys'] if COIN_TYPE.match(coin))
    return [(PRICES_URL + ','.join(chunk), chunk) for chunk in (coins[index:index + PRICE_CHUNK]
                                                                for index in range(0, len(coins), PRICE_CHUNK))]


def _priced(entry):
    value = entry.get('value') if isinstance(entry, dict) else None
    return isinstance(value, (int, float)) and not isinstance(value, bool) and 0 < value < float('inf')


def unpriced(data, asked):
    """The coin types among `asked` with no usable price: absent from the answer or not a positive number."""
    found = data.get('data') if isinstance(data, dict) else None
    if not isinstance(found, dict):
        raise ValueError('invalid_response')
    return [coin for coin in asked if not _priced(found.get(coin))]


def _ref(scope, native_id):
    return {'provider': PROVIDER, 'native_scope': scope, 'native_id': native_id}


def page(scope, projection, observed_at):
    """A scope's one batch in ClaimBatch wire form: 7 markets, well under core's 5,000 claims a batch."""
    provenance = {'plugin': PLUGIN, 'source': PROVIDER, 'adapter_version': ADAPTER_VERSION,
                  'retrieved_at': observed_at, 'source_record': MARKETS_URL}
    claims = []
    if scope == 'protocols':
        claims = [{'level': 'protocol', 'identifiers': [{'scheme': 'sui_package', 'value': PACKAGE}],
                   'native_ref': _ref('protocol', PROTOCOL_ID),
                   'attributes': {'name': PROTOCOL_NAME, 'status': 'active'}, 'provenance': provenance}]
    else:
        for row in sorted(projection['rows'], key=lambda row: row['market']):
            market = _ref('market', row['market'])
            claims.append({'level': 'market', 'identifiers': [{'scheme': 'sui_object', 'value': row['market']}],
                           'native_ref': market, 'attributes': {
                               'name': f"{PROTOCOL_NAME} {row['name']}", 'asset_class': 'crypto',
                               'status': 'inactive' if row['hidden'] else 'active'}, 'provenance': provenance})
            claims.append({'type': 'part_of', 'from_key': market, 'to_key': _ref('protocol', PROTOCOL_ID),
                           'provenance': provenance})
            claims.extend({'type': 'market_asset', 'from_key': market,
                           'to_key': {'scheme': 'caip19', 'value': projection['keys'][coin]}, 'role': 'supply',
                           'provenance': provenance} for coin in row['coins'] if projection['keys'][coin])
    return {'plugin': PLUGIN, 'provider': PROVIDER, 'adapter_version': ADAPTER_VERSION, 'origin': 'catalogue',
            'scope': scope, 'complete': True, 'claims': claims}
