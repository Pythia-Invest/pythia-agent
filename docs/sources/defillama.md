# DefiLlama source record

[Source onboarding](../architecture/source-onboarding.md) defines the stages
([ADR 0042](../decisions/0042-source-onboarding-standard.md)).

- **Status:** not signed off; ships opt-in. The plugin is installed disabled
  (a product default), and enabling it is the investor's opt-in; once enabled
  it is a source like any other. It introduces subjects only it describes
  (protocols and pools) and links pools to token deployments by CAIP-19; it
  asks no identity question.
- **Owner:** `runtime/managed/plugins/defillama/` (`catalogue.py` parses and
  builds claim batches; `__init__.py` reads and caches).
- **Scope:** two keyless directory reads, `GET https://api.llama.fi/protocols`
  and `GET https://yields.llama.fi/pools`, served as the bulk catalogue scopes
  `protocols` and `pools` for the chains in the `defillama_chains` setting (Sui
  when unset or empty; `all` for every chain). Protocol metrics, pool APY and TVL history, charts, stablecoin
  data and every paid (`pro-api`) endpoint are out of scope.
- **Measured on:** 2026-09-30, one machine, one read of each directory:
  `/pools` 11.6 MB in 0.38 s, 16,919 pools, 288 of them on Sui across 13
  projects; `/protocols` 9.0 MB in 0.38 s, 8,421 protocols, 126 listing Sui.
  Nothing was stored in the repository.
- **Changes to other sources' adapters:** none.

## Terms

DefiLlama's [terms](https://defillama.com/terms) (last updated 24 June 2025)
grant a licence to use the site "for personal, non-commercial purposes"
(section 7) and forbid republishing "the data in any form without permission"
(section 8.7); programmatic access must use its official public API (section
8.9). They say nothing about caching or attribution. The contract therefore
declares `licence: personal`, `hostable: false` and `cache: unlimited`, and
credits "Data from DefiLlama" as a courtesy. The plugin is local and opt-in.

