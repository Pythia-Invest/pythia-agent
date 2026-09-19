# 0030: Coordinated reads and live updates

## Context

Independent dashboard refreshes exhausted the resident HTTP admission limit even
when the provider could accept the work. Per-worker queues did not govern combined
provider traffic. SSR, browser polling and provider streaming need one execution
owner rather than independent refresh systems.

## Decision

The backend, protected update channel and generic Desk query/binding transport
are implemented. Markets composition, request-local hydration and concrete streaming
connectors remain separate consumers; their requirements below are accepted
architecture, not claims of delivered page or provider coverage.

The existing native Hermes application owns a profile-scoped data coordinator.
Desk declares visible demand, hydrates initial snapshots and receives multiplexed
SSE updates. The same domain implementations serve agent tools. Native plugin
discovery, credentials, enablement and lifecycle remain authoritative.

Request admission, bounded local execution and provider budgets are different
controls. Compatible reads share work and connector-native batches; actual
outbound calls, including SDK fan-out, obey connector policy. HTTP saturation
is not reported as a provider outage. A consumer leaving does not cancel work
still needed by another consumer. Queues, deadlines, streams and buffers are
bounded independently.

Polling and provider push feed the same subscription channel. An open connection
does not establish financial freshness: observation times, source delay, session,
missing data and update health remain distinct. Subscriptions end with demand;
there is no new durable scheduler, service, event archive or capability registry.
The first planned upstream streaming integration is an explicitly selected EODHD series.
Socket access never silently substitutes for a different REST dataset.

SSR seeds the same TanStack cache used by the browser. Visible quotes may arrive
before charts and slow sources. Validated browser tab preferences can inform
server prefetch; hidden tabs are not prefetched speculatively. Private data is
never placed in a shared Next page cache.

Updates represent latest dashboard state, not lossless trading ticks. Reconnects
reset/reconcile snapshots. Partial bars and corrections use their own keys and
semantics. Preferred-source changes reset the resource generation; pins and
retained research keep their meaning. Specialist results retain their own schemas.

During transient delivery/provider failures, the last authorized value may remain
visible with explicit stale/disconnected qualification. It must not look live.
Revocation, invalid configuration and incompatible source changes clear affected
data. Existing user configurations and native references are preserved.

## Consequences

This supersedes the initial streaming deferral and the immediate
four-request saturation behavior in ADR 0029. Its financial and authentication
boundaries remain in force. Provider budgets shared by a gateway do not claim
account-wide enforcement across independent applications or CLI processes.
Paid/metered streaming requires an explicit connection choice; merely finding a
key does not authorize enabling it.

Rejected: per-widget provider connections, blanket larger concurrency, retries
at every layer, a new event broker, conflating SSE health with fresh data, and
silently merging feeds or inventing bars to hide gaps.
