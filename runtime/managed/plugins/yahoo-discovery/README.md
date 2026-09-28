# Yahoo Finance connector

A content connector for Yahoo Finance's public data. It needs no account or
credential. Exact-symbol details, source-pinned price series, bounded
specialist research (quote, chart, historical, quoteSummary, fundamentals,
options, insights, recommendations, screener, trending, news) and Desk
dashboards run through `yahoo-finance2` 4.0.2 in the owned resident worker
(`runtime/managed/runner/yahoo*.ts`). SDK setup and requests share the connection
budget; the native unload hook releases the worker. The connector does not use
browser cookies or private account access.

## Provider terms

Pythia is personal software: each installation serves one investor. Provider
data is used under that investor's own agreement with the provider. Each plugin
carries its provider's terms and enforces what they require. Pythia itself never
publishes, pools or redistributes provider data.

Yahoo's terms limit use to personal, non-commercial purposes and prohibit
redistribution and building a competing database or feed. This plugin enforces
that as follows:

- reads are cached only in memory, within the market-data owner's cache policy
  (seconds to minutes);
- Yahoo rows never enter a catalogue, overlay, reference snapshot or other
  shared artefact, and must not be committed as fixtures;
- tests use synthetic Yahoo-shaped values.

## Identity

Yahoo returns no ISIN, FIGI, LEI or CIK. A Yahoo symbol is a mutable listing
reference, not an identifier. `details` preserves Yahoo's venue and currency
qualifiers and asserts no identity evidence. Core addresses a Yahoo listing from
open identifiers through this plugin's MIC suffix table
([ADR 0038](../../../../docs/decisions/0038-plugin-addressing-contract.md)); that
derived symbol is an address, never evidence. The contract's `venue_codes` map
Yahoo's exchange codes (`NMS`, `GER`) to operating MICs, so core can check the
venue and currency a read states against the listing (ADR 0037, "Read checks").
Yahoo `EQUITY` is not promoted to Common Stock or proof of an issuer. Name or
ticker similarity never creates a canonical relationship.

## Price series

`series` declares one quote series and bar series, each with the longest window
Yahoo serves for its interval: daily OHLC and dividend-adjusted daily closes and
weekly OHLC (full history), hourly bars (730 days), 5- and 30-minute bars (60
days) and 1-minute bars (7 days) of the regular session, and
`two_minute_extended` (60 days) including Yahoo's pre- and post-market trades
where the venue has them. Adding the bar `volume` field changed the ids of the
OHLC series; a view pinned to an older Yahoo OHLC id must be pinned again. Intraday
equity and fund reads carry `price_context.session_window`: the current or last
started session's regular and extended bounds from Yahoo's trading periods,
never assumed hours. Continuous markets carry none and keep elapsed time. Quotes
carry the previous close their change is measured against, and bars keep the
reported volume (shares for equities and funds). Stocks and funds report
PRE/POST as pre/post sessions with the latest pre/post trade when it follows
the regular observation; a post-market result stays after the close until a
new session supersedes it. Cash indexes keep their regular interpretation.

## No provider search

Investment search is a local read of Pythia's directory; this connector offers
no free-text search. The agent forms a Yahoo reference from a symbol it already
has and confirms it with `details`. The worker reaches Yahoo's search endpoint
in two narrow ways only:

- `resolve_isin` accepts a checksum-valid ISIN and returns listing rows
  (symbol, exchange, quote type). Yahoo keys an ISIN to its primary listing
  only, so a row never proves the other listings of a security. No tool exposes
  it yet; the plugin addressing contract adopts it as this connector's
  `resolve`.
- research `news` reads an issuer's news. It takes validated Yahoo symbols
  (the listing asked for plus the issuer's other Yahoo lines, at most eight),
  and for a crypto pair also the asset's name, and returns only the items
  Yahoo tags with one of those symbols. The name is only a query; it never
  widens what is kept.

## News

Yahoo's search is a text search and its tag is its own "main" line: ASML
and Shell news is tagged with the US lines `ASML` and `SHEL`, Nestlé news
with `NESN.SW`, and bitcoin news with `BTC-USD`, while the queries `ASML.AS`,
`SHEL.L` and `NESN.SW` match no news at all (measured 2026-09-28). A news
read is therefore per issuer, not per listing: one query for each of the
issuer's Yahoo symbols, keeping items tagged with any of those symbols. The
caller supplies the symbols from Pythia's identity; the connector never
guesses them from names.

A name query is accepted for a crypto pair only. "BTC-USD" finds almost no
news while "Bitcoin" finds all of it; for equities the name query returned
exactly the main-line symbol's answer, so it only cost a request.

Yahoo answers at most about 50 items per query and has no offset, so the
read is a dated window (default the last 7 days, at most 31) filled as far
as Yahoo goes. A query whose oldest item is inside the window stopped there;
`complete_from` is the newest such oldest item, and the result then carries
`window_incomplete`. For Apple that is about two days.

Unknown item fields and unknown `type` values are counted under `drift`
with a `schema_drift` warning; unreadable items are omitted with
`invalid_value`. Detecting a feed that goes quiet belongs to Yahoo's
onboarding.

## Markets: indexes, futures, FX and movers

Core's curated market table (`identity/markets.json`) addresses indexes,
continuous front-month futures, currency pairs and yields by their Yahoo
symbols (`^GSPC`, `ES=F`, `EURUSD=X`, `^TNX`); the contract declares its
`symbol` scope at those subject kinds. `movers` serves core's `market_movers`
concept from Yahoo's predefined US screens (`most_actives`, `day_gainers`,
`day_losers`). Its field meanings, venue table and drift alarms are in the
[source record](../../../../docs/sources/yahoo-screener.md).
