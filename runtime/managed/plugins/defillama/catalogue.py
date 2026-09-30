"""DefiLlama protocols and yield pools as identity claim batches (ADR 0038, contract version 2).

The plugin describes DefiLlama's own records; core's ingest joins or introduces the subjects they name.

- A protocol is a `protocol` keyed by DefiLlama's protocol `id`. DefiLlama documents no stability for either id or
  slug, but its `slug` follows renames (2026-09-30: all 196 protocols listing previous names sit under their new
  slug) while ids were observed to survive them. The slug only joins a pool to its protocol here.
- A pool is a `market` keyed by its pool UUID, `part_of` its protocol and `market_asset` of each Sui coin type it
  holds. Pools on other chains carry no token links yet.
- A Sui coin type is a token deployment, a `listing` keyed by CAIP-19 in Pythia's Sui profile (ADR 0037): two coin
  types are two subjects whatever their symbols. A generic type or one past CAIP-19's 128 characters has no CAIP-19
  key; it is left out, since core refuses a batch with a malformed identifier.
"""
from bisect import bisect_right
from collections import Counter
import re
from urllib.parse import unquote

PROVIDER, PLUGIN, ADAPTER_VERSION = 'defillama', 'pythia-defillama', '1'
URLS = {'protocols': 'https://api.llama.fi/protocols', 'pools': 'https://yields.llama.fi/pools'}
ORIGINS = ('https://api.llama.fi', 'https://yields.llama.fi')
DEFAULT_CHAINS = frozenset({'sui'})  # `defillama_chains` unset or empty; `all` means every chain
EVERY_CHAIN = 'all'
PAGE_CLAIMS = 2000                   # well under core's 5,000 claims a batch
MAX_ROWS = 100_000
UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\Z')
SUI = 'sui'                          # DefiLlama's chain name, casefolded


def chains(value):
    """The `defillama_chains` setting as casefolded chain names, or None for every chain: DefiLlama chain names as a
    list or comma-separated text. Unset, empty or null is the default, Sui; `all` means every chain."""
    items = [] if value is None else value.split(',') if isinstance(value, str) else value
    if not isinstance(items, (list, tuple)) or not all(isinstance(item, str) for item in items):
        raise ValueError('invalid_configuration')
    names = frozenset(item.strip().casefold() for item in items if item.strip()) or DEFAULT_CHAINS
    return None if EVERY_CHAIN in names else names


def unknown_chains(protocols, pools, wanted):
    """The wanted chains no pool and no protocol is on, sorted."""
    if wanted is None:
        return []
    known = {row['chain'].casefold() for row in pools['rows']}
    known |= {name.casefold() for row in protocols['rows'] for name in row['chains']}
    return sorted(wanted - known)


def sui_caip19(coin_type):
    """A Sui coin type as CAIP-19 in the form core joins on (`pythia_platform.identifiers`, ADR 0037), or None when it
    has no key: a generic type, or one past CAIP-19's 128 characters."""
    from pythia_platform import identifiers  # published by core, which registers before this plugin
    try:
        return identifiers.normalize_identifier('caip19', f'sui:mainnet/coin:{coin_type}')
    except identifiers.IdentifierError:
        return None


def _text(value, maximum=512):
    return (isinstance(value, str) and 0 < len(value) <= maximum and value == value.strip()
            and not any(ord(char) < 32 or ord(char) == 127 for char in value))


def _rows(data, parse):
    if not isinstance(data, list) or len(data) > MAX_ROWS:
        raise ValueError('invalid_response')
    parsed = [parse(item) if isinstance(item, dict) else None for item in data]
    rows = [row for row in parsed if row is not None]
    return {'rows': rows, 'rejected': len(parsed) - len(rows)}


def _protocol(item):
    names = item.get('chains')
    if not (_text(item.get('id'), 120) and _text(item.get('slug'), 200) and _text(item.get('name'), 2000)
            and isinstance(names, list) and all(isinstance(name, str) for name in names)):
        return None
    return {'id': item['id'], 'slug': item['slug'], 'name': item['name'][:512], 'chains': names,
            'inactive': bool(item.get('deadFrom')) or item.get('deprecated') is True}


def _pool(item):
    tokens, tvl = item.get('underlyingTokens') or [], item.get('tvlUsd')
    if not (isinstance(item.get('pool'), str) and UUID.match(item['pool']) and _text(item.get('chain'), 120)
            and _text(item.get('project'), 200) and _text(item.get('symbol'), 2000)
            and (item.get('poolMeta') is None or isinstance(item['poolMeta'], str))
            and isinstance(tokens, list) and all(isinstance(token, str) for token in tokens)):
        return None
    return {'pool': item['pool'], 'chain': item['chain'], 'project': item['project'], 'symbol': item['symbol'],
            'meta': (item.get('poolMeta') or '').strip()[:120] or None, 'tokens': tokens[:32],
            'tvl': tvl if type(tvl) in (int, float) else None}


def protocol_rows(data):
    """`/protocols` projected to what the catalogue keeps; malformed records counted, never coerced."""
    return _rows(data, _protocol)


