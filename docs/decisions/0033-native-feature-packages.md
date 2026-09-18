# 0033: Native plugins own coherent features

## Context

Market data had one domain owner but an incomplete installation boundary. Its
skill came from an unrelated external skill directory, generic HTTP support lived
inside the financial feature, routes did not consistently identify the owning
plugin, and lifecycle copying could replace a user's edited plugin. That made the
default feature a poor example for independent plugin authors.

## Ruling

A Pythia feature is an ordinary Hermes-native plugin package. It owns its domain
implementation, native tools, bundled skills, deliberately exposed operations and
any presentation exports. Pythia's plugins and community plugins use the same
extension points. The exact unmodified Hermes version remains authoritative for
discovery, registration ownership, enablement and lifecycle.

Installation and enablement are separate. Pythia may ship supported optional
plugins without enabling them. The release explicitly chooses a small fresh-profile
default set, including market data. An update preserves existing native choices;
installing a new payload does not imply enabling it in an existing profile.

A managed copy may be refreshed only while Pythia can prove ownership of its
contents. Local edits, extra source files or an unrecognized replacement must be
preserved and reported. A receipt records copied content, not capability state or
an alternative plugin inventory. Returning a fork to release ownership requires
an explicit user action. No automatic merge or replacement of user code occurs.

Feature skills are registered using native `ctx.register_skill`. They travel
with the plugin and use native qualified names and disablement. At the pinned
release these skills are available through explicit `skills_list` / `skill_view`
discovery, rather than the automatic system-prompt skill index. Tool guidance
must make the relevant skill discoverable without injecting its full contents.

This initial packaging change does not migrate disabled entries for the former
standalone skill names. Native settings must address the qualified name, such as
`pythia-market-data:market-data`; a bare `market-data` entry does not disable it.
The transition requires no new settings writer or exception to credential
custody. Future changes to established skill names must separately address
compatibility for affected installations.

Platform support owns authenticated transport, trusted profile context, native
access checks, validation, bounded execution and cleanup. It is independent of
financial feature enablement. A plugin declares operations on its native tool
registration; it does not write authentication handlers or acquire an independent
HTTP server. Operation addresses include the native plugin identity:

```text
POST /v1/pythia/plugins/{plugin-id}/{operation}
POST /v1/pythia/updates
```

Updates share one transport; each resource identifies its plugin and operation.
Neither route is an arbitrary tool gateway. Declarations must belong to the
actual enabled native registration. HTTP and agent tools dispatch the same domain
handler and resident state. Standalone CLI execution shares code and durable
state, not the gateway's in-memory instance.

Automatic widget reads and update subscriptions require declared read-only
support. A mixed operation can classify its supported read arguments in its
domain adapter; this does not remove mutations from explicitly requested agent
or authorized HTTP workflows. A caller requesting a read-only check cannot grant
that property to an operation itself.

Public contracts and reusable UI components may have separate source/build
packages. Python, TypeScript and browser artifacts have different consumers;
putting them into one directory would not make their semantics more cohesive.
The feature owns its published contract and presentation declarations. Compatible
replacements preserve those interfaces; a breaking replacement also needs updated
consumers. The platform does not promise arbitrary UI for an unknown data type.

Market-data supplies canonical widgets with its financial backend, tools, skills
and presets. Connector packages may supply widgets for their own deliberately
exported operations. Users can build general or provider-specific pages, or mix
both. Both kinds of widget reuse the public UI library and SDK. A canonical widget
can also pin a supported source series; that is separate from selecting a
provider-specific widget with specialist semantics.

Features own widget entry points, input contracts, data bindings and explicitly
exported assets. Desk owns generic hosting, layout and protected delivery. Shared
library source may be built separately, but installing the feature supplies its
widget contributions without editing or rebuilding Desk. Native declarations are
the authority; a frontend cache of loaded modules is not another plugin inventory.
See [ADR 0032](0032-local-widget-sdk.md) for trusted modules, shared dependencies
and the separate legacy HTML path.

## Consequences

Market data is the first implementation of this convention. Its canonical
identity, preferred/pinned selection, financial semantics and connector boundaries
remain unchanged. Specialist operations remain available without pretending to be
standard financial observations.

Native plugins are trusted local code. Cheap containment checks protect copied
payloads, browser assets, credentials and operation ownership, but this is not an
OS sandbox or a guarantee that arbitrary installed Python is safe.

The foundation PR packages backend operations and the financial skill. The
dependent Desk/widget increment supplies presentation exports and consumes them
through the same protected boundary. Those delivery steps must not be described
as already installed widgets in the backend-only payload.

See [plugin authoring](../architecture/plugins.md) for the implemented package
layout, APIs and verification boundaries.

## Rejected alternatives

Separate plugin capability inventories, an independent widget installation
registry, per-plugin bearer checks and per-refresh CLI processes duplicate native
or platform ownership. Treating every bundled plugin as mandatory disregards user
choices. Overwriting edited copies makes replacement nominal rather than usable.
Moving all TypeScript and UI source into a Python package would obscure build
ownership without fixing any of these lifecycle problems.
Permanently special-casing market widget names in Desk would make replacement
incomplete. Requiring each provider to copy the standard widgets would undermine
both shared financial interfaces and UI reuse.
