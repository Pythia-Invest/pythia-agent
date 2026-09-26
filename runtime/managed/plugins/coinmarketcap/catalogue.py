"""Catalogue pages: active coins with identifiers and CoinMarketCap rank signals.

Sources (checked 2026-09-25): /v1/cryptocurrency/map (no credits; id, rank,
name, symbol, slug, is_active, platform) and /v3/cryptocurrency/listings/latest
(one credit per 200 rows; market cap). Pages follow the permanent coin ID, so
offsets stay stable while ranks move. A coin activated or retired during a sync
can shift one row; the next sync repairs that drift. Rows are source-asserted
identifiers and rank signals, never matches with another provider.
"""
from decimal import Decimal, InvalidOperation

from .identity import identifiers, map_platform, native, row_id, text
from .series import currency_quote, timestamp

SCOPE = 'coins'
# Market caps for the top coins only: ranking needs the head of the list, and
# the map already carries CoinMarketCap's rank for every active coin.
RANK_DEPTH = 500
RETENTION = {'mode': 'persistent', 'max_age_seconds': 86400}


def market_caps(rows, currency):
    """Market cap by coin ID from one listings read; missing values stay unknown."""
    if not isinstance(rows, list) or len(rows) > RANK_DEPTH:
        raise ValueError('invalid_response')
    result = {}
    for row in rows:
        identifier = row_id(row)
        quote = currency_quote(row, currency)
        if quote.get('market_cap') is None:
            continue
        try:
            value = Decimal(str(quote['market_cap']))
        except InvalidOperation:
            raise ValueError('invalid_response') from None
        if not value.is_finite() or value < 0 or identifier in result:
            raise ValueError('invalid_response')
        observed = quote.get('last_updated')
        result[identifier] = {'value': format(value, 'f'), 'currency': currency,
                              'observed_at': observed if timestamp(observed) is not None else None}
    return result


def page(map_rows, offset, limit, caps, retrieved_at, currency):
    """One page of typed rows; `caps` is None when the listings read failed."""
    if not isinstance(map_rows, list) or len(map_rows) > limit:
        raise ValueError('invalid_response')
    rows, seen = [], set()
    for row in map_rows:
        identifier = row_id(row)
        name = text(row.get('name'), 256)
        rank = row.get('rank')
        if (identifier in seen or name is None
                or (rank is not None and (type(rank) is not int or rank < 1))):
            raise ValueError('invalid_response')
        seen.add(identifier)
        rows.append({'native_ref': native(identifier), 'level': 'crypto', 'asset_class': 'crypto',
                     'status': 'active' if row.get('is_active') == 1 else 'inactive',
                     'name': name, 'symbol': text(row.get('symbol'), 64),
                     'identifiers': identifiers(row, map_platform(row)),
                     'rank': {'cmc_rank': rank, 'market_cap': (caps or {}).get(identifier)}})
    return {'scope': SCOPE, 'rows': rows, 'next_cursor': str(offset + len(rows)) if len(rows) == limit else None,
            'retrieved_at': retrieved_at, 'retention': RETENTION,
            'rank_signals': {'cmc_rank': 'available', 'market_cap': 'unavailable' if caps is None else 'available',
                             'market_cap_depth': RANK_DEPTH, 'currency': currency}}
