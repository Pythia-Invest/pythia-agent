# 0037: Identity backbone

## Context

Investors search for companies, securities, listings and crypto assets, then
open pages that combine data from several sources. Each provider names things
its own way: `ASML.AS`, `ASML.US`, a conId, a coin id. The previous design
searched every connected provider in parallel while the user typed, then
reconciled the results pairwise. Qualifying ASML took 11.3 s, and discovery was
mixed up with proof. Open reference data (ESMA FIRDS, GLEIF, SEC, OpenFIGI)
already identifies most EU and US listed equities. A prototype joined it into a
local index that answers searches in about 0.03 ms.

[ADR 0012](0012-investment-identity-and-repair.md) set evidence-backed identity
and repair inside the market-data feature, keyed by provider reference. This
decision keeps its principles and replaces its scope.

## Ruling

**Core owns identity.** The backbone is part of Pythia core
(`runtime/managed/core/identity/`) and is always on. It owns the schema, join
rules, evidence tiers, resolution queue, stores, directory and local search.
Every data source is a plugin that contributes typed claims. This amends
[ADR 0034](0034-core-and-optional-features.md): canonical identity moves from
the market-data feature into core. The contracts live in
`runtime/managed/core/identity/`, and plugins reach them through the loaded
core's `identity` module (`API_VERSION` 1).

| Core (always on) | Plugins (bundled, clonable, disableable) |
| --- | --- |
| Levels, schemes, tiers, authorities, claims, bindings, relations | Reference sources: FIRDS, GLEIF, SEC, OpenFIGI, ISO MIC |
| Reference, identity, overlay and directory stores; the join | Provider connectors: Yahoo, EODHD, CoinMarketCap, CoinGecko, IBKR |
| The resolution queue and the authority rule | Resolvers beyond the built-in rules, such as a Jev judge |
| Directory, local `search`, ranking policy | Ranking signals, the search bar module, page layouts, widgets |
| Evaluating the plugin contract ([ADR 0038](0038-plugin-addressing-contract.md)), page budgets | The reference data itself, fetched by the reference plugins |

Disabling a plugin removes its coverage and nothing else. No provider is
required: a Yahoo-only install works.

**Four levels.** An *issuer* is identified by LEI and/or CIK, which are peers.
A *security* is identified by ISIN, share-class FIGI or CUSIP. A *composite
listing* is identified by composite FIGI, or by (security, country); it is a
country line such as the US consolidated tape, not a venue. A *venue listing*
is one trading line at a MIC, with a currency, a price scale, a FIGI and a
ticker (root and class) as an attribute.

**Subject IDs are derived from open identifiers** (`identity.subject_id`), never
random or sequential:

| Level | ID, first available key wins |
| --- | --- |
| Issuer | `issuer:lei:<LEI>`, else `issuer:cik:<CIK>` |
| Security | `security:isin:<ISIN>`, else `security:figi:<share-class FIGI>`, else `security:caip19:<home deployment>` for a crypto asset |
| Composite | the security key plus country, e.g. `composite:isin:USN070592100:US` |
| Listing | `listing:isin:<ISIN>:<operating MIC>:<currency>`, else `listing:figi:<FIGI>`, else `listing:caip19:<deployment>` |

Every install that builds its own reference data, every rebuild and any future
sync between installs then mean the same thing by the same ID. The listing key
always includes the currency. Adding it only when needed would change an
existing ID the day a second currency line appears. Operating MICs are used
because sources disagree on segment MICs. If two current lines still share
ISIN, operating MIC and currency, both use their FIGI. Only open identifiers
derive IDs; a provider overlay never re-keys a subject.

Deterministic IDs hold only where a stable open identifier exists. Some subjects
have none: provider-only indices, coins without a CAIP-19 mapping, private
companies. These get a provider-namespaced provisional ID, for example
`security:provisional:eodhd:catalogue:GSPC.INDX`. Such an ID is valid and
deterministic for anyone with that provider, but it is marked non-portable. When
an open identifier later names the subject, the provisional ID becomes an alias
of the open-identifier subject.

When a better key becomes known, the subject is re-keyed and the old ID becomes
an alias. When a natural key changes (a new ISIN after a corporate action, an
LEI merger), the new subject is linked to the old one by `successor_of`, and the
old ID stays resolvable. User state (watchlists, notes, resolutions) stores
subject IDs only, never provider references. Readers follow aliases and
successors; saved IDs are never rewritten.

Each global scheme identifies exactly one level, and both the types and the SQL
enforce this. An ISIN alone identifies a security, never a listing, and an LEI
never identifies a security. The existing wire kinds map as follows: `company`
is an issuer, `instrument` is a security, `listing` is a venue listing and
`crypto` is a crypto asset. `composite` is new.

**Provider symbols are bindings, never subjects.** A binding is the existing
market-data `provider_ref` (`provider`, `native_id`, `native_scope`), bound to
one subject at the reference's native level. It carries a status, an authority,
evidence and a validity window. The market-data read pipeline keeps addressing
by `provider_ref` and stays unchanged; the backbone tells it which subject a
reference is. EODHD `ASML.AS` binds the XAMS listing. EODHD `ASML.US` binds the
US composite, because `.US` is not a venue.

