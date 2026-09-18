# 0011: Shared backend market-data contracts

## Context

Investment identity and data-series identity answer different questions. A
company, security, listing or crypto asset can have multiple source datasets,
price adjustments and temporal conventions. Provider identifiers remain useful
when evidence is insufficient to associate them with a canonical investment.
Future backend consumers need these distinctions without depending on Hermes,
a connector implementation or a particular user interface.

## Ruling

`@pythia/market-data` owns portable TypeScript types and a versioned JSON Schema
for shared investment-data contracts. This package exists so backend consumers
can exchange the same explicit subjects, evidence, series and read results
without importing provider execution or the agent runtime.

Stable canonical subject references remain separate from provider-native
references and scoped mapping evidence. Series definitions identify one
source's measurement semantics; observations carry values and actual temporal
meaning. Read envelopes retain the selected series, provenance, requested and
returned bounds, coverage, freshness, completion limitations and structured
issues. Missing quantities are not zero; session dates are not invented
midnight instants. Decimal strings prevent further binary rounding at the shared boundary; they
cannot recover precision already lost when a source SDK parses JSON numbers.

A Pythia view selects one underlying source series for a read. A source view
pins it. A selected-source failure does not authorize fallback or history
stitching. Unknown evidence remains unknown, and names or tickers alone do not
prove investment equivalence. Wire validation does not establish the truth of
mapping evidence or authorize an override.

The feature plugin's small provider-free Python wire modules own structural
shapes and contextual validation. The package exports their reproducible JSON
Schema artifact and corresponding TypeScript types. JSON Schema validates
structure; Python additionally checks relationships such as field semantics,
provenance, time windows and honest requirement assessments. Shared synthetic
fixtures exercise the language boundary. See the
[contract interface](../../packages/market-data/README.md) for exact consumers,
regeneration and checks.

## Rationale

A narrow shared package keeps data concepts reusable for headless operations and
future consumers while native Hermes continues to own extension discovery and
execution. Explicit provenance and uncertainty preserve distinctions that would
be lost by symbol-shaped records or a common numeric-price field alone.

## Consequences

The native feature consumes these contracts for shared reads, preferences,
identity and repair. [ADR 0028](0028-standard-financial-reads.md) extends the initial
per-operation preferences with scoped orders, deterministic defaults and
compatibility checks before source commitment. Ambiguous series remain actionable.
A pinned request carries the full retained descriptor; the provider recomputes
its actual identity/semantics before a result is accepted. A selected-source
failure reports alternatives without calling them.

The bounded in-process cache defaults to 32 entries, 4 MiB and 15 seconds. It is
keyed by full read intent, source descriptor, preferences, identity generation
and native access context. Availability and revisions are rechecked before hits
and publication; strict freshness bypasses cache. Observations are not persisted
as a market dataset. Canonical private-store metadata participates in access invalidation, including
atomic credential replacement. Missing or unsafe metadata disables cache reuse
and publication without disabling source reads. Explicit provider access-mode
configuration also participates; credentials or failures never silently change
the chosen mode. Unknown freshness, coverage, units or completion cannot
satisfy strict requirements. Daily session dates stay dates, and unfinished bars
are omitted from completed-only reads with explicit issues.

Source examples and contributor documentation are not runtime scan inputs;
packaging explicitly copies Python wire modules. Changes to identity-bearing
series semantics require distinct series identities rather than rewriting
retained results. Synthetic equity, crypto and non-price examples demonstrate
the common contract, not live support for every represented asset or measure.
This foundation ships no concrete shared connector. The retained matching
rules are qualified with synthetic evidence, not claims of live availability.
Source-specific coverage must be established with each separately installed
integration. See [identity/repair](0012-investment-identity-and-repair.md).

## Rejected alternatives

An experiment-wide merge would import unrelated product surfaces and discarded
runtime assumptions. A generic schema service, formula engine, capability
registry or ingestion platform would add owners beyond this demonstrated need.
Provider-only wrappers would leave investment identity and result semantics
incompatible between consumers. Treating all observations as prices, matching
by ticker/name, inventing timestamps, silently replacing failed sources or
stitching feeds would conceal materially different evidence.
