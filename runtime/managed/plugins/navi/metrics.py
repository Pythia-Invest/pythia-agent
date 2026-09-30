"""A NAVI reserve's metrics as core's metric rows (`core/identity/defi_metrics.py`, `fundamentals.metrics`).

Everything comes from the one `/api/navi/pools` answer the catalogue reads, read again fresh (NAVI caches it for a minute)
and projected here, apart from the catalogue's projection. Every row is `as_reported`: NAVI's own API, not the chain and
not a provider's standardisation. The answer states amounts in 1e-9 of the coin, interest accrued to the reserve's last
on-chain update, and rates as ray fractions (1e27 is 100% a year), before any incentive reward.

- supplied and borrowed: `totalSupplyAmount` and `borrowedAmount` at the reserve's own `oracle.price`.
- utilisation: borrowed over supplied, in coins; a reserve nobody supplied has none, not zero.
- supply and borrow rate: `currentSupplyRate` and `currentBorrowRate` as a yearly percentage, NAVI's base rate before
  the `*IncentiveApyInfo` rewards.
- `oracle.valid` is false for every reserve (35 of 35 in the main market, 2026-09-30), so it is not read as a gate.
- Every row is `as_of` the time the plugin read the answer; `updated_at` says when the reserve was last touched on chain.
"""
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, localcontext

from . import catalogue

BASIS = 'as_reported'
ROW = Decimal('0.000001')
SCALE, RAY_PERCENT, CEILING = Decimal(10) ** 9, Decimal(10) ** 25, Decimal(10) ** 30  # no coin amount or rate nears CEILING


def _decimal(value):
    """A non-negative finite decimal from NAVI's string, or None. The projection keeps the string itself (it is cached
    as JSON); a row works it in Decimal."""
    try:
        number = Decimal(value) if isinstance(value, str) else None
    except InvalidOperation:
        return None
    return number if number is not None and number.is_finite() and 0 <= number < CEILING else None


def _updated(value):
    """The reserve's last on-chain update, an ISO time, or None."""
    try:
        return datetime.fromtimestamp(int(value) / 1000, timezone.utc).isoformat()
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def _figures(item):
    contract, token = item.get('contract'), item.get('token')
    oracle = item.get('oracle')
    if not (isinstance(contract, dict) and isinstance(contract.get('pool'), str) and catalogue.POOL_ID.match(contract['pool'])
            and isinstance(oracle, dict) and isinstance(token, dict) and catalogue._text(item.get('market'), 40)
            and catalogue._text(token.get('symbol'))):
        return None
    stated = {key: item[field] if _decimal(item.get(field)) is not None else None for key, field in (
        ('supply', 'totalSupplyAmount'), ('borrowed', 'borrowedAmount'), ('supply_rate', 'currentSupplyRate'),
        ('borrow_rate', 'currentBorrowRate'))}
    price = oracle.get('price')
    return {'pool': contract['pool'], 'market': item['market'], 'symbol': token['symbol'], **stated,
            'price': price if _decimal(price) is not None else None, 'updated_at': _updated(item.get('lastUpdateTimestamp'))}


def reserve_figures(data, wanted):
    """`/pools` projected to each reserve's figures by Pool object id, for the markets asked for; a reserve two records
    share is left out, since neither names it. An answer of another shape is refused."""
    if not isinstance(data, dict) or data.get('code') != 0 or not isinstance(data.get('data'), list) \
            or len(data['data']) > catalogue.MAX_ROWS:
        raise ValueError('invalid_response')
    rows = [row for item in data['data'] if isinstance(item, dict) and (row := _figures(item)) is not None
            and row['market'] in wanted]
    counts = Counter(row['pool'] for row in rows)
    return {row['pool']: row for row in rows if counts[row['pool']] == 1}


def reserve_rows(figures, observed_at, url):
    """The rows NAVI's figures support for one reserve; a figure it left out makes no row, never a zero."""
    supply, borrowed, price, supply_rate, borrow_rate = (_decimal(figures[key]) for key in (
        'supply', 'borrowed', 'price', 'supply_rate', 'borrow_rate'))
    priced = "NAVI's own oracle price; amounts carry interest accrued to the reserve's last update."
    rows = []
    if supply is not None and price is not None:
        rows.append(('supplied', supply * price / SCALE, 'USD', 'at_oracle_price', 'Coins supplied to the reserve at ' + priced))
    if borrowed is not None and price is not None:
        rows.append(('borrowed', borrowed * price / SCALE, 'USD', 'at_oracle_price', 'Coins borrowed from the reserve at ' + priced))
    if supply and borrowed is not None:
        rows.append(('utilisation', borrowed / supply, 'ratio', 'borrowed_over_supplied',
                     "Borrowed over supplied coins, both from NAVI's pool amounts; NAVI states no utilisation itself."))
    for metric, rate, who in (('supply_rate', supply_rate, 'suppliers earn'), ('borrow_rate', borrow_rate, 'borrowers pay')):
        if rate is not None:
            rows.append((metric, rate / RAY_PERCENT, 'percent', 'base_apr',
                         f"NAVI's current yearly rate {who}, from its ray-scaled rate before any incentive reward."))
    with localcontext() as context:
        context.prec = 80  # room to round a product of two figures under CEILING to six places
        return [{'metric': metric, 'value': format(value.quantize(ROW), 'f'), 'unit': unit, 'period': {'kind': 'instant'},
                 'as_of': observed_at, 'basis': BASIS, 'definition': {'id': definition, 'text': text}, 'source_url': url}
                for metric, value, unit, definition, text in rows]
