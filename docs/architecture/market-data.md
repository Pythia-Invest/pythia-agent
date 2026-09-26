# Shared financial backend

Pythia owns canonical investment identity, evidence-backed matching and the
meaning of financial reads. Connectors supply native references, source evidence,
implemented capabilities and normalized results. Hermes owns discovery,
enablement, tool execution and profile lifetime.

The `pythia-market-data` native plugin provides one lazy backend per loaded
profile context. Its financial tool and protected HTTP/SSE handlers share that
instance inside the existing gateway. Standalone CLI operations use the same
implementation and durable identity/preferences with their own disposable cache.
Ordinary dashboard consumers must use the resident endpoint, without model calls
or per-request Hermes startup.

This increment installs the shared owner, contracts, execution helpers and agent
skill. It deliberately installs no concrete shared provider or Desk widget.
`describe` reports only installed, enabled native contributions; on this payload
it has no provider sources. The original core SEC/EODHD tools are retired; later
connector packages must supply those capabilities explicitly. Enabling the owner
does not install a provider or prove an account's access.

- [Wire contracts](../../packages/market-data/README.md): subject, series,
  observation and read result, with provenance and financial semantics.
- [Identity](../../packages/market-data/IDENTITY.md): narrow source-specific
  evidence rules, retained intent and revision-aware repair.
- [Backend operations](../../packages/market-data/BACKEND.md): preferred and
  pinned reads, compatibility selection, cache authorization and native actions.
- [Connector support](connector-support.md): reusable execution, batching,
  cancellation, budgets, structured failures and Hermes logs.
- [Data delivery](data-delivery.md): resident HTTP/SSE and demand lifetime.

The identity direction has changed. ADR 0037 replaces the provider-bound rules in
the identity document with a core-owned backbone of issuer, security, listing
and crypto subjects. Provider symbols become bindings, joined at ingest by
identifier agreement. The [ADR 0012 amendment](../decisions/0012-investment-identity-and-repair.md#amendment-2026-09)
records which parts of the provider-bound model are superseded. Reference data
will be built on the device directly from open sources
([ADR 0039](../decisions/0039-local-first-reference-data-and-rights.md)).
Investment search will read a local directory and will call no provider while
the user types. Provider data is used under the investor's own agreement with
each provider; each plugin carries and enforces its provider's terms, and Pythia
itself never publishes, pools or redistributes provider data. The identity
document describes the implemented rules until identity v2 replaces them.

Provider preferences are deterministic application logic. Only confirmed identities,
compatible series and eligible operations participate. Failure after selecting a
source never authorizes fallback or history stitching. A preference change does
not rewrite retained research or source pins. Unknown units, times, completion,
coverage and entitlements remain explicit.

The existing lifecycle copies explicit plugin files and bundled skills, validates
with native doctor and enables only the declared default set for a fresh profile.
Updates preserve existing native enabled choices, private plugin state and
user-owned replacements. See the common [plugin convention](plugins.md).
Activation requires
the normal refresh and gateway restart; source files are not automatically live.
There is no second registry, daemon, credential store or durable price archive.
