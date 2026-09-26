---
name: market-data
title: Market data
description: Choose a price series or read bounded latest and historical market data for a Pythia subject or an explicit source reference.
version: 0.4.0
license: Apache-2.0
platforms: [linux, macos]
metadata:
  hermes:
    tags: [Investing, Market Data]
    category: finance
    requires_toolsets: [pythia-market-data]
---

# Market data

Use `pythia_market_data` for series selection and bounded price reads. Market
data informs research; it does not determine an investment strategy.

`{"action":"describe"}` reports native sources, contributed operation schemas and local
availability without contacting a provider. Missing configuration or disabled
sources cannot be fixed by changing request arguments. Inspect the returned
operation schemas for supported shared operations and their native argument
variants. Shared `call` accepts only those contributed operations. Separate
native provider tools have their own tool schemas and are invoked directly;
they are not an expanded `call` namespace. Local readiness does not establish login, subscriptions or fresh prices.
Configured access mode is explicit user intent, not something to change after
a denied request or infer from which credential happens to exist.

Investments are Pythia subjects. Find one with `pythia_identity_search` and
pass it as `{"kind": <level>, "id": <subject id>}`, the level being the id's
prefix (`listing`, `security`, `issuer` or `composite`). A subject's reads use
the sources core binds or derives for it. When none serves it yet, the read
reports `unresolved_identity`: `pythia_identity_subject` shows each source's
state and `pythia_identity_resolve` asks one that needs a lookup. A symbol or
name alone never identifies a subject. Associations belong to core; this tool
cannot save, override or repair them.

An explicit `provider_ref` (provider, native scope and native id, with any
qualifiers) reads exactly that source. Use it as `native_ref` for `details` when
that source contributes it, or directly as the binding for series and reads.
Preserve native IDs and qualifiers; trading routes do not establish primary
venues, and crypto coin IDs, platform contracts and wrapped assets stay distinct.

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
latest/history preferences, optionally scoped by asset class or series facets.
Without a saved preference a subject follows core's source order. Retained
research is not rewritten when bindings or preferences change.
