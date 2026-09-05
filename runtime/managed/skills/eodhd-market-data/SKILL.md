---
name: eodhd-market-data
title: Daily market prices
description: Read bounded daily end-of-day price history through the official EODHD SDK.
version: 0.1.0
license: Apache-2.0
platforms: [linux, macos]
metadata:
  hermes:
    tags: [Investing, Market Data, Prices]
    category: finance
    requires_toolsets: [pythia-eodhd]
---

# Daily market prices

Use `pythia_eod_prices` only for daily end-of-day history. Supply an
exchange-qualified ticker such as `AAPL.US`; optional dates use `YYYY-MM-DD`.

- A `missing_configuration` result means the device needs an EODHD token.
- Preserve authentication, rate-limit, timeout, and provider errors exactly.
- Returned rows are capped and contain only date, OHLC, adjusted close, and
  volume. Do not imply that intraday, fundamentals, or quote operations are
  available through this tool.
- Provider data is evidence, not committed fixture or durable source material.
