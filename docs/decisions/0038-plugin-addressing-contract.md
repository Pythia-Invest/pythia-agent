# 0038: Plugin addressing and content contract

## Context

Under [ADR 0037](0037-identity-backbone.md), core owns identity and plugins
contribute claims. Core still has to know three things about each plugin. It
must know which subjects the plugin can address, and how. It must know which
page sections the plugin can fill, and at which level. And it must know what
the plugin may contribute to identity. Core must learn this without calling
the plugin and without trying calls, including for installed plugins that are
disabled, so that a page can say which plugin would fill an empty section.
Connectors used to expose a provider `search`, which pulled identity work into
the typing path.

## Ruling

**A static contract file.** Each plugin that serves investment data ships
`contract.json` at its package root, beside `plugin.yaml`. Its settings live in
the separate `configuration.json`, which the configuration contract owns; the
two files are never merged. Core reads `contract.json` without running plugin
code and validates it with `identity.validate_manifest`, which rejects unknown
fields. Native Hermes stays the authority for discovery and enablement. For an
enabled plugin, core also checks that every tool the file names is registered
and owned by that plugin. The file of a disabled plugin only feeds coverage
hints. This is not a registry: there is no central list, and deleting the
package removes the declaration.

```json
{
  "schema_version": 1, "plugin": "yahoo", "provider": "yahoo", "label": "Yahoo Finance",
  "addressing": {
    "native": [{"native_scope": "symbol", "level": "listing", "asset_classes": ["equity", "fund", "index"]}],
    "schemes": {"listing": ["ticker_mic"], "security": ["isin"]},
    "venues": {"mic_table": {"XAMS": {"suffix": ".AS"}, "XNGS": {"suffix": ""}}, "composites": ["US"]},
    "symbol_rules": {"class_separator": "-", "pad": {"XHKG": 4}, "strip_trailing_dot": ["XLON"]}
  },
  "content": {
    "quote": {"level": "listing", "via": "listing", "tool": "yahoo_quote"},
    "news": {"level": "security", "via": "listing", "tool": "yahoo_news"}
  },
  "catalogue": {"mode": "resolve_only", "binding_ttl_seconds": 2592000},
  "resolve": {"tool": "yahoo_resolve", "input_schemes": ["isin"], "echoes": ["ticker_mic"],
              "cost": {"calls": 1, "credits": 0}}
}
```

**`addressing`** declares what the plugin can address:

