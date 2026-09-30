# Cetus catalogue connector

Native `pythia-cetus` adds Cetus CLMM pools on Sui to Pythia as subjects, with
links to the two Sui coin types each holds. It needs no key and has no worker
process. It is part of the Sui experiment (branch `exp-sui`), one plugin for one
protocol API, beside `pythia-navi`, `pythia-suilend` and `pythia-deepbook`.

It is identity and catalogue only: no prices, volume, fees earned, positions or
rewards. Pool figures come later, as a read operation rather than identity claims.

## Opt-in

Installed **disabled**: its contract is unsigned
([ADR 0042](../../../../docs/decisions/0042-source-onboarding-standard.md)) and
Cetus publishes no data terms for its stats API. Enabling it is the investor's
choice; its data stays on the device (`rights.hostable: false`).

```sh
hermes -p <profile> plugins enable pythia-cetus
```

## Operation

`catalogue` takes `scope` (`protocols` or `pools`) and an optional `cursor`, and
answers one page of a `ClaimBatch` (ADR 0038) with `next_cursor`. Core's identity
sync pages `protocols` then `pools` on the investor's request (Settings, Data,
Data sources, "Sync now"); nothing schedules it.

A sync reads `GET https://api-sui.cetus.zone/v2/sui/stats_pools?order_by=-tvl&limit=100&offset=N`
four times (100 pools, about 210 KB each), stops at the first page that ends
below the liquidity floor, and keeps each answer for an hour. The connector
allows 60 requests a minute; Cetus states 300.

## Subjects and keys

| Cetus record | Subject | Keys |
| --- | --- | --- |
| Cetus CLMM | `protocol` | `sui_package` `0x1eabed72…b2fb` (the original package of `pool::Pool<A, B>`); native `cetus-clmm` |
| A pool | `market` | `sui_object`: the pool's object id (also its native `pool` reference) |
| A coin | `listing` | `caip19`, by coin type |

- **Liquidity floor: US$1,000.** Cetus lists 44,480 pools, nearly all launch-pad
  dust. Only pools whose `pure_tvl_in_usd` (the reserves priced by Cetus) is at
  least US$1,000 are subjects: 306 on 2026-09-30. Smaller pools are not
  subjects and are not re-emitted as inactive; a pool that falls under the floor
  is marked not seen. The liquidity is also kept as `rank.tvl_usd` for search.
- A pool is named "Cetus USDC/SUI 0.25%": the coin symbols in the API's order,
  then the fee tier, which is part of a pool's identity (one pool per pair and
  tier) and has no attribute of its own in core. DeFiLlama labels the same pool
  "25%"; this plugin also checks Cetus's label against the pool's on-chain
  `fee_rate`.
- `market_asset` roles: coin A is `base` and coin B `quote` in the pool's own
  price (the price of A in B). That is the pool's convention, not a trading one,
  and Cetus's order differs from other sources (Bluefin lists SUI first).
- A closed or paused pool is `status: inactive`.

## Drift alarms

Warnings: `invalid_reference` (malformed records left out), `fee_mismatch` (fee
label differs from the on-chain rate; left out), `unkeyed_coin_type` and
`floor_not_reached` (the list ran 2,000 pools deep without reaching the floor).
An answer of another shape, or with no pool over the floor, fails as
`invalid_response` and is not cached.

Field meanings, the terms and what was measured are in the
[source record](../../../../docs/sources/cetus.md).
