"""SEC reporting-entity evidence; a CIK identifies a filer, not a security or listing.

Public formats: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
These functions are pure so the same parsing serves runtime reads and offline
reference builds.
"""
import re

DIRECTORY_URL = 'https://www.sec.gov/files/company_tickers_exchange.json'
# SEC's venue labels only name the exchange group, so they map to ISO 10383
# operating MICs, never to a segment: "NYSE" also covers NYSE American and Arca,
# "CBOE" covers BZX/BYX/EDGA/EDGX and "OTC" every OTC Markets tier.
OPERATING_MICS = {'Nasdaq': 'XNAS', 'NYSE': 'XNYS', 'CBOE': 'XCBO', 'OTC': 'OTCM'}
_EMAIL = re.compile(r'[^\s@]+@[^\s@]+\.[^\s@]+')


def contact(value):
    """SEC fair access requires a declared name and email in the User-Agent.

    HTTP headers here are encoded as ASCII-compatible bytes, so only printable
    ASCII is usable; anything else would fail every request.
    """
    if not isinstance(value, str) or len(value) > 320 or any(not 32 <= ord(c) < 127 for c in value):
        return False
    parts = value.split()
    return len(parts) >= 2 and bool(_EMAIL.fullmatch(parts[-1]))


def cik(value):
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise ValueError('invalid_request')
    text = str(value)
    if not re.fullmatch(r'[0-9]{1,10}', text) or int(text) == 0:
        raise ValueError('invalid_request')
    return text.zfill(10)


def reference(value):
    return {'provider': 'sec', 'native_id': cik(value), 'native_scope': 'cik'}


def from_reference(value):
    if not isinstance(value, dict) or value.get('provider') != 'sec' or value.get('native_scope') != 'cik' or value.get('qualifiers'):
        raise ValueError('invalid_request')
    return cik(value.get('native_id'))


def submissions_url(value):
    return 'https://data.sec.gov/submissions/CIK' + cik(value) + '.json'


def identifier(value):
    return {'scheme': 'cik', 'value': cik(value), 'level': 'issuer', 'authority': 'source_asserted'}


def listing(symbol, exchange):
    """A traded line as SEC labels it; no asset class or share class is inferred."""
    if not isinstance(symbol, str) or not 1 <= len(symbol) <= 32 or not symbol.strip() or not (exchange is None or isinstance(exchange, str)):
        raise ValueError('invalid_response')
    venue = {'provider_code': exchange, **({'operating_mic': OPERATING_MICS[exchange]} if exchange in OPERATING_MICS else {})}
    return {'ticker': {'symbol': symbol}, **({'venue': venue} if exchange else {})}


def directory_records(raw, observed_at):
    """One row per SEC ticker line, in the file's own order (``rank``).

    The order is SEC's, exposed for the core to evaluate as a ranking signal; it
    is not a market value. Several lines can share one CIK (share classes,
    preferreds, warrants), and none of them proves security equivalence.
    """
    if not isinstance(raw, dict) or raw.get('fields') != ['cik', 'name', 'ticker', 'exchange'] or not isinstance(raw.get('data'), list):
        raise ValueError('invalid_response')
    records = []
    for position, row in enumerate(raw['data'], 1):
        if not isinstance(row, list) or len(row) != 4:
            raise ValueError('invalid_response')
        number, name, symbol, exchange = row
        if not isinstance(name, str) or not name.strip():
            raise ValueError('invalid_response')
        try:
            value = cik(number)
        except ValueError:
            raise ValueError('invalid_response') from None
        records.append({'native_ref': reference(value), 'level': 'listing', 'name': name,
                        **listing(symbol, exchange), 'identifiers': [identifier(value)],
                        'rank': position, 'observed_at': observed_at, 'source_url': DIRECTORY_URL})
    return records


def directory_matches(raw, observed_at, symbol, mic=None):
    """Exact ticker (and optional operating MIC) matches, grouped per filer."""
    wanted = symbol.casefold()
    filers = {}
    for row in directory_records(raw, observed_at):
        filers.setdefault(row['native_ref']['native_id'], []).append(row)
    matches = []
    for rows in filers.values():
        if not any(row['ticker']['symbol'].casefold() == wanted
                   and (mic is None or row.get('venue', {}).get('operating_mic') == mic) for row in rows):
            continue
        first = rows[0]
        matches.append({'native_ref': first['native_ref'], 'native_level': 'issuer', 'name': first['name'],
                        'identifiers': first['identifiers'],
                        'listings': [{key: row[key] for key in ('ticker', 'venue') if key in row} for row in rows],
                        'observed_at': observed_at, 'source_url': DIRECTORY_URL})
    return matches


def _date(value):
    if not isinstance(value, str) or not re.match(r'\d{4}-\d{2}-\d{2}', value):
        return None
    return value[:10]


def submission_record(raw, expected_cik, observed_at):
    """Filer identity from submissions: current name, former names and listed lines."""
    value = cik(expected_cik)
    try:
        matches = cik(raw.get('cik')) == value if isinstance(raw, dict) else False
    except ValueError:
        matches = False
    if not matches or not isinstance(raw.get('name'), str) or not raw['name'].strip():
        raise ValueError('invalid_response')
    tickers, exchanges = raw.get('tickers') or [], raw.get('exchanges') or []
    if not isinstance(tickers, list) or not isinstance(exchanges, list) or len(tickers) != len(exchanges):
        raise ValueError('invalid_response')
    former = raw.get('formerNames') or []
    if not isinstance(former, list) or any(not isinstance(item, dict) or not isinstance(item.get('name'), str) for item in former):
        raise ValueError('invalid_response')
    record = {'native_ref': reference(value), 'native_level': 'issuer', 'name': raw['name'],
              'identifiers': [identifier(value)],
              'listings': [listing(symbol, exchange or None) for symbol, exchange in zip(tickers, exchanges)],
              'former_names': [{'name': item['name'], **{key: day for key in ('from', 'to')
                                if (day := _date(item.get(key)))}} for item in former],
              'observed_at': observed_at, 'source_url': submissions_url(value)}
    code, description = raw.get('stateOfIncorporation'), raw.get('stateOfIncorporationDescription')
    if isinstance(code, str) and code.strip():
        # EDGAR state/country code (for example a foreign issuer's country).
        record['incorporation'] = {'edgar_code': code, **({'description': description} if isinstance(description, str) and description else {})}
    return record
