# 0048: The Live market view and Hyperliquid as its first source

**Status.** Accepted (2026-09-28). Implemented for the Hyperliquid BTC perp.

## Context

[ADR 0030](0030-coordinated-reads-and-live-updates.md) already delivers pushed
updates over one shared SSE channel per browser, and
[ADR 0040](0040-data-concepts-and-agent-tools.md) added the `market_data.live`
operation with core's `live_market` snapshot. Nothing served it and no page
could show it. The founder chose Hyperliquid as the first provider, behind an
explicit opt-in because it publishes no data licence, shown on the perp's own
page; EODHD's US stock stream follows on the same path.

A perp is a `market` subject ([ADR 0037](0037-identity-backbone.md)): outside
the instrument hierarchy, linked to its underlying by `derivative_on`. Page
composition and contracts handled instrument levels only.

## Ruling

- **Market subjects come from a curated core table.** `identity/markets.json`
  (rule `native_markets@1`) names each market, its underlying and the native
  reference of each plugin that serves it, like `native_coins@1`. A market page
  needs no reference file; the underlying's page lists the market as a related
  link and never folds it.
- **Contracts may address a kind outside the hierarchy as itself.** A concept
  that allows the kind (`market_data` allows `market`) takes `level` and `via`
  both `market`, with a native scope at level `market`; core's curated table
  supplies the reference.
- **`live` is a page section.** Core composes it like the others, with the
  plugin's request (`native_ref` and `subject_id`). The Desk subscribes to it
  through the shared channel only while the section is on screen and renders
  it with shared components: the chart on a rolling 15-minute window, an order
  book ladder, a trade tape and a context strip. The view reads only the
  `live_market` shape, so a top-of-book, single-venue stock feed renders with
  the same code and a venue label.
- **The headline is the mark price** with its change against Hyperliquid's
  24-hour reference; last trade, oracle and mid stay labelled.
- **Hyperliquid runs in-process.** One websocket (Hermes' pinned `websockets`)
  serves every watched perp, opens with the first listener and closes with the
  last. It publishes at most four snapshots a second, reconnects on its own
  with a bounded backoff and records the outage as a gap, and turns stale after
  20 seconds so the platform's retry takes over.
- **Five book levels, twice a second.** Hyperliquid's 20-level book updates
  about every 5 seconds; its `fast` book carries 5 levels about every 530 ms. A
  live ladder needs the second.
- **Opt-in is native enablement.** The plugin ships disabled; enabling it is the
  choice to connect. No separate setting exists.
- **The agent gets a one-shot snapshot** through the same native tool; there is
  no agent subscription.

## Consequences

- Adding a perp is one entry in `markets.json`, reviewed like code, until a
  catalogue-driven market directory exists.
- Search does not list markets yet; the underlying's page links to them.
- A perp page has no history chart until a plugin serves `daily` or `intraday`
  for a market.
- `@pythia/ui` gains `OrderBookLadder`, `TradeTape`, a percent format and units
  in `InstrumentStats`, and minute labels on short chart windows.

## Rejected alternatives

- **A Node worker per provider, as for EODHD:** a child process and a build
  step for one socket that the pinned Python dependency already handles.
- **The 20-level book:** a ladder that changes every 5 seconds does not read
  as live.
- **A separate `live: enabled` setting:** a second switch beside native
  enablement, for a keyless source.
- **Leaving reconnects to the platform:** its retry waits at least 15 seconds,
  and Hyperliquid disconnects without notice.
- **Showing the perp on the Bitcoin page:** a perp's price is not the asset's
  price; the backbone keeps them separate subjects.
