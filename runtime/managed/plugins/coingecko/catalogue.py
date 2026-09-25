"""Pages over one native active-coin snapshot, never identity adoption.

Sources (checked 2026-09-25): docs.coingecko.com/reference/coins-list with
include_platform=true, /coins/markets and /asset_platforms. The list has no
pagination or market-cap order. Rows carry source-asserted identifiers only;
joining them to subjects, CAIP-19 derivation and ranking belong to the core.
"""
from .identity import reference

# CoinGecko API Terms 6.1.1: a cache must be refreshed at least every 24 hours.
RETENTION = {'mode': 'persistent', 'max_age_seconds': 86400}


def identifiers(coin, symbol, pairs, chains):
    values = [{'scheme': 'coingecko.id', 'value': coin, 'authority': 'source_asserted'}]
    if symbol:
        # A display label: never cross-coin or cross-provider proof.
        values.append({'scheme': 'symbol', 'value': symbol, 'authority': 'source_asserted'})
    for network, address in pairs:
        item = {'scheme': 'contract_address', 'value': address, 'network': network, 'authority': 'source_asserted'}
        if type(chains.get(network)) is int:
            item['chain_identifier'] = chains[network]
        values.append(item)
    return values


def page(snapshot, arguments):
    if (not isinstance(snapshot, dict) or not isinstance(snapshot.get('rows'), list)
            or len(snapshot['rows']) > 100000 or not isinstance(snapshot.get('version'), str)
            or len(snapshot['version']) != 64 or not isinstance(snapshot.get('retrieved_at'), str)):
        raise ValueError('invalid_response')
    offset, limit = int(arguments.get('cursor', '0')), arguments.get('limit', 1000)
    if offset > len(snapshot['rows']):
        raise ValueError('invalid_request')
    ranks, chains = snapshot.get('ranks', {}), snapshot.get('chains', {})
    if not isinstance(ranks, dict) or not isinstance(chains, dict):
        raise ValueError('invalid_response')
    rows = []
    for row in snapshot['rows'][offset:offset + limit]:
        if not isinstance(row, list) or len(row) != 4 or not isinstance(row[3], list):
            raise ValueError('invalid_response')
        coin, symbol, name, pairs = row
        native = {'provider': 'coingecko', 'native_scope': 'coin', 'native_id': coin}
        reference(native)
        if (any(not isinstance(value, str) or len(value) > 512 for value in (symbol, name)) or not name
                or any(not isinstance(pair, list) or len(pair) != 2 or not all(isinstance(v, str) and v for v in pair)
                       for pair in pairs)):
            raise ValueError('invalid_response')
        item = {'provider_ref': native, 'level': 'crypto', 'asset_class': 'crypto', 'status': 'active',
                'name': name, 'symbol': symbol or None, 'identifiers': identifiers(coin, symbol, pairs, chains)}
        signal = ranks.get(coin)
        if isinstance(signal, dict):
            rank, cap = signal.get('rank'), signal.get('market_cap')
            item['rank'] = {'market_cap_rank': rank if type(rank) is int and rank > 0 else None,
                            'market_cap': {'value': cap, 'currency': 'USD'} if isinstance(cap, str) else None,
                            'observed_at': snapshot['rank_observed_at'], 'time_basis': 'retrieval',
                            'source_url': snapshot['rank_source_url']}
        rows.append(item)
    end = offset + len(rows)
    return {'rows': rows, 'scope': 'coins', 'version': snapshot['version'], 'total': len(snapshot['rows']),
            'next_cursor': str(end) if end < len(snapshot['rows']) else None,
            'complete': True, 'retrieved_at': snapshot['retrieved_at'], 'retention': RETENTION,
            'rank_coverage': snapshot.get('rank_coverage', 'unavailable'),
            'chain_coverage': snapshot.get('chain_coverage', 'unavailable'),
            'source_url': snapshot.get('source_url', 'https://api.coingecko.com/api/v3/coins/list?include_platform=true')}
