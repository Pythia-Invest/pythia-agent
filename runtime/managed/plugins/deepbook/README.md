# DeepBook catalogue connector

Native `pythia-deepbook` adds DeepBook V3 order books (pools) on Sui to Pythia as
subjects, with links to their base and quote coin types. It needs no key and has no
worker process. It is part of the Sui experiment (branch `exp-sui`), one plugin for
one protocol API, beside `pythia-navi`, `pythia-cetus` and `pythia-suilend`.

It is identity and catalogue only: no order books, trades, volume or prices.

## Opt-in

Installed **disabled**: its contract is unsigned
([ADR 0042](../../../../docs/decisions/0042-source-onboarding-standard.md)) and the
indexer documents no terms or rate limit. Enabling it is the investor's choice; its
data stays on the device (`rights.hostable: false`).

```sh
hermes -p <profile> plugins enable pythia-deepbook
```

## Operation

`catalogue` takes `scope` (`protocols` or `pools`) and answers one complete
`ClaimBatch` (ADR 0038). Core's identity sync reads `protocols` then `pools` on the
investor's request; nothing schedules it. A sync makes one request,
`GET https://deepbook-indexer.mainnet.mystenlabs.com/get_pools` (14 KB, 26 pools),
kept for an hour.

## Subjects and keys

| Indexer record | Subject | Keys |
| --- | --- | --- |
| DeepBook V3 | `protocol` | `sui_package` `0x2c8d603b…4809` (the original package of `pool::Pool<B, Q>`); native `deepbook-v3` |
| A pool | `market` | `sui_object`: `pool_id` (also its native `pool` reference) |
| A coin | `listing` | `caip19`, by coin type |

- A pool is named "DeepBook SUI_USDC", the indexer's `pool_name`. Base and quote
  are real roles here, so each pool states `market_asset` edges with role `base`
  and `quote`.
- Only the 26 pools `/get_pools` lists. `/pool_created` holds 89: the other 63 are
  permissionless pools the indexer does not curate, and are not read.
- Fees, tick, lot and minimum size are not stated. Governance changes them, and the
  indexer's own copies go stale (`/get_pools` said SUI_USDC tick size 100 while the
  pool object said 10).
- No rank: the indexer has no liquidity figure.

## Drift alarms

Warnings: `invalid_reference`, `duplicate_pool` (two records share an object id;
neither is kept) and `unkeyed_coin_type`. An answer of another shape, or with no
pool, fails as `invalid_response` and is not cached.

Field meanings, the terms and what was measured are in the
[source record](../../../../docs/sources/deepbook.md).