**Typed relations never merge subjects.** The relations are
`depositary_receipt_of` (with an optional ratio), `share_class_of`, `parent_of`
(direct or ultimate), `wraps` (crypto) and `successor_of`. ASML's NASDAQ line
is a separate security: New York Registry Shares, ISIN USN070592100. It is
linked to the ordinary share NL0010273215 by `depositary_receipt_of`, under the
same issuer.

**Identifier assertions.** Each assertion records the subject, scheme, value,
validity window, provenance (plugin, source, record, version, retrieval time),
authority and tier. Its evidence ID is a content hash, so an unchanged
assertion keeps its ID across builds.

**Crypto.** A crypto asset is a security-level subject (asset class `crypto`,
kind `coin` or `token`), usually without an issuer. Its provider IDs
(`coinmarketcap`/`coin` `1`, `coingecko`/`coin` `bitcoin`) are bindings. Each
chain deployment is a listing-level subject identified by CAIP-19 (for example
`eip155:1/slip44:60`), with a CAIP-2 chain instead of a MIC. Tokens join across
providers when their CAIP-19 deployments agree. Native coins join through a
small curated chain table (CAIP-2, native CAIP-19, provider coin IDs). Symbols
and names never join. Wrapped and bridged assets are separate subjects linked by
`wraps`. The reason is that provider coin IDs identify assets, not deployments:
one CMC id covers USDC on every chain. The deployment is the only open,
verifiable key. A native coin's asset ID is its SLIP-44 deployment (Bitcoin is
`security:caip19:bip122:000000000019d6689c085ae165831e93/slip44:0`). A token's
asset ID is its home deployment from the curated table, and the token stays
provisional until the table names one. Exchange pairs and aggregated prices are
content read through the asset's binding; they are not subjects.

**Evidence tiers and authorities.**

| Tier | Authorities | Confirms? |
| --- | --- | --- |
| T0 identifier | `source_asserted`, `snapshot` | Yes |
| T1 versioned rule (≥99.5% measured precision) | `rule_confirmed` (+ `rule_id`) | Yes |
| T2 probabilistic score | none: it ranks and rejects candidates | Never |
| T3 model verdict | `model_confirmed` at or above the relation's gold-calibrated threshold; `model_suggested` below | Only `model_confirmed` |
| T4 attestation | `user_attested`, `curated` | Yes |

`query_only` and `unknown` are not evidence. Plugins never choose a tier; the
core assigns it at ingest. This table is the authority vocabulary. The
ADR 0012 amendment points here.

**The authority rule.** It is the same for every resolver and is implemented
once, in `identity.resolution.decide`.

1. Any confirming authority may confirm an association when no identifier proves
   it. None may confirm against contradicting identifier evidence. The mechanical
   depositary-receipt and share-class guards override every verdict: a receipt
   and its underlying, or two share classes, are never the same security.
2. *Contradicting identifier evidence* means a T0 assertion for a single-valued
   scheme, valid at the time in question, at that scheme's own level on the
   association's subject or one of its ancestors, whose value differs.
   Identifiers are compared only at their own level: a record's ISIN is checked
   against the security's ISIN, never against the listing's ticker or FIGI. A
   provider overlay's identifier that disagrees with open reference evidence
   does not veto. The reference evidence prevails, and the disagreement becomes
   a conflict for inspection. In the prototype, all 66 US ISIN conflicts were
   stale EODHD ISINs. A provider's identifier vetoes only where no open
   evidence exists for that scheme.
3. If several candidates reach the threshold, or resolvers disagree, nothing is
   confirmed and the item stays in the queue as ambiguous.
4. An identifier-proven (T0) association is revoked only by new contradicting
   identifier evidence, or by the source's positive statement that it ended.
   Rule, model and user confirmations are also revocable, and a later
   contradiction reopens them as conflicts.
5. When a resolver's model, prompt version or threshold changes, the `model_*`
   associations it produced are re-evaluated. A threshold change is re-applied
   from stored confidences without calling the model again. Until the new
   verdict arrives, existing associations stay as they are.

Two rules carry over from the earlier lab. Missing evidence never erases a
confirmed association: only positive evidence of an end sets `valid_to`. A
revision is written only when the normalized record changes.

**Resolution queue.** Core owns one durable queue. It holds *residuals*, which
are records the join could not place, and *conflicts*, which are contradicting
evidence. A resolver reads an item and its evidence and submits a `Verdict`
with an authority. Resolvers are interchangeable and chosen by the user:

- built-in rules (`rule_confirmed`);
- the Hermes agent (`model_*`, or `user_attested` when it records what the user
  said);
- an optional resolver plugin such as Jev (`model_*`), off by default;
- the user resolving by hand (`user_attested`).

