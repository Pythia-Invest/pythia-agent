# 0038: Plugin addressing and content contract

## Context

Under [ADR 0037](0037-identity-backbone.md), core owns identity and plugins
contribute claims. Core must know, without calling a plugin and even while it is
disabled, which subjects the plugin can address, which page sections it can
fill, and what it may contribute to identity. Connectors used to expose a
provider `search`, which pulled identity work into the typing path.

## Ruling

**A static contract file.** A plugin that serves investment data ships
`contract.json` at its package root, beside `plugin.yaml`; its settings stay in
`configuration.json`. Core validates it with `identity.validate_manifest`
(standard library only), which rejects unknown fields and names the first bad
path. Native Hermes stays the authority for discovery and enablement. This is
not a registry: deleting the package removes the declaration.

```json
{
  "plugin": "yahoo", "provider": "yahoo",
  "addressing": {
    "native": [{"native_scope": "symbol", "level": "listing", "asset_classes": ["equity"]}],
    "schemes": {"listing": ["ticker_mic"], "security": ["isin"]},
    "mic_table": {"XAMS": ".AS", "XNAS": ""}
  },
  "content": {"quote": {"level": "listing", "via": "listing", "tool": "yahoo_quote"}},
  "resolve": {"tool": "yahoo_resolve", "input_schemes": ["isin"], "echoes": ["ticker_mic"]}
}
```

- **`addressing`** lists the plugin's native reference scopes, each at one
  level; the global schemes it accepts per level (a scheme must belong to that
  level); and a flat table from operating MIC to the literal suffix core appends
  to the ticker (`".AS"`, or `""` for a bare symbol), so core can build a
  native reference from `ticker_mic` without a call. It builds none for a line
  the reference marks inactive, whose ticker may name another company now
  (ADR 0037, "Consequential failures"). A ticker is written as its
  venue writes it: core's ticker grammar allows one space before a one-letter
  class (`VOLV B@XSTO` on Nasdaq Stockholm and Copenhagen); a two-letter suffix
  is refused, as `AAPL US` or `ASML NA` is a Bloomberg code, not a venue ticker. A provider symbol
  has no space, so core writes that separator as `-` (`VOLV-B.ST`), rule
  `mic_table@2`. An optional `venue_codes` table maps the provider's own venue
  codes to operating MICs (Yahoo `NMS` to XNAS), so core can check the venue a
  read states; a code it does not map is not checked.
- **`content`** maps core's page sections (`quote`, `chart`, `profile`,
  `financials`, `news`, `filings`) to a tool, the level the data is about and the level of
  the reference used to call (`via`). `via` may be narrower than `level`, never
  broader, and must be addressable: EODHD financials are issuer data fetched
  via a listing.
- **`catalogue.mode`** is the one provider term core enforces. `bulk` names a
  catalogue tool and scopes and keeps typed records in the identity store's plugin-tagged claims.
  `resolve_only`, the default when the block is absent, keeps only the records
  the user picked. Each plugin enforces its provider's other terms itself.
- **`resolve`** is an optional lookup from global identifiers to a native
  reference. It declares its input schemes and the schemes an answer merely
  echoes from the query; echoes are never evidence. A lookup in X calls exactly
  one plugin's `resolve`, from that plugin's own row in Settings, never from
  search.

Every native scope must be producible by a bulk catalogue, a `resolve` or the
MIC table. **Provider `search` is not part of the contract**; search is core's
local read.

**Claims, not reconciliation.** A plugin emits a `ClaimBatch` of
`RecordClaim`s and `RelationClaim`s through `identity.emitter()`. A record
claim co-asserts one source record's identifiers at its native level, with
provenance and optionally its own native reference, which becomes a binding.
It marks each ISIN `self`, `underlying` or `unqualified`; core cannot verify the
mark. A crypto record carries the coin id as its native reference, lists token
deployments as provider chain id plus contract, and sets `native_of` only when
the provider states it. Reference sources do not emit: the reference builder
writes the reference store.

