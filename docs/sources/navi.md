# NAVI source record

[Source onboarding](../architecture/source-onboarding.md) defines the stages
([ADR 0042](../decisions/0042-source-onboarding-standard.md)).

**Status: in development (experimental). Disabled by default; not signed off; kept for future reference.** This applies to NAVI's on-chain key statements (`sui_object` and `sui_package`); the catalogue read is the older, separate part. See [ADR 0048](../decisions/0048-sui-defi-experiment.md).

- **Status:** not signed off; ships opt-in. The plugin is installed disabled
  (a product default), and enabling it is the investor's opt-in; once enabled
  it is a source like any other. It introduces subjects only it describes (its
  protocol and lending reserves) and links each reserve to the Sui coin type it
  holds by CAIP-19; it asks no identity question.
- **Owner:** `runtime/managed/plugins/navi/` (`catalogue.py` parses and builds
  claim batches; `__init__.py` reads and caches).
- **Scope:** one keyless read, `GET
  https://open-api.naviprotocol.io/api/navi/pools?env=prod&market=<keys>`,
  served as the bulk catalogue scopes `protocols` (one record) and `reserves`,
  for the markets in the `navi_markets` setting (all 11 the SDK names when unset
  or empty). Reserve parameters (LTV, liquidation threshold, caps, rates,
  incentives), e-mode, vaults, positions, prices and the chain itself are out of
  scope.
- **Measured on:** 2026-09-30, one machine. `/api/navi/pools` for all 11
  markets is about 150 KB and 62 reserves; `main` alone is 86 KB and 35
  reserves (24 active, 11 deprecating). All 62 reserves hold one of 38 distinct
  coin types; all 38 have a CAIP-19 key (the longest encoded form is 115
  characters of the 128 allowed). All 62 Pool object ids are distinct, and
  each object's own on-chain type, `Pool<T>`, names the same coin as the API
  (checked through Sui GraphQL; the plugin does not repeat the check). Nothing
  but a trimmed test fixture was stored in the repository.
- **Measured through core:** the plugin's one real read, ingested into a copy
  of a dev store that already held a DeFiLlama Sui sync (2026-09-30): 62
  reserves and the protocol introduced, nothing unmatched, conflicting or
  rejected, and no warning. Of 38 token records, 35 joined a subject already
  there (33 DeFiLlama's, SUI and native USDC core's curated ones) and 3 were
  introduced (AUSD, eACRED, YBTC.B). The pools and protocols of the two sources
  stayed separate.
- **Sui experiment (in development):** reserves state their Pool object id as
  `sui_object` and the protocol states the original package of `lending_core`
  (`0xd899cf7d…81ca`) as `sui_package`, so their subjects are
  `market:sui_object:<id>` and `protocol:sui_package:<id>`. The display names of
  the markets follow `/api/navi/markets`. The measurements here predate both.
- **Changes to other sources' adapters:** none. The plugin reads no other
  source: its tokens join DeFiLlama's because both name a coin type, not
  because either looks at the other.

## Terms

NAVI publishes no terms for its open API, no rate limit and no status page
(none found in the SDK documentation, the README or the site). Its Terms of
Service cover use of the platform, and its SDK (`@naviprotocol/lending`) is MIT
licensed, which is a licence for code, not data. The contract therefore declares
the closest honest class, `licence: personal`, with `hostable: false` and
`cache: unlimited`, and credits "Data from NAVI Protocol" as a courtesy. The
plugin is local, opt-in and makes one request a sync, the same request NAVI's
own app makes.

