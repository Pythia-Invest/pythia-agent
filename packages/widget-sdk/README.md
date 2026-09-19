# Shared widget SDK

Build a user-owned React widget with the same instrument components Pythia uses.
This is local tooling supplied by a prepared Pythia checkout, not an npm release.
The package supplies rendering, module compatibility and data-binding types.
Desk supplies its actual React and UI implementation. Financial meaning, source
selection and native operation permissions remain with their existing owners.

## Author and build

Create a `.tsx` file outside the managed checkout:

```tsx
import { InstrumentTable, type InstrumentRead, type WidgetProps } from "@pythia/widget-sdk";
export { financialBinding as binding } from "@pythia/market-data/widgets";

export default function MyWatchlist({ data, options }: WidgetProps<InstrumentRead>) {
  return <InstrumentTable read={data} options={options} />;
}
```

From the prepared Pythia checkout, run:

```sh
pnpm widget:build /absolute/path/my-watchlist.tsx /absolute/path/markets/widgets/my-watchlist.mjs
```

The command compiles the component into a static module with a widget factory,
compatibility metadata and scoped styles. React, JSX runtime, React DOM and public
SDK imports bind to Desk's matching runtime objects; their implementations are not
bundled again. Other already installed local dependencies can be bundled. Nothing
is compiled or installed when the dashboard refreshes. Remote imports, runtime
dependency downloads and private Desk imports are unsupported.

The component is the default export; the host handles rendering. Compose
`InstrumentIdentity`, `InstrumentStatusDot`, `InstrumentPrice`, `InstrumentChange`,
`InstrumentExtendedSummary`, `InstrumentPathView` and `InstrumentSparkline`, or
reuse `InstrumentTile`, `InstrumentCompactTile` and `InstrumentTable`. Use ordinary
React hooks and custom markup when those components do not fit. Public SDK exports
are the supported boundary; private Desk and Design Lab imports are not.

Use Tailwind utilities from Pythia's theme. The builder emits widget-scoped
utilities without a second theme or document reset. Authored CSS must fit the
scoped contract; unsupported global definitions fail the build rather than leak
styles into Desk. Shared UI components inherit the host's theme and fonts.

Keep source in a user-owned directory and rebuild explicitly after edits. A failed
build preserves the previous artifact. Product updates preserve user files and do
not silently rebuild them. Compatible modules use the current host implementation;
an incompatible runtime or missing required SDK export gives a visible error.
Copy a small example composition to start a personal variant and keep SDK imports.

## Host contract

`WidgetProps` contains `data`, standard display `options`, custom JSON `settings`,
optional resolved `appearance`, `locale` and `timeZone`.
Optional `presentation` identifies the selected native widget declaration. A
feature may publish several presentations from one artifact and interpret that
identifier in its own component; Desk does not switch on those names. The supplied
tile, compact tile and table share one artifact and one financial binding.
The default data type is the shared `InstrumentRead`. A display reference is not
evidence of cross-provider identity. Preserve source, units, time, gaps, change
baselines and missing values. Use the supplied locale/timezone for raw instants; keep date-only values
as calendar dates.

The generic host caches imported module code and its factory result, renders
components in Desk's React tree, and preserves healthy state across ordinary data
and appearance updates. `@pythia/widget-sdk/runtime` describes module metadata and
validates the required runtime interface and imports before factory invocation.
Runtime compatibility includes public SDK semantics; a breaking interface change
requires a runtime version change. SDK release versions are informational.
An explicit retry uses a new bounded import URL while retaining the same required
content digest. Successful code/factories are shared; each revision allows three
load attempts before requiring reload or an updated artifact. Cached code grants
no native access. A render error remains isolated until remount, revision change
or an explicit presentation selection change.

`WidgetProps` also accepts an explicit data/settings type for a host with another
supported contract. This does not automatically add that dataset to Desk or
authorize a backend call.

The feature-owned binding constructs requests and interprets their results.
This foundation's `WidgetHost` loads code/styles and renders caller-supplied props;
it does not execute the binding or refresh presentation authority. The dependent
Markets composition integration coordinates bindings through its existing
authorized query/cache/update path and withdraws unavailable contributions.
A standalone host consumer must provide those responsibilities itself.
Preserve canonical identities,
preferred/pinned semantics and full result qualifications before making a display
snapshot. Specialist bindings keep their own operation and data meaning.