`identity.check_batch` enforces mechanically that a batch matches its
manifest's plugin and provider, that a plugin binds only its own declared
native references at their declared level, that a catalogue page names a
declared bulk scope and a resolve answer a declared `resolve`, and that
native references are unique within a batch. Records never assert identifiers
narrower than themselves, and hold one `self` value per single-valued scheme.
Plugins never name subject IDs, choose a tier or compare rows with another
plugin; core joins at ingest.

Identity overlap between plugins is solved by the join: one subject, two
bindings. Content overlap, page budgets and resolver declarations belong to
the page composition and matcher pieces.

**Page sections never wait on a provider.** Core's `identity-subject`
operation reads the reference file, the identity store and the contracts only.
Per section it takes the first usable plugin in a fixed default order (quote
and chart: Yahoo, EODHD, CoinMarketCap, CoinGecko; profile: GLEIF; filings:
filings.xbrl.org, SEC) that can address the subject at the content entry's
`via` level, and lists the others as alternatives with their status
(`disabled`, `needs_configuration`, ...). A plugin is addressed at once when
core holds a confirmed binding (kept but not used once its line is delisted
and its native scope is a ticker or symbol: ADR 0037, "Ticker reuse") or can
derive the native reference from open identifiers: the MIC suffix table, a
native scope named after a scheme the plugin accepts at that level (GLEIF by
`lei`, SEC by `cik`), or core's curated canonical-asset table (rule `canonical_assets@1`, a confirmed binding). A derived
reference is an address, never identifier evidence, and is recomputed rather
than stored; only its read checks are stored (ADR 0037, "Read checks"). Otherwise the section is `resolving`, and the Desk asks
`identity-resolve` for that one plugin after rendering: core runs its declared
`resolve` with a short timeout, applies `decide` (rule `resolve_answer@1`: the
answer to open identifiers binds unless identifier evidence or the receipt
guard contradicts it; an issuer's LEI or CIK confirms only an issuer, and a
record quoting the sent ISIN as its underlying's is a residual) and stores a
binding or a queue item, so the next open
is local. Resolve answers use the wire form of `claims.batch_to_json`.

## Rationale

A declarative contract lets core decide addressing and coverage hints without
running plugin code on the page path or making trial calls. A connector author
writes the contract, the content tools they already have, and optionally a
catalogue or `resolve`; no search or matching code.

## Consequences

- Managed plugins list `contract.json` in their release file allowlist.
- The `pythia_market_data` annotation keeps declaring read operations for the
  unchanged read pipeline; `contract.json` adds identity addressing on top.
- Adding a section is a core change.

## Rejected alternatives

- **Provider search in the contract:** network calls and reconciliation return
  to typing.
- **Plugin code deciding addressing on the page path:** slow, untrusted and
  impossible to evaluate for a disabled plugin.

## Amendment (2026-09-28): contract version 1

**Status: accepted and implemented.** All managed contracts live in this
repository; the first third-party or forked plugin would freeze whatever shape
exists, so every change below is made in one pass. The licence classes are a
recommended default awaiting the founder's confirmation.

The file had no version and the validator rejects unknown fields, so an older
core would have rejected a newer plugin wholesale. [ADR 0040](0040-data-concepts-and-agent-tools.md)
makes core own data concepts. Naming Hermes tools tied the contract to one
harness, and provider terms core must know (cache lifetime, attribution,
licence) lived only in READMEs.

Superseded: the `content` block, `catalogue.tool` and `resolve.tool` holding
Hermes tool names, the fixed per-section default orders under "Page sections
never wait on a provider" (they are now each concept's default order in core's
registry), and "Adding a section is a core change" (now: adding a concept or
operation is a core change). "`catalogue.mode` is the one provider term core
enforces" stands; `rights` below is declared, not yet enforced.

