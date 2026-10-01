"""Sui's chain as identity claim batches (ADR 0038, contract version 2). The plugin states what the chain proves.

Three scopes, in the order core's sync pages them:

- `protocols`: one `protocol` per entry of `protocols.PROTOCOLS`, keyed by `sui_package`, the ORIGINAL package id of its main
  family, which the chain confirmed on this read (`package(address: id, version: 1)`). Other families are aliases.
- `tokens`: a `listing` per coin type, keyed by CAIP-19 in core's Sui profile, named from on-chain `CoinMetadata` (registry
  `0xc` or legacy). A coin the Sui Bridge treasury supports, or Wormhole's Token Bridge wrapped, says so in its name and in
  its provenance record, which points at the registry entry that proves it; the relation and attribute slots have no place
  for an origin (`bridged_from` links securities, not deployments), so this is the honest form. `rank.supply` is the coin's
  minted-less-burned supply where a readable TreasuryCap or the registry gives it (a stop-gap: `rank` is the one numeric slot).
  The coins are the seed list plus those the chain-read markets hold.
- `markets`: a `market` per DeepBook V3 pool above the dust floor, AlphaLend reserve and Bucket vault, keyed by `sui_object`,
  `part_of` its protocol and `market_asset` of each coin it holds with the role the chain gives it.
"""
from collections import Counter, defaultdict

from . import alphalend, bucket, deepbook, protocols
from .chain import WORMHOLE_CHAINS, WORMHOLE_STATE, coin_type, label
from .seed import SEED

PROVIDER, PLUGIN, ADAPTER_VERSION = 'sui', 'pythia-sui', '1'
SCOPES = ('protocols', 'tokens', 'markets')
PAGE_COINS, PAGE_MARKETS = 25, 200  # markets: about 6 claims each, well under core's 5,000 a batch
SOURCES = (deepbook.pools, alphalend.reserves, bucket.vaults)


def market_rows(chain, verified):
    """(rows, found): every chain-read market of a protocol the chain confirmed. A market of one it did not is counted in
    `unverified` and left out, so a `part_of` never names a protocol the read could not vouch for."""
    rows, found = [], Counter()
    for source in SOURCES:
        more, counts = source(chain)
        rows += more
        found.update(counts)
    kept = [row for row in rows if row['protocol'] in verified]
    found['unverified'] = len(rows) - len(kept)
    return sorted(kept, key=lambda row: row['object']), found


def keyed(coin):
    """A coin type core can key: plain and accepted by the CAIP-19 Sui profile."""
    from pythia_platform import identifiers  # published by core, which registers before this plugin
    return coin_type(coin) == coin and identifiers.sui_caip19(coin) is not None


def universe(rows):
    """Every coin type the tokens scope lists: the seed list and the coins the chain-read markets hold, sorted."""
    coins = {coin_type(coin) for coins in SEED.values() for coin in coins}
    coins |= {coin for row in rows for coin, _role in row['assets']}
    return sorted(coin for coin in coins if coin and keyed(coin))


def window(keys, cursor, size):
    """(one page of the sorted keys after `cursor` as a set-like list, the cursor of the next page or None). The cursor is
    the last key a page emitted, so a sync whose reads refresh between pages skips nothing both reads hold."""
    rest = [key for key in keys if cursor is None or key > cursor]
    return rest[:size], rest[size - 1] if len(rest) > size else None


def _ref(scope, native_id):
    return {'provider': PROVIDER, 'native_scope': scope, 'native_id': native_id}


def page(chain, scope, cursor):
    """One page of a scope: (ClaimBatch wire form, next cursor, what the read should warn about). `found` counts what
    the read could not vouch for; the protocols the chain did not confirm are listed by name."""
    verified, found = protocols.resolved(chain)
    if not verified:
        raise ValueError('invalid_response')  # likewise every protocol
    found, following = defaultdict(int, found), None
    if scope == 'protocols':
        claims = _protocols(chain, verified)
    else:
        rows, more = market_rows(chain, verified)
        found.update(more)
        if scope == 'markets' and not rows:
            raise ValueError('invalid_response')  # an empty complete scope would tell core every market is gone
        if scope == 'markets':
            chosen, following = window([row['object'] for row in rows], cursor, PAGE_MARKETS)
            claims = _markets(chain, [row for row in rows if row['object'] in chosen], found)
        else:
            coins, following = window(universe(rows), cursor, PAGE_COINS)
            claims = _tokens(chain, coins, found)
    batch = {'plugin': PLUGIN, 'provider': PROVIDER, 'adapter_version': ADAPTER_VERSION, 'origin': 'catalogue',
             'scope': scope, 'complete': following is None, 'claims': claims}
    return batch, following, found


