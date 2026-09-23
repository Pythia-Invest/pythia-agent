# Developing a Pythia feature plugin

A feature is a Hermes-native plugin. Market data is supplied by default; an
optional Pythia-supported or community feature uses the same package boundary.
There is no separate Pythia plugin inventory. Native Hermes discovers the selected
package and controls whether it is enabled in the profile.

Pythia's host support lives separately in `runtime/managed/core/`. It still uses
the native Hermes extension hook under the `pythia` identity; `plugins/` contains
the pluggable features and connectors. Core supplies operating guidance, Desk
context and shared transport, not provider-specific research tools. See
[ADR 0034](../decisions/0034-core-and-optional-features.md).

The package owns its tools, domain implementation, bundled skills and explicitly
exposed operations. Presentation assets and presets belong with the feature when
it supplies them. Shared contracts, the widget SDK and reusable UI primitives are
dependencies, not competing feature installations.

## Widgets belong to the supplying feature

Market-data supplies standard widgets backed by canonical financial operations.
Connectors may supply specialist widgets backed by their own declared operations.
Both reuse the public widget SDK and UI components, and users may mix them on one
page. A canonical widget can follow source preferences or pin a compatible series;
a specialist widget remains explicitly bound to its provider operation.

Package widget entry points, input contracts, data bindings and explicit assets
with the feature. Desk supplies generic hosting and protected delivery. Source
libraries may be built separately; a feature installation supplies its frontend
contributions without editing Desk. Backend-only plugins and standalone user
renderers remain valid. The [widget decision](../decisions/0032-local-widget-sdk.md)
defines shared runtime compatibility and the trust boundary.
The [widget SDK guide](../../packages/widget-sdk/README.md) covers authoring,
building, native registration, data bindings and explicit user overrides.

## Installation, defaults and customization

Release payload lists determine which supported packages Pythia copies, and which
ones it enables when creating a fresh profile. They are build/lifecycle allowlists,
not runtime discovery. Existing profiles keep their native enablement choices.
Community packages do not need to be added to those release lists: install them
through Hermes's supported local plugin mechanism.

At the pinned release, `requires_plugins` orders loading and reports missing
dependencies; it does not install them or enforce compatibility. A feature that
uses a helper API must check that API before registering dependent functionality.
Likewise, declaring Python dependencies does not silently install packages. Keep
supported dependencies in the existing explicit preparation path.

Pythia updates a copied package only while its content is still managed. An edited
or replaced package is user-owned and is preserved. An unrecognized pre-existing
directory is not automatically adopted. Preserve the native plugin identity when
replacing an implementation intended to serve existing consumers, and preserve
its contracts unless those consumers are changed together.

## Domain and platform responsibilities

| Feature author | Shared platform |
| --- | --- |
| Meaning, schemas, native tools and result qualifications | Authenticated HTTP and trusted profile context |
| Native operation declarations | Registration ownership, enablement and applicable tool access |
| Bundled native skills | Existing Hermes skill discovery and disablement |
| Provider connection protocol and efficient requests | Credential custody and reusable bounded execution helpers |
| Supported widget exports, settings and presets | Browser host, reusable SDK and protected data transport |

Provider credentials remain on the server. An HTTP operation is an intentional
export, not permission to invoke any registered tool. New plugins use
`/v1/pythia/plugins/{plugin-id}/{operation}`; the shared updates channel addresses
the same plugin and operation. Plugins never parse bearer tokens, run their own
listener or launch Hermes for a dashboard refresh.

Native tool and HTTP entry points call the same domain implementation. A loaded
profile may retain a backend instance and coordinated requests; standalone CLI
commands have their own in-memory lifetime. Native access is checked again before
cached data or completed work is published. Feature disablement must deny its
exports without disabling unrelated features.

## A small operation export

A package starts with `plugin.yaml` and `__init__.py`. For example:

```yaml
name: example-research
version: 0.1.0
description: Example local research feature
license: Apache-2.0
requires_plugins:
  - pythia
provides_tools:
  - example_research_summary
```