Export a named `binding` alongside the default component when the feature supplies
that adapter. Its pure `queries(input)` method declares primary resources;
`deferred(input, primaryResults)` can request history once prices are available.
Each query has a stable key, a native `plugin`/`operation`/`arguments` resource,
an `enabled` flag and a decoder. Optional reconciliation preserves qualified
previous values. `render(input, primaryResults, deferredResults, context)` produces
the component's data, loading state and useful error message. The context supplies
timestamp formatting; it supplies no provider client or credential. The binding
contract is packaged here; its automatic execution belongs to the dependent
composition integration, not the low-level `WidgetHost`.

For a canonical financial composition in that integration, export the feature's
adapter as shown in the first example. A `source.feed: "prices"` custom module
requires a binding; it does not acquire one by importing a visual component:

```tsx
export { financialBinding as binding } from "@pythia/market-data/widgets";
```

Its input keeps canonical subjects and preferred/pinned source choices separate
from presentation options. The public feature library also supports recognized
financial server rendering. Desk does not execute arbitrary browser modules on
the server: adding a new module does not automatically add server rendering for
a new dataset. Specialist operations keep their own explicit data contract.

Module widgets are trusted code running alongside Desk with access to its browser
origin. Scoped CSS and error boundaries are not a security sandbox. Provider
credentials stay server-side, and every backend operation still enforces native
authorization. The SDK itself creates no
provider client, polling timer, filesystem bridge or native capability.

## Distribution and configuration

Distribute module artifacts inside the supplying Hermes-native feature package,
alongside editable source, tools and skills. Market-data supplies canonical
presentations; connectors may supply specialist widgets through the same boundary.
Installing a module does not register or authorize any backend capability.

The core helper `platform.register_widget_presentation` registers an ordinary
read-only `widgets` operation on the contributing plugin's native tool. Pass a
bounded widget list (`id`, `asset`, `input_contract`) and an explicit mapping from
asset IDs to bundled `.mjs` paths. Register the tool in the native manifest.
Descriptors include the content digest and UTF-8 byte length so hosts can enforce
their aggregate asset budget without downloading each module a second time.
The [market-data declaration](../../runtime/managed/plugins/market-data/presentation.py)
is the supplied example. Check the helper exists on the declared core dependency;
an edited older core can remain preserved across updates.

For example, a plugin can register a compiled specialist view as follows, using
its actual native toolset and a matching `provides_tools` manifest declaration:

```python
platform.register_widget_presentation(
    ctx,
    tool_name="my_plugin_widgets",
    toolset=ctx.plugin_id,
    widgets=[{
        "id": "overview",
        "asset": "overview",
        "input_contract": "my-plugin.overview.v1",
    }],
    assets={"overview": "dist/widgets/overview.mjs"},
)
```

Build the artifact before packaging; include its editable source and declared
asset in the feature payload. Adding another supplied feature also requires its
explicit lifecycle build/copy declaration. A community package ships its compiled
assets with its normal native plugin installation. Runtime reads do not build it.

Desk reads that operation through protected transport, then serves the declared
asset at a content-digest URL. It verifies the returned digest and rechecks native
access before publishing bytes. Loaded-code caching is independent of permission
to mount a contribution or receive data. Consumers must withdraw disabled
contributions and release their data demand. There is no plugin-folder scan,
arbitrary filesystem path or parallel registration list.

The dependent dashboard composition integration also selects explicit workspace
artifacts, with an explicit trusted-module format:

```json
{"id":"my-watchlist","name":"My watchlist","format":"module","file":"widgets/my-watchlist.mjs"}
```

Select `custom:my-watchlist` on a block, or map `instrument-table` to
`my-watchlist` in `overrides`. Keep that block's financial source unchanged when
changing its presentation. Removing an override restores the built-in renderer.
For several views sharing a module, optional `presentation` selects the feature's
view ID. A native `{format: "module", plugin, asset, presentation}` selection must
match a widget declaration for that asset. A local module interprets its explicitly
configured presentation ID itself.
The Markets page and its configuration loader remain a dependent integration;
this package does not introduce a dashboard editor or marketplace installer.
Modules are the only widget format. The earlier unreleased HTML/iframe format has
been removed; old HTML configurations are rejected without rewriting user files.
The module marker is a format identifier, not a signature or a safety guarantee.

## Check a widget

Check successful and incompatible builds, loading/empty/error states, theme and
narrow layout, updates without state reset, and cleanup when removed. Confirm
the generated module uses host imports and exposes only its intended data binding.
Use synthetic observations with explicit financial semantics. New integration
boundaries need an actual production host check, not only a component fixture.

See [ADR 0032](../../docs/decisions/0032-local-widget-sdk.md) for ownership,
compatibility and the rejected alternatives.
