---
name: market-data
title: Market data
description: Read latest quotes and bounded price history for a Pythia subject with pythia_prices, and interpret its sources, units and gaps.
version: 0.4.0
license: Apache-2.0
platforms: [linux, macos]
metadata:
  hermes:
    tags: [Investing, Market Data]
    category: finance
    requires_toolsets: [pythia-desk]
---

# Market data

Use `pythia_prices` for quotes and price history. Market data informs research;
it does not determine an investment strategy.

Investments are Pythia subjects. Find one with `pythia_find` and pass its
subject id; for a company (issuer) `pythia_prices` reads the primary listing. A
symbol or name alone never identifies a subject. `pythia_instrument` shows which
source serves the subject's quote and chart, or why none does (disabled, needs
configuration, unresolved). Associations belong to Pythia's core; the agent
cannot save, override or repair them.

A read uses the first source in the investor's order that serves the subject.
It never falls back on its own: a failure returns its error, the eligible
`alternatives` and the `skipped` sources with reasons. Reading another source
is a separate call that names it as `source`, and the answer should say so.
Never stitch series from different sources. Missing configuration or a disabled
source cannot be fixed by changing arguments. Local readiness does not
establish login, subscriptions or fresh prices.

Preserve observation dates separately from retrieval time, numeric precision,
currency, adjustment and market-data type (delayed, end of day). Daily session
dates are not midnight instants. Missing values are not zero; a partial result
remains useful with its coverage gaps and issues.
