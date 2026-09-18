# Local widget SDK

Build a user-owned React widget with the same instrument components Pythia uses.
This is local tooling supplied by a prepared Pythia checkout, not an npm release.
The package supplies rendering and a host-message contract. It does not fetch
prices, select providers or grant access to native tools.

## Author and build

Create a `.tsx` file outside the managed checkout:

```tsx
import { InstrumentTable, type WidgetProps } from "@pythia/widget-sdk";

export default function MyWatchlist({ data, options }: WidgetProps) {
  return <InstrumentTable read={data} options={options} />;
}
```

From the prepared Pythia checkout, run:

```sh
pnpm widget:build /absolute/path/my-watchlist.tsx /absolute/path/markets/widgets/my-watchlist.html
```

The command resolves supported SDK and React imports from that checkout, bundles
their implementation and compiles Tailwind styles. It writes a self-contained
HTML fragment with production React. Nothing is compiled or installed when the
dashboard refreshes. Already installed local dependencies can be bundled; remote
imports and runtime asset downloads are not part of this contract.

The component is the default export; the builder handles mounting. Compose
`InstrumentIdentity`, `InstrumentStatusDot`, `InstrumentPrice`, `InstrumentChange`,
`InstrumentExtendedSummary`, `InstrumentPathView` and `InstrumentSparkline`, or
reuse `InstrumentTile`, `InstrumentCompactTile` and `InstrumentTable`. Use ordinary
React hooks and custom markup when those components do not fit. Public SDK exports
are the supported boundary; private Desk and Design Lab imports are not.

Keep source in a user-owned directory and rebuild explicitly after edits. A failed
build preserves the previous artifact. Product updates preserve user files and
do not silently rebuild them against a newer SDK. Rebuilding adopts that SDK's
implementation. Copy a small example composition to start a personal variant;
keep its imports so shared components remain shared.

## Host contract

`WidgetProps` contains `data`, standard display `options`, custom JSON `settings`,
legacy theme colors, optional resolved `appearance`, `locale` and `timeZone`.
`WidgetSnapshot` contains the shared `InstrumentRead` plus `source`, `detail` and
optional `retrievedAt`. A display reference is not evidence of cross-provider
identity. Preserve supplied source, units, time, gaps, change baselines and missing
values. Use the supplied locale/timezone for raw instants; keep date-only values
as calendar dates.

`mountWidget` owns one React root and preserves component state across host data
and appearance updates. Hosts import the React-free `@pythia/widget-sdk/protocol`
entry for document wrapping, message types and artifact bounds. The v1 protocol
remains compatible with existing inline HTML renderers. The artifact marker is a
format/version identifier, not a signature or a declaration that code is safe.

The default data type is an instrument snapshot. `WidgetProps` also accepts an
explicit data/settings type for a host with another supported contract. This
does not automatically add that dataset to Desk or authorize a backend call.

The host must deliver data through its existing authorized operations and update
coordination. Widgets receive their block's view, not a provider client. They run
in a script-only iframe without same-origin authority; external requests, resources
and tool/file bridges are unavailable. The shared stylesheet uses system-font
fallbacks in that frame. This isolation is not protection from all malicious
code or excessive CPU use.

## Distribution and configuration

Distribute the prebuilt HTML along with optional editable source. It can accompany
a Hermes-native plugin, but the browser artifact does not register or enable any
backend capability. Native plugins retain their own discovery and enablement.

Desk's dashboard composition integration selects explicit workspace artifacts,
using the existing shape:

```json
{"id":"my-watchlist","name":"My watchlist","file":"widgets/my-watchlist.html"}
```

Select `custom:my-watchlist` on a block, or map `instrument-table` to
`my-watchlist` in `overrides`. Keep that block's financial source unchanged when
changing its presentation. Removing an override restores the built-in renderer.
The dashboard configuration/loader is a separate integration from this SDK;
there is no automatic plugin-folder scan or marketplace installer here.

See [ADR 0032](../../docs/decisions/0032-local-widget-sdk.md) for ownership,
compatibility and the rejected alternatives.
