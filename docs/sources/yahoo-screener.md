# Yahoo screener source record

- **Status:** in onboarding, stage 3 (stages 1 to 3 recorded here; no stage 4).
  Yahoo was in use before the
  [onboarding standard](../architecture/source-onboarding.md); this record
  covers a new feed of it, the predefined screeners behind core's
  `market_movers` lists. The feed confirms nothing: rows are shown, and core
  names a row's Pythia listing only through an existing reference assertion.
- **Owner:** `runtime/managed/plugins/yahoo-discovery/movers.py` (adapter);
  the worker call is the existing `screener` method in
  `runtime/managed/runner/yahoo.ts`.
- **Scope:** Yahoo's predefined screens `most_actives`, `day_gainers` and
  `day_losers` through `yahoo-finance2` 4.0.2, at most 25 rows each.
- **Measured on:** two live samples of 100 rows per screen, 2026-09-28
  12:10 UTC (US pre-market, the lists showing Friday's session) and
  (regular hours) as noted below. Raw answers stayed on the device.
- **Changes to other sources' adapters:** none.

Citations: the screens' own `rawCriteria` (returned with every answer), and
the `ScreenerQuote` type of `yahoo-finance2` 4.0.2
(`esm/src/modules/screener.d.ts`), "SDK" below. Yahoo publishes no field
documentation; the SDK schema is the closest statement of the shape.

## 1. Field semantics

| Field | Definition, citation | Pythia meaning | Measured behaviour | Read today |
| --- | --- | --- | --- | --- |
| `symbol` | Yahoo symbol (SDK) | The row's Yahoo reference; for these US screens also its ticker | 300/300 present; plain US tickers, class shares with `-` (`BRK-B`) | yes |
| `exchange` | Yahoo venue code (SDK) | Mapped to an operating MIC through the adapter's table: `NMS`, `NGM`, `NCM` → XNAS; `NYQ`, `ASE`, `PCX` → XNYS (NYSE American and Arca are XNYS segments); `BTS` → XCBO; OTC tiers → OTCM | NMS 125, NYQ 135, NCM 20, NGM 14, ASE 4, OID 1, BTS 1 | yes |
| `quoteType` | Instrument type (SDK) | Must be `EQUITY`: the screens ask for equities (`rawCriteria.quoteType`) | EQUITY 300/300 | checked |
| `longName`, `shortName` | Names (SDK; `longName` optional) | Display name: `longName`, else `shortName` | `longName` missing in 2/300 | yes |
| `currency` | Quote currency (SDK) | The unit of price and change | USD 300/300 | yes |
| `regularMarketPrice` | Last regular-session price (SDK) | Last price of the regular session | always present; numbers, int for whole values | yes |
| `regularMarketChange`, `regularMarketChangePercent` | Change and % against `regularMarketPreviousClose` (SDK) | Change since the previous close | recomputed: 0 inconsistencies in 300 rows | yes |
| `regularMarketVolume` | Regular-session volume (SDK) | Shares traded | always present | yes |
| `regularMarketTime` | Epoch seconds (SDK: `number`) | Time of the regular-session values | before the open: Friday 20:00 UTC while `marketState` is PRE | yes |
| `marketState` | Session state (SDK) | `PREPRE`/`PRE` → pre, `REGULAR` → regular, `POST`/`POSTPOST` → post, `CLOSED` → closed | PRE 300/300 in the first sample | yes |
| `fullExchangeName` | Venue name (SDK) | Display only | e.g. NasdaqGS, NYSE, "OTC Markets OTCID" | yes |
| `exchangeDataDelayedBy`, `quoteSourceName` | Delay minutes; feed name (SDK) | Not read: they disagree (0 minutes with "Delayed Quote" on 172 rows) | see odd cases | no |
| `marketCap`, `averageDailyVolume3Month`, pre/post fields | (SDK) | Not read yet | present on nearly every row | no |

The screens' universe, from `rawCriteria`: region US, intraday market cap
from $2B, OTC venues `PNK`, `OQB`, `OQX`, `OEM`, `OGM`, `OBB` and `XXX`
excluded. Gainers need a change above 3% and losers below −2.5%, both a price
of at least $5; most actives a day volume above 5M. The `region` parameter is
ignored (GB, DE and FR return the US list). The Desk labels the lists "US
stocks with a market cap of $2B or more".

## 2. Adapter and drift alarms

- [x] Each read field has one parse and one meaning; the MIC table is the
  plugin's documented venue crosswalk, never identity evidence.
- [x] The adapter picks no winner and reads no other source; core resolves
  `ticker@MIC` against the reference and leaves a row unresolved when no or
  several listings claim it.
- [x] An empty list is shown as empty.
- [x] Unexpected input is counted, never coerced.
- [x] Network-free tests use synthetic rows (`runtime/test/python/test_markets.py`).

| Check (every answer) | Baseline | Alarm |
| --- | --- | --- |
| Field set against the SDK schema plus the fields the audit saw | none unknown | logged for the maintainer, naming the new fields |
| A read field missing or of the wrong type | none | row left out; logged and returned as a `source_drift` issue |
| `exchange` outside the venue table | none | row kept without a MIC (unresolved, marked on the page); logged |
| `marketState` outside the vocabulary | none | logged |
| `quoteType` other than `EQUITY` | none | logged |
| No `quotes` list | – | the read fails with `source_drift` |

Only a structural break (rows that cannot be read) becomes an issue on the
answer, which the agent and developers see; the Markets page shows none of
them. Additive changes leave every shown value intact.

## 3. Data audit

No labelled accuracy sample yet: the feed only displays rows and names their
Pythia listing through existing reference assertions. The checks run on the
live samples:

| Check | Result |
| --- | --- |
| Change equals price minus previous close, % equals change over previous close | 300/300 |
| Gainers sorted by % descending, losers ascending | yes |
| Most actives sorted by `regularMarketVolume` | no: Yahoo sorts by its own `dayvolume`; the source's rank order is kept |
| A symbol on two lists at once (gainer and loser) | none |

### Odd cases

| Case | Count (unit) | Example | Explanation | Handling | Status |
| --- | --- | --- | --- | --- | --- |
| OTC line despite the OTC exclusion | 1/300 rows | `SCGLY`, "OTC Markets OTCID" (`OID`) | `OID` is not in the screens' exclusion list | mapped to OTCM; unresolved when the reference has no such line | handled |
| Lists before the open are the last session's | 300/300 in the first sample | `regularMarketTime` Friday 20:00 UTC, `marketState` PRE | the screens rank regular-session values | rows marked "previous session"; the page shows the quote time | handled |
| Stated delay contradicts the feed name | 172/300 rows | `exchangeDataDelayedBy` 0 with `quoteSourceName` "Delayed Quote" | Yahoo's delay field is not reliable (also seen on indexes) | delay not read; the quote time is shown | accepted |
| Foreign issuers on US venues | 24/300 rows | STLA (EUR financials), NIO (ADR, CNY financials) | US lines of foreign issuers; `financialCurrency` is not the quote currency | not read; the row resolves to its US listing | handled |
| Missing `longName` | 2/300 rows | OLED, RBRK | optional in the SDK | `shortName` | handled |
| Cboe-listed share | 1/300 rows | CBOE on `BTS` | Cboe BZX | mapped to XCBO, the reference builder's operating MIC | handled |
| NYSE American line | 4/300 rows | DNN on `ASE` | a segment of XNYS; the reference keys it at XNYS | mapped to XNYS | handled |
| Share classes of one company | 0/300 rows | – | would be two securities | each row resolves on its own | handled |
| Answer metadata beyond the SDK schema | every answer since 2026-09-29 | `criteriaMeta.includeFields` lists `full_day_price`, `full_day_change` and `full_day_change_percent` | the SDK schema pins that list, so its check failed every answer and all three lists showed "Data unavailable" | the worker skips the SDK's check for the screener (`validateResult: false`); the adapter's checks above cover every field it reads | handled |

## 4. Judgement cases

None: a row is resolved only by an exact `ticker@MIC` assertion in the
reference, otherwise it stays unresolved and is shown without a link.

## Sign-off

- [ ] Every stage meets its exit criteria.
- [ ] Every open item is closed, or accepted with a limit and an owner.
- [ ] The reviewer, date and PR are recorded.
