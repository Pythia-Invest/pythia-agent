# ADR 0032: Local widget SDK and explicit build artifacts

Status: Accepted

## Context

Users need to change a composition or write a different visualization without
copying Pythia's status, price and chart implementations. Plain HTML renderers
cannot import the source-first React components in `@pythia/ui`. Making those
components public in a repository alone does not provide a usable extension API.

The local product prioritizes straightforward authoring. Native backend plugins
are trusted user-installed code. Browser renderers need neither provider secrets
nor access to Desk's authenticated origin to compose a custom view.

## Ruling

`@pythia/widget-sdk` is the supported local authoring boundary. It exports a
deliberate subset of the actual shared UI implementation, instrument display
types, the versioned host-message contract and a React mount helper. Built-in
and custom widgets reuse the same primitives; the SDK does not fork them.
Authors may compose these exports or render arbitrary React/HTML/SVG content.
Private Desk modules and Design Lab fixtures are not extension APIs.

A widget is an ordinary default-export React component. An explicit local build
bundles its code, React, selected UI components and compiled Tailwind styles into
one self-contained HTML artifact. The builder comes from the selected Pythia
checkout and its frozen dependencies. It does not install dependencies, execute
user build hooks, run a service or compile while loading a dashboard. Extra
dependencies must already be available locally. The private workspace package
is not advertised as a published npm package.

User source and generated artifacts remain user-owned. Editing a built-in
composition means copying its small composition into local source while keeping
SDK imports; it does not mean copying all underlying primitives. Explicit
configuration selects a renderer or replaces a built-in renderer. Removing that
override restores the built-in. Normal Pythia updates do not rewrite the user's
source, configuration or artifact. Rebuilding explicitly adopts the installed
SDK version; an existing artifact retains its bundled implementation.

The host delivers data, display options, JSON settings, locale, timezone and
resolved appearance through a versioned message. One React root receives later
updates without resetting local component state. The default financial snapshot
is a presentation view, not a canonical identity database or new financial
contract. Custom data types require an appropriate host/backend contract; a
TypeScript generic does not authorize arbitrary backend requests.

The frame retains script-only sandboxing without same-origin authority and a
CSP that blocks external resources and network requests. Outgoing messages are
limited to readiness, errors and bounded height. There is no shell, filesystem,
credential or arbitrary-tool bridge. The SDK supplies rendering and lifecycle,
not provider polling, authentication or a second update channel. Financial
operations remain with their existing native backend owner.

Frontend artifacts are explicitly selected files, not another native plugin
registry. A native plugin can distribute a frontend artifact alongside its
backend code; installing/enabling its backend continues to use Hermes. This
increment does not add automatic discovery or serving of arbitrary files from
native plugin directories. Authors can also distribute a display-only artifact
without registering a backend capability.

## Consequences

Ordinary users can use a prebuilt artifact; authors need the local build tool.
Legacy inline HTML remains usable. Protocol version 1 keeps its existing fields;
appearance additions are optional. The file loader rejects unsupported artifact
versions visibly rather than presenting an empty widget. The message bridge
ignores invalid or unsupported incoming messages; they do not grant authority.
The SDK release version is separate from the artifact/wire protocol version.

Each custom frame bundles its own React/UI code. Built-ins pay no iframe or
duplicate-runtime cost. Artifact size and dashboard admission stay bounded, and
unchanged artifacts must not be retransmitted on every configuration refresh.
Theme tokens come from the shared stylesheet. System-font fallbacks avoid
external font loads in the isolated frame.

Isolation protects Desk's origin, not the user against all malicious code, CPU
exhaustion or misleading rendering. It is not a general plugin sandbox. Authors
and users remain responsible for the code they install. Backend access checks
and credential custody remain mechanically enforced by their existing owners.

## Alternatives

Reimplementing shared controls inside every HTML widget defeats reuse. Loading
arbitrary same-origin modules would grant unnecessary Desk browser authority.
A new registry, marketplace, remote module loader or build daemon would add
ownership and lifecycle work unrelated to this first extension path. Publishing
an npm SDK and sharing one React runtime across isolated frames can be considered
later if distribution or measured resource cost requires them.

See [shared UI ownership](0003-ui-and-design-lab.md),
[styling](0007-tailwind-styling-layer.md) and the
[instrument presentation contract](../architecture/market-widget-presentation.md).