Field citations: the SDK source (`@naviprotocol/lending` 2.0.12, MIT, `pool.ts`,
`types.ts`, `market.ts`) and the documentation at
[sdk.naviprotocol.io](https://sdk.naviprotocol.io/lending), "SDK" below. NAVI's
own "Supported Assets" page is out of date (it lists USDCet and USDTeth); the
API is authoritative.

## 1. Field semantics

| Field | Official definition | Pythia meaning | Measured behaviour | Read |
| --- | --- | --- | --- | --- |
| `contract.pool` | Object id of the reserve's `Pool<T>` (SDK `Pool.contract`) | Native reference, scope `reserve`, and the `sui_object` key: the reserve's ID | A 66-character lowercase id for all 62 reserves, all distinct; the object's type names the coin | Yes |
| `suiCoinType` | The coin type, as a full Sui type | The coin the reserve holds: `market_asset` link, a `listing` keyed by CAIP-19 | Always `0x` plus the address. `coinType` is the same without `0x` and not zero-padded, so core's pattern would refuse it: never read | Yes |
| `market` | The market key (SDK `MARKETS`) | Which reserves a setting takes; part of the name through the SDK's display name | 11 keys; `main` has 35 reserves, `ember` 3, `rwa` 3, `sui-eco` 7, the seven pair markets 2 each | Yes |
| `token.symbol` | The token's symbol | The token's label; part of the reserve's name | Drifts: `vSUI` here, `VSUI` at DeFiLlama; `wBTC`/`WBTC` for three different coins in one market. A symbol never identifies | Yes |
| `isSuiBridge`, `isWormhole`, `isLayerZero` | Bridge flavour of the coin | The bridge tag in the label ("suiUSDT (Sui Bridge)") | Independent booleans; at most one is true on any reserve | Yes |
| `isDeprecated` | Reserve is being wound down | `status: inactive` | True for 11 reserves of `main`; `status` reads `deprecating` with it. The app marks the whole `ember` market "Deprecating" while its API records are not flagged: the API decides | Yes |
| `totalSupplyAmount`, `borrowedAmount`, `oracle.price` | Supplied and borrowed amounts in units of 1e-9 of the coin; the oracle's USD price (SDK `getPools` computes its supply and borrow values the same way) | `rank.tvl_usd` = (supplied - borrowed) x price, DeFiLlama's definition for lending: a search rank signal only. A record missing one of the three has no rank | `main-10` USDC: about $36.7M supplied and $25.2M borrowed, so $11.5M, DeFiLlama's $11.48M for the same pool | Yes |
| `id`, `uniqueId` | The reserve's number in its market; `<market>-<id>` | Not read | `id` is contiguous in `main`; deprecated reserves stay listed. Its permanence rests on NAVI's discipline, unlike the object id | No |
| `isIsolated` | Not documented | Not read | `false` on all 62 reserves although NAVI presents some markets as isolated risk silos | No |

Relevant unread fields: rates, caps, `ltv`, `liquidationFactor`,
`borrowRateFactors`, incentive APYs, `contract.reserveId` (empty outside
`main`), `oracleId`, `tags`, `meta.emodes`. They are the reserve-detail read's
data, not identity, and wait for stage 1.

## 2. Adapter and drift alarms

- [x] Every field has one parse and one meaning (`catalogue.py`).
- [x] Claims name subjects by the plugin's own references (the Pool object id,
  the protocol slug) or by CAIP-19 for a Sui coin type, in the profile core
  applies. A symbol, name or market never joins anything.
- [x] Picks no winner and reads no other source. Two records that share a Pool
  object id are both left out.
- [x] An answer with no reserve is an error, never an empty complete scope.
- [x] Only direct field values are `source_asserted`.
- [x] Unexpected input is counted in a warning, never coerced.
- [x] A structural break (another shape, no reserve) fails the read as
  `invalid_response` and is not cached.
- [x] Pages continue from the last Pool object id emitted, so an answer
  refreshed mid-sync never skips a reserve both snapshots hold.
- [x] Network-free tests use fixtures cut from NAVI's own responses
  (`runtime/test/python/test_navi_catalogue.py`,
  `fixtures/navi-pools.json`: 13 of the 62 reserves, trimmed to the fields read).

| Fingerprint check | Baseline | Alarm |
| --- | --- | --- |
| Answer is `{code: 0, data: [...]}` with at least one reserve | 62 reserves in the 11-market answer | `invalid_response` (error, no page, not cached) |
| A record's fields parse: a valid Pool object id, market key, symbol, boolean `isDeprecated`, string `suiCoinType` | 62 of 62 | `invalid_reference` warning with a count; the records are left out |
| Every record's `market` is one asked for | 62 of 62 | `unexpected_market` warning; the records are left out |
| Pool object ids are distinct | 62 of 62 | `duplicate_pool` warning; every record sharing an id is left out |
| Every coin type has a CAIP-19 key | 38 of 38 | `unkeyed_coin_type` warning; the reserve is kept without a token link |
| Every requested market returns a reserve | 11 of 11 | `empty_market` warning naming the markets |

