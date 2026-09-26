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
qualifiers and asserts no identity evidence, so a saved Yahoo reference stays an
unresolved candidate under [ADR 0012](../../../../docs/decisions/0012-investment-identity-and-repair.md).
Yahoo `EQUITY` is not promoted to Common Stock or proof of an issuer. Name or
ticker similarity never creates a canonical relationship.

## Price series

`series` declares one quote series and bar series: daily and dividend-adjusted
daily closes (up to ten years), and 1-minute, 5-minute and hourly bars of the
regular session (up to seven days). `five_minute_extended` adds 5-minute bars
including Yahoo's pre- and post-market trades where the venue has them. Intraday
equity and fund reads carry `price_context.session_window`: the current or last
started session's regular and extended bounds from Yahoo's trading periods,
never assumed hours. Continuous markets carry none and keep elapsed time. Quotes
carry the previous close their change is measured against, and bars keep the
reported volume (shares for equities and funds).

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
- research `news` accepts a validated Yahoo symbol and returns only the items
  Yahoo tags with that exact symbol.
