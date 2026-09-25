"""Catalogue identifiers retain their source scope until independently qualified.

Identifiers are typed source assertions for Pythia's join, never identity proof.
The subject level is stated only where the scheme fixes it; EODHD does not
qualify FIGI grain, so that level stays unknown (None).
"""
import re
from datetime import datetime, timezone
from uuid import uuid4


def isin(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Z]{2}[A-Z0-9]{9}[0-9]', value):
        return False
    digits = ''.join(str(ord(c)-55) if c.isalpha() else c for c in value)
    return sum(sum(divmod(int(c)*(2 if i % 2 else 1), 10)) for i, c in enumerate(reversed(digits))) % 10 == 0


# Scheme -> subject level the value identifies; None where EODHD leaves it unqualified.
LEVELS = {'isin': 'security', 'cusip': 'security', 'figi': None, 'lei': 'issuer', 'cik': 'issuer'}


def identifier(scheme, value):
    """One typed source-asserted identifier, or None for an invalid value."""
    if scheme == 'isin' and not isin(value):
        return None
    if scheme == 'cik':
        if not isinstance(value, str) or not re.fullmatch(r'[0-9]{1,10}', value):
            return None
        value = value.zfill(10)
    elif not isinstance(value, str) or not re.fullmatch(r'[A-Z0-9]{1,64}', value):
        return None
    return {'scheme': scheme, 'value': value, 'level': LEVELS[scheme], 'authority': 'source_asserted'}


def mapping_records(rows):
    """ID-mapping rows become per-symbol typed identifier assertions."""
    result = []
    for row in rows:
        values = [identifier(scheme, row.get(scheme)) for scheme in LEVELS]
        result.append({'provider_ref': native(row['symbol']), 'identifiers': [item for item in values if item]})
    return result


def native(symbol, currency=None):
    result = {'provider': 'eodhd', 'native_scope': 'catalogue', 'native_id': symbol}
    if currency and re.fullmatch('[A-Z]{3}', currency):
        result['qualifiers'] = {'currency': currency}
    return result


def reference(value):
    if value.get('provider') != 'eodhd' or value.get('native_scope') != 'catalogue' or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]{0,63}\.[A-Za-z0-9]{1,16}', value.get('native_id', '')):
        raise ValueError('invalid_request')
    if set(value.get('qualifiers', {})) - {'currency'}:
        raise ValueError('invalid_request')
    return value['native_id']


def candidates(rows):
    groups = {}
    for row in rows:
        key = (row['symbol'], row['currency'])
        groups.setdefault(key, []).append(row)
    result = []
    for (symbol, currency), records in groups.items():
        ref = native(symbol, currency)
        evidence = []
        if {row['type'] for row in records} == {'Common Stock'}:
            # Search ISIN can describe underlying exposure (for example a CEDEAR).
            # Common Stock is too broad to qualify it as this instrument's ISIN.
            values = [('native', symbol)]
            for scheme, value in values:
                evidence.append({'schema_version': 1, 'id': 'evidence:' + str(uuid4()), 'provider_ref': ref,
                    'scope': 'instrument', 'scheme': scheme, 'value': value, 'qualifiers': {}, 'adapter_version': '2',
                    'authority': 'source_asserted', 'observed_at': None, 'retrieved_at': datetime.now(timezone.utc).isoformat(),
                    'effective': {'start': None, 'end': None}})
        provider_type = records[0]['type'] if len({row['type'] for row in records}) == 1 else None
        # Returned types are display facts, not evidence of identity equivalence
        # or supported price reads. Never classify from the candidate's name.
        category = {'Common Stock': 'equity', 'Preferred Stock': 'equity', 'ETF': 'etf',
                    'Fund': 'fund', 'FUND': 'fund', 'Mutual Fund': 'fund'}.get(provider_type)
        # EODHD documents these virtual catalogue namespaces. "Currency" alone
        # cannot distinguish a crypto quote pair from a forex pair.
        # https://eodhd.com/financial-apis/api-for-historical-data-and-volumes
        if category is None:
            category = {'CC': 'crypto', 'FOREX': 'forex', 'INDX': 'index'}.get(symbol.rsplit('.', 1)[1])
        # A catalogue ISIN can describe underlying exposure (for example a
        # CEDEAR); it is a typed claim for Pythia's join, not instrument evidence.
        identifiers = [identifier('isin', value) for value in sorted({row.get('isin') for row in records if isin(row.get('isin'))})]
        # The worker builds native IDs from returned Code + Exchange; only strip that namespace.
        result.append({'provider_ref': ref, 'name': records[0]['name'], 'symbol': symbol.rsplit('.', 1)[0],
                       'kind': 'instrument', 'category': category, 'venue': records[0].get('actual_venue') or symbol.rsplit('.', 1)[1],
                       'metadata': {'product_type': provider_type}, 'provider_type': provider_type,
                       'identifiers': identifiers, 'evidence': evidence, 'identifier_conflict': len(identifiers) > 1})
    return result
