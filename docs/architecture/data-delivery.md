# Coordinated financial reads and updates

[ADR 0030](../decisions/0030-coordinated-reads-and-live-updates.md) keeps financial
meaning and demand coordination in the existing Hermes API application. This
implementation includes the native backend and reusable Desk read/update/binding
transport. Markets composition and request-local hydration remain separate consumers. There is no additional service, registry
or durable scheduler.

## Ownership and limits

The platform's native api_server factory installs plugin-operation and SSE routes before
application startup. HTTP and agent tools enter the same lazy profile backend.
Standalone CLI shares code and durable state, with its own memory. Native
permissions and current access are checked before execution, reuse and publication.
Trusted dashboard usage context is bound by transport, never caller arguments.
A connector can restrict continuous dashboard use without restricting occasional
research; a warm research cache does not grant dashboard access.

| Layer | Bound |
| --- | --- |
| HTTP | Authentication, served profile, declared operation/schema, 32 body readers, 64 KiB input, five-second body deadline |
| Execution | Four ordinary read workers/64 admitted jobs; two independent history workers/32 jobs; separate control inspection |
| Delivery | 16 SSE connections, 64 resources per connection, 256 resident resources; bounded snapshots and slow-writer disconnect |
| Connector | Actual native batch size, response reuse, outbound concurrency/rate policy, retries and subscription limits |
| Provider | Account entitlement, quota, cadence, sessions and actual errors; declarations do not prove access |

Identical work shares execution. Queued jobs retain deadlines; quote and history
lanes prevent either class from starving the other. Native-ID batches collect for
10 ms, deduplicate overlapping IDs and reuse qualified per-ID results. Currency,
feed, options, credentials and worker revision qualify reuse. One caller leaving
cancels only its demand; the last caller cancels upstream work. Owned children
retain output limits, termination and reaping. Trusted Python threads cannot be
forcibly killed, so uncooperative extensions may retain a bounded slot.

LiveReads shares resources between subscribers. Polling runs only while demanded;
a two-second release grace avoids repeated setup during brief transitions. Grace
expiry cancels active work independently of its polling loop. Retiring tasks stay
tracked through gateway shutdown. Connector push can publish to this same owner;
SSE is downstream transport, not a requirement on providers.
Push notifications wake delivery immediately; the one-second access recheck
remains a fallback while no events arrive. Idle HTTP streams check the native
request transport every 250 ms because Hermes does not cancel disconnected
handlers. A lost transport enters the same release grace without waiting for
the ten-second heartbeat; other subscribers retain their demand, and a reconnect
within the grace reuses the resource. This uses the native transport surface
without changing Hermes or its server-wide cancellation policy.

Actual outbound operations, including SDK setup/fan-out, request connector budget
permits. A local short burst waits in a bounded FIFO; saturation is busy. Quota
exhaustion and provider throttles preserve distinct origins and retry delays.
The demand owner retries after deferral. Shared budgets apply within this gateway,
not across independent CLI processes or other users of the subscription. Estimated
credits are not a billing ledger. See [connector support](connector-support.md).

## Protocol

POST /v1/pythia/updates (also under /p/{profile}) accepts
`{resources: [{plugin, operation, arguments, window?}]}`. Operations are the deliberately
exposed native operations from protected reads; this is not arbitrary-tool dispatch.
Shared financial resources use `plugin: "pythia-market-data"` and
`operation: "query"`. The transport is independent of financial enablement;
financial batching, relative windows and series qualifications remain feature-owned.
Financial subscriptions permit read/read_many/get_preferences, never mutations.
Only the factory's profile is served; effective-home mismatch fails closed.

Each SSE event identifies request index, schema version, resource generation and
increasing delivery revision. A snapshot replaces data, status qualifies retained
data, and reset clears it. States are ready/loading/stale/unavailable. Reconnection
reconciles current authorized state; no durable replay or exactly-once guarantee
is made. Slow consumers receive latest state rather than a lossless tick log.
Heartbeats describe transport, not observation freshness.

Relative history windows are rolling or sessions with a day count, limited to a
single history read. The resident owner materializes bounds on refresh, avoiding
page-load-frozen windows. Dates and instants retain their distinct meaning.

