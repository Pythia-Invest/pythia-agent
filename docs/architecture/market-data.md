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

The release installs the shared owner, contracts, execution helpers and agent
skill, plus the credential-free [Yahoo Finance connector](../../runtime/managed/plugins/yahoo-discovery/README.md)
(personal use; its data never leaves the device). `describe` reports only
installed, enabled native contributions. The original core SEC/EODHD tools are
retired; other connector packages must supply those capabilities explicitly.
Enabling the owner does not install a provider or prove an account's access.

- [Wire contracts](../../packages/market-data/README.md): subject, series,
  observation and read result, with provenance and financial semantics.
- [Identity](../../packages/market-data/IDENTITY.md): narrow source-specific
  evidence rules, retained intent and revision-aware repair.
- [Backend operations](../../packages/market-data/BACKEND.md): preferred and
  pinned reads, compatibility selection, cache authorization and native actions.
- [Connector support](connector-support.md): reusable execution, batching,
  cancellation, budgets, structured failures and Hermes logs.
- [Data delivery](data-delivery.md): resident HTTP/SSE and demand lifetime.

Provider preferences are deterministic application logic. Only proven identities,
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
