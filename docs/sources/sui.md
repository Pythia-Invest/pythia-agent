# Sui chain source record

[Source onboarding](../architecture/source-onboarding.md) defines the stages
([ADR 0042](../decisions/0042-source-onboarding-standard.md)). This is slice E2 of
the Sui experiment on branch `exp-sui` (not a decided design; see
`docs/architecture/identity-data.md`).

- **Status:** not signed off; ships opt-in. The plugin is installed disabled and
  enabling it is the investor's opt-in. It introduces the protocols, tokens and
  markets it describes and asks no identity question.
- **Owner:** `runtime/managed/plugins/sui/`. `chain.py` is the one shared chain
  layer; `protocols.py`, `deepbook.py`, `alphalend.py` and `bucket.py` are the
  per-protocol modules; `catalogue.py` builds the claim batches; `__init__.py`
  reads, caches and reports.
- **Scope:** Sui's public GraphQL endpoint, `POST https://graphql.mainnet.sui.io/graphql`,
  keyless, as the bulk catalogue scopes `protocols` (10), `tokens` and `markets`,
  and the read `metrics` (a DeepBook pool's governance parameters). Suilend,
  Scallop, NAVI, Cetus, Bluefin, Turbos and Momentum markets, positions, prices and
  history are out of scope: their markets come from their own APIs (slice E3).
- **Measured on:** 2026-09-30, one machine, keyless. One full sync: 77 requests in
  6 pages, 19 s (a first run took about 40 s: cold lookups on the endpoint took 5
  to 16 s and were retried). It stated 10 protocols, 99 tokens (8 Wormhole wrapped,
  3 Sui Bridge, 35 with a readable supply, none unnamed) and 97 markets (41 DeepBook
  V3 of 89 pools, 36 AlphaLend, 20 Bucket), and warned of 4 market assets with no
  CAIP-19 key (two generic receipts in AlphaLend, two in Bucket). The shared chain
  layer is 288 lines (195 without comments and docstrings), the rest of the code 505
  lines and the seed list 171.
- **Changes to other sources' adapters:** none.

## Terms

Sui's public endpoints carry "strict rate limits" and are "not for production"
(Sui documentation); no data terms are published. The chain's data is public.
The contract declares `licence: personal`, `hostable: false`, `cache: unlimited`.
The connector allows two concurrent reads and 240 a minute, a local ceiling, not a
published quota.

## 1. What the endpoint does (measured)

| Limit | Measured | What the plugin does |
| --- | --- | --- |
| Payload | 5,000 bytes including variables ("Query payload too large") | Batches are cut under 4,900 bytes; a refusal is the `payload_rejected` alarm |
| Page | 50 nodes | Cursor loops, at most 40 pages |
| Backing-store lookups | 21 a request; one `coinMetadata` costs about 2, with `supply` about 3. The aliases past the budget carry an error and the rest answer | An alias-level error halves the batch; one alone is an alarm |
| Latency | 0.2 to 0.5 s, with cold lookups of 5 to 16 s | Core's transport waits 5 s; a timeout halves a batch or retries a single read, three times |
| Retention | Current objects only | Nothing here needs history |

## 2. Field semantics

| Read | Meaning | Measured |
| --- | --- | --- |
| `package(address: id, version: 1)` | The family's original id: the answer is `id` exactly when `id` is original. `package(address: id)` is the latest version | All 13 ids of `protocols.PROTOCOLS` are original, with 2 to 26 versions. Upgrades do not change the key |
| `objects(filter: {type})` | Every object of a type, any type arguments | DeepBook V3: 89 pools. AlphaLend: one `LendingProtocol` |
| `coinMetadata(coinType)` | Name, symbol, decimals and supply of the coin, from the registry `0xc` or the legacy `CoinMetadata` | `supply` is null where the TreasuryCap is wrapped (LSTs, sCoins, Wormhole coins). SUI's is its 10 billion cap |
| Sui Bridge `0x9` `inner` `treasury.supported_tokens` | The coins the bridge supports, by token id | 4: ETH, USDT, BTC and WLBTC. The origin asset is fixed by the bridge and is not on Sui |
| Wormhole Token Bridge `State` `token_registry` `Key<coin>` | `WrappedAsset<coin>`: origin chain, origin address, native decimals; or `NativeAsset<coin>` for a Sui coin it custodies | 450 wrapped, 60 native. Wrapped coins are all `<package>::coin::COIN` |
| DeepBook `Pool<Base, Quote>` `inner` | The one dynamic field holds the book, vault and governance `trade_params` (fees scaled 1e9, stake in DEEP at 6 decimals) | Resting orders, from none to 1,782. Fees change by vote at an epoch |
| AlphaLend `LendingProtocol.markets` | A table of 36 `Market`s, values wrapped; the dynamic-field object is the addressable one | `borrow_limit` is 0 on all 36; 34 are `active` |
| Bucket `Config` | Eight objects: `PackageConfig` (the original id of ten families) and the vault registry (20 collateral types to `Vault<T>` objects) | The chain holds 21 `Vault` objects; the registry lists 20 |

## 3. Adapter and drift alarms

- [x] Every read has one parse and one meaning.
- [x] Claims name subjects by `sui_package`, `sui_object` or CAIP-19, never by a
  name or a symbol.
- [x] Unexpected input is counted and left out, never coerced; an answer with no
  protocol or no market fails.
- [x] Network-free tests use objects cut from these reads (`test_sui_catalogue.py`).

| Alarm | Raised when |
| --- | --- |
| `package_unknown`, `package_not_original`, `package_family_changed` | A protocol's package is not on chain, is not the original of its family, or its latest version lost the anchor module (`pool`, `lending_market`, `market`, `alpha_lending`, `vault`). The protocol and, as `unverified_protocol`, its markets are left out |
| `unexpected_root` | AlphaLend has not exactly one `LendingProtocol`, or Bucket's `Config` is gone or names another CDP family |
| `invalid_reference` | A market is not a `Pool<Base, Quote>`, `Market` or `Vault<T>` of its package, or has no state |
| `unkeyed_coin_type`, `metadata_missing` | A market asset has no CAIP-19 key (a generic receipt, or over 128 encoded characters), or a coin has no on-chain metadata |
| `payload_rejected`, `query_rejected` | The endpoint refused a request as over its payload limit, or no longer accepts a query |

## 4. Identity decisions

- **Protocols are keyed by the original package id of their main family.** A
  protocol of several families is one record: the key is the family with the markets
  read here, or the main one (Bluefin Spot, Bucket CDP), and the others are aliases
  that the chain confirmed (Cetus DLMM, Bluefin Pro, Bucket USDB), because a record
  states one `sui_package`. NAVI's oracle family and Scallop's other packages are
  not named: the research gave them truncated or not at all.
- **Markets are keyed by an addressable object.** DeepBook: the pool. Bucket: the
  vault. AlphaLend: the dynamic-field object of the table entry, not the wrapped
  `Market.id`.
- **Roles are the chain's configuration today**: a pool's `base` and `quote`; a
  reserve's `supply`, `collateral` where its ratio is above zero and `borrow` where
  its limit is; a vault's `collateral` and its USDB `debt`.
- **The dust floor is depth**, 8 resting orders, because the chain has no price: the
  smallest of the 26 pools the Mysten indexer lists rests 8. 41 of 89 pass.
- **Governance fees are metric rows**, `metrics`, in core's `defi_metrics` shape, with as-of; core gained `taker_fee` and `maker_fee` (percent, definition `governance_trade_params`). The stake required (DEEP) has no unit there and is a limitation in words.
- **Gaps found:** a bridged coin's origin has no relation (`bridged_from` links
  securities) and no attribute, so it is in the name and the provenance record; token
  supply has no field, so `rank.supply` carries it (a stop-gap: `rank` is the one
  numeric slot); a record states one `sui_package`, so other families are aliases.
