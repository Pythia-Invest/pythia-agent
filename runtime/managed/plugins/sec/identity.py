"""SEC reporting-entity evidence; a CIK identifies a filer, not a security or listing.

Public formats: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
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


def _directory_lines(raw):
    """``(cik, name, listing)`` per SEC ticker line; several lines can share one CIK."""
    if not isinstance(raw, dict) or raw.get('fields') != ['cik', 'name', 'ticker', 'exchange'] or not isinstance(raw.get('data'), list):
        raise ValueError('invalid_response')
    lines = []
    for row in raw['data']:
        if not isinstance(row, list) or len(row) != 4:
            raise ValueError('invalid_response')
        number, name, symbol, exchange = row
        if not isinstance(name, str) or not name.strip():
            raise ValueError('invalid_response')
        try:
            value = cik(number)
        except ValueError:
            raise ValueError('invalid_response') from None
        lines.append((value, name, listing(symbol, exchange)))
    return lines


def directory_matches(raw, observed_at, symbol, mic=None):
    """Exact ticker (and optional operating MIC) matches, grouped per filer.

    Every line of a matching filer is returned (share classes, preferreds,
    warrants); none of them proves security equivalence.
    """
    wanted = symbol.casefold()
    filers = {}
    for number, name, line in _directory_lines(raw):
        filers.setdefault(number, (name, []))[1].append(line)
    return [{'native_ref': reference(number), 'native_level': 'issuer', 'name': name,
             'identifiers': [identifier(number)], 'listings': lines,
             'observed_at': observed_at, 'source_url': DIRECTORY_URL}
            for number, (name, lines) in filers.items()
            if any(line['ticker']['symbol'].casefold() == wanted
                   and (mic is None or line.get('venue', {}).get('operating_mic') == mic) for line in lines)]


def claims(records):
    """A resolve answer in core's ClaimBatch wire form (ADR 0038): one issuer claim per SEC filer record."""
    return {'plugin': 'pythia-sec', 'provider': 'sec', 'adapter_version': '1', 'origin': 'resolve', 'claims': [
        {'level': 'issuer', 'identifiers': [{'scheme': 'cik', 'value': record['native_ref']['native_id']}],
         'native_ref': record['native_ref'], 'attributes': {'name': record['name']},
         'provenance': {'plugin': 'pythia-sec', 'source': 'sec', 'adapter_version': '1',
                        'retrieved_at': record['observed_at'], 'source_record': record['source_url']}}
        for record in records]}


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
