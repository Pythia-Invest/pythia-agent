# 0028: Standard widgets and agents share financial reads

## Context

The canonical identity store and preferred/pinned reader existed, but Markets
used separate provider recipes and display adapters. Adding a connector did
not make it usable by a standard widget. Source selection also committed to a
provider before checking its series definitions, and preferences had only one
order per operation.

The financial contracts/provider extensions in
[OpenBB](https://docs.openbb.co/odp/python/developer/extension_types/provider),
[coordinated fetching in Home Assistant](https://developers.home-assistant.io/docs/integration_fetching_data/),
and [Grafana's common frames](https://grafana.com/developers/plugin-tools/key-concepts/data-frames)
support separating retrieval from reusable presentation. Pythia adopts that
separation, not those frameworks. Common structure never proves financial
equivalence or cross-provider identity.

## Ruling

Standard price lists use canonical subjects. The existing native market-data
feature owns identity, source resolution, preferences and shared reads. Desk
and the agent call this same owner; neither uses an LLM for source selection.
Native Hermes contributions remain the only capability/discovery mechanism.
Connectors own native retrieval, implemented support and normalization. They
can retain specialist tools and data beyond the shared contracts.

Preferred reads use qualified identity bindings, current native availability,
applicable preferences and compatible series semantics. Selection checks
measurement, interval, session, adjustment, market-data class, currency, venue,
route and declared operation/window support before observation execution.
Unsupported metadata permits examining the next eligible source before choosing;
metadata errors, ambiguity and failed observation reads do not authorize fallback.
Different source methodologies, listings, units and feeds stay distinct.

Preferences keep the existing latest/history orders and add optional exact
scopes for subject kind, currency, venue, measurement, interval, session and
adjustment. More constrained matching scopes precede broader ones. For equally
constrained scopes, venue precedes subject kind, measurement, interval, session,
adjustment and currency. These exceptions precede the global order, then product
defaults, then other eligible contributors in stable name order. A scope only
matches established request facts; catalogue suffixes do not invent a venue.
Default provider order is CoinGecko, CoinMarketCap, Yahoo, EODHD, then hosted
IBKR Data; only bindings and implemented, eligible operations participate.
Broker data still needs explicit source intent or a saved applicable preference.

Pinned reads retain the complete source descriptor. Preference/identity changes
do not redirect their source or alter retained research. Native source access and
actual returned series semantics are still checked. `read_support` describes
connector execution limits; adding this optional metadata does not rename a
financial series. It does not certify an account's entitlements.

The shared result optionally carries `price_context`: source display labels,
known delay, evidenced session state and change values with an explicit previous
close or rolling-time baseline. Absence is meaningful. No current price is
appended to a different historical feed, and graph baselines are derived only
from the graph's own series. Date-only observations remain dates; rendering
coordinates do not turn them into observed midnight instants.

`read_many` coordinates up to 32 reads through the same validation/publication
path as `read`. Identical work is deduplicated. Native `read_batch` contributions
allow compatible quotes to share one provider response; otherwise the feature
uses the existing individual operations. Execution is bounded, carries the
native caller context and does not hold identity transactions during network
requests. Results preserve per-item failures and original order.

The accepted Desk consumer design uses per-read TanStack Query keys, batches pending requests, shares bounded
in-flight/server cache entries across overlapping widget lists, and checks
native reuse scope before serving cached values. Provider cadence controls
refresh; quote and history loading are separate. Preferred query keys observe
preference revisions; pinned keys do not. A read cache is disposable, not a
research archive or another capability registry.

## Delivery scope and consequences

This foundation implements the canonical backend, identity, preferences, contracts,
protected resident transport and coordinated reads. It ships no concrete shared
connector and no Markets widget/configuration changes. The native describe result
therefore reports only any separately installed native contributions; legacy
SEC/EOD tools remain independent. The HTTP and native-tool paths are qualified
with synthetic native contributions.

The accepted next consumer is a canonical prices configuration translated by one
generic display adapter. Compatible connectors must become available without
standard-widget fetching changes. Existing provider recipes, custom renderers,
source choices, saved preferences and retained research must be preserved, with
no automatic conversion from ticker/name similarity.

Pythia's retained rules prove qualified IBKR/EODHD instrument evidence and anchor
CoinGecko/CoinMarketCap within their own catalogues. These rule tests do not
install the providers or prove live availability. Unqualified Yahoo/hosted IBKR
references and cross-catalogue crypto associations remain native-only/unresolved.
Those limits must not be bypassed to demonstrate provider switching.

Standard history supports scalar samples or OHLC closes with explicit sampling,
units, adjustment, window and coverage. Not every dataset becomes a series; no
formula engine or customization UI is part of this slice. [ADR 0029](0029-financial-http-and-runtime-lifetime.md)
uses the existing resident native API server, retaining metadata/coordination.
Standalone CLI keeps a separate process lifetime. See [backend](../../packages/market-data/BACKEND.md).

## Rejected alternatives


Provider switches inside widgets, a second plugin registry, ticker-based
association, automatic fallback after failures, stitching histories and rewriting
existing user recipes would each obscure ownership or change financial meaning.
None is part of this refactor.