There is no alarm for a market NAVI launches later: the plugin carries the SDK's
11 keys and does not read `/api/navi/markets`, which lists them. The setting `navi_markets`
replaces that default, as `defillama_chains` does its own, so the investor lists
all 11 keys and the new one; until then its reserves are not in the catalogue.

## 3. Identifiers of introduced subjects

| Subject | ID | Why |
| --- | --- | --- |
| Protocol | `protocol:sui_package:0xd899cf7d…81ca` (native `navi-lending`) | The original package of `lending_core` (26 versions), constant across upgrades; NAVI publishes no protocol id. NAVI Prime, Volo and the vaults are not modelled |
| Reserve | `market:sui_object:<Pool object id>` | A permanent on-chain object that is globally unique (62 of 62) and verifiable without NAVI. `uniqueId` is readable and is the SDK's address, but its permanence rests on NAVI; a coin has up to nine reserves, so the coin type alone is no key |
| Sui token deployment | `listing:caip19:sui:mainnet/coin:<type>`, SUI as `…/slip44:784` | An on-chain coin type is portable: DeFiLlama naming it reaches the same subject, and core's curated SUI and native USDC listings are reached this way |

NAVI and DeFiLlama join at the token only. DeFiLlama states no on-chain
address for a pool or a protocol, so a NAVI reserve and a DeFiLlama pool for
the same coin stay two subjects, adjacent on the token's page, and the two
"NAVI Lending" protocols stay two. A rule that fused a reserve with a pool
(same protocol, same coin) would be wrong across markets, and a curated bridge
is the founder's decision ([ADR 0038](../decisions/0038-plugin-addressing-contract.md)).
A market is part of a reserve's name, not a subject: no relation joins a
reserve to a market group, and `part_of` ends at the protocol.

## 4. Data audit

Not yet sampled. The measured cases:

| Case | Count | Example | Handling | Status |
| --- | --- | --- | --- | --- |
| Native USDC | 9 reserves in 9 markets | `main-10`, `ember-0`, `rwa-0` | `0xdba3…::usdc::USDC` is one token subject and links to core's curated Sui USDC deployment; nine reserves | Handled |
| Same symbol, different coins | `wBTC`/`WBTC` ×3 in `main` | Sui Bridge `…::btc::BTC`, LayerZero `…::wbtc::WBTC`, deprecated Wormhole `…::coin::COIN` | Three subjects, each labelled with its bridge | Handled |
| Coins DeFiLlama's Sui pools do not hold | 3 of 38 | AUSD, eACRED, YBTC.B, all deprecated or in a deprecating market | Introduced by NAVI | Handled |
| Reserve of a deprecating market | 3 (`ember`) | `ember-0` | The API flags none of them: `status: active` | Accepted |
| Deprecated reserve | 11 of 62 | `main-8`, Wormhole WBTC | `status: inactive`: found in search marked Delisted, below live reserves; its page still opens | Handled |
| Generic or over-long coin type | 0 of 62 | Longest 115 characters | Not keyed if one appears; the reserve is kept without a token link | Handled |
| Reward coins (`rewardCoin`) | 4 types | Volo's `CERT` | Not modelled: no relation for them | Accepted |

## 5. Judgement cases

None: the source asks no identity question.

## Sign-off

- [ ] A labelled random sample of reserves and their coin types.
- [ ] Reviewer, date and PR are recorded.

Open items accepted for the first version:

- NAVI publishes no data terms for its open API; opt-in and local only. Open:
  ask NAVI whether the API may be used by a desktop app before sign-off.
- A new market needs its key listed in `navi_markets` beside the others, which the
  setting replaces rather than extends; `/api/navi/markets` would list them, and
  is not read.
- Reserves are not fused with DeFiLlama's pools, and the two NAVI Lending
  protocols stay separate (a founder decision).
- An on-chain check that each Pool object's type matches its coin (three
  batched Sui GraphQL reads; 62 of 62 agreed on 2026-09-30) is not in the plugin.
  The public GraphQL endpoint is labelled beta, so a failure would warn, never
  block.
- No rates, caps or LTVs: a reserve-detail read and agent tool are a later stage.
