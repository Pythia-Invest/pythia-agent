# EODHD connector

`pythia-eodhd` is a bundled Hermes-native connector requiring the market-data
feature. It is enabled on fresh profiles and makes no provider request until its
declared configuration is complete. Updates preserve native plugin/toolset
choices and edited copied packages. The retired core `pythia_eod_prices` tool
and managed Python environment are not restored.

The package owns common financial contributions, specialist reads, identifier and
catalogue operations, and the `pythia-eodhd:eodhd` skill. The shared market-data
owner keeps canonical identity, source preferences, read coordination and the
financial wire contract. Core keeps protected transport and native access checks.

The connector has no provider `search` operation. Investment discovery is a
local directory read owned by Pythia; a connector contributes catalogue rows,
identifier claims and content, never search-time results.

## Configuration and native access

`configuration.json` at the package root declares one required field,
`eodhd_api_token` of kind `secret`: the investor adds it by hand to
`secrets.json` (mode `0600`) in the Pythia config folder. There is no settings
UI or EODHD-specific settings route. The connector reads the value only
through core's `platform.configuration` (until that lands, a marked interim
shim reads the same `secrets.json` field through the market-data helper).
Adding the token does not enable the plugin, change toolsets, restart Hermes or probe
provider access. Until the token is configured, every EODHD tool answers with a
`needs_configuration` issue ("EODHD needs an API token") and makes no provider
request.

Use the selected installation's pinned Hermes executable and profile for native
commands. `just dev-paths` reports development paths; installed paths come from
the lifecycle receipt. The shell must supply its `HERMES_HOME`,
`PYTHIA_CONFIG_ROOT`, absolute `PYTHIA_MANAGED_ROOT` and `PYTHIA_NODE`; a global
Hermes or Python installation is not required. With `native` denoting that
profile-scoped Hermes invocation, an existing profile opts in with:

```sh
native plugins enable pythia-eodhd --no-allow-tool-override
native tools enable pythia-eodhd-market-data --platform api_server
native tools enable pythia-market-data --platform api_server
```

Restart the selected stack after native configuration changes. CLI research uses
its own `--platform cli` toolset choices. Missing configuration, a disabled
feature, connector or applicable toolset deny reads without provider work. Local readiness
does not establish provider-plan entitlement. Existing canonical preferences and
retained series determine which eligible source a read uses.

## Shared financial operations

`details`, `series`, `latest`, `history` and `read_batch` are native financial
contributions. The shared `pythia_market_data` tool exposes them through
canonical resolution and preferred/pinned reads. Native references retain
`provider: eodhd`, `native_scope: catalogue`, exact `SYMBOL.EXCHANGE`, and evidenced
qualifiers. `details` reads exact catalogue metadata through the SDK search
endpoint filtered to the reference's exchange; it is not free-text discovery.
Only exact Common Stock metadata supplies a native instrument assertion. A ticker
match or catalogue suffix does not establish a primary venue or cross-provider
identity.

| Series | Semantics and Pythia bounds |
| --- | --- |
| Daily OHLC | Trading dates, raw OHLC and split-adjusted share volume; at most 366 days |
| Daily adjusted close | Scalar close adjusted for splits/dividends; separate from raw OHLC |
| Latest | Delayed scalar quote with actual or unknown observation time |
| Intraday 1m/5m/1h | UTC bar start and nominal end; at most 7 days; adjustment, finality and feed class remain unknown |
| Explicit EDGX | USD US stock trades or minute bars; venue XEDX, separate from delayed REST reads |

