# Identity backend consumer interface

`runtime/managed/plugins/market-data/identity.py` exports
`IdentityStore(data_dir, *, rules=None, evidence_versions=None)`. Pass the actual
native feature `PluginState.data_dir`; do not compute another profile or global
state root. `rules` and expected adapter evidence versions are installed code
configuration, never model arguments. The store uses one private SQLite file,
short `BEGIN IMMEDIATE` transactions, revision history and a monotonic mapping
generation. It rejects linked, nonregular, foreign-owned or permissive state
paths. It opens no provider connections, listeners or background jobs.

Current matching supports qualified IBKR and EODHD equity evidence. A native
IBKR conId assertion supports its own contract binding. A checksummed, actually
asserted instrument ISIN can prove instrument equivalence across IBKR contracts
unless known share-class/identifier evidence contradicts it. An EODHD
`catalogue` reference names the exact source-returned `CODE.EXCHANGE`; qualified
native instrument evidence supports that exact catalogue intent. Common Stock
classification belongs to the trusted EODHD adapter: missing, ambiguous or
receipt classifications provide no qualified native/ISIN assertions.

The concrete IBKR/EODHD rule joins one instrument in either save order only
when both have source-asserted native instrument evidence and the same actual,
checksum-valid instrument ISIN, without contradictory identifiers or explicit
share classes. Distinct provider references, currencies and series stay distinct.
The same qualified native-plus-ISIN evidence also proves instrument equivalence
between EODHD catalogue references, without an IBKR intermediary.
These rules need no paid reference catalogue or suffix/name/ticker inference;
incomplete reverse lookup is not evidence of uniqueness or absence. Missing or
query-only identifiers do not cross-confirm; native source reads remain useful.

An IBKR listing requires actual listing-scoped native evidence with primary
venue and currency; SMART routing is not a venue. Listing equivalence requires
the same conId, venue and currency. EODHD catalogue suffixes (including `US`) do
not establish venues or listing equivalence; EODHD listing matching is currently
unqualified. Names, tickers and currency alone prove no association. The equity
rules do not identify company/issuer or crypto subjects, infer receipt/share-class
equivalence, or synthesize issuer identity from a security identifier.

The separate CoinGecko/CoinMarketCap crypto rules require their matching provider,
`native_scope: coin` and source-asserted native crypto evidence for the exact
coin ID. It confirms only the same native reference, retaining distinct coin
IDs as candidates. Conflicting native assertions block confirmation. Platform
contracts, symbols and wrapped-asset relationships are not cross-coin or
cross-provider proof. Synthetic evidence checks exercise these narrow rules;
no concrete shared crypto connector or live qualification is included in this
foundation. An absent connector cannot be used merely because its rule exists.

The internal connector boundary is `ingest(native_ref, evidence)`. It validates
and stores immutable normalized evidence, returning evidence IDs. Only a trusted
adapter result obtained through the bounded source execution path may call it.
Do not expose an Evidence object or its `authority` field as a model-authored
mutation argument. Search does not automatically ingest or create identities.
Evidence IDs cannot be reused for changed content, and an evidence record must
be bound to the exact selected native reference.

Public backend operations take already-stored evidence references:

- `save(native_ref, scope, evidence_ids)` explicitly saves a selected native
  reference, returning an existing stable association or creating a scoped
  subject. Missing/insufficient evidence remains candidate, not routable proof.
- `refresh(mapping_id, evidence_ids)` applies newly ingested details while
  retaining original reference intent and all historical mapping revisions.
- `inspect(mapping_id)` returns `mapping`, `generation`, normalized `evidence`,
  `native_ref`, `intent_subject`, and a `repair` reason. The nested `mapping`
  satisfies the shared closed Mapping contract; lineage stays outside it.
- `subject(subject_ref)` returns its original native reference and evidence IDs.
  `history(mapping_id)` returns retained Mapping revisions in order.
- `bindings(subject_ref)` returns confirmed current mappings plus `generation`.
  A proven correction may retain the requested subject as original intent while
  reporting a corrected canonical target explicitly in the Mapping, but only
  when current evidence also proves equivalence to the retained original facts.
  `inspect`/`history` can expose a known-good correction without making it a
  routable alias for contradictory or unknown original intent. The shared reader uses
  `bindings` for routing, never treat correction lineage as routing authority. A
  contradicted listing/share-class association is quarantined, never redirected
  to make a read succeed. Native source reads remain possible independently.
- `apply_override(mapping_id, effect, evidence_ids, target=None)` accepts only
  evidence-record-backed `positive` or `negative` effects. Positive evidence
  must prove the scoped target, including comparison with all current evidence;
  a caller cannot omit a contradiction. Negative evidence must demonstrate a
  conflict with the existing target and cannot choose a replacement. Neither
  free-text confidence nor a query echo establishes proof.
- `overrides(mapping_id)` exposes override state and references;
  `revoke_override(override_id)` returns the ordinary rule's current assessment.
- `repair_status()` reports current unresolved associations and generation.

Every access first repairs mappings whose concrete rule or adapter-evidence
version dependencies changed. Evidence versions are checked against each record's
own provider, including target-side evidence; the providers need not use the
same version string. Cross-provider mappings also depend on the concrete pair
rule version in either save direction. These dependencies use the existing
private mapping JSON, not a new registry or database schema. Updates touch only
participating mappings: an EODHD revision does not revise unrelated IBKR-only
rows. Positive/negative overrides require current evidence on both sides.
Retained current proof can enrich optional
identifiers without overwriting original intent. A newly sufficient candidate
can join one proven equivalent subject, with the correction visible in history.
A pending adapter refresh does not erase previously retained intent: refreshed
contradictory class/ISIN proof cannot enter automatic candidate retargeting.
Previously confirmed contradictory intent is quarantined. Multiple proven
existing subjects stay ambiguous across a version change; no generic merge
engine or arbitrary first-match selection resolves them. Unaffected mappings
keep their revisions. Relevant fixes retire redundant overrides; insufficient
updated evidence quarantines them. Required source refresh stays
`pending_evidence_refresh` offline until an explicit permitted details read
provides the installed adapter's expected evidence revision.

The cache seam is `cache_token()` before a read and
`with store.current_generation(token):` around cache publication. The latter
holds the SQLite transaction while the caller publishes, rejecting stale
in-flight results atomically with repair. Cache lookups must still verify the
current generation and native source availability. A generation token does not
substitute for the execution bridge's platform/readiness checks.

Focused synthetic qualification lives in
`runtime/test/python/test_market_data_identity.py` and
`runtime/test/python/test_market_data_equity_matching.py`. They cover optional-ID
enrichment, instrument/listing/route distinctions, class conflicts, positive and
negative overrides, relevant update repair, immutable historical intent,
pending refresh/recovery, ambiguous subjects, concurrent operations, rollback
after an interrupted multi-row repair, stale cache publication and private state
paths, both cross-provider save orders, distinct adapter revisions, target-side
refresh, pair-rule updates and seeded false-merge correction. These tests use
invented evidence and make no live-provider or installed-plugin claim.
