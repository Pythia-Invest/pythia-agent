"""DeepBook V3 pools as identity claim batches (ADR 0038, contract version 2).

The plugin describes the indexer's own records; core's ingest joins or introduces the subjects they name.

- DeepBook V3 is one `protocol`, keyed by the original package id of its `pool::Pool<Base, Quote>` type (`sui_package`).
- A pool (an order book) is a `market` keyed by its object id (`sui_object`, also its native reference), `part_of` the
  protocol, with `market_asset` edges to its `base` and `quote` coin, both real roles here.
- Fees, tick, lot and minimum size are not stated: governance changes them, and the indexer's own copies go stale.
"""
from collections import Counter

PROVIDER, PLUGIN, ADAPTER_VERSION = 'deepbook', 'pythia-deepbook', '1'
PROTOCOL_ID, PROTOCOL_NAME = 'deepbook-v3', 'DeepBook V3'
PACKAGE = '0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963357661df5d3204809'  # original package of `pool::Pool<B, Q>`
ORIGINS = ('https://deepbook-indexer.mainnet.mystenlabs.com',)
URL = ORIGINS[0] + '/get_pools'
MAX_ROWS = 1000


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


def _pool(item):
    pool = normalized('sui_object', item.get('pool_id'))
    if not (pool and _text(item.get('pool_name'), 60) and _text(item.get('base_asset_symbol'))
            and _text(item.get('quote_asset_symbol'))):
        return None
    return {'pool': pool, 'name': item['pool_name'],
            'coins': [{'symbol': item[prefix + '_asset_symbol'], 'key': sui_caip19(item.get(prefix + '_asset_id'))}
                      for prefix in ('base', 'quote')]}


def pool_rows(data):
    """`/get_pools` projected to what the catalogue keeps, with the drift counted: records left out as malformed or
    sharing a pool object id (two records for one id name no one pool, so neither is kept), and coins with no CAIP-19
    key. Nothing is coerced. An answer of another shape, or with no pool, is refused: an empty complete scope would
    tell core every pool is gone."""
    if not isinstance(data, list) or len(data) > MAX_ROWS:
        raise ValueError('invalid_response')
    parsed = [_pool(item) if isinstance(item, dict) else None for item in data]
    valid = [row for row in parsed if row is not None]
    counts = Counter(row['pool'] for row in valid)
    rows = [row for row in valid if counts[row['pool']] == 1]
    if not rows:
        raise ValueError('invalid_response')
    return {'rows': rows, 'rejected': len(parsed) - len(valid), 'duplicated': len(valid) - len(rows),
            'unkeyed': sum(coin['key'] is None for row in rows for coin in row['coins'])}


def _ref(scope, native_id):
    return {'provider': PROVIDER, 'native_scope': scope, 'native_id': native_id}


def page(scope, projection, observed_at):
    """A scope's one batch in ClaimBatch wire form: 26 pools, well under core's 5,000 claims a batch."""
    provenance = {'plugin': PLUGIN, 'source': PROVIDER, 'adapter_version': ADAPTER_VERSION,
                  'retrieved_at': observed_at, 'source_record': URL}
    claims = []
    if scope == 'protocols':
        claims = [{'level': 'protocol', 'identifiers': [{'scheme': 'sui_package', 'value': PACKAGE}],
                   'native_ref': _ref('protocol', PROTOCOL_ID),
                   'attributes': {'name': PROTOCOL_NAME, 'status': 'active', 'aliases': ['DeepBook']},
                   'provenance': provenance}]
    else:
        labels, emitted = {}, set()
        for row in projection['rows']:
            for coin in row['coins']:
                if coin['key']:
                    labels.setdefault(coin['key'], coin['symbol'])
        for row in sorted(projection['rows'], key=lambda row: row['pool']):
            claims.extend(_pool_claims(row, emitted, labels, provenance))
    return {'plugin': PLUGIN, 'provider': PROVIDER, 'adapter_version': ADAPTER_VERSION, 'origin': 'catalogue',
            'scope': scope, 'complete': True, 'claims': claims}


def _pool_claims(row, emitted, labels, provenance):
    """A pool's record, the token records not emitted yet, and its relations."""
    pool = _ref('pool', row['pool'])
    record = {'level': 'market', 'identifiers': [{'scheme': 'sui_object', 'value': row['pool']}], 'native_ref': pool,
              'attributes': {'name': f"DeepBook {row['name']}", 'asset_class': 'crypto', 'status': 'active'},
              'provenance': provenance}
    tokens, relations = [], [{'type': 'part_of', 'from_key': pool, 'to_key': _ref('protocol', PROTOCOL_ID),
                              'provenance': provenance}]
    for role, coin in zip(('base', 'quote'), row['coins']):
        if coin['key']:
            if coin['key'] not in emitted:
                emitted.add(coin['key'])
                tokens.append({'level': 'listing', 'identifiers': [{'scheme': 'caip19', 'value': coin['key']}],
                               'attributes': {'asset_class': 'crypto', 'name': labels[coin['key']][:512]},
                               'provenance': provenance})
            relations.append({'type': 'market_asset', 'from_key': pool,
                              'to_key': {'scheme': 'caip19', 'value': coin['key']}, 'role': role,
                              'provenance': provenance})
    return [record, *tokens, *relations]
