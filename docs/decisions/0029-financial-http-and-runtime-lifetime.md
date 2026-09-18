# 0029: Financial HTTP uses the resident native gateway

## Context

The runtime/authentication boundary remains accepted. [ADR 0030](0030-coordinated-reads-and-live-updates.md)
supersedes this ADR's initial four-request rejection policy, HTTP-local specialist
cache and withholding of transiently stale display values. It adds bounded
execution queues, connector response sharing and shared polling/push delivery.
The limits below describe the original resident-HTTP qualification.

Desk's financial and specialist requests used short-lived Hermes commands.
They shared backend code with agent tools but lost metadata caches between
invocations. Saving metadata to disk would have retained repeated runtime startup.

The authoritative commit is `29112bef099274229cadff79cdff7bf7b99c4b77` in
`runtime/versions.json`. Its native
[`register_platform_handler`](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/hermes_cli/plugins.py)
accepts a factory. The
[`api_server` adapter](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/gateway/platforms/api_server.py)
passes its existing aiohttp application before router freeze;
[`base.py`](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/gateway/platforms/base.py)
provides the invocation. Adding a route does not authenticate it.

## Ruling

Ordinary market reads, preference checks and cache validation use the existing
long-running Hermes API server. They start no conversation, model call or Hermes
CLI process. CLI remains for standalone operations and diagnostics, with separate
in-memory instances and the same durable state.

The registered native financial tool holds the lazy profile-bound backend. HTTP
dispatches that handler under trusted `api_server` context. Agent and HTTP reads
therefore share metadata/observation caches, identity/preferences and in-flight
coordination. Provider discovery and enablement remain Hermes-owned.

Pythia owns one protected transport adapter, shipped with the existing market-data
owner for this slice. It handles authentication, profile admission, validation,
limits, bounded execution, fixed transport errors and application cleanup.
Connectors declare intentionally exposed operations on their native tool schemas.
They do not install competing financial routes or implement HTTP authentication.

- `POST /v1/pythia/financial` invokes supported shared financial actions.
- `POST /v1/pythia/plugins/{operation}` invokes an explicitly named specialist
  operation marked by `pythia_http_operation` in its native schema's `$comment`.

Bodies contain `arguments` and optional `reuse_scope`. They cannot select a
profile, executable, native tool name, caller platform or credential. Mirrors at
`/p/{profile}` use native profile middleware. This slice serves the factory's
own profile; a different effective Hermes home fails closed. It does not promise
multi-profile routing through one listener. Pythia's existing lifecycle runs the
selected profile, and separate installations/profiles retain separate state.

Authentication delegates to the API adapter's `_expected_api_key` and `_check_auth`
with a fail-closed missing-key guard. The pinned adapter is treated read-only.
Desk must reuse its existing authenticated loopback client with redirects disabled.
The bearer never reaches browser code. Native plugin and platform toolset
availability are checked before dispatch and publication. Actual native tool
registration ownership prevents disabled plugins' retained handlers from remaining eligible
before lifecycle restart.

Transport shape validation uses JSON Schema from the locked native environment.
The financial owner and connectors retain domain semantic validation. Specialist
results retain their provider-specific meaning; they are not forced into common
contracts. API keys stay in existing credential custody and OAuth/session
protocols stay in existing connection adapters. No new credential store or
universal OAuth framework is introduced.

The application admits at most four concurrent financial HTTP requests without
an unbounded queue. Bodies are capped at 64 KiB with a five-second read deadline;
execution has a 30-second deadline and output is capped at 16 MB. Provider work,
native eligibility and serialization run on a dedicated bounded executor, leaving
the HTTP event loop and chat executor available. Inner financial coordination
remains bounded. Saturation returns 429 with a retry hint. Disconnect, deadline
and cleanup signal cancellation. Admission remains occupied until the worker
actually exits. Existing provider subprocesses retain termination/reaping logic.
Python threads cannot be forcibly killed: an uncooperative trusted extension can
occupy a bounded slot until it returns.

Caches remain process-local and disposable. Native access/configuration and
canonical custody changes invalidate reuse; preference and identity revisions
also qualify preferred reads. Pins keep their selected series. Failures never
authorize fallback, stitching or stale-result resurrection. Cache-disabled
connections, including hosted IBKR Data, remain uncached.

## Consequences and evidence

Preparation copies the helpers through the existing managed-file owner. Normal
lifecycle restart activates handlers; no endpoint starts a separate listener.
The proposed cross-process metadata cache is unnecessary for this slice.

`node tooling/qualification/financial_http.mjs <prepared-hermes-source>` copies
the actual feature allowlist into disposable state and starts the pinned API
adapter. It checks shared HTTP/tool backend lifetime, in-memory metadata/price
reuse, preferences and pins, missing/wrong authentication, profile rejection,
native disablement, undeclared operations, malformed/oversized input, bounded
concurrency, timeout, disconnect and native agent cancellation, and responsive
native health.
Subprocess creation is prohibited during these synthetic requests. This does not
exercise model generation or prove provider latency/entitlements. Current scope
and evidence are recorded in the [backend contract](../../packages/market-data/BACKEND.md).
This foundation does not ship the Desk client or concrete shared connectors.
Identity evidence limits from ADR 0012 remain unchanged.

## Rejected alternatives

Per-refresh CLI startup, a separate daemon, another capability registry,
connector-specific bearer checks, arbitrary tool invocation over HTTP and a new
OAuth framework duplicate platform ownership or obscure authority. Persisting
metadata solely to compensate for short-lived execution was rejected in favor of
the already-supported native handler lifecycle.
