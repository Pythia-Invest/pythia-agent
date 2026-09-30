# Suilend source record

[Source onboarding](../architecture/source-onboarding.md) defines the stages
([ADR 0042](../decisions/0042-source-onboarding-standard.md)). Part of the Sui
experiment on branch `exp-sui` (not a decided design).

- **Status:** not signed off; ships opt-in (installed disabled).
- **Owner:** `runtime/managed/plugins/suilend/` (`catalogue.py` parses and
  builds claim batches; `__init__.py` reads and caches).
- **Scope:** `GET https://lending.api.sui-prod.bluefin.io/markets` and
  `/proxy/prices?addresses=…` (the price check), served as the bulk catalogue
  scopes `protocols` (one record) and `markets`. Reserve configuration, rates,
  caps, positions, history and the chain itself are out of scope.
- **Measured on:** 2026-09-30, one machine, keyless: `/markets` is 8 KB and 7
  markets; 5 list reserves (43 coins in Main Market; the chain holds 45), 2
  (Bitwise, Securitize) answer `reserveOrder: null`; 48 distinct coin types, all
  keyable; one price request of 48 coins, 47 priced and one `missing` (`sdeusd`).
  Through the plugin's reader: 67 claims, warnings `unlisted_reserves` and
  `unpriced_coin`. Nothing but trimmed test fixtures was stored.
- **Changes to other sources' adapters:** none.

## Terms

Suilend publishes no terms for this API that I found. It answers 300 requests a
minute for `/markets` and 60 for prices (`x-ratelimit-limit`), and only for paths
on an allowlist (others answer 403). The SDK calls the related events route
"experimental", and the host moved to `bluefin.io` after the acquisition. The
contract declares `licence: personal`, `hostable: false`; the connector keeps to
30 requests a minute.

## 1. Field semantics

| Field | Pythia meaning | Measured behaviour | Read |
| --- | --- | --- | --- |
| `id` | The `LendingMarket` object id: `sui_object` key and native reference | 66-character lowercase, distinct for 7 of 7 | Yes |
| `name` | The market's name, after "Suilend" | "Main Market", "Matrixdock Market" | Yes |
| `isHidden` | Hidden in the app: `status: inactive` | False for all 7 | Yes |
| `reserveOrder` | The coin types of the market's reserves: `market_asset` edges of role `supply` | Display order; `null` for 2 of 7; 43 for Main, 45 on chain | Yes |
| `/proxy/prices` `data`, `missing` | Whether Suilend can price a listed coin; no price is read into a claim | 47 of 48 priced; FUD at $7.9e-9 is a real price, unlike its on-chain placeholder | Checked, not stated |
| `type`, `lendingMarketOwnerCapId`, `displayOrder`, `iconUrl`, `timestamp` | Not read | `type` names a marker type, not the package | No |

A reserve is not a subject: it is a field inside the market object and the API
names no id for it, so it cannot carry a `sui_object` key. The market is the
subject and its reserves are its edges.

## 2. Adapter and drift alarms

- [x] Every field has one parse and one meaning, keyed by a global identifier.
- [x] Picks no winner and reads no other source. Two records sharing an object
  id are both left out.
- [x] No price is ever stated; an unpriceable coin is alarmed.
- [x] Unexpected input is counted in a warning, never coerced.
- [x] Network-free tests use fixtures cut from Suilend's responses
  (`runtime/test/python/test_suilend_catalogue.py`, `fixtures/suilend-*.json`).

| Fingerprint check | Baseline | Alarm |
| --- | --- | --- |
| Answer is a list with at least one market | 7 markets | `invalid_response` (error, not cached) |
| A record's fields parse | 7 of 7 | `invalid_reference` warning with a count |
| Market object ids are distinct | 7 of 7 | `duplicate_market` warning; both left out |
| Every market lists its reserves | 5 of 7 | `unlisted_reserves` warning |
| Every coin type has a CAIP-19 key | 48 of 48 | `unkeyed_coin_type` warning |
| Every listed coin has a usable price | 47 of 48 | `unpriced_coin` warning |
| The price service answers | yes | `prices_unavailable` warning; the catalogue is still served |

## 3. Identifiers of introduced subjects

| Subject | ID | Why |
| --- | --- | --- |
| Protocol | `protocol:sui_package:0xf95b0614…6ddf` | The original package id of `LendingMarket<P>` (25 versions); SpringSui and STEAMM are other families |
| Market | `market:sui_object:<LendingMarket id>` | A permanent on-chain object; the API gives it |
| Coin | `listing:caip19:sui:mainnet/coin:<type>` | Linked only: the API names no coin, so no token is introduced |

## 4. Data audit

Not sampled. Measured cases:

| Case | Count | Handling | Status |
| --- | --- | --- | --- |
| Placeholder on-chain prices | FUD, SUDENG and others | No on-chain price is read and none is stated | Handled |
| Markets with no `reserveOrder` | 2 of 7 | Subjects without token links, warned | Accepted |
| API markets vs the chain registry | 7 of 26 | The API's list is the curated one; the other 19 are test and experimental markets | Handled |
| Same coin in several markets | USDC in all 5 markets that list reserves | One edge per market | Handled |

## Sign-off

Open: a labelled sample against the chain; the reviewer, date and PR.
