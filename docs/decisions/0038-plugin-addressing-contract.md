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
  native reference from `ticker_mic` without a call.
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
  echoes from the query; echoes are never evidence. "Look up in X" calls exactly
  one plugin's `resolve`.

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
core holds a confirmed binding or can derive the native reference from open
identifiers: the MIC suffix table, a native scope named after a scheme the
plugin accepts at that level (GLEIF by `lei`, SEC by `cik`), or core's curated
canonical-asset table (rule `canonical_assets@1`, a confirmed binding). A derived
reference is an address, never identifier evidence, and is recomputed rather
than stored. Otherwise the section is `resolving`, and the Desk asks
`identity-resolve` for that one plugin after rendering: core runs its declared
`resolve` with a short timeout, applies `decide` (rule `resolve_answer@1`: the
answer to open identifiers binds unless identifier evidence or the receipt
guard contradicts it) and stores a binding or a queue item, so the next open
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