```json
{
  "contract_version": 1,
  "plugin": "pythia-coingecko", "provider": "coingecko",
  "addressing": {"native": [{"native_scope": "coin", "level": "security", "asset_classes": ["crypto"]}]},
  "concepts": {
    "market_data": {
      "level": "security", "via": "security",
      "operations": {"quote": "latest", "intraday": "history", "daily": "history"},
      "coverage": {"asset_classes": ["crypto"]}
    }
  },
  "catalogue": {"mode": "bulk", "operation": "catalogue", "scopes": ["coins"]},
  "rights": {"licence": "personal", "cache": {"ttl_seconds": 86400}, "hostable": false,
             "attribution": {"text": "Powered by CoinGecko API", "url": "https://www.coingecko.com/en/api/"}},
  "signoff": {"status": "grandfathered", "record": "docs/sources/coingecko.md"},
  "limits": {"plan": "Demo", "unit": "credit", "per_minute": 100, "per_month": 10000}
}
```

- **`contract_version`** is a required positive integer, read before anything
  else. A contract newer than this core is not validated further: the plugin
  is reported as `needs_update` (`ManifestNeedsUpdate`, logged distinctly),
  never as invalid, and its fields are never silently ignored. Any added, removed or changed field raises the version. A new value
  in one of core's closed vocabularies (a concept, operation, quality,
  authority or asset class) is a core change; managed plugins always ship with
  the core that knows their values.
- **`concepts`** replaces `content`. Each entry names a registered concept,
  its `level` and `via` (as before; the concept limits the levels), the plugin
  operation per concept operation, optional `coverage` (`asset_classes`, and
  `markets` as operating MICs where coverage is narrower than addressing, and
  `operations` narrowing either for one concept operation, as for a live
  stream that covers fewer markets),
  optional `qualities` keyed by concept operation from the registry's closed
  vocabulary, and for a combining concept (filings) the `authorities` it serves.
  Page sections read concepts: quote is `market_data.quote`, chart
  `market_data.daily` or `intraday`, profile `profile.fields`, filings
  `filings.list`.
- **Operations, not tools.** Every concept and resolve entry names a plugin
  operation: the name a tool the plugin actually owns declares, either as a
  protected HTTP operation or in its market-data contribution. Core's Hermes
  adapter (`identity_ops.native_operations`) maps an operation to that tool, so
  another harness reads the same contract. A name two of one plugin's tools
  declare is ambiguous and is not mapped. `catalogue.operation` names the
  plugin's own catalogue operation, which the plugin's sync runs and core does
  not dispatch, so the adapter does not map it.
- **`rights`** (required): `licence` (`open`, `personal`, `business` or
  `seat`; only personal mode exists), `cache` (`none`, `{"ttl_seconds": n}`
  or `unlimited`: how long the data may stay on the device), `hostable`
  (whether data may appear in a published package; false for every shipped
  plugin) and optional `attribution` (text and an https link that every surface
  showing the data renders). Declared now; enforcing the cache lifetime and
  rendering attribution come later. Each plugin still enforces its provider's
  other terms itself.
- **`signoff`** (required): the source's onboarding status
  ([ADR 0042](0042-source-onboarding-standard.md)): `status` `signed_off`,
  `grandfathered` or `unsigned`, and `record`, the source record
  (`docs/sources/<source>.md` or an https link), required once signed off.
  Core enforces it; ADR 0042 says how. It joined version 1 before any release
  shipped a contract, so the version did not change.
- **`limits`** (optional): the provider's published rate limits for a named
  plan (`unit` `call`, `credit` or `request`; per second, minute, day or
  month). A claim for that plan, not the investor's entitlement; nothing
  enforces it yet. A per-operation cost comes with the quota ledger.
- Provider functions (ADR 0040's later phases) are not part of version 1;
  adding them raises the version.

Consequences: `identity.validate_manifest` and `identity_ops.installed()` keep
their names and signatures. The `Manifest` they return has `concepts` instead
of `content` (with `ConceptEntry.coverage_for(operation)`),
`catalogue_operation` instead of `catalogue_tool`, `resolve.operation` instead
of `resolve.tool`, plus `rights`, `limits`, `contract_version` and
`plugin_operations` (every operation the contract names).
`PluginInfo.operations` maps a plugin operation to its native tool. `Section`
moved from the manifest to page composition. The `pythia_market_data`
annotation remains until market-data selection moves to core. Page
composition reads concepts; its only change is core's default order (ADR
0040), free sources first, which puts CoinGecko ahead of CoinMarketCap.