Daily adjustments follow the [EOD fields](https://eodhd.com/financial-apis/api-for-historical-data-and-volumes).
The [delayed quote](https://eodhd.com/financial-apis/live-ohlcv-stocks-api) and
[intraday](https://eodhd.com/financial-apis/intraday-historical-data-api) endpoints
have different meaning. Successful transport does not prove completed bars or
complete coverage. GBP/GBX price scale remains unknown; no conversion is guessed.
Decimal strings preserve the finite number parsed by the SDK, not unavailable
original lexical precision. Missing values stay missing and zero stays zero.

## Identifiers and catalogue

Identifiers leave the connector as typed source assertions:
`{scheme, value, level, authority: "source_asserted"}`. ISIN and CUSIP are
security-level, LEI and CIK issuer-level (CIK zero-padded to ten digits). EODHD
does not qualify FIGI grain, so its level is `null`. Invalid values are dropped,
not passed through. These are claims for Pythia's join, not identity proof: a
catalogue ISIN can describe an underlying security (for example a CEDEAR), so the
connector never turns it into wire identity evidence.

- `details` and `catalogue` rows carry `identifiers` with the row's ISIN;
  several distinct ISINs for one symbol set `identifier_conflict`.
- `pythia_eodhd_identifiers` (by exact symbol) and `pythia_eodhd_reverse_isin`
  read the [ID mapping](https://eodhd.com/financial-apis/id-mapping-api-cusip-isin-figi-lei-cik-%E2%86%94-symbol)
  endpoint: at most 4 pages of 100 records, never following returned URLs, one
  record per symbol with its typed identifiers. Incomplete or conflicting
  pagination stays visible and never becomes a unique identity.
- `catalogue` (`eodhd-catalogue`) pages a resident, connection-scoped
  [exchange symbol list](https://eodhd.com/financial-apis/exchanges-api-list-of-tickers-and-trading-hours)
  snapshot for `AS` (Euronext Amsterdam, operating MIC XAMS), `NASDAQ`, `NYSE`,
  `LSE`, `XETRA` or `FOREX`. EODHD does not paginate this endpoint. One bounded
  response is compacted before crossing the worker boundary; later pages reuse
  it. A snapshot hash binds cursors and a changed snapshot aborts the chain.
  Output exceeding the worker's bound is an error, never a silently truncated
  catalogue. `NASDAQ`/`NYSE` rows use the `.US` API namespace and keep the
  returned exchange as venue metadata.

Reference metadata may be retained locally for 24 hours after an explicit sync.
This is an application freshness bound, not a provider-imposed expiry. EODHD's
[personal-use terms](https://eodhd.com/financial-apis/terms-conditions) permit
storage, manipulation and analysis for private, non-commercial investment use;
nothing here grants redistribution or commercial rights. There is no automatic
startup import.

## Content operations

- `news` (`eodhd-news`) retains at most 30 headlines, original links,
  publication instants and the provider's many-to-many symbol mentions, without
  article bodies. The default window is the preceding 30 days through today's
  UTC date; optional `from`/`to` dates allow up to 366 days. The result keeps the
  inclusive query dates and limit; absence from this bounded feed does not
  establish absence from the full history.
- `fundamentals` (`eodhd-fundamentals`) requests only the `Financials` section
  and normalizes five supported statement concepts from up to eight annual and
  eight quarterly records each, newest first, at most 30 facts. Provider field
  names, currency, reporting end dates and supplied filing dates stay explicit;
  period starts are never inferred. Fundamentals are a separate EODHD
  entitlement. A plan without it (HTTP 403) returns outcome `empty` with
  `capability: {dataset: "fundamentals", status: "not_entitled"}` and a
  `not_entitled` warning: a visible capability gap, not a failed read and not
  missing data. It never authorizes another source. Other denials keep their
  `access_denied` error.

## Specialist operations and streaming

The connector deliberately declares protected read-only operations on its native
tools; the shared platform routes them under
`/v1/pythia/plugins/pythia-eodhd/{operation}`:

- `eodhd-dashboard`: up to 10 explicit US/INDX delayed quotes, or recent
  closed EDGX one-minute bars for US stocks and five-minute EODHD intraday bars
  for `STOXX50E.INDX`, `GDAXI.INDX` and `FCHI.INDX`. Index-bar completion stays
  unknown. Each chart carries source, feed, interval and completion qualifiers.
  Its `session` is the latest returned calendar date in New York (US) or Paris
  (these indices), not evidence of complete exchange-session coverage.
- `eodhd-volume-ranking`: a Pythia volume ranking of Common Stock listings from
  bulk EOD plus the current exchange catalogue. It preserves dates and limited
  coverage, excludes stale/missing volume rows and costs 100 bulk credits plus the
  catalogue request.
- `eodhd-market-movers`: US NYSE/Nasdaq [Screener](https://eodhd.com/financial-apis/stock-market-screener-api)
  gainers, losers or active stocks, with reported market cap above USD 1 billion
  and last-day volume above 100,000 shares. These are latest known
  completed-session results, not live rankings.
- `eodhd-news`, `eodhd-fundamentals` and `eodhd-catalogue` as described above.

Streaming stays disabled until an explicit native `eodhd-streaming --mode demo`
or `--mode account` choice. Select an evidenced series with `venue: XEDX`; changing
mode never changes a saved REST series. The bounded worker multiplexes trade,
book, status and minute-bar demand. SDK reconnects are disabled: connection loss
retires the owned child, clears retained observations and lets the shared native
demand owner retry active subscriptions after its bounded delay. A retained
snapshot is delivered to a new subscriber only under the stream lock and only if
no loss or staleness invalidated it in between. A resumed child reports
`stream_gap`; elapsed time never repairs an interrupted candle. The worker
releases unused subscriptions and stops when its last consumer leaves or the
plugin unloads (native `on_unload`). Exchange calendar/reference-close evidence
qualifies session context; missing or stale evidence cannot manufacture a
baseline. These [EDGX trades and book quotes](https://eodhd.com/financial-apis/new-real-time-data-api-websockets)
are one venue's data, not consolidated SIP trades or NBBO.

## Build, custody and qualification

Frozen pnpm preparation installs the official `eodhd` 1.1.0 tarball. Explicit
`build:runtime` compiles the allowlisted Node workers before lifecycle copying;
plugin refresh refuses to replace any package while a declared worker source or
its compiled output is missing. Neither reads nor plugin discovery install
dependencies or compile source. The native plugin uses the pinned Hermes
interpreter; no managed Python package or environment is added. The SDK uses
native Node 22 WebSocket support.

Provider workers receive the token on owned stdin with an allowlisted environment,
10-second HTTP timeout and no SDK retries. The shared connection governor counts
actual outbound requests, including setup/fan-out and endpoint credit costs.
Workers suppress SDK logs, bound outputs and are terminated/reaped on cancellation
or deadlines. Native access is checked before reuse and publication. Credentials
and raw error bodies do not cross into browser or tool results.

Synthetic worker, native-package, stream-lifetime and credential tests cover this
supported seam; normal tests never read an account or contact EODHD. They do not
prove live account entitlements, paid-stream availability, real market coverage
or browser behavior. Provider network calls are a separate explicit
qualification.
