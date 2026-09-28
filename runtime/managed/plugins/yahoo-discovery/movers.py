"""Yahoo's predefined US screeners as core's `market_movers` lists.

Field meanings, the venue table and the audit are in docs/sources/yahoo-screener.md.
The adapter reads a few documented fields and checks every answer against the
fields and vocabularies the audit found. An unknown field, venue, market state
or instrument type is logged for the maintainer; a row missing a read field or
holding an unreadable value is left out, counted and returned as a
`source_drift` issue. Nothing here is identity evidence: core resolves each
row's ticker and operating MIC against the reference.
"""
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

SCREENS = {'most_active': 'most_actives', 'gainers': 'day_gainers', 'losers': 'day_losers'}
LIMIT = 25
# What the predefined screens rank, from their criteria (rawCriteria): US equities, market cap of $2B or more,
# OTC venues excluded; gainers and losers also need a price of $5 or more and a move beyond 3% or -2.5%.
UNIVERSE = 'US stocks with a market cap of $2B or more'
# Yahoo exchange code -> operating MIC (ISO 10383). Nasdaq's tiers, NYSE American and NYSE Arca are segments
# of their operating MIC; Cboe's equities follow the reference builder's operating MIC (XCBO); every OTC Markets
# tier is OTCM.
VENUES = {'NMS': 'XNAS', 'NGM': 'XNAS', 'NCM': 'XNAS', 'NYQ': 'XNYS', 'ASE': 'XNYS', 'PCX': 'XNYS', 'BTS': 'XCBO',
          'PNK': 'OTCM', 'OID': 'OTCM', 'OQB': 'OTCM', 'OQX': 'OTCM', 'OEM': 'OTCM', 'OGM': 'OTCM', 'OBB': 'OTCM'}
SESSIONS = {'PREPRE': 'pre', 'PRE': 'pre', 'REGULAR': 'regular', 'POST': 'post', 'POSTPOST': 'post', 'CLOSED': 'closed'}
# Every quote field yahoo-finance2 4.0.2's ScreenerQuote declares, plus those the audit saw beyond it.
KNOWN = frozenset((
    'language region quoteType typeDisp quoteSourceName triggerable customPriceAlertConfidence lastCloseTevEbitLtm '
    'lastClosePriceToNNWCPerShare firstTradeDateMilliseconds priceHint postMarketChangePercent postMarketTime '
    'postMarketPrice postMarketChange regularMarketChange regularMarketTime regularMarketPrice regularMarketDayHigh '
    'regularMarketDayRange currency regularMarketDayLow regularMarketVolume regularMarketPreviousClose bid ask bidSize '
    'askSize market messageBoardId fullExchangeName longName financialCurrency regularMarketOpen '
    'averageDailyVolume3Month averageDailyVolume10Day fiftyTwoWeekLowChange fiftyTwoWeekLowChangePercent '
    'fiftyTwoWeekRange fiftyTwoWeekHighChange fiftyTwoWeekHighChangePercent fiftyTwoWeekChangePercent '
    'earningsTimestamp earningsTimestampStart earningsTimestampEnd trailingAnnualDividendRate '
    'trailingAnnualDividendYield marketState epsTrailingTwelveMonths epsForward epsCurrentYear priceEpsCurrentYear '
    'sharesOutstanding bookValue fiftyDayAverage fiftyDayAverageChange fiftyDayAverageChangePercent '
    'twoHundredDayAverage twoHundredDayAverageChange twoHundredDayAverageChangePercent marketCap forwardPE '
    'priceToBook sourceInterval exchangeDataDelayedBy exchangeTimezoneName exchangeTimezoneShortName '
    'gmtOffSetMilliseconds esgPopulated tradeable cryptoTradeable exchange fiftyTwoWeekLow fiftyTwoWeekHigh shortName '
    'averageAnalystRating regularMarketChangePercent symbol dividendDate displayName trailingPE prevName '
    'nameChangeDate ipoExpectedDate dividendYield dividendRate yieldTTM peTTM annualReturnNavY3 annualReturnNavY5 '
    'ytdReturn trailingThreeMonthReturns netAssets netExpenseRatio hasPrePostMarketData corporateActions '
    'earningsCallTimestampStart earningsCallTimestampEnd isEarningsDateEstimate preMarketChange '
    'preMarketChangePercent preMarketTime preMarketPrice '
    'fulldayChange fulldayChangePercent fulldayPrice impliedSharesOutstanding newListingDate').split())