- its native reference scopes, each at one level (`yahoo` `symbol` addresses a
  listing; `eodhd` `catalogue` a listing, EODHD's US composite a composite);
- the global identifier schemes it accepts at each level (a scheme must belong
  to that level);
- a MIC table, served composites and symbol rules, from which core builds a
  native reference from ticker@MIC without a call.

Core evaluates `can_address(subject, section)` from this block and from cached
bindings. It is pure and synchronous, and it answers `yes` (native ref), `no`
(reason) or `needs_lookup` (cost).

**`content`** maps page sections to capabilities. Each entry gives the level the
data is about, the level of the reference used to call (`via`), and the tool
(and optionally the operation). For example, `fundamentals` is issuer data
fetched via a listing symbol. `via` may be narrower than `level`, never broader,
and it must be a level the plugin can address. Core owns the section vocabulary:
`quote`, `chart`, `profile`, `financials`, `fundamentals`, `filings`, `news`,
`estimates`, `transcripts`, `dividends`, `ownership`, `ratings` and `events`.
Content operations take `{subject, level, native_ref}` and echo `native_ref`.

**`catalogue`** holds the one provider term core enforces: whether a local copy
is allowed.

- `bulk` pages typed record claims into `overlay-<plugin>.sqlite3` with declared
  scopes and a maximum age.
- `resolve_only` is for providers that forbid local caching. No catalogue rows
  are stored. Only the bindings for subjects the user actually picked are kept,
  with a TTL, and they are re-verified. Yahoo works this way.

No other licence terms are modelled. Each plugin carries its provider's terms
and enforces them itself. Rows can leave the plugin, for example as a queue item
that a resolver plugin reads. For that reason core records the originating
plugin on every claim, overlay row and queue item, and any consumer honours that
plugin's catalogue mode.

**`resolve`** is an optional, budgeted lookup from global identifiers to the
plugin's native reference, for example Yahoo search-by-ISIN. It must echo
identifiers. Core confirms the binding only when the echoed identifiers agree
with the subject at the right level: ISIN or share-class FIGI at security level,
FIGI or ticker@MIC at listing level, LEI or CIK at issuer level. Anything else
stays a candidate or goes to the resolution queue. The explicit "Look up in X"
action in search calls exactly one plugin's `resolve`.

**`resolver`** (optional) declares that the plugin can answer resolution-queue
items, and for which relations. Jev, for example, would declare it. Its verdicts
go through the core's authority rule like any other resolver's.

**Provider `search` is not part of the contract.** The validator rejects a
`search` block. Search is the core's local read of the directory.

**Claims, not reconciliation.** A plugin emits a `ClaimBatch` (a catalogue page,
a resolve answer or a reference-source run) through the loaded core's
`identity.emitter().emit(batch)`, which returns an `EmitReceipt`. The batch
holds `RecordClaim`s and `RelationClaim`s:

- a record claim co-asserts the identifiers of one source record at its native
  level, with provenance and optionally its own native reference, which becomes
  a binding;
- a relation claim names both ends by global identifiers.

`identity.check_batch` enforces the contract mechanically:

- a plugin binds only its own declared native references, at their declared level;
- a record never asserts identifiers narrower than itself, except that a crypto
  asset may list its CAIP-19 deployments;
- a depositary line marks its underlying's ISIN as `underlying`;
- catalogue pages need a declared bulk scope, and resolve answers need a
  declared `resolve`.

Plugins never name Pythia subject IDs, never choose an evidence tier and never
compare their rows with another plugin's. Core joins at ingest.

**Overlap between plugins.** Identity overlap is solved by the join: when two
plugins' references land on one subject, the subject simply has two bindings.
Content overlap is solved by the user's preference, one plugin per section:

- each section shows the plugin that served it, the native reference and the
  as-of time;
- fields from different plugins are never merged;
- a failed plugin does not silently fall back to another;
- when plugins disagree on a fact, the page shows the disagreement instead of
  averaging it away.

**Page composition budget.** A page makes at most 6 content reads and at most 3
resolves (1 per plugin), and resolves have 5 s of wall-clock time
(`identity.PAGE_BUDGET`). A section beyond the budget offers "resolve on
demand". A section no enabled plugin covers names the installed or bundled
plugin that would fill it. Pages never wait on the agent or a resolver.

## Rationale

A declarative contract lets core decide addressing, section choice and coverage
hints without running untrusted code on the page path, and without a trial call
per provider. A connector author writes the contract file, content operations
they already have, and optionally a catalogue or `resolve`. They write no
search, grouping or matching code. One page-level preference model keeps
provenance clear and avoids mixed-source numbers.

## Consequences

- Managed plugins must list `contract.json` in their release file allowlist.
- The existing `pythia_market_data` contribution annotation keeps declaring
  market-data read operations for the unchanged read pipeline. `contract.json`
  adds identity and page addressing on top of it.
- Adding a section name is a core change, because sections are shared meaning
  across plugins.
- Resolve-only providers cost one verification call the first time a subject is
  opened, and again after the TTL.

## Rejected alternatives

- **Provider search in the contract.** It brings network calls and
  reconciliation back into typing.
- **Plugin code that decides addressing on the page path.** It is slow,
  untrusted and impossible to evaluate for a disabled plugin. Declarative tables
  cover the measured cases.
- **Declaring the contract in the tool schema's `$comment`.** A disabled plugin
  registers no tools, so coverage hints could not be shown.
- **Field-level merging or automatic fallback between plugins.** Either one
  hides which source supplied a number.
- **Modelling licences in core.** Each plugin carries its provider's terms;
  core needs only the local-catalogue switch.