def _provenance(chain, record=None, version=None):
    return {'plugin': PLUGIN, 'source': PROVIDER, 'adapter_version': ADAPTER_VERSION, 'retrieved_at': chain.observed_at,
            **({'source_record': record} if record else {}), **({'source_version': version} if version else {})}


def _protocols(chain, verified):
    return [{'level': 'protocol', 'identifiers': [{'scheme': 'sui_package', 'value': original}],
             'native_ref': _ref('protocol', original),
             'attributes': {'name': row['name'], 'status': 'active', 'aliases': row['others']},
             'provenance': _provenance(chain, f'package {original}', f"{row['latest']}@v{row['version']}")}
            for original, row in sorted(verified.items())]


def _origin(coin, bridge, wormhole):
    """How the chain proves a coin bridged, as (name suffix, provenance record), or None for a coin it does not."""
    if coin in wormhole:
        origin, origin_address = wormhole[coin]
        where = WORMHOLE_CHAINS.get(origin, f'chain {origin}')
        return (f'Wormhole, from {where}', f'wormhole {WORMHOLE_STATE} token_registry WrappedAsset<{coin}> '
                                           f'from chain {origin} (Wormhole id) address 0x{origin_address}')
    if coin in bridge:
        return 'Sui Bridge', f'sui bridge 0x9 supported_tokens id {bridge[coin]} for {coin}'
    return None


def _tokens(chain, coins, found):
    from pythia_platform import identifiers  # published by core, which registers before this plugin
    described = chain.metadata(coins)
    bridge, wormhole = chain.sui_bridge(), chain.wormhole(coins)
    claims = []
    for coin in coins:
        meta, origin = described[coin], _origin(coin, bridge, wormhole)
        found['no_metadata_coins'] += meta is None
        name = meta and meta['name'] or meta and meta['symbol']
        shown = f'{name} ({origin[0]})' if name and origin and origin[0].split(',')[0] not in name else name
        attributes = {'asset_class': 'crypto', 'status': 'active', **({'name': shown[:512]} if name else {}),
                      **({'aliases': [meta['symbol']]} if meta and meta['symbol'] != name else {}),
                      **({'rank': {'supply': meta['supply']}} if meta and meta['supply'] is not None else {})}
        claims.append({'level': 'listing', 'identifiers': [{'scheme': 'caip19', 'value': identifiers.sui_caip19(coin)}],
                       'attributes': attributes,
                       'provenance': _provenance(chain, origin[1] if origin else f'coinMetadata {coin}')})
    return claims


def _markets(chain, rows, found):
    from pythia_platform import identifiers  # published by core, which registers before this plugin
    coins = {coin for row in rows for coin, _role in row['assets'] if coin_type(coin) == coin}
    described, claims = chain.metadata(sorted(coins)), []
    for row in rows:
        symbols = [(described.get(coin) or {}).get('symbol') or label(coin) for coin, _role in row['assets']]
        ref, key = _ref('market', row['object']), {'scheme': 'sui_object', 'value': row['object']}
        provenance = _provenance(chain, f"object {row['object']}")
        claims += [{'level': 'market', 'identifiers': [key], 'native_ref': ref, 'provenance': provenance,
                    'attributes': {'name': row['name'].format(*symbols)[:512], 'asset_class': 'crypto',
                                   'status': row['status']}},
                   {'type': 'part_of', 'from_key': key, 'to_key': {'scheme': 'sui_package', 'value': row['protocol']},
                    'provenance': provenance}]
        for coin, role in row['assets']:
            token = identifiers.sui_caip19(coin) if coin_type(coin) == coin else None
            found['unkeyed_coin_type'] += token is None
            if token:
                claims.append({'type': 'market_asset', 'from_key': key, 'to_key': {'scheme': 'caip19', 'value': token},
                               'role': role, 'provenance': provenance})
    return claims
