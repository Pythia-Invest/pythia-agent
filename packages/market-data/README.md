# Market-data wire contract v1

This increment ships shared contracts and the native owner. Concrete connectors
are separate additions; an enabled feature does not establish provider coverage.

This package exports portable TypeScript backend types and `schema.json` (JSON
Schema Draft 2020-12). It defines references, evidence, series and read results;
it does not discover providers, match investments, execute reads or store data.

This is the consumer library of the `pythia-market-data` feature, not a second
installed Hermes plugin. Its separate directory/build lets TypeScript consumers
use the feature's published interface without importing its Python runtime.
A compatible user replacement can retain this contract; changing it requires
updating the affected consumers too. See [feature packaging](../../docs/architecture/plugins.md).

The `@pythia/market-data/widgets` entry supplies the feature's pure frontend
binding: canonical request construction and stable query keys, response decoding,
deferred history demand and financial display adaptation. Its three native widget
declarations share one artifact composing the SDK's tile, compact tile and table
with this binding. The feature interprets the selected presentation identifier.
The dependent Markets integration coordinates the declared reads; the low-level
widget host in this foundation only renders supplied props. This library starts
no provider client, cache, polling loop or subscription. Server rendering of recognized canonical
resources can reuse the same functions without executing installed widget modules.
`@pythia/market-data/widgets/contract` exposes the configuration and response shapes
for these consumers. This presentation validation does not replace the native
backend's identity, source-selection or semantic checks described below.

Financial history displays preserve the requested window by default. Optional
`history.presentation: "session"` selects a single evidenced session axis for an
intraday view; `"window"` retains the complete requested range. This changes only
presentation, not source selection, retrieval bounds or query identity. Session
metadata alone must not truncate a multi-day or rolling chart. Without session
evidence the requested window remains in use. Tick/unknown sampling has no invented
millisecond interval.

`runtime/managed/plugins/market-data/wire_schema.py` owns the closed structural
shapes. Regenerate the package artifact from the repository root with
`python3 packages/market-data/test/export_schema.py`; use `--check` to verify it.
TypeScript types are maintained alongside that artifact. They describe values,
but do not validate untrusted JSON. JSON Schema checks structure, enum values,
decimal syntax and calendar formats (enable a format checker). Python `wire.py`
also checks relationships that JSON Schema cannot express: field units, scoped
identity qualifiers, OHLC bounds, time windows, pinned series/provenance and
honest outcome/requirements assessments. A consumer cannot claim these semantic
checks from a TypeScript assertion or structural schema check alone.

The provider-free Python consumer interface is:

```python
validate("contribution", description)  # validated detached JSON value
validate("series", definition)
validate_observation(observation, definition)  # requires its series context
validate_read_result(result)  # includes contextual observation checks
encode("read_result", result)  # lossless validated JSON serialization
parameter_schema("read_request")  # owned, expanded schema for native tool properties
validate_parameters(native_schema, arguments)  # closed supported structural subset
```

`validate(kind, value)` also admits the named `$defs` in the schema. Failures
raise `WireError` with field paths and fixed diagnostics, without echoing input
values. `validate_parameters` reuses structural checks for closed native argument
schemas and rejects unsupported keywords or references rather than ignoring
them. It does not apply defaults/coercion; `title`, `description` and `$comment`
are inert annotations. `parameter_schema(kind)` expands only owned contract
references and types their enums for that subset; use `read_request` and
`provider_ref` as nested native tool properties, then validate full wire
semantics separately. It never loads external references. Open source-detail
maps are intentionally outside the native argument subset. `wire.py` and `wire_schema.py` are the only runtime files needed; install
both as exact files beside the feature plugin. Package examples/tests and this
README are not runtime/plugin scan inputs. No JSON Schema dependency is needed
at runtime.

Subject IDs are opaque scoped references (`company:…`, `instrument:…`,
`listing:…`, `crypto:…`). A provider reference instead has `provider`,
`native_id`, and source-owned `native_scope` (for example `contract`, `coin`,
`catalogue`, or `unknown`). It is usable without a confirmed canonical mapping.
Names and tickers are evidence assertions, never proof of equivalence. Evidence
records separately assert canonical scope and authority. Mapping validation
requires evidence references but does not establish the truth or sufficiency
of those records; the identity owner must validate them and the matching rule.
A positive override cannot be authorized by wire validation alone.

