"""Yahoo symbols are mutable source references, not global security identifiers."""
import re


def reference(value):
    if value.get('provider') != 'yahoo' or value.get('native_scope') != 'symbol' or not isinstance(value.get('native_id'), str) or not re.fullmatch(r'[A-Za-z0-9^][A-Za-z0-9.^=\-]{0,63}', value['native_id']):
        raise ValueError('invalid_request')
    if set(value.get('qualifiers', {})) - {'currency', 'venue'}:
        raise ValueError('invalid_request')
    return value['native_id']


def candidate(row):
    symbol = row.get('symbol')
    native = {'provider': 'yahoo', 'native_scope': 'symbol', 'native_id': symbol}
    qualifiers = {}
    currency = row.get('currency')
    if isinstance(currency, str) and re.fullmatch('[A-Z]{3}', currency):
        qualifiers['currency'] = currency
    venue = row.get('exchange')
    if isinstance(venue, str) and venue:
        qualifiers['venue'] = venue
    if qualifiers:
        native['qualifiers'] = qualifiers
    reference(native)
    provider_type = row.get('type') or row.get('quoteType')
    # Scope describes this quoted product, not proof of cross-provider identity.
    types = {'EQUITY': ('listing', 'Equity', 'equity'), 'ETF': ('listing', 'ETF', 'etf'),
             'MUTUALFUND': ('instrument', 'Fund', 'fund'), 'INDEX': ('instrument', 'Index', 'index'),
             'CURRENCY': ('instrument', 'Currency pair', 'forex'), 'CRYPTOCURRENCY': ('crypto', 'Crypto', 'crypto'),
             'FUTURE': ('instrument', 'Futures', 'future'), 'OPTION': ('instrument', 'Option', 'option'),
             'MONEY_MARKET': ('instrument', 'Money market', 'other')}
    kind, product, category = types.get(provider_type, (None, None, None))
    # Yahoo returns no ISIN, FIGI, LEI or CIK, so it asserts no identity evidence
    # (ADR 0012): a saved Yahoo reference stays an unresolved candidate.
    return {'provider_ref': native, 'name': row.get('name') or row.get('longname') or row.get('shortname') or symbol,
            'symbol': symbol, 'kind': kind, 'category': category,
            'venue': row.get('full_exchange_name') or row.get('fullExchangeName') or row.get('exchDisp') or venue,
            'metadata': {'product_type': product, 'short_name': row.get('short_name') or row.get('shortname'),
                         'full_exchange_name': row.get('full_exchange_name') or row.get('fullExchangeName') or row.get('exchDisp'),
                         'native_currency': currency},
            'provider_type': provider_type, 'evidence': [], 'identifier_conflict': False}

