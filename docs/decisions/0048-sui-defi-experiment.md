# 0048: Sui DeFi experiment: mapping and plugin split (in development)

**Status.** Experimental; not adopted as product direction (2026-09-30). The
code here is kept as the worked example of how a crypto source joins Pythia's
identity model, and the plugin it adds ships disabled. Nothing in this record
decides a rule for the product; "Decision candidates" lists what the founder may
adopt later.

## Context

[ADR 0044](0044-product-direction.md) A1 says any plugin can extend the universe
on equal terms, and A3 says core owns the identifier rules and new kinds are a rare
core addition (so a new key scheme is a core change). To test
both against real data, the experiment represented Sui DeFi (10 protocols, 340
tokens, 759 markets) from one chain plugin, three protocol-API plugins and
DeFiLlama. The founder wants Sui in the repository as a reference for integrating
crypto sources, clearly marked as still in development.

**What is in the tree.**

- Core: `pythia_platform.identifiers` (core's identifier forms for plugins,
  [ADR 0045](0045-plugin-platform-interface.md)), the open key schemes
  `sui_package` and `sui_object`, `market_asset.role`, and `fundamentals.metrics`
  declarable for protocol and market subjects
  ([identity data](../architecture/identity-data.md)).
- `pythia-sui`, a chain plugin reading Sui's public GraphQL: ten protocols, their
  tokens, and the DeepBook, AlphaLend and Bucket markets
  ([source record](../sources/sui.md)). Disabled by default, unsigned.
- NAVI stating `sui_object` (each reserve) and `sui_package` (the protocol), so two
  sources, NAVI and the chain plugin, reach one subject by a chain-native key
  ([source record](../sources/navi.md)).

**What stays on branch `exp-sui`, for later development.** The Cetus, DeepBook
and Suilend API plugins, and the DeFi metric rows (core's checked row in
`identity/defi_metrics.py`, DeFiLlama protocol metrics, NAVI reserve metrics, their
two agent tools, and the raise of the agent tool budget from 17,700 to 19,000
characters). Measurements below that concern them were taken with them
installed and are marked "on `exp-sui`".

## How to integrate a crypto source

Rules 1 to 4 and 7 to 9 describe what the code in this tree does, with the evidence
for each. Rules 5 and 6 are proposals (candidate 2 below), not adopted.

1. **Identity is by chain-native key, never by name.** A token is a `listing`
   keyed by CAIP-19 (`sui:mainnet/coin:<type>`, native SUI as `slip44:784`). A
   protocol is keyed by its original package (`sui_package`) and a market, meaning
   a pool, a reserve, an order book or a vault, by its object id (`sui_object`).
   Names, symbols and "same protocol and same coin" never join: a coin has up to
   nine NAVI reserves, and three USDT coin types make three pools named
   "USDT/USDC". The plugin states its CAIP-19 keys in the
   form core joins on, through `pythia_platform.identifiers`; it still keeps its
   own tolerant reader for Sui addresses (`chain.address`, which also accepts hex
   without `0x`, as Cetus writes it), and core normalises whatever it states.
