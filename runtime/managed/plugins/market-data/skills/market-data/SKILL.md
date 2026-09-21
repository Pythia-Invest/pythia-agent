---
name: market-data
title: Investment identity and market data
description: Search investments across connected sources, retain stable identities, choose a price series, or read bounded latest and historical market data.
version: 0.4.0
license: Apache-2.0
platforms: [linux, macos]
metadata:
  hermes:
    tags: [Investing, Market Data, Identity]
    category: finance
    requires_toolsets: [pythia-market-data]
---

# Investment identity and market data

Use `pythia_market_data` for investment discovery, identity evidence, series
selection and bounded price reads. Market data informs research; it does not
determine an investment strategy.

`{"action":"describe"}` reports native sources, contributed operation schemas and local
availability without contacting a provider. Missing configuration or disabled
sources cannot be fixed by changing request arguments. Inspect the returned
operation schemas for supported shared operations and their native argument
variants. Shared `call` accepts only those contributed operations. Separate
native provider tools have their own tool schemas and are invoked directly;
they are not an expanded `call` namespace. Local readiness does not establish login, subscriptions or fresh prices.
Configured access mode is explicit user intent, not something to change after
a denied request or infer from which credential happens to exist.

Search with `action: "search_catalogue"` and `query`. Results lead with investment
identity; `references` and `coverage` expose source details, availability and
incomplete searches. Names rank candidates but do not prove equivalence. Distinct
listings and unresolved associations remain separate. To retain a selected result,
use `adopt_search` with its exact available `native_ref` and known `scope`. It
returns a stable `subject` and a usable `binding`: unresolved identities retain
an explicit source binding, not automatic provider substitution. Unknown scope
needs connector metadata; do not guess it from a ticker. Search never saves
identities or calls details for every candidate.

Explicit source search remains available as `action: "search"`, `provider` and
`query`. Use the selected
`provider_ref` as `native_ref` for `details` only when that source contributes it;
otherwise use the reference directly for series and reads. Search/details do not
save identities. Preserve native IDs and qualifiers; a symbol/name is a discovery
clue, instrument identifiers do not establish listing identity, and trading
routes do not establish primary venues. Crypto coin IDs, platform contracts and
wrapped assets likewise remain distinct unless supported scoped evidence proves
an association. `resolve_save` explicitly saves the chosen
reference at the requested scope. Unknown evidence stays unresolved; a native
read can still be useful without a canonical match.

`series` takes `binding` and optional common `criteria`. Narrow measurement,
interval, session, adjustment, currency, venue or market-data mode until one
series fits. `read` takes a complete `request` with operation `latest` or
`history`, view, window, limit and requirements. A Pythia view follows current
per-operation preferences. Implicit canonical reads and series discovery exclude
broker-dependent sources unless saved preferences include them; explicit native
references or source pins retain access. A source view needs the full retained `series`
descriptor and its matching ID; retain both with research that needs repeatable
source intent. Do not construct a descriptor or opaque source selector by guess.
A selected-source failure reports alternatives; choosing another is a separate
explicit read, never an automatic fallback or stitched history.

Preserve observation date/time separately from retrieval, numeric precision,
unit scale, adjustment, actual market-data mode, coverage and issues. Daily
session dates are not midnight instants. Unknown freshness or completion cannot
satisfy strict requirements. Completed-only requests omit unproven bars with
limitations. Partial results can
remain useful, but must retain their gaps and `requirements_satisfied` status.

`get_preferences` inspects source order; `set_preferences` changes local
latest/history preferences. `inspect_identity`, `inspect_subject` and
`inspect_repair` expose evidence and supported repairs. `refresh_identity`
reads updated details for retained native intent. Positive/negative overrides
use `apply_override` with existing evidence IDs; `revoke_override` withdraws one.
These local changes cannot fabricate source assertions, hide contradictions or
force a match. Relevant fixes re-evaluate affected state; required source refresh
may remain pending offline. Inspection can apply supported local repairs.
Retained research is not rewritten when mappings or preferences change.