def pool_rows(data):
    """`/pools` projected to what the catalogue keeps; malformed records counted, never coerced."""
    if not isinstance(data, dict) or data.get('status') != 'success':
        raise ValueError('invalid_response')
    return _rows(data.get('data'), _pool)


def _ref(scope, native_id):
    return {'provider': PROVIDER, 'native_scope': scope, 'native_id': native_id}


def page(scope, protocols, pools, wanted, cursor, observed_at):
    """One page of a scope over the chains `wanted` (None: all): (ClaimBatch wire form, next cursor).

    Rows are ordered by their native id and the cursor is the last id a page emitted, so a sync whose snapshot is
    refreshed between pages never skips a row both snapshots hold; the last page is `complete`. The protocols are
    those listing a wanted chain or running a pool on one, so every pool's `part_of` names a protocol the
    `protocols` scope introduces."""
    held = sorted((row for row in pools['rows'] if wanted is None or row['chain'].casefold() in wanted),
                  key=lambda row: row['pool'])
    projects = {row['project'] for row in held}
    listed = sorted((row for row in protocols['rows'] if wanted is None or row['slug'] in projects
                     or any(name.casefold() in wanted for name in row['chains'])), key=lambda row: row['id'])
    provenance = {'plugin': PLUGIN, 'source': PROVIDER, 'adapter_version': ADAPTER_VERSION,
                  'retrieved_at': observed_at, 'source_record': URLS[scope]}
    rows, key = (listed, 'id') if scope == 'protocols' else (held, 'pool')
    start = bisect_right([row[key] for row in rows], cursor) if cursor else 0
    if scope == 'pools':
        slugs = {}
        for row in listed:
            slugs.setdefault(row['slug'], []).append(row)
        owners = {slug: found[0] for slug, found in slugs.items() if len(found) == 1}
        labels = _labels(held)
    claims, emitted, following = [], set(), None
    for index in range(start, len(rows)):
        row = rows[index]
        if scope == 'protocols':
            own = [{'level': 'protocol', 'identifiers': [], 'native_ref': _ref('protocol', row['id']),
                    'attributes': {'name': row['name'], 'status': 'inactive' if row['inactive'] else 'active'},
                    'provenance': provenance}]
        else:
            own = _pool_claims(row, owners.get(row['project']), emitted, labels, provenance)
        if claims and len(claims) + len(own) > PAGE_CLAIMS:
            following = rows[index - 1][key]
            break
        claims.extend(own)
        emitted.update(_held(row) if scope == 'pools' else ())
    batch = {'plugin': PLUGIN, 'provider': PROVIDER, 'adapter_version': ADAPTER_VERSION, 'origin': 'catalogue',
             'scope': scope, 'complete': following is None, 'claims': claims}
    return batch, following


def _held(row):
    """The CAIP-19 keys of the Sui coin types a pool holds, in the source's order, without repeats."""
    if row['chain'].casefold() != SUI:
        return []
    return list(dict.fromkeys(key for key in map(sui_caip19, row['tokens']) if key))


def _labels(pools):
    """A label per coin type from the symbols of pools that hold only it. Protocols name one coin differently
    ("SBUSDT", "SUIUSDT", "USDT"), so the coin type's own struct name wins where a pool uses it, else the most common
    symbol; a coin no single-asset pool holds has none. A label is never evidence."""
    symbols = {}
    for row in pools:
        keys = _held(row)
        if len(keys) == 1 and '-' not in row['symbol']:
            symbols.setdefault(keys[0], Counter())[row['symbol'][:512]] += 1
    labels = {}
    for key, counts in symbols.items():
        own = unquote(key).rsplit('::', 1)[-1] if '/coin:' in key else 'SUI'
        named = [symbol for symbol in counts if symbol.upper() == own.upper()]
        labels[key] = named[0] if named else min(counts, key=lambda symbol: (-counts[symbol], symbol))
    return labels


def _pool_claims(row, protocol, emitted, labels, provenance):
    """A pool's record, the token records this page has not emitted yet, and its relations."""
    pool = _ref('pool', row['pool'])
    name = f"{protocol['name'] if protocol else row['project']} {row['symbol']}"
    attributes = {'name': (f"{name} ({row['meta']})" if row['meta'] else name)[:512], 'asset_class': 'crypto',
                  'status': 'active', **({'rank': {'tvl_usd': row['tvl']}} if row['tvl'] is not None else {})}
    held = _held(row)
    tokens = [{'level': 'listing', 'identifiers': [{'scheme': 'caip19', 'value': key}],
               'attributes': {'asset_class': 'crypto', **({'name': labels[key]} if key in labels else {})},
               'provenance': provenance} for key in held if key not in emitted]
    relations = [{'type': 'part_of', 'from_key': pool, 'to_key': _ref('protocol', protocol['id']),
                  'provenance': provenance}] if protocol else []
    relations += [{'type': 'market_asset', 'from_key': pool, 'to_key': {'scheme': 'caip19', 'value': key},
                   'provenance': provenance} for key in held]
    record = {'level': 'market', 'identifiers': [], 'native_ref': pool, 'attributes': attributes,
              'provenance': provenance}
    return [record, *tokens, *relations]
