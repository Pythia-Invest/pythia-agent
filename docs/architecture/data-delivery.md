# Coordinated financial reads and updates

[ADR 0030](../decisions/0030-coordinated-reads-and-live-updates.md) keeps financial
meaning and demand coordination in the existing Hermes API application. This
increment implements the native backend; Desk subscription, hydration and widget
composition will adopt it separately. There is no additional service, registry
or durable scheduler.

## Ownership and limits

The native api_server factory installs financial, specialist and SSE routes before
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

Actual outbound operations, including SDK setup/fan-out, request connector budget
permits. A local short burst waits in a bounded FIFO; saturation is busy. Quota
exhaustion and provider throttles preserve distinct origins and retry delays.
The demand owner retries after deferral. Shared budgets apply within this gateway,
not across independent CLI processes or other users of the subscription. Estimated
credits are not a billing ledger. See [connector support](connector-support.md).

## Protocol

POST /v1/pythia/updates (also under /p/{profile}) accepts
`{resources: [{operation, arguments, window?}]}`. Operations are the deliberately
exposed native operations from protected reads; this is not arbitrary-tool dispatch.
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

## Evidence and next consumers

Synthetic Python regressions exercise sharing, bounded execution, batching,
cancellation, release during active polling, reset/revocation and failure meaning.
The copied pinned-Hermes qualification checks native route registration, one shared
HTTP/tool backend, zero model/CLI subprocesses, auth/profile/disablement, deadlines
and responsive native health. Run
`node tooling/qualification/financial_http.mjs <prepared-hermes-source>`.

The accepted Desk consumer design is one channel for visible page demand, separate
quote/history loading, request-local server hydration and bounded per-read query
caches. Hidden/departed pages release demand; changing preferences updates preferred
views. This increment does not ship that client or claim browser/provider/paid
stream/production-service qualification. Each concrete connector must qualify its
native batch and push behavior separately.
