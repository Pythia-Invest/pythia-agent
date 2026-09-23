# 0035: Shared investment search and retained catalogue identity

## Context

Provider-specific search required an investor or agent to choose a connector
before finding an investment. The identity store already retained stable Pythia
subjects and qualified mappings, but did not provide searchable display metadata.
A single search needs to combine those records with connected-provider discovery
without interpreting similar names, tickers or provider catalogue membership as
proof of equivalence.

## Ruling

The market-data feature owns one investment-first search operation, shared by
Desk and the native agent tool. It searches retained catalogue metadata and
eligible native connector search capabilities. Native discovery and permissions
remain authoritative; search adds no plugin registry, service or credential store.
Provider failures and bounded coverage remain inspectable alongside successful
results. Search relevance is separate from identity confidence.

Search combines query relevance with native result order, rather than giving
every connector an equal top slot regardless of match quality. Numeric provider
scores are not comparable; a connector declares whether its ordering expresses
relevance or prominence. There are no provider-name or popular-ticker exceptions.
Product category is shared presentation metadata distinct from identity scope.
Connectors translate native types, and ordinary users can narrow results to
stocks, funds, indices or other returned categories without choosing a provider.
This does not infer relationships between an underlying stock and tokenized
exposure, or conceal unresolved duplicate source references.

Connectors declare implemented text, symbol and identifier search modes. Pythia
dispatches one appropriate request per source and reports unsupported input
without treating it as a source failure. Legacy undeclared search remains usable
with conservative unspecified ordering. Native schemas remain authoritative.
Responses can qualify their ordering as relevance or prominence; absent ordering
uses local name/symbol matching. Pythia interleaves source ranks, favoring text or
identifier search over symbol-only lookup within each round, then text relevance
and relevance-qualified provider ordering. It does not globally prioritize exact
ticker matches. Names and
symbols have equal standing, and repeated provider appearances never add votes.
This small policy prevents one large catalogue from hiding other sources while
preserving useful provider ordering. It needs no per-candidate enrichment reads.
Provider ranking signals do not become identity evidence or company/product
relationships. Perfect global relevance is not promised, and real name/ticker
queries must qualify connector adoption alongside synthetic boundary tests.

Ordinary search executes connector searches in parallel and returns one result
per provider reference. Labels include the source, known venue and currency.
Even previously reconciled references remain separate in this discovery view.
Search does not request identifier mappings, OpenFIGI qualification, or
cross-reference comparisons. This replaces the earlier instrument-grouped
experiment: cold reconciliation added several sequential network round trips
to an otherwise lightweight search.

Typing does not ingest evidence or adopt an investment. Selection fetches the
chosen connector's details and retains its exact source intent, without external
identity enrichment. Single-reference `adopt_search` defaults to
`binding_mode: source`; this is source binding, not a full pinned series.
Explicit resolve/refresh and grouped adoption remain deliberate reconciliation
operations outside ordinary search. They require qualified evidence and cannot
rewrite retained listing intent.

Searchable display
metadata lives with the profile's existing identity database and is not matching
evidence. Repeated adoption preserves the existing identity and revision history.
Explicitly retained identity labels remain discoverable when a connector is
disabled, with that reference marked unavailable. This is retained investor-owned
catalogue state, not permission to publish cached provider responses or execute
disabled operations.

Selection returns both a stable subject and the selected native data binding.
Canonical preferred reads remain available to deliberate workflows with
qualified mappings; search selection never changes source preferences.
The existing rules against silent fallback, history stitching and rewriting
original research intent remain unchanged.

## Rationale

An investment-first interface and connector transparency are compatible. Investors
choose the investment; Pythia handles evidence-backed associations and eligible
data sources. The same standard widgets can consume preferred or source-bound
financial data, so incomplete reconciliation does not require a separate renderer
for every provider.

The catalogue grows through deliberate use rather than requiring a paid global
reference catalogue or downloading every connected provider's universe at startup.
Names and identifiers can aid discovery without becoming automatic merge rules.

## Consequences and limits

Connector integrations must qualify their own evidence and implemented search
coverage. A source lacking usable evidence can still supply an explicit candidate;
this does not establish cross-provider identity. The shared search does not make
the current narrow matching rules universal. Future reference-data connectors can
enrich evidence through the same native mechanism.
Instrument-level equivalence does not establish listing-level equivalence between
EODHD and Yahoo. Optional reference-data qualification now joins proven ordinary
shares using OpenFIGI share-class identifiers, with returned security type and
market sector checked. Composite FIGIs, listing FIGIs and bare provider ISINs
are not substituted for that proof. The former EODHD Common Stock/ISIN merge
rule is retired because an identifier can describe a receipt's underlying asset.
Existing associations are re-evaluated through versioned repair, preserving
original intent and revision history.

Reference enrichment is available only through explicit qualification workflows,
using native operations and access-aware caching. Missing evidence leaves
associations unresolved. No reference-data provider is needed for ordinary
search or source-bound selection. The shared financial contracts and widgets
continue to support source-bound and canonical reads.