Connectors opt qualified series into push using read_support.updates = push and
pythia_updates in the native read schema's $comment. The handler receives trusted
_subscription context and emits normalized ReadResults. The domain revalidates
identity, binding, access and contracts before publication. Browser arguments cannot
supply that context. Specialist results retain their declared schemas and polling
through the same protected delivery.

Transient failures may retain an authorized result only with stale qualification;
revocation, incompatible selection and invalid configuration clear it. Retained
results stay whole and bound to their original source/query. No history stitching
or quote substitution hides missing data. Preferred preference/identity changes
reset resource generations; pins and retained research preserve intent.

## Desk transport

Desk proxies explicit read-only native operations through admitted `/api/data/read`
and `/api/data/updates` routes. The server holds the profile and bearer; redirects
are rejected. The browser owns one multiplexed channel per Desk client, reference
counts identical resources and suspends hidden-page demand. TanStack owns query
state. Active peers share their authorized publication; dormant cached values
wait for fresh native validation; disabled queries expose no retained result.
Equivalent JSON objects share demand independently of member order. Successful
explicit retries publish raw native results through this same owner, keeping
feature decoding local to each query. Native generation/revision cursors survive active-channel rebuilds, so
known older replay cannot undo a manual publication. Same-revision resets still
clear data and its cursor, allowing a subsequently authorized publication of the
same revision to restore access. Unseen native revisions/new generations remain
authoritative. Native reset cancels pending reads independently of presentation
status; a delayed read cannot restore withdrawn data.
A recovered connection restores the prior qualification, including provider stale
status, rather than equating transport health with fresh observations.
Reset clears data and transient failure carries
a stale qualifier. Invalid subscriptions wait for explicit retry or changed intent.

`BoundWidget` executes a module-owned primary/deferred binding through that generic
coordinator. Binding code owns decoding, query keys and result meaning, including
specialist schemas. The public financial widget library provides the canonical
binding. Desk's financial read/preference adapters only validate that library's
contract, batch duplicate requests and revalidate bounded cache entries against
the native reuse scope. Cache capacity is 128 entries / 8 MB, with 2 MB per entry;
inflight keys are capped at 128 and native batches at 32 reads / 16,000 requested
observations. Cancellation detaches one consumer and aborts only an unneeded batch.

## Evidence and next consumers

Synthetic Python regressions exercise sharing, bounded execution, batching,
cancellation, release during active polling, reset/revocation and failure meaning.
The provider-free loopback check runs with
`<prepared-hermes-source>/.venv/bin/python tooling/qualification/update_streams.py`.
It verifies prompt idle-disconnect cleanup, shared demand and reconnect grace on
native aiohttp with handler cancellation disabled.
The copied pinned-Hermes qualification checks native route registration, one shared
HTTP/tool backend, zero model/CLI subprocesses, auth/profile/disablement, deadlines
and responsive native health. Run
`node tooling/qualification/financial_http.mjs <prepared-hermes-source>`.

The synthetic production Desk qualification runs with
`pnpm --filter @pythia/desk test:qualification:data`. It builds the real copied app
with the pinned webpack toolchain, compiles canonical financial and nonfinancial
widget modules afterwards, and exercises admitted native read/update/asset routes.
It covers resource sharing, state-preserving updates, cancellation, dormant cache
revalidation and withdrawal without real providers, profiles or installed services.

Markets page composition and request-local hydration remain future consumers.
This delivery makes no paid-stream or production-service qualification claim.
Each concrete connector must qualify its native batch and push behavior separately.

## Follow-up during widget adoption

Use the next real news or filings widget to evaluate binding ergonomics. Extract
small helpers only where resource declarations, query keys or decoding show
repeated boilerplate; do not add a speculative binding framework.

Keep TanStack's query-state responsibility separate from the shared coordinator's
resource subscriptions and publications. New widgets should use this delivery
path rather than introduce another cache or their own refresh loops. Preserve
generation/revision tracking, reset semantics and cancellation protections when
simplifying: they prevent reconnect replay and late reads from restoring obsolete
or withdrawn data.