2. **State keys only for what the source names.** A source that names no object
   states none (DeFiLlama) and introduces its own subject; a coin type core cannot
   key (a generic receipt type, or one past CAIP-19's 128 characters) gets a
   warning and no subject, never a guessed key.
3. **Declare what the plugin may introduce.** The contract lists the schemes under
   `introduces`. Any plugin may join a subject a key names; only one that declares
   the scheme may introduce it. A subject introduced under a native reference
   moves up to the open key once the record states it, and two open keys never
   merge.
4. **State relations with roles.** A market is `part_of` its protocol and has
   `market_asset` edges to its tokens, each with the `role` its source knows
   (`base`, `quote`, `collateral`, `debt`, `supply`, `borrow`). A source that does
   not know the role states none.
5. **One plugin per source.** A plugin is one provider endpoint family with its own
   terms, limits, failure mode and opt-in. The protocol category (lending, DEX) is
   never a boundary, and neither is sharing code.
6. **Proposed, not adopted: the effect-line test.** The maintainers would not ship
   a separate protocol-API plugin that supplies nothing the chain plugin cannot get
   with comparable effort (a filtered or ranked catalogue, as Cetus's 306 pools of
   44,480; figures the protocol computes, as NAVI's rates; curation with a meaning,
   as Suilend's listed markets). The check is to run its sync beside the chain plugin
   and read core's `plugin_effect`, the subjects only that plugin supplies: a line of
   zero states nothing new. This guidance is for what Pythia bundles. It is not a gate
   on contributors, and any plugin may still contribute evidence under A1.
7. **Source quirks stay in the plugin.** The chain plugin's dust floor (a DeepBook
   pool needs 8 resting orders, because the chain has no price) and its list of
   ten protocols with original packages live in the plugin. DeFiLlama's fee labels,
   written 100 times too large for Cetus, are a labelled source correction in its
   plugin, never a core rule. The dust floor is a known deviation in the
   experiment: it leaves a pool out of the plugin's records, where a plugin keeps
   every source record and learns the source's vocabulary (OpenFIGI keeps a line
   it cannot place, parked, with a `venue_note` saying why, and filters come at
   display: [exchange codes](../sources/openfigi.md#exchange-codes)). Before the
   Sui plugin leaves the experiment, the floor becomes a status on a kept pool,
   filtered at display. The package-identity alarms stay as they are: they check
   the plugin's own catalogue of original packages against the chain, and are not
   dropped source records.
8. **Fees and other changing state are reads with an as-of, never claims.** The
   chain plugin's `metrics` read returns a DeepBook pool's taker and maker fee as
   they stand now. It is a plain plugin read, not core's checked metric row, which
   stays on `exp-sui`.
9. **What stays separate stays separate, and is shown adjacent.** DeFiLlama's 127
   protocols and 287 pools join nothing on chain: it states no package or object
   id, and matching by protocol and token set would be a join by attributes. A3 joins by
   identifier agreement and leaves ambiguous links unresolved, so core does not do it
   (J4 would have the device agent judge such a link and show it, never join it by a
   core rule; for Cetus, 58 of 95 pools match uniquely, 17 ambiguously and 20 not
   at all). Its 73 of 130 tokens do join, because a coin type is a key.

## What was measured

Measured on 2026-09-30 by syncing the five Sui plugins, with DeFiLlama already
synced, into a copy of a dev store with real provider reads (nothing kept from the
providers). The four plugins other than `pythia-sui` and NAVI were on `exp-sui`.

- **Identity held.** Five syncs produced 0 conflicts, 0 unmatched, 0 rejected and no
  new question in the queue. `sui_package` joined all 4 chain protocols that an API
  plugin also states, and `sui_object` joined 26 of 26 DeepBook indexer pools to
  the chain plugin's pools (on `exp-sui`). Checked on chain: NAVI 62 of 62 reserve
  objects, Suilend 7 of 7, DeepBook 26 of 26 and Cetus 60 of 60 sampled were the
  pools the APIs said, with the same coins. Replaying the same pages in the
  reverse order gave the identical 1,235 subject ids.
- **Order dependence (two findings).** The first plugin to introduce a subject owned
  its label: 43 subjects changed introducer and 34 changed display name. And a
  link-only plugin (Suilend) lost 20 of its 52 token edges if it synced before the
  plugins that introduce those tokens, until it synced again.
- **Effect line** (core's `plugin_effect`): chain 111, NAVI 62, Cetus 469,
  DeepBook **0**, Suilend 7, DeFiLlama 471. The DeepBook indexer plugin
  (on `exp-sui`) states no pool the chain plugin does not already state under the
  same key, and no fee.
- **Duplication.** 39 to 70% of each API plugin's code lines also appear in another
  catalogue plugin (the reader, envelope and issue helpers, drift-alarm table,
  `register` handler and `definition` marker). The plugin-specific part is about 30
  to 80 lines. An API plugin costs 152 to 195 code lines plus a contract, a source
  record, tests and five small edits in core's lists.
- **Fundamentals** worked end to end through `pythia_instrument` and a provider
  tool, each row with its definition id, basis, as-of and core-stamped source
  (on `exp-sui`). TVL definitions stayed apart in every row.
- **The tool budget is exhausted** on `exp-sui`: 22 tools, 18,877 of 19,000
  characters, so the chain plugin's DeepBook fee read could not get a model-visible
  tool. The limit on this branch is unchanged.

| Coverage | Protocols | Markets | Tokens |
| --- | --- | --- | --- |
| Chain plugin alone | 10 | 97 | 99 |
| API plugins alone (NAVI, Cetus, DeepBook, Suilend) | 4 | 401 | 246 |
| Chain plus API plugins | 10 | 472 | 283 |
| DeFiLlama (separate) | 127 | 287 | 130 |

By the effect-line test, Cetus, NAVI and Suilend earn their place as plugins and
the DeepBook indexer plugin does not; the recommendation was to fold it into the
chain plugin as a module if its curated 26-pool list matters, or drop it. Its one
remaining argument, working while GraphQL is down, was not measured. AlphaLend and
Bucket stay chain modules, since no API exists for them.

## Shared scaffold (recommendation)

The platform should offer a function-level catalogue scaffold in `pythia_platform`
v1, additive and the same for every plugin, and no base plugin. It would hold a
`Reader` skeleton (validate parameters, connection budget, cached read, error
mapping to the envelope), `envelope` and `issue`, the drift-alarm renderer, the
`register` handler with the access-scope check, the `definition` marker builder,
cursor paging, and builders for record, relation and provenance wire forms.
Six catalogue plugins exist on `exp-sui` (this tree has three: DeFiLlama, NAVI and Sui; three copies was the point at which this was to
be reconsidered), and an API plugin would drop to roughly 75 to 110 lines.
Plugins still never import each other ([ADR 0045](0045-plugin-platform-interface.md)).

## Gaps the experiment exposed

| Gap | Evidence | Suggested direction |
| --- | --- | --- |
| Base and quote roles | `role` works (Cetus 306 base and 306 quote, DeepBook 26 and 26, chain 41 and 41); NAVI and DeFiLlama state none on 62 and 482 edges, and a pool's base and quote are the contract's A and B, not a market convention | Keep the attribute; sources that know the role state it |
| Receipt and LP tokens | 4 `unkeyed_coin_type` warnings on the chain read; generic types are refused by the CAIP-19 profile | A `receipt_of` relation, or key receipts by their reserve object |
| Market groups | One `market` kind covers a pool, a reserve, a lending-market group and a vault; "suilend usdc" finds nothing, "navi usdc" returns 7 label matches | A `member_of` relation and a sibling marker for pools of one pair |
| Bridge provenance | 11 chain and 19 NAVI token names say "(Wormhole...)" or "(Sui Bridge)"; `bridged_from` links securities only | Allow `bridged_from` from a listing, with the bridge as provenance |
| Supply | 35 tokens have a supply, but `rank.supply` shows on 10 subjects | A typed attribute or a token metric row, not `rank` |
| Fee tier | Cetus's 306 pools carry the tier only in the name; DeFiLlama labels the same pool "25%" for 0.25% | A `fee_tier` market metric with its own definition id |
| Stale roles | `relations.keep` has no sweep of relations a source stops stating, and evidence ids include the role: if a source drops or changes a role (AlphaLend `collateral`), the old row stays and the asset shows under two roles | Sweep a plugin's unstated relations on a complete scope, or key the row without the role |
| Protocol and DeFiLlama | 10 chain protocols against 16 name-matching DeFiLlama protocols, one to many; DeFiLlama states no package id | A curated protocol table plus `part_of` between protocols (a core decision under A3) |
| Metric level | A concept entry has one `level`, so NAVI cannot also serve a protocol aggregate and a chain-keyed NAVI protocol has no tool | One entry per level, or a level per operation |
| Tool budget | 22 tools, 18,877 of 19,000 characters on `exp-sui` | One generic metrics tool for any subject instead of one per source |
| First introducer names the subject | 91 of 340 tokens have an empty name although 35 have one elsewhere | Fill an empty label from a later claim; prefer chain metadata over API labels |
| Mixed numbers in `rank` | `rank.tvl_usd` is net-of-borrowed for NAVI and pool reserves for Cetus and DeFiLlama, and search orders by it | Rank by a tagged metric, or name the definition |
| One package per protocol | Bluefin, Bucket and Cetus span several package families; others are aliases | Acceptable while aliases stay |

## Decision candidates

These are proposals for the founder, not decisions.

1. Adopt `sui_package` and `sui_object` as open key schemes, and keep
   `market_asset.role`.
2. Adopt the split rule above: a plugin is a source, tested by its effect line.
3. Add the function-level catalogue scaffold to `pythia_platform` v1; reject a
   base plugin and cross-plugin imports.
4. Keep fundamentals on protocol and market kinds with definition ids in core;
   allow more than one level per concept entry; serve the agent through one
   generic tool rather than one per source.
5. Decide the protocol bridge (a curated table or a protocol relation) before
   any production DeFi source.
6. Fix label precedence and unplaced relation ends before a second catalogue
   source of the same subjects ships.

Open founder decisions: the **protocol bridge** (candidate 5) and the **generic
fundamentals tool and tool budget** (candidate 4).

## Since the experiment

The order dependence above (candidate 6) was fixed in core by the amendment
"ingest results do not depend on which plugin syncs first"
([ADR 0037](0037-identity-backbone.md)): a relation with an end no subject
names yet waits in `pending_relations` and is placed when that subject arrives,
and a subject's display name follows the investor's `source_order`. That work
applies to the open keys too: a `sui_object` market reached through a waiting
relation is placed when its record arrives, in either order (covered by a test).
What remains order-dependent is a subject's status, attributes and parent, which
still follow the plugin that introduced it: issue #154.

## Consequences

- Joins are by key at the record's own scope: zero wrong merges in this run and an
  identical subject set in both orders. A source that adds nothing is cheap to
  detect and remove.
- `pythia-sui` and NAVI's chain keys are off by default, but merging commits every
  install to some always-on changes, which stay even if the experiment is dropped:
  - `pythia_platform.identifiers` is added to platform v1. [ADR 0045](0045-plugin-platform-interface.md)
    says a version only gains names and removing one makes v2, so this export is
    permanent: a one-way door the founder accepts by asking for the merge.
  - `relations.role` is a new nullable column on every install's identity store,
    added to existing stores on open.
  - The open schemes, `on_chain` as a fundamentals basis and the protocol and market
    kinds on the fundamentals concept are in core's vocabulary, claims, joins and
    ingest for every install.
  Install size and test time grow too.
- "In development" is carried by the docs, the plugin's description in `plugin.yaml`
  and its disabled default; neither `plugin.yaml` nor `contract.json` has a status
  field the code could read.
- The measurements are one machine on one day. Unmeasured: the Cetus id check
  covered 60 of 306 pools, NAVI's `updated_at` lag was not read, the DeepBook
  indexer's value while GraphQL is down is unknown, and no Desk rendering of DeFi
  subjects was run.

## Rejected alternatives

- **One plugin per protocol category.** Category is not a platform unit.
- **A chain base plugin other plugins import.** [ADR 0045](0045-plugin-platform-interface.md)
  forbids plugins importing each other.
- **Joining DeFiLlama to chain subjects by name or token set.** A3 joins by identifier
  agreement, not by attributes, and the match is ambiguous for 13 to 17 pools per protocol.
- **One agent tool per source.** The budget allows no more.
- **Bringing every experiment plugin and the metric rows into the tree now.** The
  founder wants one small, clean reference; the rest stays on `exp-sui`.