A `series:…` ID identifies one source's measurement semantics, not an investment.
The series owner must assign a new ID when the actual native binding, dataset,
venue/route, measurement, interval/session/time anchor, field units/scale,
adjustments/anchor or transformation methodology changes. Read windows,
retrieval times, adapter releases unrelated to semantics and current capability
lists are excluded. After proving a current identity mapping, the shared owner
may project `series.subject` to the requested canonical subject while retaining
the native series ID and `provider_ref`, and report `provenance.mapping_revision`.
This proven canonical projection does not change the underlying native series
identity. The shared owner first executes and validates a source-pinned native
request, then projects its request/selection/subject after a generation recheck.
A provider's unknown/current adjustment vintage is read
provenance, not a claim of historical reproducibility. Source details are bounded
flat facts under the actual source namespace; they are not arbitrary endpoint
arguments or nested provider responses. A source may include an opaque bounded
`source_detail.values.read_selector` string. The shared reader copies it into
native `{request, source_selector}` arguments without parsing it; the provider
owns interpreting it and deriving transport parameters. Common details/series
calls use `{native_ref}`. Selectors never confer identity or execution authority;
the native bridge and returned actual-series/native-binding checks still apply.

Decimal strings use plain base-10 notation without exponent notation, NaN or
Infinity. Trailing digits survive serialization. A unit's positive decimal
`scale` multiplies its numeric value; `unknown` with scale `1` preserves the raw
number without claiming a physical unit or a conversion. Price and volume
adjustments are separate. Omitted volume differs from the string `"0"`.
Daily session dates remain dates, aware instants retain their offsets, and
missing observation times are `{ "kind": "unknown" }`. Unknown window bounds
are `null`. `Series.market_data_type` exposes the offered/actual source class
through the common enum also used by `Freshness.market_data_type`; the read
result's two classes must agree. Unknown remains valid. A daily interval does
not itself establish an EOD class. Completion requires a source/calendar basis; response end by itself
is not bar completion. Feed class (`market_data_type`) does not establish age.

A Pythia view identifies the requested subject and reports one selected series;
a source view pins that series. Selection alternatives are suggestions for a
separate discovery/read, never fallback calls or stitched observations. An already
known series uses `series:…`; a known contribution without a discovered series
uses `provider:<namespace>`. Other identity namespaces are invalid alternatives. `empty` is a
successful empty response with source provenance; `error` has no observations;
`partial` preserves useful values with issues. Unknown coverage may accompany
an ordinary successful read, but cannot satisfy a strict complete-coverage
request. A strict unmet freshness/completion/coverage request cannot report
`ok` or `empty`. Returned/requested windows cannot exclude dated observations.
These checks do not prove actual provider coverage, freshness or identity.

Synthetic shared JSON examples cover equity OHLC(V), aggregate crypto scalar
samples, a non-price count, useful partial bars, missing source time, empty and
unavailable results, evidence/mapping and native contribution descriptions.
Their descriptions identify the contract/source version that shaped them;
none are recorded provider responses. Verification from the repository root:

```sh
pnpm --filter @pythia/market-data check
pnpm --filter @pythia/market-data test:unit
python3 packages/market-data/test/export_schema.py --check
uv run --no-project --with jsonschema==4.26.0 python packages/market-data/test/check_wire.py --json-schema
node tooling/check-structure.mjs
```

The regular package tests send the actual shared fixtures through Python and
TypeScript's checker. The last Python command additionally compares structural
acceptance/rejection with the independent JSON Schema implementation. Semantic
negative fixtures remain structurally valid by design. This qualifies the
contract, not a provider, matching algorithm or copied native integration.

See [the backend action API](BACKEND.md) and [identity API](IDENTITY.md) for
the separate native feature implementation that consumes these contracts.

Optional `ReadResult.price_context` carries source display labels, known delay,
evidenced session state and change values with an explicit previous-close or
rolling baseline. Unreported values remain absent; a rolling change is not a
daily session return. `Series.read_support` describes implemented operations,
window kind and optional maximum span without changing financial series identity.
Neither field certifies entitlements. The package exports `marketDataSchema`
alongside its types so Desk validates wire shapes from the same generated schema;
the native reader remains responsible for semantic validation.
