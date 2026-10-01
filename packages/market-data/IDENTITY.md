# Market data and identity

Market data has no identity store of its own. Core owns subjects, bindings,
evidence and the review queue ([ADR 0037](../../docs/decisions/0037-identity-backbone.md));
this feature reads through them.

A read names what it wants in one of two ways:

- A **Pythia subject**, `{"kind": <level>, "id": <subject id>}`. The id is a
  backbone subject id such as `listing:isin:NL0010273215:XAMS:EUR` or
  `security:caip19:…`, and `kind` is its level: `security`, `composite` or
  `listing`. An `issuer` subject has no price; its reads fail with
  `issuer_subject` before any provider call. The backend asks core, through its versioned platform
  support (`platform().price_sources`), for the native references that serve
  the subject's quote and chart now: a local read of the reference file,
  `identity.sqlite3` and the installed contracts, once per subject per request.
  These are confirmed bindings and addresses core derives from open identifiers,
  in core's one source order (ADR 0040). A plugin that is disabled, needs
  configuration, is contradicted or still needs a resolve contributes none. The
  first of them with a compatible series serves. With no reference data,
  an unknown subject, core not loaded or no serving plugin, the read reports
  `unresolved_identity`, says which, and calls no provider. The agent then inspects the
  subject (`pythia_identity_subject`) or asks a plugin to resolve it
  (`pythia_identity_resolve`).
- An **explicit provider reference** (`provider_ref`). It reads exactly that
  source. Pinned `source` views read the retained series descriptor.

A subject read's series carries the requested subject.

This feature cannot save, override or repair an association. Those are core
decisions: resolve answers, the review queue and its resolvers.

## Retired state

Before ADR 0037 this feature kept provider mappings and source preferences in
its own `identity.sqlite3` (ADR 0012), and later its source orders in
`preferences.sqlite3`. Pythia now has one source order, core's `source_order`
setting (ADR 0040), so neither file applies. On its first use in this version
the backend renames each file that exists to `identity-retired.sqlite3` or
`preferences-retired.sqlite3` in the same private data directory, never
overwriting an earlier one, and logs a warning in the Hermes log naming the
orders it held. Nothing is copied into `settings.json` and nothing is deleted;
provider mappings, evidence and overrides are not migrated either. Core derives
or resolves every address again from open identifiers.

A retained request or widget that still names a
retired subject (`instrument:…`, `company:…`, `crypto:…`) fails validation as an
invalid request and shows its error. It is not rewritten or dropped. Search the
investment again to get its subject id.

Desk has no stored watchlist yet, and instrument pages already address backbone
subject ids, so no other device state names a retired subject.
