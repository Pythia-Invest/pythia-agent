# Connector execution support

[ADR 0031](../decisions/0031-connector-execution-and-visible-failures.md) describes
the execution and error boundary. The existing market-data plugin supplies its
`connector` module through the connector's resolved native dependency. There is
no additional registration or authentication mechanism.

## Library

| Primitive | Responsibility |
| --- | --- |
| `connection` | Connection-scoped concurrency, quota accounting and provider cooldown |
| `WorkerReads` | Bounded successful-response cache and shared in-flight reads with consumer cancellation |
| `NativeBatch`, `worker_batch`, `worker_item` | Collect compatible IDs, deduplicate overlapping requests, retain each ID's result or failure |
| `process.run_worker` | Bounded disposable process, actual outbound permits, safe execution diagnostics |
| `ResidentTransport` | Optional bounded RPC worker, connection-state reuse, deadlines, idle expiry and cleanup |
| `SourceFailure`, `qualify_failure` | Preserve error code, origin and retry qualification through domain results |
| `failed_item`, `qualify_items` | Preserve per-item errors and successful siblings in display batches |
| `emit` | Allowlisted structured events through native Hermes logging |

Use the already resolved native module, for example:

```python
connector = importlib.import_module(market_data_module.__name__ + '.connector')
reads = connector.WorkerReads(process)
budget = connector.connection('provider', connection_identity, per_minute=60)
raw = reads.read(command, request, explicit_environment,
                 age=60, cancelled=cancelled, budget=budget, timeout=30)
```

The plugin still owns supported operations, request validation, provider mapping,
units, sessions, entitlement interpretation, native batch limits and cadence.
The library does not infer these from a URL. Connection identity includes the
applicable credential/access mode; it is hashed in memory, never logged.
Current native access must be checked before reuse and again before publication.

For `worker_batch`, declare the endpoint's actual response layout: keyed maps
use the default; arrays use `row_id` (using the provider's documented identifier field).
Batch size must fit the connector worker's admitted native request size. Invalid,
duplicate or unexpected IDs fail validation, are not cached, and emit a safe
`batch_invalid_response` event correlated with the worker request. Tests must
exercise that layout through the registered tool and batch path, not just call
the display normalizer with an already prepared response.

Each connector must declare its actual native chunk limit; coalescing several
valid consumer requests must still respect that limit. `worker_batch`
returns successful native rows plus an internal `item_errors` map; use
`worker_item(raw, native_id)` when normalizing a single read. Specialist batches
also retain successful rows and expose failures for the affected IDs, including
retry delays. Do not treat the first failed chunk as failure of every chunk or
drop errors when unwrapping `data`. Valid common error envelopes with `data: null`
are validated before success cardinality checks.

Shared reads preserve the cancellation state of every consumer, including
synchronous nested metadata reads. A departing caller stops only its own demand;
provider work stops when no live consumer remains. The same rule applies to
explicit Desk reads and subscribers whose release grace expires during a poll.

Python workers use `worker_budget.open_budgeted` or `operation_permit`; Node
workers use `budgetedFetch`. These count actual outbound operations, including
SDK setup and fan-out. An in-process Python reader can use `budget.slot()` from
its execution thread. Local admission failures are typed exceptions, not
synthetic HTTP responses. SDK adapters must preserve those types when an SDK
would otherwise wrap them as network errors.

For an SDK that benefits from reuse, construct `ResidentTransport`, pass it to
`WorkerReads`/batching, and register `transport.shutdown` with native
`ctx.on_unload`. The worker implements the bounded request/result protocol;
Node's `provider-worker.ts` supplies a serial host with cancellation signals.
Changed worker/environment/connection bindings retire the child. No new listener
is opened. Concrete connectors choose whether SDK session reuse is justified.

Return per-item `failure` details with a fixed code/message, optional retry delay
and connector/provider origin, and a diagnostic reference. `qualify_items`
marks the containing display result partial. Failed charts/metrics must not be
cached as successful responses. Known quota delays govern retries; display
partials otherwise retry after 15 seconds, or 300 seconds for terminal access
and unsupported-request errors. Source selection never changes because a read
failed. A missing observation remains distinct from a failed transport.

## Logs

Pythia uses the pinned Hermes `hermes_logging.py` handlers, without installing a
second logging system. Events use logger `tools.pythia.connectors`, appear in the
served profile's `logs/agent.log`, and warnings also appear in `logs/errors.log`.
Hermes owns rotation, retention, redaction and queued file writes. Request
references correlate read and outbound events; they are not model-session IDs.

Use the **managed** Hermes executable and the same `HERMES_HOME`/profile as the
running gateway, not a globally installed Hermes:

```sh
HERMES_HOME="<hermes-root>" "<managed-hermes>" -p "<profile>" logs --component tools --since 30m
HERMES_HOME="<hermes-root>" "<managed-hermes>" -p "<profile>" logs errors --since 30m
HERMES_HOME="<hermes-root>" "<managed-hermes>" -p "<profile>" logs --component tools -f
```

`just dev-paths` identifies a normal development stack's root/profile; custom
previews use their lifecycle receipt. Filter the profile log for a dashboard's
diagnostic reference to see matching requests. INFO records show operation
duration, queue wait and actual HTTP status. `outbound_deferred` distinguishes
local budgets from provider cooldown; `read_failed`/`worker_failed` retain the
safe code. Cache hits are DEBUG events. These are local operational diagnostics,
not stored provider responses or an account-wide usage ledger.

## Evidence and limitations

Network-free tests exercise FIFO admission, queue cancellation/expiry, distinct
local quota/provider cooldown, actual worker permits, nested cancellation,
per-item partial failures, cache exclusion, safe logging and resident process
reuse/cleanup. The copied native HTTP qualification checks auth/profile/access,
shared tool/HTTP lifetime and responsiveness without model or CLI subprocesses.

Concrete connectors such as [EODHD](eodhd.md) use these helpers. Synthetic
qualification makes no live-provider, browser, broker, paid-stream or
production-service claim. Provider
PRs must exercise registered tools, real worker admission sizes and actual response
layouts with synthetic fixtures, then qualify live behavior separately when
explicitly authorized. A passing helper test cannot establish a connector's units,
coverage, entitlements or API billing. Local counters cannot enforce account-wide
quota across other processes/devices.
