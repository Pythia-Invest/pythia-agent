# Native feature backend actions

The managed `market-data` plugin binds one ordinary `Backend` instance to native
`ctx.state.data_dir`. The `pythia_market_data` tool and platform-bound native CLI
`hermes market-data --platform cli --request '<JSON>'` dispatch through the same implementation.
The running gateway's protected `POST /v1/pythia/plugins/pythia-market-data/query` dispatches the native
tool handler and shares its profile-bound backend instance. CLI processes have
their own instance. Describe/startup
only inspect native contributions; they never test live entitlements. Every
source operation rechecks native feature/source availability and platform scope.

Arguments are flat action objects. The backend rejects unrelated fields.

| Action | Required fields | Optional fields / result |
| --- | --- | --- |
| `search` | `provider`, `query` | Source candidates; no identity save |
| `details` | `native_ref` | Source candidates, normalized evidence and issues |
| `resolve_save` | `native_ref`, `scope` | Reads details and explicitly saves one selected native identity |
| `series` | `binding` | `criteria`; returns matching definitions |
| `read` | `request` | `criteria`, `series`; returns wire `ReadResult` |
| `read_many` | `reads` | 1–32 `{request, criteria?, series?}` items; ordered `ReadResult` array in `data` |
| `get_preferences` | — | Per-operation orders, scoped exceptions and revision |
| `set_preferences` | `operation`, `providers` | Optional `preference_scope`; an empty order clears that scope |
| `inspect_identity` | `mapping_id` | Current mapping, original intent, revisions and overrides |
| `inspect_subject` | `subject` | Retained subject evidence |
| `refresh_identity` | `mapping_id` | Reads details for original native intent and updates evidence |
| `inspect_repair` | — | Evaluates supported local repairs and reports pending refresh |
| `apply_override` | `mapping_id`, `effect`, `evidence_ids` | `target` for a positive override |
| `revoke_override` | `override_id` | Revokes an existing override |

Non-read operations use `{schema_version, outcome, data, issues}` envelopes;
explicit mutations also return `effect: "local_write"`. Identity inspection can
apply supported dependency repairs using retained evidence, as described in the
[identity API](IDENTITY.md). Existing `describe` and specialist `call` remain
available; `call` requires provider, operation and native-schema arguments and
accepts only operations in that provider's validated contribution. `describe`
does not catalogue every native tool. Specialist native tools remain separate
from the shared `call` operations.

`binding` is a canonical subject or provider reference. Common read criteria
are measurement, interval, session, price adjustment, market-data type,
currency, venue and route. They filter common definition fields; the shared
owner never parses provider datasets or transport parameters. Scoped preferences,
global orders and deterministic defaults order eligible sources. The reader checks
each candidate's compatible definitions and declared `read_support` before
committing to a source. Successful metadata with no compatible series permits
examining the next candidate; a metadata failure does not.
Ambiguity requires narrower criteria or a retained descriptor. Selection scans
at most eight matching native bindings per provider; exceeding the bound returns an explicit
issue without selecting a subset. Selected-source failures identify the source
and report alternatives separately, with no backup metadata/price call and no
history stitching.

Native contributions optionally declare `requires_broker_app` (default false)
and `observation_cache` (`default` or `disabled`, default `default`). Implicit
canonical reads exclude broker-dependent sources unless the operation's saved
preference includes them. Canonical `series` discovery honors either latest or
history saved preference because that action has no operation parameter. Explicit
native references and pinned descriptors retain access. An excluded-only read
returns `explicit_source_required` without contacting Broker. Validated source
issues survive metadata and generic read failures alongside selection context.

A Pythia request selects using current preferences and proven `bindings()`.
A source-pinned request requires the full retained `series` descriptor whose ID
matches `request.view.series_id`; retain it with the result for later reads,
including after restart. The descriptor expresses caller intent, not evidence
or authority. The provider recomputes the actual definition. The shared reader
checks its ID, native binding and common semantics before accepting the result.
It copies only the opaque `source_detail.values.read_selector` into native
`{request, source_selector}`. Details and series use native `{native_ref}`.

Canonical reads execute a native source-pinned request first. After validating
the native result and rechecking identity generation, the backend creates a new
canonical projection with the original request/view, requested subject and
mapping revision. It preserves native provider reference and series ID; it does
not rewrite previously returned values. Correction lineage exposed by inspection
is not routing authority: only current `bindings()` proof can route retained
canonical intent. Native reads need no canonical mapping. Sources without a qualified details
operation remain native-only; no evidence is invented to route them.

Only validated connector detail results can supply normalized evidence to the
internal identity ingest API. Search does not bulk-save identities. Public
operations cannot submit Evidence objects or source authority; overrides cite
persisted evidence IDs and remain subject to scope/contradiction checks. Offline
refresh stays pending, and known-bad associations cannot route while pending.

