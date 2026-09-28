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
  in core's source order. A plugin that is disabled, needs configuration, is
  contradicted or still needs a resolve contributes none. The investor's saved
  source preferences come first; core's order follows. With no reference data,
  an unknown subject, core not loaded or no serving plugin, the read reports
  `unresolved_identity`, says which, and calls no provider. The agent then inspects the
  subject (`pythia_identity_subject`) or asks a plugin to resolve it
  (`pythia_identity_resolve`).
- An **explicit provider reference** (`provider_ref`). It reads exactly that
  source. Pinned `source` views read the retained series descriptor.

A subject read's series carries the requested subject. Scoped source preferences may name an `asset_class` (`equity` or
`crypto`) taken from core's subject.

This feature cannot save, override or repair an association. Those are core
decisions: resolve answers, the review queue and its resolvers.

## Retired state

Before ADR 0037 this feature kept provider mappings and source preferences in
its own `identity.sqlite3` (ADR 0012). On the first start of this version the
backend copies the source preferences into `preferences.sqlite3` and renames
the old file `identity-retired.sqlite3` in the same private data directory:

- Global source orders are copied as they are.
- A scoped preference for the retired subject kinds becomes an `asset_class`
  scope: `crypto` to `crypto`; `listing` and `instrument` to `equity`, the
  `listing` rule winning when both collapse onto one scope. `company`-scoped
  preferences never applied to a price read and are dropped (and counted).
- Provider mappings, evidence and overrides are not migrated. Core derives or
  resolves every address again from open identifiers.

The file is renamed only after the copy commits. If the copy fails (a locked
or unreadable file), the file stays where it is and the next start retries; two
processes starting together copy idempotently and one renames. Nothing is
deleted. The retired file stays for inspection, and a warning in the
Hermes log reports how many choices were copied, how many were shadowed and how
many mappings were left behind. A retained request or widget that still names a
retired subject (`instrument:…`, `company:…`, `crypto:…`) fails validation as an
invalid request and shows its error. It is not rewritten or dropped. Search the
investment again to get its subject id.

Desk has no stored watchlist yet, and instrument pages already address backbone
subject ids, so no other device state names a retired subject.
