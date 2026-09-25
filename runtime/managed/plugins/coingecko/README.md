# CoinGecko connector

Native Hermes plugin `pythia-coingecko`. It reads CoinGecko's coin catalogue,
aggregate prices and exact coin metadata through a standard-library worker
(`runtime/managed/runner/coingecko/main.py`) under the pinned Hermes Python.
There is no SDK, separate Python environment or provider search operation:
investment search is a local directory read owned by core, and this plugin
only contributes catalogue rows and content.

## Operations

| Tool | What it reads | Key |
| --- | --- | --- |
| `pythia_coingecko_catalogue` | Active coins with IDs, symbols, names and platform contracts | Optional |
| `pythia_coingecko_details` | Exact `/coins/{id}` metadata and network-scoped contract evidence | Optional |
| `pythia_coingecko_series`, `_latest`, `_history`, `_read_batch` | Standard market-data series over `/simple/price`, `/coins/{id}/market_chart` and `/ohlc` | Optional |
| `pythia_coingecko_dashboard` | Up to three coins as quotes or rolling charts for widgets | Required |

Only the standard read operations carry the market-data contribution marker.
Hourly and daily OHLC ranges need paid access.

## Access and configuration

`configuration.json` declares one optional secret, `coingecko_api_key`. Settings
stores it in Pythia's device credential store; the connector reads it in process
through core configuration and sends it only as the `x-cg-demo-api-key` or
`x-cg-pro-api-key` header, never in a URL, argument, log or result.

The native plugin setting `mode` (CLI: `coingecko-config --mode`) defaults to
`auto`:

| Saved key | `auto` uses | Works |
| --- | --- | --- |
| none | keyless public access | catalogue, details and price reads at low limits |
| valid | Demo access | everything above plus automatic dashboard refresh |
| invalid | nothing | every tool reports `unavailable`; no silent keyless fallback |

`demo`, `paid` and `keyless` force one mode; paid access is always explicit
because it uses the separate `pro-api` host. A failed request never changes the
mode or selects another source. `coingecko-config` reports the resolved access
(`keyless`, `demo`, `paid` or `unavailable`), never the key. The local budget
defaults to 10 requests per minute keyless and 30 with a key (`requests_per_minute`).

## Catalogue

One sync makes two bulk requests, each counted by the shared connection budget:

1. `/coins/list?include_platform=true`: every active coin with its source
   platform contracts. Measured 2026-09-25: 21,587 coins, 20,781 with at least
   one contract, 37,175 contracts on 304 platforms, 3.9 MB of JSON. The worker
   raises its output bound for this read only.
2. `/coins/markets` (top 250 by market cap, USD): `market_cap_rank` and
   `market_cap` as rank signals. A zero market cap means unknown supply and is
   kept unknown. Prices and volumes are not retained.

A rank failure leaves rank facts unknown and never discards the list. Pages of
at most 1,000 rows share one 30-minute in-memory snapshot with a content-derived
version. Each row carries `provider_ref`, `name`, `symbol` and source-asserted
identifiers: `coingecko.id`, `symbol` and `contract_address` with its CoinGecko
platform `network`. Symbols, contracts and ranks never prove equivalence between
coins or providers; the identity owner decides joins and derives CAIP-19.

Native coins such as Bitcoin, Ether and Solana carry no contract. Joining
native coins across providers, and mapping platform names to CAIP-2 chains,
needs a core-owned table (CAIP-19 `slip44` IDs); the connector emits neither.

## CoinGecko plans and terms

Checked 2026-09-25; the account's own terms govern use.

- [Demo plan](https://www.coingecko.com/en/api/pricing): free, 10,000 calls per
  month and 100 calls per minute. Each HTTP 200 counts one credit. Base URL
  `https://api.coingecko.com/api/v3`.
- [Keyless public API](https://docs.coingecko.com/docs/keyless-public-api): same
  host, about 10 to 30 calls per minute shared per IP, and documented as not
  suitable for production workloads, scheduled polling or high-frequency
  updates. Automatic dashboard refresh therefore requires a key.
- Source caches: `/coins/list` refreshes every 30 minutes and `/coins/markets`
  every 60 seconds on Demo and keyless.
- [API Terms](https://www.coingecko.com/en/api_terms) (updated 5 September
  2025): no selling, sub-licensing, redistribution or syndication of API access
  (4.1.6); visible "Powered by CoinGecko" attribution (4.4); caching is
  discouraged and a cache must be refreshed at least every 24 hours (6.1.1); no
  storing or deriving data beyond what the terms allow (6.2).

Pythia never redistributes CoinGecko data. Each user supplies their own key,
data stays on the device, and the catalogue declares a one-day retention bound
(`retention.max_age_seconds: 86400`) for any local reference index built from it.
Showing the attribution next to CoinGecko-sourced content is the displaying
surface's responsibility.