An ordinary operation needs no authentication code or separate server. Its native
schema contains the deliberate export declaration:

```python
import json

def register(ctx):
    def summary(arguments, **context):
        return json.dumps({"schema_version": 1, "data": {"message": "Ready"}})

    ctx.register_tool(
        name="example_research_summary",
        toolset="example-research",
        handler=summary,
        schema={
            "name": "example_research_summary",
            "description": "Read the local research feature's summary.",
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
                "$comment": json.dumps({"pythia_http_operation": {
                    "plugin": ctx.plugin_id,
                    "operation": "summary",
                    "cache_seconds": 0,
                    "updates": False,
                    "read_only": True,
                }}),
            },
        },
    )
```

After native installation and enablement, the agent can call the tool and Desk's
server can call `POST /v1/pythia/plugins/example-research/summary` with
`{"arguments": {}}`. The existing API bearer and trusted profile apply on the
server; neither is passed to a widget. The result must be a bounded JSON object
with `schema_version: 1`; its domain data remains owned by this feature.
The declared name is not authority: the adapter verifies the actual native owner
and applicable tool enablement before execution and publication.

Automatic widget reads add `read_only: true` to the request envelope. This is a
requirement, not a grant: the backend checks the operation's declaration, or its
domain-owned classifier for a mixed operation, before dispatch. SSE resources
always require read-only support. For example, market-data's query operation can
still expose explicitly requested preference changes to authorized callers, while
an automatically refreshed widget cannot invoke that mutation. Authors must not
label an operation read-only if it performs user-directed mutations.

For coordinated financial data, use the feature's existing connector helpers
instead of copying this demonstration's handler. The loaded core also exports
`platform.declare_operation` for code that needs declaration helpers and
handler-bound coordination hooks; neither mechanism creates another inventory.

## Skills and contracts

Put feature guidance and supporting files inside the plugin. Register it with
`ctx.register_skill(name, path, description=...)`. In the pinned Hermes release,
the qualified name is `<skill_namespace-or-plugin-name>:<skill-name>`. Agents
discover these skills through `skills_list` and read them with `skill_view`;
registration does not add them to the automatic prompt index. Keep tool
descriptions concise and point to relevant guidance when the workflow needs it.

The market-data Python plugin owns financial schemas and validation. The separate
[`@pythia/market-data`](../../packages/market-data/README.md) package publishes its
portable TypeScript types and generated JSON Schema. This lets browser and server
consumers share an interface without importing Python or connector code. Updating
a contract requires checking its actual consumers; moving files is not a version
compatibility strategy.

For financial extensions, follow the [market-data owner](market-data.md) and
[connector support](connector-support.md). Ticker similarity never establishes
cross-provider identity, and a common JSON shape never establishes interchangeable
financial meaning. Standard prices/history use shared operations; specialist
features retain their declared meaning.

## Verification boundary

Qualify registration and discovery against the pinned native runtime, including
copied packages. Check enablement, profiles, malformed requests, cancellation and
cache publication at the protected boundary. Check that updates preserve edited
packages and existing choices. Use synthetic data for normal tests; enabling a
package does not establish a provider account's entitlements.

The backend foundation includes the market-data skill and operations. Concrete
connectors and the Desk/widget package integration are dependent increments; this
document does not claim that a backend-only install has already installed them.
The durable decision is [ADR 0033](../decisions/0033-native-feature-packages.md).

## Desk top bars

A feature can supply the complete Desk top bar through the existing native widget
asset declaration with `input_contract: pythia.desk-topbar.v1`. The user's workspace
`desk/top-bar.json` selects the plugin, presentation and JSON settings. The
plugin's native presentation declaration determines its compiled asset.
Community packages use the same mechanism without editing or rebuilding Desk.
The SDK exposes host controls and protected read/update/explicit-invoke transport;
Desk retains the core controls when a contribution becomes unavailable. See the
[SDK example and contract](../../packages/widget-sdk/README.md#replace-the-desk-top-bar)
and [ADR 0036](../decisions/0036-replaceable-desk-top-bar.md).
