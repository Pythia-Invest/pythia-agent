---
description: "Extend financial capabilities through native plugins, shared contracts and coordinated execution."
paths:
  - "runtime/managed/plugins/**/*"
  - "runtime/managed/runner/{eodhd*,yahoo*,provider-*}.ts"
  - "runtime/managed/runner/{coingecko,ibkr}/**/*"
  - "runtime/contracts/financial-data.md"
  - "packages/market-data/**/*"
  - "docs/architecture/{market-data,connector-support,data-delivery,credential-custody}.md"
globs:
  - "runtime/managed/plugins/**/*"
  - "runtime/managed/runner/{eodhd*,yahoo*,provider-*}.ts"
  - "runtime/managed/runner/{coingecko,ibkr}/**/*"
  - "runtime/contracts/financial-data.md"
  - "packages/market-data/**/*"
  - "docs/architecture/{market-data,connector-support,data-delivery,credential-custody}.md"
---

# Financial connectors

Use the existing [market-data owner](../../docs/architecture/market-data.md),
[wire contract](../../packages/market-data/README.md) and
[native extension boundary](../../runtime/contracts/hermes.md#qualified-market-data-extension-seams).
Verify the pinned Hermes surface and provider documentation for the capability
being added; examples from another connector do not establish identical semantics.
These financial requirements do not add a market-data dependency to unrelated
native plugins.
Package the feature through the common [plugin convention](./plugin-authoring.md),
including bundled native skills and explicitly owned operation exports.

## Ownership and capability

Pythia owns canonical identity, matching and source selection. Connectors return
native references and qualified evidence; tickers, names and catalogue membership
do not prove cross-provider equivalence. Keep issuer, instrument, listing and
source-series identity distinct. Follow the [identity owner](../../packages/market-data/IDENTITY.md)
for evidence-backed repair; unresolved associations stay unresolved.

Register through Hermes and declare implemented common operations on the native
tool schemas. Discovery/enablement remain native, not a second inventory. Declare
coverage, supported series and access requirements honestly; local readiness and
capability declarations do not prove account entitlements. Do not probe every
provider during startup or each refresh to infer them.

Normalize common reads with provenance, units/scale, observation time, known delay, session,
change baseline, adjustments and sampling intact. Unknowns stay unknown; preserve
useful native detail through the supported source-detail or specialist surface.
Preferred reads follow compatible preferences; retained pins preserve their
series. A failed selected source never authorizes fallback or history stitching.
See [selection and actions](../../packages/market-data/BACKEND.md).

## Execution and access

HTTP and agent tools in the same gateway share its resident profile backend.
Standalone CLI workflows share implementation and durable state, not its in-memory
instance. Expose specialist HTTP operations deliberately through the native schema
annotation and [protected adapter](../../docs/decisions/0029-financial-http-and-runtime-lifetime.md).
Do not add connector routes, bearer checks, arbitrary-tool dispatch or per-refresh
Hermes launches. Preserve native access checks before cache reuse and publication.
Provider authentication uses [existing custody](../../docs/architecture/credential-custody.md);
unusual signing/session logic belongs in the connection adapter. Credentials stay
server-side, with no new store or ambient-secret fallback.

Use the shared [connector primitives](../../docs/architecture/connector-support.md)
for budgets, worker lifetime, caching, batches, cancellation, failures and Hermes
logs. The connector owns native endpoint limits and cadence. Count actual outbound
work, including SDK setup/fan-out; batching does not necessarily reduce billed
credits. Coalesced batches must fit the worker's admitted size and actual response
layout, retain successful siblings and preserve per-item retry/error provenance.

Share only compatible requests within the current connection/access scope. Pass
cancellation through nested reads; one departing consumer releases its demand,
and the last consumer stops unnecessary work. Bound workers and clean them up
through native lifecycle hooks. Distinguish local saturation, provider throttling,
missing data, unsupported requests, denied access and transient failures. Do not
cache failed work as success or log credentials/provider payloads.

Polling and supported push use the same [demand owner](../../docs/architecture/data-delivery.md).
Declare push only for a qualified series, preserve its financial meaning and
release upstream demand when unused. SSE transport health is not price freshness.

Native local plugins remain user-owned. Adding a managed connector to a release
also needs the existing explicit file/dependency allowlists and lifecycle copy
owner; those packaging lists are not a requirement for local plugin discovery.
Document supported scope and qualification limits. These are builder guidelines;
schemas, custody, admission and execution code enforce mechanical boundaries.
