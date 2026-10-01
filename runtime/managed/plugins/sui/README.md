# Sui chain connector (experiment)

> **Status: in development (experimental). Disabled by default; not signed off; kept for future reference.** See [ADR 0048](../../../../docs/decisions/0048-sui-defi-experiment.md), which is also the reference for integrating a crypto source.

Native `pythia-sui` adds Sui DeFi to Pythia as subjects, read straight from the
chain: protocols, tokens and the markets of protocols that have no API. It needs
no key and has no worker process. It depends on Pythia core alone and reads
through core's connector toolkit. One plugin reads the chain for every protocol;
the experiment's design, what it found and what is in this tree are in
[ADR 0048](../../../../docs/decisions/0048-sui-defi-experiment.md). The Cetus,
DeepBook and Suilend API plugins the experiment also built are not in this tree.

## Opt-in

The plugin is installed **disabled**: its contract is unsigned
([ADR 0042](../../../../docs/decisions/0042-source-onboarding-standard.md)) and Sui's
public GraphQL endpoint states "strict rate limits" and is "not for production".
Enabling it is the investor's choice:

```sh
hermes -p <profile> plugins enable pythia-sui
```

## Operations

| Operation | Input | Result |
| --- | --- | --- |
| `catalogue` | `scope`: `protocols`, `tokens` or `markets`; optional `cursor` | One page of a `ClaimBatch` (ADR 0038) and `next_cursor` (null on the last page, which is `complete`) |
| `metrics` | `market`: a DeepBook V3 pool's object id | The pool's governance parameters as of now (taker fee, maker fee, DEEP stake required, and any change voted for the next epoch), with `basis: on_chain`, `as_of` and the governance epoch |

Core's identity sync pages the scopes in the contract's order, `protocols`,
`tokens`, `markets`, on the investor's request (Settings, Data, Data sources,
"Sync now"); nothing schedules it. A full sync made 77 requests on 2026-09-30 in
6 pages and 19 seconds (up to a minute when the endpoint is slow on cold lookups),
against core's bound of 50 pages and 120 seconds. A request that times out is
retried: a batch is halved, a single read is asked three times.

## Subjects and keys

| Record | Subject | Key |
| --- | --- | --- |
| A protocol | `protocol` | `protocol:sui_package:<original package id>` |
| A DeepBook pool, an AlphaLend market, a Bucket vault | `market` | `market:sui_object:<object id>` |
| A coin type | `listing` | `listing:caip19:sui:mainnet/coin:<type>`, or `…/slip44:784` for SUI |

- **Protocols** (`protocols.py`): NAVI Lending, Suilend, Scallop, Cetus CLMM,
  DeepBook V3, Bluefin, Turbos, Momentum, AlphaLend and Bucket Protocol. A record
  is stated only if the chain confirms its package on this read:
  `package(address: <id>, version: 1)` answers the id itself only for an
  original id, and the family's latest version must still have its anchor module.
  A protocol of several families is one record: the key is the family holding the
  markets this plugin reads or the main one (NAVI lending core, Suilend, Scallop,
  Cetus CLMM, DeepBook V3, Bluefin **Spot**, Bucket **CDP**), and the other
  confirmed families are aliases, because a record states one `sui_package`: Cetus
  DLMM, Bluefin Pro and Bucket's USDB stablecoin. The latest package id and
  version at read time are the record's `source_version`, an observation, not an
  identifier. NAVI's oracle and the other families named in the research could not
  be confirmed in full from it and are left out.
- **Tokens** (`catalogue.py`, `chain.py`): a listing per coin type, named from
  on-chain `CoinMetadata` (the coin registry `0xc` and the legacy store answer the
  same query), with its symbol as an alias. The coins are the seed list
  (`seed.py`: the coin types NAVI, Suilend, Scallop and Cetus markets use, read
  2026-09-30) and the coins the chain-read markets hold. A coin the Sui Bridge
  treasury supports, or Wormhole's Token Bridge wrapped (`WrappedAsset`), says so
  in its name ("Tether (Sui Bridge)", "USD Coin (Wormhole, from Ethereum)") and in
  its provenance record, which names the registry entry and, for Wormhole, the
  origin chain and address. A Sui coin Wormhole only custodies is no provenance.
  `rank.supply` is the coin's supply in whole coins where a readable TreasuryCap or
  the registry gives it, and absent where it does not (null is not zero). It is
  minted less burned, never circulating supply; SUI's is its 10 billion cap.
- **Markets** (`deepbook.py`, `alphalend.py`, `bucket.py`): each `part_of` its
  protocol and `market_asset` of its coins with the role the chain gives:
  - a DeepBook V3 pool (a shared `Pool<Base, Quote>`): `base` and `quote`;
  - an AlphaLend market: `supply`, plus `collateral` where its safe collateral
    ratio is above zero and `borrow` where its borrow limit is (none is today);
  - a Bucket vault: `collateral` and USDB as `debt`.
  A coin with no CAIP-19 key (a generic receipt such as `DEEPBOOK_STAKED<USDC>`)
  has no link; its market is kept and a warning counts it.

## Decisions for the experiment

- **Dust floor.** Anyone can create a DeepBook pool and the chain has no price, so
  a pool needs at least 8 resting orders (`deepbook.MIN_ORDERS`): the smallest of
  the 26 pools the Mysten indexer lists rests 8. Of 89 pools, 41 pass. AlphaLend
  and Bucket have no floor: 36 markets and 20 vaults, as their own registries list.
  **The floor leaves pools out of the catalogue, which departs from Pythia's rule
  that a plugin never drops a record its source states.** The rule is to keep
  every pool with a status and to filter at display. That change is to be made
  before this plugin leaves the experiment; until then the code still drops the
  pools below the floor and counts them in a warning.
- **AlphaLend's key** is the dynamic-field object of the table entry, which anyone
  can read and which is derived from the table and the market number. The research
  used `Market.id`, the wrapped UID, which no API reads.
- **Bucket's list** is its `Config` registry, not a type scan: the chain also holds
  a `TLP` vault (limit 0) the registry does not list.
- **Fees are governance state**, so they are a read (`metrics`) with an as-of, never
  a claim. The contract declares it as `fundamentals` at level `market`, basis
  `on_chain`.
- **Bridge provenance has no relation or attribute slot**: `bridged_from` links
  securities, not deployments, and a record has no provenance field. The name and
  the provenance record carry it.

## The shared chain layer

`chain.py` is the one module every protocol module uses: the GraphQL client (a JSON
POST through core's `Transport`, cached for an hour), request shaping for the
5,000-byte payload limit, the 50-node page and the 21 backing-store lookups a
request may make (a batch is cut to fit the payload, and an alias the endpoint
refused halves the batch), pagination, coin metadata (memoised per coin for an
hour), object, dynamic-field and multi-get reads, the package-family resolver, and
the Sui Bridge and Wormhole readers.

## Drift alarms

A read answers with warnings when the chain is not what the plugin expects:
`package_unknown`, `package_not_original` and `package_family_changed` (the
protocol is left out, and its markets with `unverified_protocol`),
`unexpected_root` (a protocol's root object is not what the plugin expects; its
markets are left out), `invalid_reference` (a market is not readable as the
protocol's own), `unkeyed_coin_type` and `metadata_missing`. A payload the
endpoint refuses (`payload_rejected`) and a query it no longer accepts
(`query_rejected`) fail the read, as does an answer with no protocol or no market at
all (`invalid_response`): an empty complete scope would tell core everything is gone.

Field meanings, the terms and what was measured are in the
[source record](../../../../docs/sources/sui.md).