Rejected: adding only the version (the `content` to `concepts` and
tool-to-operation changes break every contract anyway); keeping rights in
READMEs (core could not render attribution or respect cache lifetimes);
qualities flat per concept (delay and depth differ between a quote and daily
history); free-form qualities (selection and labels need values core
understands); reserving an always-empty `functions` key (adding a field raises
the version either way).

## Amendment (2026-09-29): reference sources contribute like any plugin

*Status on 2026-09-30: every plugin emits through core's ingest (amendment "core
dispatches catalogue and resolve" below). The reference sources are still builder
adapters that write the reference package, and A8 of ADR 0044 leaves their direct
and prebuilt forms open, so "until that lands" below has not ended for them. Trust
attached to a release no longer exists (amendment "no trust levels" below).*

[ADR 0044](0044-product-direction.md) sets the direction that reference
sources contribute subjects and evidence through the same contract as any
plugin, replacing "Reference sources do not emit". The concern behind that
rule, a plugin labelling its own rows as reference data, is met by bounding
what claims can establish by claim type and trust level, with trust attached
to a signed or hashed release rather than to a plugin name. Until that lands,
the reference builder remains the only writer of the reference store.

## Amendment (2026-09-30): contract version 2, introduced subjects and a plugin's own addresses

*Three consequences below are no longer true: the package dropped `canonical_assets`,
`provider_chains` and the provisional-coin aliases in format 6 (ADR 0037, amendment
"package format 6 states kinds and names no provider"), the Hyperliquid perp's
address is `confirmed`, and no release grants or digests exist (amendment "no trust
levels" below).*

**Status: accepted and implemented** (roadmap stage 0). [ADR 0044](0044-product-direction.md)
A1, A3 and A4 let any plugin introduce subjects under declared identifier
schemes, and rule out authority that comes from a source's name. Core's
maintained tables did both jobs at once: `markets.json` named each index's
Yahoo symbol and the BTC perp's Hyperliquid coin, and `canonical_assets.json`
named each asset's CoinGecko and CoinMarketCap coin ids and their chain ids.
Pages marked those addresses `confirmed` because the table said so. Keying an
address by a provider's name is authority by name, and a new source for an
index or a coin needed a core change.

Version 2 adds three declarations (`identity/declared.py`) and widens two claim
shapes. Every shipped contract is version 2.

CoinGecko's addressing, abridged:

```json
"addressing": {
  "native": [{"native_scope": "coin", "level": "security", "asset_classes": ["crypto"]}],
  "subjects": {"security:caip19:bip122:000000000019d6689c085ae165831e93/slip44:0":
               {"native_scope": "coin", "native_id": "bitcoin"}},
  "chain_codes": {"ethereum": "eip155:1"}
}
```

The DefiLlama plugin keys pools and protocols by its own references and names
token deployments by CAIP-19, so it declares
`"introduces": {"market": ["native"], "protocol": ["native"], "listing": ["caip19"]}`
beside native scopes at `market` and `protocol`. Its protocol scope uses
DefiLlama's protocol id rather than its slug, because a rename changes the slug
([source record](../sources/defillama.md)).

The NAVI plugin declares the same shape (`market` scope `reserve`, `protocol`,
`listing` by CAIP-19). It keys each lending reserve by the object id of its
`Pool<T>`, states one protocol, `navi-lending`, and names each reserve's coin
by CAIP-19 ([source record](../sources/navi.md)). A coin type is the one
identifier two DeFi sources share, so tokens join across them while pools and
protocols do not: DefiLlama states no on-chain address for either, and `market`
and `protocol` take no open identifier. A NAVI reserve and a DefiLlama pool for
one coin stay two subjects, adjacent on the token's page, and the two "NAVI
Lending" protocols stay two. Nothing fuses them by name, symbol or "same
protocol and coin", which would be wrong where a coin has up to nine reserves.
Fusing them takes a deliberate bridge, either `protocol` as a curated kind or a
core rule over markets that share a joined protocol and one coin; that is the
founder's decision and is not built.

- **`addressing.subjects`** maps a subject core keys, by an open identifier
  or a Pythia key, to the plugin's own reference for it. The native scope must
  be one the contract declares at the subject's kind; a provisional ID is not
  core-keyed and is refused, and one reference names one subject. Page
  composition derives the address from it without a call, under rule
  `declared_ref@1`, before any other derivation.
  - The address is `confirmed` when the plugin's files are granted confirm
    ([ADR 0042](0042-source-onboarding-standard.md), amendment of
    2026-09-30), and `derived` otherwise. A display plugin's declaration is an
    address, shown with its source, never a confirmation.
  - A confirm-level declaration also aliases the plugin's provisional ID for
    that reference (`security:provisional:coingecko:coin:bitcoin`) to the
    subject. `subject.current_id` follows these aliases with the reference's
    own, so an ID saved before the subject was keyed keeps resolving once the
    package stops carrying the alias. This applies on reads (pages, price
    routing, agent reads); Lifecycle A still follows only the package's
    aliases when it re-points stored rows. A display-level declaration never
    aliases, because a lone display claim could otherwise re-point saved IDs
    (A3: the absence of competing evidence never increases authority), and a
    provisional ID two declarations give different subjects stays unaliased.
- **`addressing.chain_codes`** maps the provider's own chain ids to CAIP-2
  chains, for the token deployments it names. Core reads none of it yet; the
  drift check and the reference build do.
- **`introduces`** maps a registered subject kind to the key schemes the
  plugin's subjects of that kind may use: an open scheme registered for the
  kind (`KEY_SCHEMES`), or `native`, the plugin's own reference in a native
  scope it declares at that kind (`<kind>:provisional:<provider>:<scope>:<id>`,
  unchanged). `provisional` and `pythia` are not a plugin's to name. A
  `native` key scope must name a permanent reference the provider never reuses
  for another subject, because the reference is the subject's ID.
  `validate_manifest` checks each kind, each scheme and that `native` has a
  scope. Core's ingest will apply it per record: a record the plugin may not
  introduce stays an unmatched claim rather than rejecting its batch.
- **Claim shapes.** A `RecordClaim` may sit at a registered kind outside the
  hierarchy (a market, a protocol); such a record carries no identifiers and is
  keyed by its native reference. A `RelationClaim` endpoint may be the
  emitting plugin's own declared native reference as well as a global
  identifier; `check_batch` checks it like a binding, refuses another
  provider's reference or an undeclared scope, and checks the relation's kinds
  against the kinds the contract declares that scope at. On the wire such an
  endpoint is `{"provider", "native_scope", "native_id"}`.
- **Relations.** `part_of` (a market to its protocol) and `market_asset` (a
  market to a listing or security it holds or trades), both `related`.
- **Version.** Core reads versions 1 and 2. A version 1 contract that uses a
  version 2 field is refused, naming the field, rather than read as version 2.

Superseded: "through `identity.emitter()`" (the unused `ClaimEmitter` protocol
is deleted; plugins return claim batches from operations core dispatches),
"core's curated canonical-asset table (rule `canonical_assets@1`, a confirmed
binding)" among the derived addresses, and ADR 0043's "core's curated table
supplies the reference". Core no longer reads a provider column from the
reference package.

