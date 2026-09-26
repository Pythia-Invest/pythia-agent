# 0012: Investment identity and evidence-backed repair

## Context

Investors retain references while providers change identifiers, listings and
metadata. A ticker or company name cannot distinguish instruments, share
classes, venues and trading routes. Fixing a matcher without repairing stored
associations leaves incorrect routing in place; rewriting retained research
would instead erase what the investor originally selected.

## Ruling

The shared feature owns stable company, instrument, listing and crypto subject
references, provider-native references, scoped evidence and mapping revisions.
Connectors provide normalized source evidence; only validated details returned
through the source bridge can enter identity ingestion. Search does not create
identities. `resolve_save` explicitly saves a selected native reference at the
requested scope; insufficient evidence stays candidate and cannot route a
canonical read. Native reads do not require a canonical match.

IBKR native conId evidence binds its contract. EODHD qualified Common Stock
metadata binds an exact catalogue reference. Actual checksum-valid instrument
ISIN assertions can prove instrument equivalence across qualified IBKR/EODHD
references, including either save order, unless class or identifier evidence
contradicts it. Native assertions are required on both sides; query echoes and
reverse-lookup completeness do not supply identity proof. Listing proof remains
IBKR-specific: same conId, primary venue and currency. SMART is a route, and an
EODHD exchange suffix is not a proven listing venue.

CoinGecko/CoinMarketCap's narrow crypto rules associate the same exact native coin reference
when source-asserted crypto evidence confirms it. Names, symbols, platform
contracts and wrapped-asset relationships do not prove equivalence between
coin IDs or across sources. Company/issuer matching is not implemented.

Rule dependencies belong to the concrete source or source pair. Evidence
versions are checked against each record's provider, including target evidence;
providers need not share version strings. Updating one adapter repairs affected
mappings without revising unrelated source-only associations.

Identity, original intent, immutable evidence, rule/evidence-version dependencies,
revision history and overrides live in private transactional SQLite under native
`PluginState.data_dir`. Access re-evaluates mappings affected by installed rule
or evidence-version changes. Supported proof repairs associations automatically;
contradictory intent is quarantined. Required fresh source evidence remains
pending offline until an explicit permitted refresh supplies it. Unknown or
multiple possible targets are never guessed into a match.

The agent can inspect state and apply/revoke positive or negative overrides using
persisted evidence IDs. Positive overrides must prove the scoped target against
all current evidence. Negative overrides need contradiction and cannot nominate
a replacement. Caller-authored assertions, omitted contradictions and free-text
confidence cannot override proof. Relevant fixes retire redundant overrides or
quarantine unsupported ones; revisions remain inspectable.

Correction lineage reports what changed without rewriting original references
or research. Only current proven `bindings()` may route canonical intent; an
inspection result is not a routable alias. Mapping generation is rechecked under
a transaction before cache publication so a repair invalidates stale in-flight
results. Known listing/share-class conflicts cannot silently select another
investment to make a read succeed.

## Rationale

Source evidence and explicit scopes permit durable references without a paid
universal catalogue or investor-maintained mapping table. Supported automatic
repair fixes persisted consequences as well as code. Conservative unresolved
states preserve useful native-source access without pretending universal proof.

## Consequences

Private identity/settings survive restart; observations do not become a durable
archive. Repair runs on access rather than through a background service. Source
refresh can require connectivity and permission, so offline repair may remain
pending. Synthetic tests exercise equity association, repair, conflicts,
per-provider version changes and native crypto-catalogue identity. These rules
are Pythia-owned even when their connector is absent; they neither install a
provider nor certify actual account coverage. The
[identity API](../../packages/market-data/IDENTITY.md) owns exact operations.

## Rejected alternatives

Ticker/name matching, ISIN-as-listing-ID and SMART-as-venue collapse different
investments. Connector-owned global mappings duplicate authority. Manual
investor rematching, code-only fixes and permanent force-match overrides leave
incorrect associations hidden. A universal merge engine, automatic fallback,
renumbering every reference or rewriting retained research would sacrifice
scope, intent or evidence beyond this requirement.

## Amendment (2026-09)

ADR 0037 replaces the provider-bound evidence model above with a core-owned,
subject-keyed identity backbone. The source-pair rules and the IBKR-only listing
proof go with it. The original text is kept as the record of that model.

These passages are superseded:

- **Ruling, overrides paragraph:** "Positive overrides must prove the scoped
  target against all current evidence. Negative overrides need contradiction
  and cannot nominate a replacement."
- **Ruling, lineage paragraph:** "Only current proven `bindings()` may route
  canonical intent". Current *confirmed* bindings now route canonical intent,
  including confirmations made without identifier proof.
- **Rejected alternatives:** the rejection of "manual investor rematching" and
  "permanent force-match overrides". Manual resolution is one allowed resolver.
  Its confirmations stay inspectable and yield to contradicting identifiers.

One invariant governs every confirmation. A resolver may confirm an association
when no identifier proves it. It never confirms one against current
contradicting identifier evidence.

Conflicts and residuals collect in one core-owned queue. The investor chooses
among interchangeable resolvers:

- built-in rules;
- the Hermes agent;
- an optional matcher plugin such as Jev;
- manual resolution.

Manual resolution is allowed and never required. Plugin updates repair affected
matches automatically.

The remaining guarantees of this ADR stand:

- retained intent;
- no guessing between unknown or multiple targets;
- quarantined contradictions;
- inspectable revisions.

ADR 0037 owns the authority vocabulary and the edge cases:

- which authorities may confirm;
- what counts as contradicting evidence across levels and validity windows;
- what happens when several targets qualify;
- revocation;
- repair dependencies.

It also owns the matching change to the ADR 0011 wire authority enum.

## Amendment (2026-09, retirement)

The implementation this ADR describes is removed. Market data keeps no identity
store: its `IdentityStore`, source-pair matching rules, overrides and repair
code are gone, and so are the `search`, `resolve_save`, `inspect_identity`,
`inspect_subject`, `refresh_identity`, `inspect_repair`, `apply_override` and
`revoke_override` actions. A subject read now names a backbone subject id and
routes through core's bindings and source order
([ADR 0037](0037-identity-backbone.md)); explicit provider references and
pinned source reads are unchanged.

Existing device state is kept, not converted. Source preferences move to the
feature's `preferences.sqlite3`. The old identity file is renamed
`identity-retired.sqlite3` and left in place; its mappings are not migrated,
because core derives or resolves addresses again from open identifiers. A
retained reference to a retired subject fails visibly instead of being rewritten.
[Market data and identity](../../packages/market-data/IDENTITY.md) has the
details. The principles in the first amendment still hold, now enforced by core.
