---
name: eodhd
title: EODHD market data
description: Inspect EODHD source series, identifier mappings, exchange catalogues, news, fundamentals, specialist rankings and explicitly enabled EDGX streams. Use for EODHD-specific reads and limitations; use market-data for canonical subjects and source preferences.
version: 0.1.0
license: Apache-2.0
platforms: [linux, macos]
metadata:
  hermes:
    tags: [Investing, Market Data]
    category: finance
---

# EODHD market data

Use the market-data feature's shared operations for canonical identity,
preferred or pinned prices and history. EODHD has no search tool here: find
investments through Pythia, then use an exact `SYMBOL.EXCHANGE` reference.
EODHD details, catalogue rows and identifier mappings return ISIN, CUSIP, FIGI,
LEI and CIK values as typed source assertions. They are claims for Pythia to
compare, not proof: a catalogue ISIN can describe an underlying security, and
FIGI grain is not stated. Only exact Common Stock evidence can establish an
instrument mapping. Preserve ambiguous or conflicting identifiers. An exchange
suffix or matching ticker does not prove cross-provider identity.

The connector keeps delayed scalar quotes, raw daily OHLC, split/dividend-adjusted
close, and intraday bars as distinct series. Keep their units, source timestamps,
adjustments, coverage and completion qualifications. Missing values are not zero;
request success does not establish freshness or entitlement. Identifier mapping
by symbol or ISIN is bounded and preserves distinct assertions and incomplete
pagination.

News returns bounded ticker-linked headlines for an explicit date window, not an
exhaustive history. Fundamentals need a separate EODHD entitlement. A
`not_entitled` result means the connected plan lacks that dataset; say so, and
do not describe it as missing data or substitute another source unasked.

Specialist native tools expose explicit EODHD quotes and recent charts: US stock
closed EDGX one-minute bars, or five-minute intraday bars with unknown completion
for STOXX50E.INDX, GDAXI.INDX and FCHI.INDX. Preserve each chart feed, interval,
completion and latest-returned calendar-date qualifiers; do not describe these
feeds as interchangeable or session-complete. Other operations expose a
completed-session volume ranking from bulk EOD plus catalogue, and US Screener
movers. Their source membership and dates remain inspectable; neither ranking is
a live market-wide ranking or canonical identity result. The bulk ranking costs
100 API credits plus its catalogue request. Request it deliberately, without
polling or substituting another feed after an error.

The EODHD API token is set in Settings. A `needs_configuration` result means
it is not configured yet: tell the user EODHD needs an API token rather than
reporting a data failure. Native plugin and toolset enablement are separate
choices; a saved token does not enable the connector. Configuration never
proves provider-plan entitlement.
Preserve authentication, access, rate-limit and partial-result diagnostics.

EDGX streaming is disabled by default. The native `eodhd-streaming --mode` command
selects `disabled`, `demo` or `account` explicitly. A stream needs a supported USD
US stock and an explicit `venue: XEDX` series selection; it is not a consolidated
quote or a substitute for delayed REST history. Quotes, book timestamps, trade
sizes and session reference prices retain their own meaning. Gaps after reconnect
remain gaps; healthy delivery is not evidence of a fresh price.
