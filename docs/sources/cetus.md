# Cetus source record

[Source onboarding](../architecture/source-onboarding.md) defines the stages
([ADR 0042](../decisions/0042-source-onboarding-standard.md)). Part of the Sui
experiment on branch `exp-sui` (not a decided design).

- **Status:** not signed off; ships opt-in (installed disabled, the investor's
  choice to enable).
- **Owner:** `runtime/managed/plugins/cetus/` (`catalogue.py` parses and builds
  claim batches; `__init__.py` reads and caches).
- **Scope:** `GET https://api-sui.cetus.zone/v2/sui/stats_pools?order_by=-tvl&limit=100&offset=N`,
  read until a page ends below US$1,000 of liquidity, served as the bulk
  catalogue scopes `protocols` (one record) and `pools`. Prices, volume, fee
  income, APR, rewards, vaults, positions and the aggregator are out of scope.
- **Measured on:** 2026-09-30, one machine, keyless: 44,480 pools in all; 4
  requests (about 850 KB) reach the floor; 306 pools are over it, with 234
  distinct coin types, all with a CAIP-19 key; all 600 pools read had a
  distinct object id and a fee label equal to the pool's on-chain `fee_rate`,
  and none was closed or paused. Through the plugin's reader: 1,458 claims, no
  warning. Nothing but a trimmed test fixture (7 pools) was stored.
- **Changes to other sources' adapters:** none. DeFiLlama's own label for the
  same pool differs ("25%" for 0.25%); the two sources do not read each other.

## Terms

Cetus publishes no terms for this API that I found, and the route is the one its
own SDK calls (`stats_pools_url`). It answers `x-ratelimit-limit: 300, 300;w=60`.
The contract therefore declares `licence: personal`, `hostable: false`, and the
connector keeps to 60 requests a minute.

## 1. Field semantics

| Field | Pythia meaning | Measured behaviour | Read |
| --- | --- | --- | --- |
| `address` | The pool's object id: `sui_object` key and native reference | 66-character lowercase, distinct in all 600 records read | Yes |
| `coin_a_address`, `coin_b_address` | The pool's coins, as coin types (`0x0…02::sui::SUI` in long form) | Normalised by core's Sui profile; coin A is `base`, B `quote` in the pool's own price (A in B, checked against `current_sqrt_price` for SUI/USDC) | Yes |
| `coin_a.symbol`, `coin_b.symbol` | Labels in the pool's name and the token's name | Drift: "PNUT " carries a trailing space, so symbols are trimmed | Yes |
| `fee`, `object.fee_rate` | Fee tier as a percent string, and in ppm on chain | `fee` x 10,000 equals `fee_rate` for all 600; a mismatch leaves the pool out | Yes |
| `pure_tvl_in_usd` | Reserves priced by Cetus: the floor, and `rank.tvl_usd` | Descending order confirmed over 600 pools; 306 at or over US$1,000 | Yes |
| `is_closed`, `object.is_pause` | Pool is closed or paused: `status: inactive` | False for all 600 | Yes |
| `symbol`, `name`, `tick_spacing`, `price`, `vol_in_usd_24h`, `fee_24_h`, `apr`, rewarders, vaults | Not read | `symbol` is always coin A then B; `price` did not match the pool's own price for SUI/USDC | No |

## 2. Adapter and drift alarms

- [x] Every field has one parse and one meaning, keyed by a global identifier
  (`sui_object`, `sui_package`, `caip19`).
- [x] Picks no winner and reads no other source.
- [x] An answer with no pool over the floor is an error, never an empty complete scope.
- [x] Only direct field values are `source_asserted`.
- [x] Unexpected input is counted in a warning, never coerced (except trimming a symbol).
- [x] Network-free tests use fixtures cut from Cetus's own response
  (`runtime/test/python/test_cetus_catalogue.py`, `fixtures/cetus-stats-pools.json`).

| Fingerprint check | Baseline | Alarm |
| --- | --- | --- |
| Answer is `{code: 0, data: {lp_list: [...]}}` with a pool over the floor | 306 pools | `invalid_response` (error, not cached) |
| A record's fields parse | 600 of 600 | `invalid_reference` warning with a count |
| Fee label equals the on-chain fee rate | 600 of 600 | `fee_mismatch` warning; the pool is left out |
| Every coin type has a CAIP-19 key | 612 of 612 | `unkeyed_coin_type` warning |
| The floor is reached within 20 requests | 4 requests | `floor_not_reached` warning |

## 3. Identifiers of introduced subjects

| Subject | ID | Why |
| --- | --- | --- |
| Protocol | `protocol:sui_package:0x1eabed72…b2fb` | The original package id of the pool type; constant across upgrades. Any Sui source stating it joins. The plugin's name is "Cetus CLMM" (Cetus DLMM has another package) |
| Pool | `market:sui_object:<pool object id>` | A permanent on-chain object, stated identically by the chain. A second fee tier of one pair is a second pool |
| Coin | `listing:caip19:sui:mainnet/coin:<type>` | As NAVI and DeFiLlama |

## 4. Data audit

Not sampled. Measured cases:

| Case | Count | Handling | Status |
| --- | --- | --- | --- |
| Launch-pad dust pools | about 44,170 of 44,480 | Under the floor: not subjects | Handled (floor stated) |
| One pair in several fee tiers | SUI/USDC at 0.05% and 0.25% | Two pools, names differ by tier | Handled |
| Pair orientation | Cetus USDC/SUI, Bluefin SUI/USDC | The name follows Cetus's order; never evidence | Accepted |
| A pool that crosses the floor | not measured | Not emitted, or marked not seen on the next sync | Accepted |
| Core has no fee attribute | every pool | The tier is part of the name | Gap (experiment) |

## Sign-off

Open, as for any opt-in source: a labelled sample of pools against the chain;
the reviewer, date and PR.
