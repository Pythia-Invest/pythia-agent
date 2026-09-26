# EODHD connector

`pythia-eodhd` is a bundled Hermes-native connector that requires the
market-data feature. It is enabled on fresh profiles and makes no provider
request until it is configured. It has no provider `search` operation:
discovery is Pythia's local directory read, and the connector contributes
catalogue rows, identifier claims and content.

## Configuration

`configuration.json` declares one required secret, `eodhd_api_token`. The
investor adds it by hand to `secrets.json` (mode `0600`) in the Pythia config
folder; there is no settings UI. The connector reads it only through core's
`platform.configuration`. Until it is set, every tool returns core's
`needs_configuration` result without provider work. A token does not enable the
plugin or prove plan entitlement.

## Operations

| Operation | Tool | Returns |
| --- | --- | --- |
| `details`, `series`, `latest`, `history`, `read_batch` | shared market-data reads | Catalogue metadata and distinct series: daily OHLC and adjusted close (≤366 days), delayed quote, intraday 1m/5m/1h (≤7 days), explicit EDGX |
| `catalogue` | `eodhd-catalogue` | Paged exchange symbol list for `AS`, `NASDAQ`, `NYSE`, `LSE`, `XETRA`, `FOREX`, bound to one snapshot |
| `identifiers`, `reverse` | agent tools | [ID mapping](https://eodhd.com/financial-apis/id-mapping-api-cusip-isin-figi-lei-cik-%E2%86%94-symbol) by symbol or ISIN, at most 4 pages of 100 |
| `news` | `eodhd-news` | Up to 30 ticker-linked headlines in an explicit window (default 30 days) |
| `fundamentals` | `eodhd-fundamentals` | Statement facts; a plan without the dataset returns `not_entitled`, not missing data |
| `dashboard` | `eodhd-dashboard` | Up to 10 US/INDX delayed quotes or recent bars |

Missing values stay missing; GBP/GBX scale is never guessed.

## Identifiers

Identifiers are typed source assertions
`{scheme, value, level, authority: "source_asserted"}`: ISIN and CUSIP are
security-level, LEI and CIK issuer-level, FIGI level `null`. Details and
catalogue rows carry ISIN only; the mapping operations add CUSIP, FIGI, LEI and
CIK. Invalid values are dropped. A catalogue ISIN can describe an underlying
security, so these are claims for Pythia's join, never identity proof.

## Streaming

EDGX streaming is off until `eodhd-streaming --mode demo|account`, and serves
only an explicit `venue: XEDX` series. SDK reconnects are disabled: connection
loss retires the worker and clears retained observations; the shared demand
owner resubscribes and a resumed child reports `stream_gap`. A retained snapshot
reaches a new subscriber only if nothing invalidated it. The worker stops when
its last consumer leaves or the plugin unloads. EDGX is one venue, not SIP/NBBO.

## Custody and rights

Workers receive the token on owned stdin with an allowlisted environment, no SDK
retries and bounded outputs; tokens and raw error bodies never reach tool
results or the browser. The shared governor counts actual requests. EODHD's
[personal-use terms](https://eodhd.com/financial-apis/terms-conditions) allow
private local storage and analysis, not redistribution. Tests are synthetic and
never contact EODHD.
