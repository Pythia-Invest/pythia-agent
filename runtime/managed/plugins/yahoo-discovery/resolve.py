"""Internal Yahoo resolve: which Yahoo listing Yahoo keys to an ISIN.

This is not investment search. It accepts only a checksum-valid ISIN, never
free text, and is not registered as a tool until the plugin addressing contract
adopts it as this connector's `resolve` operation.

Yahoo's ISIN lookup returns its primary listing only, and Yahoo echoes no
identifier back. A result is therefore a query-only hint for the identity core
to confirm, never identity proof. The chosen symbol is verified with one exact
metadata read so the returned reference carries Yahoo's actual venue and currency.
"""
import re

from .identity import candidate


def valid_isin(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Z]{2}[A-Z0-9]{9}[0-9]', value):
        return False
    digits = ''.join(str(int(char, 36)) for char in value)
    total = 0
    for position, char in enumerate(reversed(digits)):
        digit = int(char) * (2 if position % 2 else 1)
        total += digit - 9 if digit > 9 else digit
    return total % 10 == 0


def by_isin(isin, call):
    """`call(endpoint, arguments)` is the connector's bounded worker read.

    Returns `resolved`, `ambiguous`, `not_found` or `error`, with provider
    issue codes preserved for the caller's envelope.
    """
    if not valid_isin(isin):
        raise ValueError('invalid_request')
    raw = call('resolve_isin', {'isin': isin})
    if raw['issues']:
        return {'status': 'error', 'issues': list(raw['issues'])}
    rows = ((raw.get('data') or {}).get('result') or {}).get('quotes') or []
    symbols = []
    for row in rows:
        symbol = row.get('symbol') if isinstance(row, dict) else None
        # Some venues list a line under the ISIN itself (e.g. `<ISIN>.SG`);
        # that spelling is Yahoo's placeholder, not a traded ticker.
        if isinstance(symbol, str) and not symbol.startswith(isin) and symbol not in symbols:
            symbols.append(symbol)
    query = {'scheme': 'isin', 'value': isin, 'authority': 'query_only'}
    if not symbols:
        return {'status': 'not_found', 'query': query}
    if len(symbols) > 1:
        return {'status': 'ambiguous', 'query': query,
                'candidates': [candidate(row)['provider_ref'] for row in rows
                               if isinstance(row, dict) and row.get('symbol') in symbols]}
    metadata = call('metadata', {'symbol': symbols[0]})
    if metadata['issues']:
        return {'status': 'error', 'issues': list(metadata['issues'])}
    if (metadata.get('data') or {}).get('symbol') != symbols[0]:
        raise ValueError('binding_mismatch')
    exact = candidate(metadata['data'])
    return {'status': 'resolved', 'native_ref': exact['provider_ref'], 'native_level': exact['kind'],
            'echoed': {}, 'query': query}
