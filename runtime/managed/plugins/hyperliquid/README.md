# Hyperliquid live market connector

Native `pythia-hyperliquid` streams one Hyperliquid perpetual market while a
page shows it: the top five book levels per side, recent trades, a 15-minute
last-trade line and the perp context (mark, oracle, hourly funding, open
interest). It needs no key and has no worker process. It serves core's
`market_data.live` operation and returns core's `live_market` snapshot
([ADR 0040](../../../../docs/decisions/0040-data-concepts-and-agent-tools.md)).

## Opt-in

The plugin is installed **disabled**. Hyperliquid publishes no data licence,
and its interface terms restrict some jurisdictions (including US persons), so
opening a socket to it is the investor's choice:

```sh
hermes -p <profile> plugins enable pythia-hyperliquid
```

Until then the perp page shows the live section as turned off. Data is shown
locally to the investor only; nothing is stored or published
(`rights.cache: none`, `hostable: false`).

## Operation

| Operation | Input | Result |
| --- | --- | --- |
| `live_market` | `subject_id` (a `market:` subject) and `native_ref` (`hyperliquid`/`perp`, the coin, such as `BTC`) | One `live_market` snapshot. Under the Desk's update channel it pushes snapshots at most four times a second until the page leaves |

Core addresses the plugin through its curated market table
(`runtime/managed/core/identity/markets.json`); the section request carries both
arguments, so the agent replays it for a one-shot read (it waits up to 10 s).

## Behaviour

- One websocket for every watched perp, opened with the first viewer and closed
  2 seconds after the last one leaves (the platform's release grace).
- Before subscribing, the coin is checked against `meta`: an unknown or delisted
  perp is refused, because Hyperliquid answers a bad subscription by closing the
  whole connection.
- The line is seeded with closed 1-minute candles from before the view opened,
  then continues with the last trade of each second.
- Disconnects are reconnected here with a 1 to 30 s backoff and kept as gaps;
  after 20 s without a connection the snapshot turns stale and the platform
  retries.
- Buyer and seller addresses in trades are dropped on receipt.
- Unexpected shapes raise drift alarms: logged once, and shown for five minutes
  after the last occurrence (`source_drift` when a part was dropped,
  `source_extra` when an unknown field was only reported). A changed `meta`
  refuses the view instead of looking like a lost connection.
- A one-shot read (the agent) gets the line at one point a minute, with its
  first, last, high and low in `line_summary`. Field meanings, the audit and the alarms are in the
  [source record](../../../../docs/sources/hyperliquid.md).