Consequences:

- `markets.json` and `canonical_assets.json` stay Pythia's maintained subject
  lists, without provider columns. Yahoo's contract declares the 22 index,
  future, pair and yield subjects, Hyperliquid's the BTC perp, and the
  CoinGecko and CoinMarketCap contracts each curated asset and their chain ids.
- A renamed copy of a coin plugin serves the same subjects under the same
  rule, at whatever level its files are granted.
- The Hyperliquid perp's address is now `derived`: the plugin ships
  unsigned.
- The reference package keeps its `canonical_assets` and `provider_chains`
  tables and the provisional-coin aliases until its next format; the builder
  fills them from the coin plugins' contracts meanwhile, and
  `just canonical-assets-drift` reads the coin ids and chain ids there.
- Editing a shipped contract changes its plugin's digest; the release grants
  are regenerated when the payload is assembled.

Rejected alternatives:

- **Keeping the provider columns and trusting them only for audited
  plugins.** The table would still name providers, and a new source for an
  index or coin would still need a core change.
- **A separate addresses file per plugin.** A second mechanism beside the
  contract core already validates without running plugin code.
- **Aliasing on any declaration.** A display plugin could re-point a saved
  ID, which A3 rules out.
- **Refusing a batch whose record the plugin may not introduce.** One such
  record would hide the plugin's valid evidence; it stays an unmatched claim.

