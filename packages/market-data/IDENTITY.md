# Identity backend consumer interface

Shared investment search stores selected display labels in `catalogue_labels`
inside the existing private identity database. The additive table is created for
existing databases without replacing subjects, mappings or revision history.
Only explicit adoption/resolve/details-refresh mutations update it; provider
search results are not an automatically ingested catalogue. Stored normalized
search text supports local label filtering before decoding metadata/evidence.
Older subjects without labels remain searchable by their retained native ID.

`adopt_search` reuses the identity owner's save/repair behavior. Ordinary single-reference
selection skips external enrichment and defaults to a source-bound result. It returns the
immutable intent subject and either a currently routable canonical binding or
an explicitly source-bound reference. A stable ID does not establish equivalence:
unsupported associations remain unresolved. Caller-supplied subject scope must
be supported by actual details metadata/evidence or the native contribution;
scope is not invented from the display ticker. Repeated adoption preserves IDs.
Confirmed identity also retains a native binding when default preferred reads
would exclude its source, such as a broker without saved opt-in. Identity status
and current source eligibility are separate; adoption never changes preferences.
Disconnected source references retain their user-adopted labels with unavailable
status, but do not grant provider access or canonical routing.

Search keeps provider references separate and performs no external qualification.
Explicit resolution retains the evidence rules below; instrument equivalence does not identify a listing.
Conflicting candidate metadata is exposed as unresolved/conflicting rather than
letting whichever source row arrived last dictate identity. Qualified instruments
retain separate native references and listing labels; they do not add a
company/instrument/listing relationship graph or collapse provider series.

`runtime/managed/plugins/market-data/identity.py` exports
`IdentityStore(data_dir, *, rules=None, evidence_versions=None)`. Pass the actual
native feature `PluginState.data_dir`; do not compute another profile or global
state root. `rules` and expected adapter evidence versions are installed code
configuration, never model arguments. The store uses one private SQLite file,
short `BEGIN IMMEDIATE` transactions, revision history and a monotonic mapping
generation. It rejects linked, nonregular, foreign-owned or permissive state
paths. It opens no provider connections, listeners or background jobs.

Current matching supports qualified equity evidence. A native
IBKR conId assertion supports its own contract binding. A checksummed, actually
asserted instrument ISIN can prove instrument equivalence across IBKR contracts
unless known share-class/identifier evidence contradicts it. An EODHD
`catalogue` reference names the exact source-returned `CODE.EXCHANGE`; qualified
native instrument evidence supports that exact catalogue intent. EODHD-reported
ISINs are retained as metadata, not promoted to instrument identity assertions:
its catalogue can label a receipt Common Stock and report an underlying-share
ISIN. Consequently the old EODHD/IBKR and EODHD/EODHD ISIN joining rules are
retired. The adapter and rule version changes trigger existing repair behavior;
they do not delete retained subjects or silently rewrite historical intent.

Optional reference qualification uses enabled native operations: EODHD's
`identifiers` supplies exact-symbol FIGI records, and OpenFIGI's `identify`
supplies classified reference records. A unique returned common-stock record
must corroborate the requested FIGI and supply a share-class FIGI. Yahoo's
currently qualified path uses its explicit `NMS` exchange metadata, the `XNGS`
segment MIC request, and the returned `UW` exchange code and exact ticker. It
does not invent a currency, rewrite a ticker, or infer a venue from a suffix.
Other Yahoo exchanges and financial product types remain unqualified until
their evidence paths are demonstrated. A query constraint alone is not returned
identity evidence. Multiple reference hits remain unresolved even if they share
an identifier.

Pythia owns these narrow qualification rules and the distinction between a
share-class, composite and listing FIGI; connectors retrieve native facts without
deciding cross-provider equivalence. Evidence retains the reference authority,
record ID, security classification and adapter revision. Equal qualified
share-class FIGIs can join instrument groups while currencies, listings and
source series remain distinct. A listing FIGI or issuer identifier is not
silently reinterpreted as a share-class identifier.

Qualification is optional: an absent or inaccessible reference connector leaves
ordinary native search usable. It adds no direct HTTP path, mandatory paid
catalogue or separate plugin registry. Explicit resolution qualifies a bounded
set of at most eight selected equity references. Ordinary search and single-reference
adoption do not invoke this enrichment. Re-adopting a reference retains previously
qualified reference evidence when fresh source assertions are unchanged apart
from observation IDs and timestamps. Changed assertions replace that proof and
run normal repair; retained proof remains subject to rule and adapter-version
invalidation. Explicit resolution and refresh replace evidence through their
qualified path. Requests use the profile's resident
native execution and metadata cache, with configuration/access-aware keys and
publication checks. Successful reference reads are reused for five minutes;
reference failures are not cached as successful proof. Failures are reported as
issues and safe structured diagnostics, without provider payloads or credentials.
Search never persists an identity; explicit adoption/resolution owns durable writes.

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