Citations for fields: the free API documentation
([api-docs.defillama.com](https://api-docs.defillama.com/), "TVL" `/protocols`
and "Yields" `/pools`, summarised in
[llms-free.txt](https://raw.githubusercontent.com/DefiLlama/api-docs/main/llms-free.txt)),
"API" below.

## 1. Field semantics

| Field | Official definition | Pythia meaning | Measured behaviour | Read |
| --- | --- | --- | --- | --- |
| protocol `id` | Protocol id (API); no stability is documented, and the API addresses protocols by slug | Native reference, scope `protocol`: the protocol's ID | Unique; numeric text from 2 to 8813 for 8,420 of 8,421, with gaps (removed ids are not refilled); it survived all 196 renames (MakerDAO's `118` is `sky-lending`). One, OpenTrade's, is `<5471>`, apparently hand-typed: core hashes a reference it cannot spell into its ID, so that protocol re-keys if DefiLlama corrects it | Yes |
| protocol `slug` | Protocol slug, used in `/protocol/{protocol}` (API) | Joins a pool's `project` to its protocol; never an ID | Follows renames: all 196 protocols with `previousNames` carry the new name's slug (`sky-lending`, formerly MakerDAO) | Yes |
| protocol `name` | Protocol name | Label | — | Yes |
| protocol `chains` | Chains the protocol is on | Which protocols a chain setting takes | Names differ from `/pools`: `Binance` and `Optimism` there are `BSC` and `OP Mainnet` here; one protocol with a Sui pool lists no chain | Yes |
| protocol `deadFrom`, `deprecated` | Not documented | `status: inactive` | 760 protocols dead or deprecated | Yes |
| pool `pool` | Pool id, used in `/chart/{pool}` (API) | Native reference, scope `pool`: the pool's ID | A UUID for every pool | Yes |
| pool `project` | The project the pool belongs to (API) | `part_of` the protocol with that slug | Every one of 496 projects is a current `/protocols` slug | Yes |
| pool `chain` | Chain name | Which pools a chain setting takes; Sui pools get token links | 288 pools on `Sui` | Yes |
| pool `symbol`, `poolMeta` | Pool symbol; pool detail such as a fee tier | Label ("NAVI Lending USDC", "Cetus CLMM USDC-SUI (0.25%)") | 223 Sui pools carry `poolMeta` | Yes |
| pool `underlyingTokens` | The pool's underlying token addresses | On Sui, the coin types the pool holds: `market_asset` links | 484 entries on Sui, 132 distinct types; SUI written both `0x2::sui::SUI` (33) and in long form (100); null on 2 non-Sui pools | Yes |
| pool `tvlUsd` | Total value locked, USD | A search rank signal only (`rank.tvl_usd`) | — | Yes |

Relevant unread fields: `apy`, `apyBase`, `apyReward`, `rewardTokens`,
`stablecoin`, `exposure`, `ilRisk` and the prediction fields. They are the
yield monitor's data, not identity, and wait for stage 1.

## 2. Adapter and drift alarms

- [x] Every field has one parse and one meaning (`catalogue.py`).
- [x] Claims name subjects by the plugin's own references (protocol id, pool
  UUID), observed stable though not documented as such, or by CAIP-19 for a Sui
  coin type, in the profile core applies. A symbol or name never joins
  anything.
- [x] Picks no winner and reads no other source.
- [x] A malformed record is left out and counted in an `invalid_reference`
  warning; a directory whose shape breaks fails the read as `invalid_response`
  and is not cached.
- [x] A chain in the setting that no pool or protocol is on is reported
  (`unknown_chain`): a warning beside the others, or an error with no page when
  none matches, so a misspelling never ends a scope empty and `complete`.
- [x] Pages continue from the last native id emitted, so a directory refreshed
  mid-sync never skips a record both snapshots hold.
- [x] A coin type without a CAIP-19 key (generic, or over 128 characters) is
  not emitted, so it cannot make core refuse the batch.
- [x] Network-free tests use synthetic fixtures shaped like the API
  documentation (`runtime/test/python/test_defillama_catalogue.py`).

## 3. Identifiers of introduced subjects

| Subject | ID | Why |
| --- | --- | --- |
| Protocol | `protocol:provisional:defillama:protocol:<id>` | Observed stable, not documented: ids survived every measured rename, while the slug changes on one, so a slug would re-key the protocol or, reused, name another |
| Pool | `market:provisional:defillama:pool:<uuid>` | DefiLlama's own pool id, the key of its pool pages and charts |
| Sui token deployment | `listing:caip19:sui:mainnet/coin:<type>`, SUI as `…/slip44:784` | An on-chain coin type is portable: another plugin naming it reaches the same subject, and core's curated SUI and native USDC listings are reached this way |

Two plugins describing one protocol still give it two IDs: there is no open
protocol identifier, and the link stays unresolved.

## 4. Data audit

Not yet sampled. The measured Sui cases:

| Case | Count | Example | Handling | Status |
| --- | --- | --- | --- | --- |
| Native USDC pools | 73 entries | NAVI Lending USDC (`0fddbf5d-ec14-4570-80d3-a70c85573d3e`), Scallop Lend USDC (`ddf68725-6ced-4c27-90ca-c14752cd7218`) | `0xdba3…::usdc::USDC` links to core's curated Sui USDC deployment | Handled |
| Wormhole USDC | 7 pools | NAVI Lending WUSDC, `0x5d4b…::coin::COIN` | Its own subject, never merged with native USDC | Handled |
| Generic or over-long coin type | 0 of 484 | Longest 108 characters | Not emitted if one appears | Handled |
| A pool's protocol lists no chain | 1 | `ondo-yield-assets` | Taken with the chain it runs a pool on | Handled |
| Control character in a symbol | 1 pool (Starknet) | — | Record left out and counted | Handled |
| One coin, several symbols | 5 of 39 labelled coin types | Sui Bridge USDT is `SBUSDT`, `SUIUSDT` and `USDT` | Labelled by its struct name where a pool uses it (`USDT`), else by the most common symbol; ties go alphabetically (Sui Bridge ETH is `SBETH`) | Accepted: a label is never evidence |
| Suilend has no yield pool | — | Suilend is in `/protocols` only | A protocol without pools | Accepted |

## 5. Judgement cases

None: the source asks no identity question.

## Sign-off

- [ ] A labelled random sample of pools and their coin types.
- [ ] Reviewer, date and PR are recorded.

Open items accepted for the first version:

- Personal, non-commercial terms: opt-in and local only.
- Token links on Sui only; pools elsewhere link to their protocol alone.
