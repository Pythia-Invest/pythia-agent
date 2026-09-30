# Hyperliquid source record

[Source onboarding](../architecture/source-onboarding.md) defines the stages
([ADR 0042](../decisions/0042-source-onboarding-standard.md)).

- **Status:** not signed off; ships opt-in. The plugin is installed disabled
  (a product default), and it creates no identity: its only subject is core's
  curated market. It is not counted as the source in onboarding (FIRDS is);
  this record documents its stages 1 to 3 so far.
- **Owner:** `runtime/managed/plugins/hyperliquid/` (`feed.py` parses, `stream.py`
  owns the socket). Core's `identity/markets.json` lists the one market it
  serves, and the plugin's contract declares its coin for it.
- **Scope:** the public websocket `wss://api.hyperliquid.xyz/ws` (`l2Book` with
  `fast: true`, `trades`, `activeAssetCtx`) and two info reads (`meta`, 1-minute
  `candleSnapshot`) for perps on the first perp dex. HIP-3 builder dexes, spot,
  user channels and every write endpoint are out of scope.
- **Measured on:** 2026-09-28, from one machine: a 150-second websocket session
  on BTC (plus one resubscription), a 40-second session per edge case, and the
  info reads below, then a live run through the dev stack: 2.5 to 2.9 snapshots a
  second over the update channel, the first after 1.4 s cold, and no upstream
  connection before or 6 s after the last viewer. A snapshot measured 4.5 to
  5.6 KB in the first minute of a view; the line gains about 41 one-second
  points a minute (about 26 bytes each), so a full 15-minute window reaches
  about 20 KB. The agent's one-shot read keeps one point a minute. Nothing was
  stored in the repository.
- **Changes to other sources' adapters:** none.

Citations:

- [Websocket](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket)
  and [subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions), "WS" below;
- [Timeouts and heartbeats](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/timeouts-and-heartbeats);
- [Info endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)
  and [perpetuals](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals), "Info" below;
- [Notation](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/notation);
- [Rate limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits);
- [Funding](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding) and
  [robust price indices](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/robust-price-indices).

## 1. Field semantics

| Field | Official definition | Pythia meaning (`live_market`) | Measured behaviour | Read |
| --- | --- | --- | --- | --- |
| `l2Book.levels` | WS `WsBook`: `[bids, asks]` of `WsLevel`; "5 levels if fast, 20 levels if slow" | `book.bids`/`book.asks`, `depth: snapshot` | Every message is a full snapshot. Fast: 5/5 levels about every 530 ms. Slow: 20/20 levels about every 5.4 s. Never crossed, always ordered | Yes, fast |
| `WsLevel.px`, `sz`, `n` | Price; size "in units of coin"; number of orders (Notation) | Level price, size (`unit.kind: coin`), order count | Decimal strings; `n` an integer ≥ 1 | Yes |
| `l2Book.time` | Epoch milliseconds (WS) | `book.time` | About 430 ms behind the local clock (median), 2.2 s at worst; never went backwards | Yes |
| `trades[].side` | "B = Bid = Buy, A = Ask = Short. Side is aggressing side for trades" (Notation) | Aggressor `buy`/`sell` | Only `A` and `B` | Yes |
| `trades[].px`, `sz`, `time`, `tid` | Price, size, time; `tid` a "50-bit hash of (buyer_oid, seller_oid)"; unique by (time, coin, tid) (WS) | Tape row `[time, price, size, side]`; (time, tid) removes replayed trades | Messages hold 1 to 121 trades, oldest first; no duplicate (time, tid) | Yes |
| `trades[].users`, `hash` | Buyer and seller addresses; transaction hash (WS) | Never kept | Always two addresses | No |
| `activeAssetCtx.ctx.markPx` | Median of oracle-based, book-based and external perp prices; used for margining and PnL; updated about every 3 s (price indices) | `context.mark`, the headline price | String | Yes |
| `ctx.oraclePx` | "Weighted median of CEX spot prices" (price indices) | `context.oracle` | String | Yes |
| `ctx.midPx` | Mid price (Info) | `context.mid` | String; `null` when the book is empty | Yes |
| `ctx.funding` | The rate paid every hour at one eighth of the 8-hour formula, capped at 4% an hour (Funding) | `context.funding.rate_1h`; `next_time` is the next full hour | String such as `0.0000125`; `fundingHistory` settles at hh:00:00 | Yes |
| `ctx.openInterest` | Total open interest (Info) | `context.open_interest`, in coins | String; `0.0` on a delisted market | Yes |
| `ctx.prevDayPx` | "Previous day's closing price" (Info) | `context.prev_day`, the 24h change basis | **A rolling price from 24 h ago**, not a UTC-day close: it moved within minutes and matched the 1-minute candle 24 h earlier | Yes |
| `ctx.dayBaseVlm` | Daily base volume, documented for HIP-3 dexes only (Info) | `context.day_volume`, in coins, over 24 h | Present for BTC on the first dex | Yes |
| `ctx.dayNtlVlm` | Daily notional volume (Info) | None: the schema has no notional volume | String | Parsed for drift only |
| `candleSnapshot` `t`, `T`, `c` | Open and close milliseconds, close price; only the latest 5,000 candles (Info) | Closed minutes seed the line as `[T, c]`, `seeded_from: candle_1m` | The last candle is the running minute (`T` after now) and is left out | Yes |
| `meta.universe[].name`, `isDelisted` | Asset name; delisted flag (Info) | Whether a coin may be watched | 234 perps, 56 delisted | Yes |

Relevant fields not read:

