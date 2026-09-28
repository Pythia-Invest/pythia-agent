# Shared financial backend

Pythia owns investment identity (core, [ADR 0037](../decisions/0037-identity-backbone.md))
and the meaning of financial reads. Connectors supply native references, source
evidence, implemented capabilities and normalized results. Hermes owns discovery,
enablement, tool execution and profile lifetime.

The `pythia-market-data` native plugin provides one lazy backend per loaded
profile context. Its financial tool and protected HTTP/SSE handlers share that
instance inside the existing gateway. Standalone CLI operations use the same
implementation and durable source preferences with their own disposable cache.
Ordinary dashboard consumers must use the resident endpoint, without model calls
or per-request Hermes startup.

The release installs the shared owner, contracts, execution helpers and agent
skill, plus the credential-free [Yahoo Finance connector](../../runtime/managed/plugins/yahoo-discovery/README.md)
and the [CoinGecko connector](../../runtime/managed/plugins/coingecko/README.md)
(keyless, or with the investor's own optional key). `describe` reports only
installed, enabled native contributions. The bundled
[EODHD connector](eodhd.md) adds prices, catalogue, identifier and research
reads once its API token is configured. The original core SEC/EODHD tools are
retired; other connector packages must supply those capabilities explicitly.
Enabling the owner does not install a provider or prove an account's access.
The bundled [CoinMarketCap connector](../../runtime/managed/plugins/coinmarketcap/README.md)
needs the user's API key in `secrets.json` and reports `needs_configuration`
until it is there.

Pythia is personal software: each installation serves one investor. Provider
data is used under that investor's own agreement with the provider. Each plugin
carries its provider's terms and enforces what they require. Pythia itself never
publishes, pools or redistributes provider data.

Two open-data reference connectors are bundled as well. The
[SEC connector](../../runtime/managed/plugins/sec/README.md) supplies filer
resolve, filings and reported US GAAP/IFRS facts; it needs a configured SEC
contact (name and email). The [OpenFIGI connector](../../runtime/managed/plugins/openfigi/README.md)
resolves identifiers to FIGIs, and its API key is optional. Neither offers
provider search, and both return evidence rather than identity decisions.

- [Wire contracts](../../packages/market-data/README.md): subject, series,
  observation and read result, with provenance and financial semantics.
- [Identity](../../packages/market-data/IDENTITY.md): how subject reads route
  through core's bindings ([ADR 0037](../decisions/0037-identity-backbone.md)),
  and the retired pre-backbone identity file.
- [Backend operations](../../packages/market-data/BACKEND.md): preferred and
  pinned reads, compatibility selection, cache authorization and native actions.
- [Connector support](connector-support.md): reusable execution, batching,
  cancellation, budgets, structured failures and Hermes logs.
- [Data delivery](data-delivery.md): resident HTTP/SSE and demand lifetime.

Two keyless issuer-level connectors also ship by default and use the same
connector support: [GLEIF](../../runtime/managed/plugins/gleif/README.md) resolves an
LEI or ISIN to legal-entity references and reads the legal profile, and
[filings.xbrl.org](../../runtime/managed/plugins/xbrl-filings/README.md) reads ESEF
report links and reported facts. Both are addressed by LEI and contribute no
market-data series or search.

Identity is core's. ADR 0037 replaced the provider-bound rules of ADR 0012 with
a core-owned backbone of issuer, security, composite and listing subjects, crypto
assets included. Provider symbols are bindings, joined by identifier agreement,
and this feature keeps no identity store: a subject read routes through core's
bindings ([identity](../../packages/market-data/IDENTITY.md)). The
[ADR 0012 amendments](../decisions/0012-investment-identity-and-repair.md#amendment-2026-09)
record what is superseded. Reference data is built on the device directly from
open sources ([ADR 0039](../decisions/0039-local-first-reference-data-and-rights.md)).
Investment search reads a local directory and calls no provider while the user
types. Provider data is used under the investor's own agreement with
each provider; each plugin carries and enforces its provider's terms, and Pythia
itself never publishes, pools or redistributes provider data.

Provider preferences are deterministic application logic. Only core's current
references, compatible series and eligible operations participate. Failure after
selecting a source never authorizes fallback or history stitching. A preference change does
not rewrite retained research or source pins. Unknown units, times, completion,
coverage and entitlements remain explicit.

The existing lifecycle copies explicit plugin files and bundled skills, validates
with native doctor and enables only the declared default set for a fresh profile.
Updates preserve existing native enabled choices, private plugin state and
user-owned replacements. See the common [plugin convention](plugins.md).
Activation requires
the normal refresh and gateway restart; source files are not automatically live.
There is no second registry, daemon, credential store or durable price archive.
