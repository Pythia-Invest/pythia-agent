# CoinMarketCap connector

`pythia-coinmarketcap` is a native plugin that depends on `pythia-market-data`.
It supplies a crypto **catalogue** for the local directory, aggregate **quotes**
and price samples through the common market-data reads, and coin **profiles**
(description, logo, links, deployments) as page content. It has no provider
search operation: search reads the local directory, which `catalogue` feeds.

Each HTTPS read runs in one isolated standard-library worker (`worker.py`, run
with the pinned Hermes interpreter and `-I`) under the market-data connector
budget. Requests go only to fixed `https://pro-api.coinmarketcap.com` endpoints,
never follow redirects, and address coins by numeric CoinMarketCap ID.

## Configuration

`configuration.json` declares one required field, `coinmarketcap_api_key`
(kind `secret`). Put it in `secrets.json` in the Pythia config folder
(`${XDG_CONFIG_HOME:-~/.config}/pythia`, mode 0600). The plugin
reads it through `platform.configuration.value`. Until that core module lands,
`config.py` holds a transitional one-line shim over the same custody reader.

Without a usable key every tool returns core's standard `needs_configuration`
result and makes no request. The quote currency defaults to USD:
`hermes -p <profile> coinmarketcap-config --currency EUR`.

## Operations

| Tool | Endpoint | Caching |
| --- | --- | --- |
| `catalogue` | `/v1/cryptocurrency/map` (active coins, ordered by ID) plus one `/v3/cryptocurrency/listings/latest` read of the top 500 by market cap | Map pages are not cached; the listings read is shared for one hour |
| `profile`, `details` | `/v2/cryptocurrency/info` | Six hours in memory, shared by both |
| `series`, `latest`, `history`, `read_batch` | `/v3/cryptocurrency/quotes/latest`, `/v3/cryptocurrency/quotes/historical` | Quotes coalesce into native requests of up to 100 IDs (one credit each) and are reused for ten minutes; history for fifteen |

The common reads are marked for the market-data owner (`details`, `series`,
`latest`, `history`, `read_batch`); `search` is deliberately absent.

## Catalogue rows

A page holds up to 2,000 active coins ordered by permanent coin ID, so offsets
stay stable while ranks move. Continue with `next_cursor` until it is null. A
coin activated or retired during a sync can shift one row; the next sync repairs
it. Each row is shaped for the plugin addressing contract (ADR 0038, pending):

- `native_ref` (`provider: coinmarketcap`, `native_scope: coin`, numeric
  `native_id`), `level: crypto`, `asset_class: crypto`, `status`, `name`, `symbol`.
- `identifiers`: `cmc.id`, `cmc.slug` and `symbol` at the asset level, plus the
  map's main platform contract as a `contract_address` at the deployment level.
- `rank`: CoinMarketCap's `cmc_rank` for every active coin, and `market_cap`
  (decimal string, currency, observation time) for the top 500. Missing values
  stay unknown; a failed listings read leaves ranks and adds a warning.

Symbols are not unique, and a shared contract address is not proof that two
providers mean the same asset. Rows are source-asserted evidence; the core
decides every join.

CoinMarketCap uses two network namespaces. The map names a token's platform by
a platform ID (Ethereum is platform 1); info names each deployment's chain by
that chain's own coin ID (Ethereum is coin 1027). The connector keeps them
distinct (`coinmarketcap:platform:<id>` and `coinmarketcap:coin:<id>`) with the
chain's name, slug and symbol. Two chains can share a native coin (BNB Beacon
Chain and BNB Smart Chain), so `details` evidence keys a deployment's network by
coin ID plus the platform name as a slug (`coinmarketcap:coin:1839:bnb-smart-chain-bep20`).
That is enough for a core CAIP-2 table to derive CAIP-19 later. CoinMarketCap
lists wrapped representations for some native coins (SOL shows the wrapped-SOL
mint); the mapping must not treat those addresses as the native asset.

## Plan limits and terms

Measured with a free Basic key on 2026-09-25 through `/v1/key/info`:
15,000 credits a month, 50 requests a minute, no daily credit limit, reset on
the first of the month (UTC). Observed credit use: map 0 (top 200 by rank, and
paging by ID); listings 1 for 200 rows (documented as one credit per 250 rows
per convert currency); quotes 1 for Bitcoin, Ether and Solana together; info 1
for the same three; historical quotes 1 for three daily points; key info 0. The
Basic plan includes these endpoints, with historical quotes limited to one month
intraday and one year daily ([pricing](https://coinmarketcap.com/api/pricing/),
[endpoint reference](https://coinmarketcap.com/api/documentation/pro-api-reference/cryptocurrency)).

The local request budget is 30 requests a minute, leaving room for other use of
the same account. A daily catalogue sync costs about 2 credits (the listings
read); pages of the ID map are free. Ten watched coins at the ten-minute quote
cadence cost about 144 credits a day. Other devices and tools share the
account's quota, and local counters cannot see them.

The pricing page describes the Basic plan as free, with a commercial-use licence
for one product and no redistribution or resale of the data as a standalone
service; CoinMarketCap's [best practices](https://coinmarketcap.com/api/documentation/guides/best-practices)
allow local caching that supports the application. Pythia therefore:

- keeps CoinMarketCap data on the device and never republishes it; the
  directory may retain catalogue metadata and market caps for at most one day
  (`retention` on every page) before the next sync replaces them;
- keeps quotes, profiles and history only in bounded in-memory caches;
- labels every result with CoinMarketCap, the native reference and the source
  or retrieval time; and
- never commits provider responses. Tests use synthetic values.

## Not included

- Provider search, and the old Desk `coinmarketcap-key` settings route
  (replaced by `configuration.json`).
- The keyless public API: a structural probe on 2026-09-25 returned HTTP 429
  (error 1022) from the shared IP pool, and its terms are unstated.
- Global metrics, Fear & Greed, trending and categories, which served the
  earlier Markets dashboard, and exchange, DEX and derivatives data.