Manual resolution is allowed and never required. Hermes is the only hard
prerequisite. Resolution never runs on the search or page path.

**Stores.** All four stores are embedded SQLite written in portable SQL: standard
types, ISO-8601 text times, JSON as validated text. FTS5 is used only in the
directory. Each store is reached through a thin per-domain store module, so raw
SQL stays in one place per store and the engine could be swapped later.

| Store | Contents | Written by |
| --- | --- | --- |
| `reference.sqlite3` | Reference subjects, assertions, relations, names, aliases, venues, chains, rank signals | The reference builder on the device, replaced atomically |
| `reference-local.sqlite3` | The same schema, for device-only steps when an optional downloaded open release is the base | The builder |
| `overlay-<plugin>.sqlite3` | One bulk-catalogue plugin's typed records and the core's join outcome per record; hidden when the plugin is disabled, deleted with its credential | Catalogue sync plus the core |
| `identity.sqlite3` (v2) | Subjects the reference lacks (IDs and levels only), bindings and revisions, the queue, verdicts, overrides, applied aliases | Core |
| `directory.sqlite3` | Flat searchable rows, derived from the stores above | Core, rebuilt atomically |

Provider data lives only in the per-plugin overlays and the derived directory.
The identity store and user state hold subject IDs, bindings and decisions, so
the shareable layer stays separable from personal licensed data. Provider terms
travel with the rows. Every claim, overlay row and queue item carries its
originating plugin. Any consumer, such as an external resolver reading a queue
item, looks up that plugin's local-cache mode before storing or sending the row.
Everything stays on the device. The reference builder runs locally by default;
a downloadable open snapshot is an optional later accelerator with its own
decision. Each plugin carries its provider's terms and enforces them; core uses
open data and never publishes, pools or redistributes provider data. The one
mechanical term core honours is whether a provider allows a local catalogue
([ADR 0038](0038-plugin-addressing-contract.md)).

**Ingest join.** Each claimed record is joined once, at ingest, in this order.
The first match wins, and a contradiction stops the chain:

1. ISIN + operating MIC (+ currency where several lines exist).
2. ISIN alone, creating the venue listing under the security. A record that
   carries its underlying's ISIN is queued as a residual instead.
3. Share-class FIGI, composite FIGI or CUSIP.
4. Exact ticker@MIC with no contradicting identifier. This is a weak binding,
   re-verified on page open.
5. Otherwise, a provisional subject and a residual in the queue.

Contradictions become conflicts, never merges. Overlays are subordinate to open
evidence.

**Search is a local read.** `search` reads only `directory.sqlite3`. It makes no
provider call and no identity write, and it does no reconciliation. Rows are
flat. Listing rows are unique by MIC + ticker + currency, and crypto rows are
one per asset. Rows carry ISIN, LEI, CIK and FIGI, confirmed provider
references, kind, names, aliases and rank signals, and never prices. They are grouped by issuer.
To find something the index lacks, the user explicitly chooses "Look up in X",
which calls one provider's `resolve`, never several at once and never while
typing. The result joins like any other claim.

## Rationale

Identity work moves off the typing path, so search runs in milliseconds and
behaves the same with any set of plugins. Each record is joined once, at ingest,
by identifier agreement. Open data carries the backbone, and paid sources add
exactly the coverage they claim. One queue and one authority rule make
resolution auditable. Swapping a resolver changes who answers, not what an
answer may do.

## Consequences

- `runtime/managed/plugins/market-data/identity.py`, `identity_db.py`,
  `identity_matching.py`, `identity_overrides.py`, `identity_repair.py` and
  `packages/market-data/IDENTITY.md` stay unchanged here. A later piece replaces
  them with the backbone and migrates their mappings to bindings. Saved
  references move to subject IDs; an explicit source pin remains a source
  preference, not identity.
- The core payload gains the `identity` package and its DDL. It is standard
  library only and does no I/O at import.
- The queue's state, lease and attempt fields let a background job drain it
  later. The founder expects event-based processing and bulk background jobs
  (ranking incoming news, reacting to a new filing, bulk re-matching), with
  Hermes or Jev as workers. This decision prepares the queue for that without
  committing to a scheduler, event bus or job framework.
- Global coverage is not promised on day one. Uncovered sections name the plugin
  that would fill them.

## Rejected alternatives

- **Parallel provider search at typing time, with pairwise reconciliation.** It
  is slow, it depends on providers, and it mixes discovery with proof.
- **Qualifying a relationship graph at search time.** It repeats the same work
  on every query, and nothing it learns is kept.
- **Per-provider identities, one catalogue per provider.** Results would appear
  once per provider, and no provider-independent subject would exist for pages,
  watchlists or research.
- **Merging on names or tickers, or keying a listing by ISIN alone.** Both
  collapse different investments.
- **Random or sequential subject IDs.** Two installs, or two rebuilds, would
  mean different things by the same ID.
- **A mandatory cloud master.** It adds a service dependency.
- **A server database now.** Embedded SQLite behind store modules is enough; a
  team edition may revisit it.
