# ADR 0032: Shared widget runtime and explicit plugin artifacts

Status: Accepted

## Context

Users need to change a composition or write a different visualization without
copying Pythia's status, price and chart implementations. Plain HTML renderers
cannot import the source-first React components in `@pythia/ui`. Making those
components public in a repository alone does not provide a usable extension API.

The first SDK built self-contained HTML with a separate React/UI copy per frame.
That remains useful for existing isolated HTML renderers, but duplicates code and
runtime work across a dense dashboard. The accepted feature-package model calls
for market-data, connector and user widgets to reuse the same supported frontend
implementation. User-installed frontend modules are trusted application code.

## Ruling

`@pythia/widget-sdk` is the supported local authoring boundary. It exports a
deliberate subset of the actual shared UI implementation, instrument display
types and a versioned host runtime interface. Built-in and custom module widgets
reuse the host's actual React and UI implementation; the SDK does not fork them.
Authors may compose these exports or render arbitrary React/HTML/SVG content.
Private Desk modules and Design Lab fixtures are not extension APIs.

A widget is an ordinary default-export React component. An explicit local build
creates a static JavaScript module containing its code and scoped presentation
styles. React and the supported SDK surface are supplied by Desk; widget-specific
dependencies can be bundled if already installed. One module may be instantiated
many times with independent component state and shared loaded code. No application
rebuild is required to load a new compatible module.

The builder comes from the selected Pythia checkout and frozen dependencies. It
does not install dependencies, execute user build hooks, run a service or compile
while loading a dashboard. The package is local tooling, not a published npm SDK.
The host uses explicit module exports and dependency bindings, not evaluated source
strings, a global plugin registration callback or a second capability inventory.

User source and generated artifacts remain user-owned. Editing a built-in
composition means copying its small composition into local source while keeping
SDK imports; it does not mean copying all underlying primitives. Explicit
configuration selects a renderer or replaces a built-in renderer. Removing that
override restores the built-in. Normal Pythia updates do not rewrite the user's
source, configuration or artifact. Module artifacts use the compatible SDK supplied
by the running host. Legacy self-contained HTML retains its bundled implementation
until explicitly rebuilt. A format transition never silently gives an old HTML
renderer the authority of an application module.

The host delivers data, display options, JSON settings, locale, timezone and
resolved appearance as component props. Ordinary data and appearance updates
preserve healthy local component state. The default financial snapshot
is a presentation view, not a canonical identity database or new financial
contract. Custom data types require an appropriate host/backend contract; a
TypeScript generic does not authorize arbitrary backend requests.

New module widgets run in Desk's frontend context and can access its browser
origin. Compatibility checks, scoped styles and error boundaries improve normal
operation; they are not a sandbox for malicious code or runaway work. Provider
credentials stay server-side, native operation permissions remain enforced, and
the host's standard data path coordinates reads and updates. The SDK adds no
provider polling, independent authentication or second update channel.

Legacy HTML continues through the explicit script-only iframe path without
same-origin authority. Its existing message protocol, network restrictions and
bounded height/error notifications remain a compatibility surface, not the new
module execution contract.

Frontend artifacts belong to their native feature package or an explicitly
selected user-owned file. Market-data ships canonical widget contributions;
connectors may ship specialist contributions through the same mechanism. Their
presentation declarations identify widgets, data contracts and explicitly exported
assets. Generic Desk hosting consumes those declarations rather than recognizing
particular market widget names. Native Hermes remains the plugin discovery and
enablement owner. Backend-only plugins and standalone custom renderers remain valid.

An optional named data binding belongs to the feature alongside its component.
It declares primary and deferred native resources, decodes qualified responses
and constructs display data. Desk coordinates those descriptors through its
existing query/cache/update path. Financial request construction, canonical
validation and display interpretation belong to the market-data public library,
not provider branches in Desk. Recognized canonical server rendering may import
that same pure library; arbitrary installed browser modules are not executed on
the server and do not automatically receive server-rendering support.

The existing protected operation adapter admits presentation reads. Module asset
URLs identify content by digest, and each server read rechecks native access and
the content identity. A module cache is not permission to mount a disabled feature
or retain unauthorized data. Hosts refresh contribution authority, remove denied
contributions and release their data demand. Already executed trusted JavaScript
cannot be revoked from a browser realm; native data access is enforced separately.

## Consequences

Ordinary users can install prebuilt modules; authors need the local build tool.
The host checks artifact format, runtime compatibility and required public exports
before invoking a generated widget factory. The runtime interface includes public
SDK semantics, not only envelope shape. Breaking changes require an interface
version change. SDK release versions and legacy wire versions are separate.

Shared React/UI imports bind to the exact host objects. Only deliberate public
exports are supported; private Desk modules and arbitrary package resolution are
not extension contracts. Module code and factories are reused by content identity;
failed loads must not permanently poison retry. Artifact sizes remain bounded.
The host supplies shared theme styles, while generated widget styles stay scoped
and cannot introduce a second document reset. Styling scope is not code isolation.

Qualification must exercise separately compiled widgets in the actual production
Desk build, including React identity/context, state updates, styles, repeated
instances, compatibility failures and cleanup. Native asset ownership, enablement,
copy lifecycle and user-file preservation need their own evidence. Synthetic data
is sufficient; module integration does not require live provider access.

## Alternatives

Reimplementing controls or bundling React/UI per standard widget defeats reuse.
Rebuilding all of Desk for every plugin install couples independent user features
to the application build. A new plugin registry, marketplace, general dependency
negotiator or build daemon is unnecessary. A small declared host surface and
explicit compatible modules are sufficient. Isolated HTML remains supported for
existing selections, with its distinct trust and performance characteristics.

See [shared UI ownership](0003-ui-and-design-lab.md),
[styling](0007-tailwind-styling-layer.md) and the
[instrument presentation contract](../architecture/market-widget-presentation.md).