def _number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _time(value):
    """regularMarketTime is epoch seconds (the SDK's schema); anything else is drift."""
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise ValueError('regularMarketTime')
    return datetime.fromtimestamp(value, timezone.utc).isoformat().replace('+00:00', 'Z')


def _row(rank, quote, drift):
    """One list row, or None when a read field is missing or malformed (counted in `drift`)."""
    try:
        symbol, currency = quote['symbol'], quote['currency']
        if not isinstance(symbol, str) or not symbol or not isinstance(currency, str) or len(currency) != 3:
            raise ValueError('symbol')
        values = {key: quote[key] for key in ('regularMarketPrice', 'regularMarketChange',
                                              'regularMarketChangePercent')}
        if not all(_number(value) for value in values.values()):
            raise ValueError('price')
        time = _time(quote['regularMarketTime'])
    except (KeyError, ValueError, TypeError):
        drift['malformed_rows'] += 1
        return None
    name = quote.get('longName') or quote.get('shortName')
    volume = quote.get('regularMarketVolume')
    exchange, state = quote.get('exchange'), quote.get('marketState')
    mic = VENUES.get(exchange)
    if mic is None:
        drift['venues'].add(str(exchange))
    if state not in SESSIONS:
        drift['states'].add(str(state))
    if quote.get('quoteType') != 'EQUITY':  # the screens ask for equities only
        drift['kinds'].add(str(quote.get('quoteType')))
    return {'rank': rank, 'symbol': symbol, 'ticker': symbol if mic else None, 'mic': mic,
            'name': name if isinstance(name, str) and name else None,
            'kind': 'equity' if quote.get('quoteType') == 'EQUITY' else 'other',
            'currency': currency, 'price': values['regularMarketPrice'], 'change': values['regularMarketChange'],
            'change_percent': values['regularMarketChangePercent'],
            'volume': volume if isinstance(volume, int) and not isinstance(volume, bool) else None,
            'session': SESSIONS.get(state), 'time': time, 'venue': quote.get('fullExchangeName')}


def adapt(payload, list_name, limit):
    """Core's market_movers data from the worker's screener answer, with any structural break as an issue."""
    result = payload.get('result') if isinstance(payload, dict) else None
    quotes = result.get('quotes') if isinstance(result, dict) else None
    if not isinstance(quotes, list):
        return None, [{'code': 'source_drift', 'severity': 'error',
                       'message': "Yahoo's screener answer has changed: it has no list of quotes."}]
    drift = {'malformed_rows': 0, 'venues': set(), 'states': set(), 'kinds': set(), 'fields': set()}
    rows = []
    for quote in quotes:
        if not isinstance(quote, dict):
            drift['malformed_rows'] += 1
            continue
        drift['fields'] |= set(quote) - KNOWN
        row = _row(len(rows) + 1, quote, drift)
        if row is not None and len(rows) < limit:
            rows.append(row)
    # Additive changes (new fields, venues, states) are the maintainer's signal only: a row still shows, at worst
    # without its link. A structural break (rows that cannot be read) is also an issue on the answer.
    changed = [f"{label} {', '.join(sorted(values)[:6])}" for label, values in (
        ('unknown fields', drift['fields']), ('unknown venues', drift['venues']),
        ('unknown market states', drift['states']), ('non-equity rows', drift['kinds'])) if values]
    if changed:
        logger.warning('yahoo screener drift (%s): %s', list_name, '; '.join(changed))
    issues = []
    if drift['malformed_rows']:
        count = drift['malformed_rows']
        message = (f"Yahoo's screener answer has changed: {count} row{'' if count == 1 else 's'} without a readable "
                   "symbol, price, change or time left out.")
        logger.warning('yahoo screener drift (%s): %s', list_name, message)
        issues.append({'code': 'source_drift', 'severity': 'warning', 'message': message})
    data = {'list': list_name, 'market': 'US', 'universe': UNIVERSE, 'retrieved_at': payload.get('retrieved_at'),
            'rows': rows}
    return data, issues