Preferences and identity live transactionally in the private SQLite state.
A fresh preference store uses internal revision zero for cache/publication
checks. Read selection reports `preference_revision: null` until a saved
positive revision exists; an unconfigured single-provider read needs no
preference write. Pinned reads also report null.
Observations have no durable archive. The process-local cache defaults to 32
entries and 4 MiB, with a 15-second default TTL overridden by declared provider
cadence, and returns detached copies. Keys include complete
request/descriptor/criteria, preference revision and identity generation for
preferred reads, and a hash
of native caller, configuration, environment and contribution availability.
Environment values and the internal access fingerprint are not persisted or returned. This invalidates
cache reuse when native settings change while readiness remains true, or an
in-process credential environment changes; restart also discards the cache.
The fingerprint also includes metadata for the canonical `secrets.json` under
the lifecycle-injected `PYTHIA_CONFIG_ROOT`: device/inode and nanosecond change/
modification times. No secret file contents are opened or hashed. Atomic secret
replacement invalidates cache even without an environment/configuration change.
Missing, inaccessible, nonprivate or nonregular metadata disables cache get/put
for that invocation while leaving native reads available. Rotation detected
between selection and publication rejects the result as `selection_changed`.
Native eligibility is checked before a cache hit and publication. Preference and
identity revisions are rechecked under the identity database write lock; no
provider call holds that lock. Strict freshness and contribution-level
`observation_cache: disabled` bypass cache reads and publication. Connectors whose account state cannot
qualify safe reuse should declare observation caching disabled. Unknown age,
coverage, completion and units remain unknown; completed-only requests exclude
unproven bars and report partial/error status.

The implementation retains narrowly qualified, Pythia-owned rules for equity
instrument evidence and native crypto-catalogue identity; see [identity](IDENTITY.md).
Synthetic tests prove rule behavior, not installed connector availability. This
increment ships no concrete shared connector. Existing SEC and legacy EOD tools
remain independent and do not implicitly become shared sources.

## Coordination and delivery

`read_many` drives the same preparation, semantic validation and publication
path as `read`. It deduplicates requests and native arguments, carries native
caller context into bounded workers, and groups committed reads by provider and
operation. Optional native `read_batch` operations let connectors use one compatible
multi-symbol quote response. Sources
without batch support use their existing individual operations. History batches
respect the native read-batch schema's item limit as well as requested observation
count to respect native response limits;
the caller's windows and limits are not silently reduced.

Contributions can declare `cadence.latest`, `cadence.history` and
`cadence.series` in seconds. The first two govern disposable read reuse and
refresh; the last governs process-local series metadata reuse. Account access
is still checked independently. Failures are not cached as successful reads;
structured retry-after information can delay the next widget refresh.

Consumers can keep bounded caches of individual shared results.
The optional `reuse_scope` checks current native access and,
for preferred reads, current preference/identity revisions. It returns either a
reuse acknowledgement or fresh reads with an opaque delivery receipt and
per-result maximum ages. The receipt qualifies caller-held, unexpired results;
it does not grant provider access or change read intent. Cache-disabled sources
and strict fresh requests receive zero reuse age. Desk cannot use the receipt
to extend expiration, preserve failed reads or bypass native availability.

Ordinary HTTP execution retains metadata and in-flight state inside the native
feature. Standalone CLI retains `--reuse-scope` for diagnostic callers. HTTP uses
the same delivery implementation without launching that command or persisting
metadata. Desk composition and consumer-side coordination are a later increment.

## Protected HTTP

The existing API bearer authenticates
`/v1/pythia/plugins/{plugin-id}/{operation}`. Shared financial actions use
`pythia-market-data/query`. The body is `{arguments, reuse_scope?}`;
the financial `arguments` is an action object from the table above. Only native
tools explicitly marked with `pythia_http_operation` are targets, and the plugin
address must identify the actual native owner.
Providers declare these with `register_read_command(..., schema=..., plugin=...)`;
the same native schema supports standalone CLI and protected HTTP. A plugin
does not implement authentication, register another financial route or gain
arbitrary tool invocation. Readiness, native enabled state and current access are
checked before execution and cached publication.

Pythia's adapter admits bounded work on a dedicated executor, outside the native
HTTP event loop. Timeout and disconnect propagate to the financial request's
child workers; slots remain occupied until work exits. Application cleanup
cancels outstanding work. Provider keys stay in the existing custody owner and
unusual provider authentication remains in its connection adapter. The installed profile lifecycle activates
copies/restarts normally; multiplexed cross-profile endpoint routing is not part
of this slice. [ADR 0030](../../docs/decisions/0030-coordinated-reads-and-live-updates.md)
extends the original ADR 0029 limits with bounded queues and shared updates.
The [delivery contract](../../docs/architecture/data-delivery.md) describes
`/v1/pythia/updates`, relative windows, native push hooks, connector budgets and
consumer hydration requirements. Specialist response caches now live below HTTP in their connector
instances, so HTTP and native tools share authorized reusable work.

## Evidence and availability

The copied-feature qualification runs against the exact unmodified Hermes pin
with disposable profiles and synthetic native contributions. It demonstrates one
HTTP/tool backend, zero CLI/model subprocesses during reads, authentication and
profile rejection, native disablement, preferred/pinned behavior, metadata and
price reuse, timeout/cancellation and responsive native health. Run:

```sh
node tooling/qualification/financial_http.mjs <prepared-hermes-source>
```

The lifecycle packaging test separately verifies exact files, native validation,
fresh-profile enablement and preservation of existing user choices and state.
No live provider, Desk widget, broker session or production service is qualified
by this foundation alone.