Parallel external searches publish source progress as it arrives. Result rows
wait for the bounded aggregate response so network timing does not change their
ranking. Removing reconciliation reduces work but does not guarantee subsecond
latency from every remote provider.

This increment does not implement a complete issuer/instrument/listing relationship
graph, merge existing subjects destructively, or add a financial detail page.
Those remain separate feature work. Main's concrete connector releases remain
separate PRs; synthetic native and browser qualification must not be reported as
proof of real provider coverage or account entitlement.

## Feature frontend and topbar composition

Market-data owns the search component, controller, schemas, connector icon assets,
and supplied topbar module. `@pythia/market-data/search-ui` is a public build-time
entrypoint for `InvestmentSearch`, its props and query/controller hooks. Custom
compositions can reuse that frontend or create their own search interface without
importing Desk internals. Feature modules use the public widget SDK's shared
React, UI and TanStack Query runtime, avoiding duplicate query contexts and caches.

The supplied `top-bar` presentation implements `pythia.desk-topbar.v1` and composes
the host page title, investment/chat search and existing action elements. The whole
topbar can be replaced through the generic Desk topbar selection; market-data has
no special renderer branch in the host. Host-provided callbacks open a chat or
prepare an editable research draft. Preparing research never sends a prompt.
Protected generic read, update and explicit invoke transport preserves native
operation checks; search does not introduce financial routes in Desk.

The source entry imports the public feature package as an ordinary dependency.
Selected-source builds compile it into the feature's explicitly declared module
asset; managed installation copies editable entry source and that artifact.
The feature accepts `settings: {"excludedProviders": ["provider-id"]}` as initial
search exclusions. Omission starts with every source included; the pills can
change participation for the mounted search. Unknown settings keys, invalid
provider IDs or more than sixteen exclusions are rejected visibly through the
host module error boundary.
Runtime discovery never installs dependencies or compiles code. This keeps the
same replacement and native permission boundaries as other feature presentations.

## Qualification

Search exposes optional `providers` selection through the shared operation.
Omission searches all declared sources; an empty list searches none, including
retained references. The feature frontend reads `describe.search_sources`, the union of declared search
providers and retained catalogue providers, and uses compact multi-select connector
pills above type filters. Default participation omits `providers`, including when
no live connector is available. Explicit exclusions produce an inclusive selection
from that complete inventory; disabling a connector never implicitly excludes its
retained labels.
Selection participates in the browser and backend cache keys. Provider statuses
arrive independently through the existing protected update channel, with
source completion times. Cumulative progress tolerates transport coalescing;
no candidates publish until the combined ranking and access recheck finish.
The search subscription is bounded and cancelled when its demand ends.
Push delivery wakes on incoming data rather than waiting for the periodic
access check. Ordinary agent/CLI search remains a single final response.
These toggles affect search participation, not plugin enablement or preferences.

Desk presents search as a dropdown anchored to its header input. Compact rows
show the ticker, name, instrument category, venue/currency and an accessible
connector badge. Category pills filter the returned set locally, in a stable
order, including before typing; they do not imply exhaustive category coverage
or change source identity. A chosen category persists as the query changes;
clicking a category preserves input focus. The idle panel uses the shared
empty-state component, with filters remaining available during loading.
Provider failures remain inspectable through search coverage. The ordinary
dropdown omits raw identity metadata and shows chat matches only when present.
Connector website icons are embedded in the feature module beside the ticker,
without badge chrome or Desk-public asset dependencies. The generic incomplete-source banner is omitted; diagnostic coverage
and actual request failures remain accessible. A nonempty search keeps a
viewport-bounded panel height across loading, results and empty states. Clicking
the editable anchor does not dismiss and reopen the search or restart its read.
Search display snapshots have a one-minute browser-memory freshness window,
with five-minute inactive retention. Closing and reopening within that window
reuses the snapshot without another request; stale reads show placeholders while
the backend revalidates access. Desk native settings mutations clear snapshots.
External configuration changes may take up to this freshness window to appear
on reopening; there is no push-based revocation of already displayed metadata.
Selection and data operations always enforce current backend permissions.
This bounded display cache does not authorize execution of disabled operations
or persist provider responses in browser storage.

Regression tests require that search and ordinary selection never invoke external
qualification, and that references stay separate even with common identity
evidence. Explicit reconciliation retains its independent evidence/access tests.
The earlier live grouping experiment established narrow Yahoo/EODHD qualification,
but is no longer the default search behavior. Native source capabilities and
optional reconciliation coverage remain connector-specific.

## Rejected alternatives

- Making users choose a provider before ordinary investment search.
- Keeping financial search in Desk or exposing private Desk imports to custom topbars.
- Replacing only a search slot while leaving the surrounding topbar composition fixed.
- Grouping results by ticker/name similarity or a shared issuer alone.
- Treating every stable provider reference as proven cross-provider identity.
- Creating identities on every search keystroke.
- Making a paid external reference catalogue mandatory for the platform.
- Duplicating standard widgets to compensate for unresolved provider associations.
