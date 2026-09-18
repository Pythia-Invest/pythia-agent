# ADR 0031: Shared connector execution and visible failures

Status: Accepted, 2026-09-17

## Context

A small concurrent dashboard workload exceeded Pythia's outbound concurrency
limit. Admission rejected work immediately and represented the rejection as a
provider HTTP 429. Per-symbol chart handlers then reduced errors to empty charts;
the batch appeared successful and could be cached. A refresh replaced a valid
futures chart with an OHLC fallback. Separately, disposable Yahoo SDK workers
repeated cookie/consent setup for ordinary reads.

## Decision

The shared primitives are implemented in this increment; concrete connectors and
Desk error presentations adopt them separately. Provider-specific examples below
explain the demonstrated motivation, not installed availability in this payload.

Keep execution in the existing market-data owner and native Hermes lifecycle.
Its `connector` module is the reusable library for response sharing, native
batching, connection budgets, owned workers and safe failure details. It is not
a registry or another service. Native enablement, current credentials and domain
contracts remain authoritative at every public entry point.

Short outbound concurrency bursts wait in a bounded FIFO: at most 64 waiters per
connection, with a ten-second admission deadline. Queue saturation/expiry is
`busy`. Configured quota exhaustion is `rate_limit` with connector origin; an
actual provider throttle has provider origin. Quota/cooldown deferrals return
their retry delay instead of occupying the queue until the quota resets.
Cancellation and owned-child teardown release queued and granted permits.

SDKs with expensive connection setup can opt into a reusable resident RPC child.
The Yahoo integration can use this option to preserve its public SDK session in memory. Requests,
output, cancellation, deadlines and idle lifetime are bounded; unload and gateway
shutdown reap the child. Other connectors retain appropriate existing transports.
No cookies or provider credentials are moved into browser or persisted by this
helper. A parent deadline that a child misses retires that child and explicitly
fails affected pending calls.

Errors are structured outcomes, including per-item failures in specialist
batches. Successful siblings remain available, but the batch is qualified as
partial and failed responses are not admitted to the successful-response cache.
Standard financial results retain their existing typed issues. Desk visibly
reports failed prices, charts and metrics. The last chart may remain during a
transient failure, explicitly stale and within the same authorized query/source;
access denial or a source reset clears it. No series substitution or stitching.

Use Python standard logging through the pinned Hermes rotating, redacting,
queued handlers and native log viewer. Connector events carry safe operation,
provider, timing, permit, status and diagnostic-reference fields. Do not log
arguments, URLs, credentials, provider bodies or arbitrary exception messages.
Plugin authors use the helper rather than installing logging handlers.

## Consequences and alternatives

This removes artificial admission failures under ordinary concurrency and permits
avoiding repeated SDK bootstrap requests. It does not guarantee availability of Yahoo's public
feed or turn local budgets into an account-wide billing ledger. A resident SDK
adds owned in-memory state; Yahoo's RPC host serializes domain requests while its
SDK queues actual HTTP calls, so a read can wait behind another bounded read.

Raising concurrency alone would hide the admission flaw and could increase real
provider throttling. Unlimited waiting, automatic source fallback, caching failed
charts as successes and hiding errors behind stale data were rejected. A new log
store, service or universal connection framework is unnecessary.

See [connector support](../architecture/connector-support.md) for the library,
log commands and qualification evidence, and [data delivery](../architecture/data-delivery.md)
for the unchanged transport and access boundaries.