## Amendment (2026-09-30): core dispatches catalogue and resolve

**Status: accepted and implemented** (roadmap stage 0). Plugins return claim
batches from the operations core dispatches; core places every record through
one ingest ([ADR 0037](0037-identity-backbone.md), amendment "ingest").

- **The catalogue operation is core's to call.** A bulk catalogue's
  `catalogue.operation` takes `{"scope", "cursor"}` (no cursor for the first
  page) and answers `{"data": <ClaimBatch>, "next_cursor"}`: a page of that
  scope, whose last page sets `complete` and no cursor. The adapter maps it
  like any other operation.
- **`identity-sync {plugin}`** reads one plugin's catalogue, a Desk operation
  with no scheduler (Settings → Data → Data sources runs it on "Sync now"): each declared
  scope in the order the contract lists them, page by
  page, within a page and time bound (then `partial`). A scope may name what an
  earlier one introduced (a DeFi source's pools name the protocols its
  `protocols` scope lists first), so the order is the plugin's to declare. It
  answers the counts: joined, introduced, conflicts, unmatched, rejected and
  not seen, with the pages read.
- **`identity-lookup {plugin, query}`** is the backend of a plugin's lookup
  (amended 2026-09-30: no longer a search action): the
  query's identifier (ISIN, FIGI, LEI or CIK, as search classifies it) is sent
  once to the plugin's resolve under a scheme it accepts (a FIGI under the
  first FIGI scheme it takes), and every record it answers is ingested. It
  answers the counts and the subjects placed; no match is an empty answer with
  zero counts, a failure an issue with no data. The lookup form on the plugin's
  row in Settings → Data → Data sources invokes it and shows the counts and the
  subjects placed; search offers and runs none.
- **`identity-resolve`** stores its answer through the same ingest before
  deciding its binding.
- Only an enabled, configured plugin is called. Sync and lookup are Desk
  operations; the agent's tool list is at its size budget, so they are not
  model tools.

Superseded: "`catalogue.operation` names the plugin's own catalogue operation,
which the plugin's sync runs and core does not dispatch, so the adapter does
not map it" (contract version 1).

Consequences:

- CoinGecko's and CoinMarketCap's catalogue tools still answer an older row
  format and declare no operation, so `identity-sync` says it cannot read them
  until they return claim batches.
- A record whose plugin gave no native reference is kept by a digest of its
  identifiers, so a token named only by CAIP-19 still joins or is introduced.

Rejected alternatives:

- **A static catalogue file per plugin:** a second mechanism, and pools and
  lookups change daily or on demand.
- **A plugin-side emitter that finds core:** couples plugins to the harness's
  plugin table, which stage 0 removes.
- **Syncing on enable, or on a schedule:** a provider call nobody asked for.

## Amendment (2026-09-30): no trust levels

[ADR 0044](0044-product-direction.md)'s amendment of the same day removes plugin
trust levels. In the amendments above:

- A declared address (`addressing.subjects`) is always `confirmed`, and the
  plugin's provisional ID for that reference always aliases the subject, so the
  perp's address is `confirmed` although Hyperliquid ships unsigned. The
  contract's `signoff` and the digest of its files change nothing.
- A relation or claim counts like any enabled plugin's, and a renamed copy of a
  plugin serves the same subjects under the same rule.
- "What claims can establish by claim type and trust level, with trust attached
  to a signed or hashed release" is replaced by claim type alone, with no level.
