---
name: eodhd
title: EODHD market data
description: Inspect EODHD source series, identifier mappings, exchange catalogues, news, fundamentals, specialist quotes and explicitly enabled EDGX streams. Use for EODHD-specific reads and limitations; use market-data for canonical subjects and source preferences.
version: 0.1.0
license: Apache-2.0
platforms: [linux, macos]
metadata:
  hermes:
    tags: [Investing, Market Data]
    category: finance
---

# EODHD market data

Use the market-data feature's shared operations for canonical identity and
preferred or pinned prices. EODHD has no search tool here: find investments
through Pythia, then use an exact `SYMBOL.EXCHANGE` reference.

Details and catalogue rows carry source-asserted ISINs. Only the identifier
mapping tools (by symbol or by ISIN) return CUSIP, FIGI, LEI and CIK. Every
identifier is a claim for Pythia to compare, not proof: a catalogue ISIN can
describe an underlying security, FIGI grain is not stated, and a matching ticker
or exchange suffix does not prove cross-provider identity. Keep ambiguous,
conflicting or incompletely paginated mappings visible.

Delayed quotes, raw daily OHLC, adjusted close and intraday bars are distinct
series; keep their units, timestamps, adjustments and completion. Missing values
are not zero, and a successful request does not establish freshness or plan
entitlement.

A `needs_configuration` result means `eodhd_api_token` is not yet in
`secrets.json` in the Pythia config folder: tell the user that rather than
reporting a data failure. Preserve authentication, access, rate-limit and
partial-result diagnostics.

EDGX streaming is off until the native `eodhd-streaming --mode demo` or
`--mode account` command enables it, and applies only to an explicit
`venue: XEDX` series for a US stock. It is not a consolidated quote; gaps after
a reconnect remain gaps.