- `ctx.premium` and `ctx.impactPxs`: the premium index sample and impact prices
  behind funding. Not needed for the view; mark and oracle are shown instead.
- `bbo`: best bid and offer about every 76 ms. The fast book already carries it.
- `l2Book` `nSigFigs`/`mantissa` grouping: no grouping control in this version.

## 2. Adapter and drift alarms

- [x] Every field in the table has one parse and one meaning (`feed.py`).
- [x] Claims keyed by a global identifier: not applicable, the source makes no
  identity claims. Its market is keyed by core's curated `market:pythia:…` ID.
- [x] Picks no winner and reads no other source. An empty book is shown as empty.
- [x] Unexpected input is counted and logged once per path, never coerced. It
  shows in the snapshot's `issues` for five minutes after its last occurrence:
  `source_drift` when a part was left out, `source_extra` when an unknown field
  was only reported. A time far from the local clock and a connection closed
  right after subscribing may be local or the network, so they are logged, not
  shown. A changed `meta` refuses the view with `source_drift`; it is not
  reported as a lost connection.
- [x] A structural break (a missing field, a number where a string is expected,
  an unordered or crossed book, a funding rate past the cap, a clock far off)
  drops that part of the snapshot and says why. Nothing is coerced.
- [x] Network-free tests use synthetic fixtures shaped like the documentation
  (`runtime/test/python/test_hyperliquid_live.py`).

A live source has no build, so the fingerprint checks run on every message
and surface in the snapshot and the Hermes log instead of a manifest.

| Check | Baseline | Alarm |
| --- | --- | --- |
| Channels | `subscriptionResponse`, `l2Book`, `trades`, `activeAssetCtx`, `pong`, `error` | Unknown channel |
| Field sets | The table above | Missing field breaks the part; an extra field is reported |
| Value types | Decimal strings (the documentation types context values as numbers; the source sends strings) | Any other type |
| Book shape | ≤ 5 levels, bids falling, asks rising, not crossed | Break |
| Times | Within 10 minutes of the local clock; books never go back | Break (logged only), or the older book is dropped and counted |
| Funding | \|rate\| ≤ 4% an hour | Break |
| Trade side | `A`, `B` | Break |
| `error` messages | None | Reported |
| `meta` universe | `name`, `szDecimals`, `maxLeverage` and the audited optional keys | The view is refused (`source_drift`) and checked again after a minute |
| Our own output | Core's `validate_live_market` | Not published, reported |

## 3. Data audit

A random, labelled sample is not applicable yet: the source is one market's
live state, not a record set. The audit was a measurement of the live feed.

### Odd cases

| Case | Count | Example | Explanation | Handling | Status |
| --- | --- | --- | --- | --- | --- |
| A bad subscription closes the whole connection | 5 of 5 cases | An unknown coin, `btc` in lower case, `nSigFigs: 7`, `mantissa: 3`: close code 1006 after about 0.8 s, no `error` message | Undocumented | Coins are checked against `meta` first; a close right after subscribing is logged | Handled |
| An unknown method or type gets an `error` message and the connection stays | 2 cases | `l3Book`, `method: bogus` | Documented error channel | Alarm | Handled |
| A duplicate subscription is refused | 1 | "Already subscribed" | — | Not sent | Handled |
| The subscription ack replays recent trades without `isSnapshot` | Every subscription | 30 trades | WS says the ack carries a snapshot; the flag is absent | Replays removed by (time, tid) | Handled |
| The 20-level book is slow | 29 messages in 150 s | About 5.4 s apart | `fast: false` cadence | `fast: true`, 5 levels, about 2 a second | Accepted limit: 5 levels |
| Context values are strings | 146 of 146 | `"markPx": "83036.0"` | The documentation types them as numbers | Parsed as strings; a number is drift | Handled |
| Context carries no time | 146 of 146 | — | — | Receipt time stands in | Handled |
| `prevDayPx` is rolling | — | 84,881 then 84,987 six minutes later | Documented as the previous day's close | Labelled "24h" | Handled |
| Undocumented `fast: true` on fast books | Every fast book | `{"coin": "BTC", "time": …, "levels": […], "fast": true}` | Echoes the subscription flag; not in the documented `WsBook`. The drift alarm caught it on the first live run | Accepted when `true`; anything else is drift | Handled |
| Undocumented `spread` on grouped books | 7 of 7 | `nSigFigs: 5` | — | Not subscribed; would be an alarm | Handled |
| A delisted market still answers | 56 perps | Empty book every 5.4 s, a trade from 2024, context with `null` mid, premium and impact prices, zero open interest | Delisting | Refused before subscribing (`delisted`) | Handled |
| Unknown coin on the info endpoint | 1 | HTTP 200 with `null` | — | `meta` decides instead | Handled |
| Trades arrive late | 2,615 trades | 440 ms median, 12 s at worst behind the local clock | Block time | Shown with their own time | Accepted |

Not observed in the audit window: an unannounced server disconnect, a halted
market that still lists, out-of-order books or trades. The adapter handles each
(reconnect with a gap, an explicit empty book, a dropped older book), but they
need a longer capture to measure.

## 4. Judgement cases

None: the source asks no identity question. Which perp is a derivative on which
asset is core's curated table (`native_markets@1`), reviewed like code.

## Sign-off

- [ ] Every stage meets its exit criteria.
- [ ] A longer capture that includes a server disconnect.
- [ ] Reviewer, date and PR are recorded.

Open items accepted for the first version:

- Data terms: no published data licence; the plugin is opt-in and personal.
- Only BTC is curated as a market subject.
