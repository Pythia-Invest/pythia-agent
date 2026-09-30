"""AlphaLend reserves, read from the chain (AlphaLend has no API that lists them).

One shared `LendingProtocol` object holds a table of `Market`s, which AlphaLend calls markets and Pythia calls reserves:
one coin each, numbered 1 to 36, and one coin can be two of them (DEEP is 8 and 11). A table's values are wrapped, so a
market has no object id of its own; its dynamic field is the object, which anyone can read and which is derived from the
table and the number for good, so that is the key (not the wrapped `Market.id`, which no API reads).

Roles are what the chain's own configuration allows: every coin is `supply`; it is also `collateral` where its safe
collateral ratio is above zero, and `borrow` where its borrow limit is (none is, today: AlphaLend is winding down and
every limit is 0, which is why `active` alone does not mean borrowable).
"""
from .chain import address, canonical, coin_type, struct

PACKAGE = '0xd631cd66138909636fc3f73ed75820d0c5b76332d1644608ed1c85ea2b8219b4'
ROOT = f'{PACKAGE}::alpha_lending::LendingProtocol'
MARKET = f'{PACKAGE}::market::Market'


def reserves(chain):
    """(rows, found): the markets as the catalogue keeps them. `unexpected_root` counts a chain that does not hold exactly
    one `LendingProtocol`; `malformed` counts markets that are not a readable `Market`."""
    roots = chain.objects('AlphaLendProtocol', ROOT)
    table = address((((roots[0]['json'] or {}).get('markets') or {}).get('id'))) if len(roots) == 1 else None
    if table is None:
        return [], {'malformed': 0, 'unexpected_root': 1}
    found, rows = {'malformed': 0, 'unexpected_root': 0}, []
    for field in chain.fields('AlphaLendMarkets', table, size=12):
        try:
            body, config = field['json'], field['json']['config']
            if struct(field['type'])[0] != MARKET or not address(field['address']):
                raise ValueError('not a market')
            coin = coin_type(canonical(body['coin_type'])) or canonical(body['coin_type'])
            roles = ['supply'] + (['collateral'] if int(config['safe_collateral_ratio']) > 0 else []) + (
                ['borrow'] if int(config['borrow_limit']) > 0 else [])
            rows.append({'object': address(field['address']), 'protocol': PACKAGE,
                         'name': f"AlphaLend {{0}} (market {int(body['market_id'])})",
                         'assets': [(coin, role) for role in roles],
                         'status': 'active' if config['active'] is True else 'inactive'})
        except (KeyError, TypeError, ValueError):
            found['malformed'] += 1
    return rows, found
