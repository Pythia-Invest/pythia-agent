# Developing a Pythia feature plugin

A feature is a Hermes-native plugin. Market data is supplied by default; an
optional Pythia-supported or community feature uses the same package boundary.
There is no separate Pythia plugin inventory. Native Hermes discovers the selected
package and controls whether it is enabled in the profile.

Pythia's host support lives separately in `runtime/managed/core/`. It still uses
the native Hermes extension hook under the `pythia` identity; `plugins/` contains
the pluggable features and connectors. Core supplies operating guidance, Desk
context, shared transport and the investment identity backbone, not
provider-specific research tools. A plugin that serves investment data declares
what it can address and serve in a static `contract.json`
([ADR 0038](../decisions/0038-plugin-addressing-contract.md)) and is onboarded
through the [source onboarding](source-onboarding.md) stages; see
[Declaring data concepts](#declaring-data-concepts-contractjson) below and
[ADR 0034](../decisions/0034-core-and-optional-features.md).

The package owns its tools, domain implementation, bundled skills and explicitly
exposed operations. Presentation assets and presets belong with the feature when
it supplies them. Shared contracts, the widget SDK and reusable UI primitives are
dependencies, not competing feature installations.

## Widgets belong to the supplying feature

Market-data supplies standard widgets backed by canonical financial operations.
Connectors may supply specialist widgets backed by their own declared operations.
Both reuse the public widget SDK and UI components, and users may mix them on one
page. A canonical widget can follow core's source order or pin a compatible series;
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
A payload's `files` are copied into the profile. Its optional `workers` name
connector workers under `runtime/managed/runner/` that run in place from the
checkout: TypeScript workers compile through `build:runtime`, other workers
(for example Python) run as source. Never list a worker in `files`.
Community packages do not need to be added to those release lists: install them
through Hermes's supported local plugin mechanism.

At the pinned release, `requires_plugins` orders loading and reports missing
dependencies; it does not install them or enforce compatibility. A feature that
uses Pythia's helpers checks the interface version before registering, as
[the platform interface](#the-platform-interface) shows. Likewise, declaring
Python dependencies does not silently install packages. Keep supported
dependencies in the existing explicit preparation path.

Pythia updates a copied package only while its content is still managed. An edited
or replaced package is user-owned and is preserved. An unrecognized pre-existing
directory is not automatically adopted. Preserve the native plugin identity when
replacing an implementation intended to serve existing consumers, and preserve
its contracts unless those consumers are changed together.

### Paused is not disabled

Two switches turn a data source off. They differ in who owns them and when they
take effect.

- **Disabled** is Hermes's (`hermes plugins disable <plugin>`). Hermes stops
  loading the plugin and the change needs a restart. A plugin Hermes does not
  run cannot be listed or switched in Desk: add it with `hermes plugins enable
  <plugin>` and restart Hermes.
- **Paused** is Pythia's. The switch beside each source in Settings → Data
  sources keeps the plugin's key in `pythia_paused_plugins` in `settings.json`
  (Pythia config folder). Desk's settings service writes it and core reads it on
  every use, so a pause and an unpause apply on the next read: no restart and,
  to undo it, no sync.

For data, a paused plugin is a disabled one, through the same paths:
`identity_ops.installed()` reports it with `enabled` false (and `paused` true),
so it leaves source selection, price routing, search, ingest and sync, and what
it states about a subject stops deciding anything on pages. `eligible_tools`,
and so `may_run` and every plugin operation over HTTP, leave its tools out; its
agent tool answers `paused` and names the switch. Its subjects and the saved
references to them keep resolving, and the page says "From X, which is paused".
Nothing is deleted, and Hermes still loads the plugin; core just stops calling
it.

Only a plugin that ships a `contract.json` and that Hermes has enabled can be
paused: core and the feature backends never are, and a plugin Hermes disabled
stays disabled whatever the list says. Every such plugin has a switch, a price
or filings source as much as a catalogue. `identity-plugin-effect` states,
before the switch is turned off, how many subjects only that source supplies and
how many saved items name them, and which concepts it serves (prices, filings,
news), which other sources take over where configured
([ADR 0037](../decisions/0037-identity-backbone.md), amendment "pausing a
plugin").

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

## The platform interface

A plugin reaches Pythia core only through `pythia_platform`, a small versioned
module that core publishes when it registers
([ADR 0045](../decisions/0045-plugin-platform-interface.md)). Declare
`requires_plugins: [pythia]` and import it inside `register(ctx)`, where Hermes has
already registered core:

```python
def register(ctx):
    import pythia_platform as platform  # ModuleNotFoundError: Pythia core is not enabled
    platform.require(1)
```

Version 1 holds `declare_operation`, `register_read_command`,
`register_agent_tool`, `register_widget_presentation`, `price_sources`,
`check_read`, `read_document`, `validate_live_market` and `FilingKind`; the
[connector toolkit](connector-support.md) as `connector`, `wire` and `process`;
the modules `configuration`, `access`, `admission`, `request_context` and
`subscription`; and, for a plugin that coordinates other plugins' reads,
`tool_schemas`, `dispatch`, `interrupted`, `session` and `session_platform`. An
exported module offers only the members ADR 0045 lists. A version only gains
names; check a later addition with `hasattr`. Import names from the module
(`from pythia_platform import configuration`), not submodules: it is not a
package.

Plugins do not import Hermes modules, read Hermes's plugin manager or import
anything dynamically (`importlib`, `import_module`, `__import__`,
`sys.modules`), so no plugin loads another plugin's modules. `just check`
enforces this for the bundled plugins, with no exceptions. A connector therefore
needs only `requires_plugins: [pythia]`.

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
always require read-only support. A mixed operation may still expose explicitly
requested changes to authorized callers, while an automatically refreshed widget
cannot invoke that mutation. Authors must not
label an operation read-only if it performs user-directed mutations.

For coordinated financial data, use core's connector toolkit
(`pythia_platform.connector`) instead of copying this demonstration's handler.
`pythia_platform` also exports `declare_operation` for code that needs
declaration helpers and handler-bound coordination hooks; neither mechanism
creates another inventory.

## Reaching the agent

Core's tools read a plugin's contract concepts (quote, chart, filings) for the
agent. For provider depth, such as reported figures, profiles or news, a data
plugin offers its own provider tools. Register the operation tool as usual in
core's hidden `pythia-core` toolset, then expose it:

```python
platform.register_agent_tool(ctx, "example_summary", "example_research_summary",
    "Research summary of a company from Example. Use it for Example's own view; "
    "pythia_instrument lists what other sources hold.")
```

The agent tool lands in a toolset named after your plugin, so Hermes offers it
directly or behind Tool Search like any plugin or MCP tool. Its schema is your
operation's parameters without Pythia's markers. `native_ref`, or the parameter
named after your native scope, becomes `subject_id`, and core fills it with the
reference the Desk page uses. Only an operation declared `read_only: true`
runs, through `may_run`, and the result is bounded. Name the tool
`<source>_<what>`, and start its description with what the investor gets and
from which provider, in at most 60 characters.
[Agent tools](agent-tools.md) owns the placement rule and the naming
convention. The [source onboarding standard](source-onboarding.md) covers how a
new source earns its place.

## Plugin configuration

A plugin that needs a credential or a provider contact ships a static
`configuration.json` beside `plugin.yaml`. Core reads it on each use without
running plugin code:

```json
{
  "schema_version": 1,
  "fields": [
    {"key": "sec_identity", "kind": "identity", "label": "SEC contact",
     "description": "Your name and email address, sent as the SEC User-Agent.",
     "url": "https://www.sec.gov/os/accessing-edgar-data", "required": true},
    {"key": "openfigi_api_key", "kind": "secret", "label": "OpenFIGI API key"}
  ]
}
```

- `key` matches `^[a-z][a-z0-9_]{2,63}$` and names the field in the store.
  Reuse an existing name, such as `eodhd_api_token`, so saved values keep
  working. `schema_version` and keys starting with `hermes_` or `pythia_` are
  reserved; core's `configuration.RESERVED` and `RESERVED_PREFIXES` are the
  only lists.
- `kind` is `secret`, stored in `secrets.json`, or `identity`, one line of text
  stored in `settings.json`.
- `label` (at most 80 characters) is required. `description` (at most 400),
  `url` (an `https` page on obtaining the value) and `required` (default
  `false`) are optional.
- A bundled plugin lists `configuration.json` among its copied files in
  `scripts/dev/managed-plugins.mjs`.

Until a settings interface exists, the investor edits the files in the Pythia
config folder, `${XDG_CONFIG_HOME:-~/.config}/pythia`, adding top-level fields
(create `settings.json` if absent) and keeping `schema_version: 1` and every existing field:

```json
{"schema_version": 1, "hermes_api_key": "<keep unchanged>", "openfigi_api_key": "<your key>"}
```

Both files must be mode `0600`; a file readable by others is reported as
invalid and never read. Values are read on each use, without a restart. Core
rejects control characters and surrounding spaces, and for a secret also inner
whitespace and more than 512 characters. Provider-specific format rules belong
to the plugin that uses the value.

Plugin code calls `platform.configuration.value(ctx, key)`. It returns
`(status, value)` with status `configured`, `missing` or `invalid`, and raises
`ValueError` for a key the plugin does not declare. The value is present only
when configured; never log, return or forward it. A tool that depends on
required fields checks them first:

```python
blocked = platform.configuration.needs_configuration(ctx)
if blocked is not None:
    return json.dumps(blocked)
```

The result is the standard error envelope with one `needs_configuration` issue
whose `fields` list `{key, label, file, status}` for each unmet field, so the
agent can tell the investor what to set. `platform.configuration.missing(ctx)`
returns the same list. Neither contains a value.

Declared keys name store fields; they are not a security boundary. Plugins run
in-process and any plugin may declare any non-reserved key; sharing a key such
as `eodhd_api_token` is how plugins share one value. Enable only plugins you
trust.

Rejected: a Desk-owned field allowlist (a Desk change per provider), a settings
UI or writer in the POC, and a block in Hermes's `plugin.yaml` (Hermes owns that
schema). Hermes `requires_env` and `.env` custody were rejected because they
keep provider secrets in the Hermes environment instead of Pythia custody.

## Declaring data concepts (`contract.json`)

Core owns the data concepts (`market_data`, `profile`, `filings`, `news`,
and later `fundamentals` and `estimates`), their operations and the qualities a
plugin may claim ([ADR 0040](../decisions/0040-data-concepts-and-agent-tools.md)).
A plugin that serves one declares it in `contract.json` version 2, beside its
addressing (the full shape is in the ADR 0038 amendments; core still reads
version 1):

```json
"concepts": {
  "market_data": {
    "level": "listing", "via": "listing",
    "operations": {"quote": "latest", "intraday": "history", "daily": "history"},
    "coverage": {"asset_classes": ["equity"]},
    "qualities": {"quote": {"delay": "delayed"}, "daily": {"adjustment": ["none", "split_dividend"]}}
  }
},
"rights": {"licence": "personal", "cache": "unlimited", "hostable": false}
```

- Operations name the plugin's own operations (its HTTP operation or
  market-data contribution names), never Hermes tools.
- Coverage decides where the source can serve: selection drops a source whose
  coverage excludes the subject, so investors never configure it. Declare
  honestly; qualities are claims, not proof of an account's entitlements.
- A filings source lists the `authorities` it serves (`sec`, `fca`, `sedar`,
  and `oam-<country>` per EEA national mechanism); core combines one source per
  authority. Its rows tag each filing's `kind` from core's vocabulary.
- A market-wide concept (`market_movers`) is about no subject, so its entry
  names `operations` only, without `level` or `via`:
  `"market_movers": {"operations": {"gainers": "movers", "losers": "movers"}}`.
- `rights` states the licence class, how long data may stay on the device,
  whether it may be published (false for provider data) and any attribution
  the provider requires. `limits` may state the provider's published rate
  limits for a named plan.
- `signoff` states where the source stands in [onboarding](source-onboarding.md):
  `{"status": "unsigned"}` for a new source, `grandfathered` for the sources
  ADR 0042 lists, and `signed_off` with the `record` that shows it
  (`docs/sources/<source>.md` or an https link). The field records Pythia's
  own audit and changes nothing in code: an enabled plugin works the same
  whatever it declares ([below](#installing-a-plugin-means-trusting-it)). An
  unsigned source ships off in fresh profiles as a product default.
- `coverage.operations` narrows coverage for one operation, for example a
  live stream that covers fewer markets than the provider's history.
- A `live` operation returns core's `live_market` snapshot
  (`identity.validate_live_market`).
- A subject kind outside the instrument hierarchy, such as a `market` (a perp),
  is addressed as itself: `level` and `via` are both `market`, with a native
  scope at level `market` ([ADR 0043](../decisions/0043-live-market-view.md)).
- `addressing.subjects` gives the plugin's own reference for a subject core
  keys: a maintained index, pair, perp or crypto asset
  (`"index:pythia:sp500": {"native_scope": "symbol", "native_id": "^GSPC"}`).
  Core's maintained tables (`markets.json`, `canonical_assets.json`) list the
  subjects and name no provider. The address is confirmed, and the plugin's
  provisional ID for that reference aliases to the subject. A coin plugin also
  maps its own chain ids to CAIP-2 chains in `addressing.chain_codes`.
- `introduces` names the kinds of subject the plugin may add and the key
  schemes their IDs use: an open scheme registered for the kind, or `native`,
  its own reference in a native scope at that kind
  (`"introduces": {"market": ["native"], "listing": ["caip19"]}`). A `native`
  scope must name a permanent reference the provider never reuses, because
  the reference becomes the subject's ID. A record of a
  kind outside the hierarchy is keyed by its native reference alone, and a
  relation claim may name the plugin's own declared references
  ([ADR 0038](../decisions/0038-plugin-addressing-contract.md), amendment
  "contract version 2"). While the plugin is enabled, its subjects appear in
  search with its label (core's name for its provider, `LABELS` in
  `identity/page.py`, else the provider id, so a bundled plugin adds its entry)
  and rank like any other; a record's `rank` signals in
  US dollars (keys ending `_usd`, such as `market_cap_usd` or `tvl_usd`) set
  their notability. A line under a known security takes the security's kind.
  A subject its source marks inactive is found too, flagged delisted and ranked
  below live ones. Search never calls a plugin: any plugin that declares a
  `resolve` (not only OpenFIGI) gets a generic lookup form on its own row in Settings → Data → Data sources
  (an identifier in, how the records it stored were placed out;
  `identity-lookup`), not a button in search
  ([ADR 0044](../decisions/0044-product-direction.md), amendment of
  2026-09-30 "search is local data only").
- A bulk `catalogue` operation takes `{"scope", "cursor"}` and answers
  `{"data": <ClaimBatch>, "next_cursor"}`, the last page of a scope `complete`
  with no cursor. Core reads it through `identity-sync`, a Desk operation with
  no scheduler (Settings → Data → Data sources, "Sync now"), scope by scope in the
  order the contract lists them, so a
  scope may name what an earlier one introduced. Core joins or introduces
  every record, and a record with no native reference (a token named only by
  CAIP-19) is kept by its identifiers
  ([ADR 0038](../decisions/0038-plugin-addressing-contract.md), amendment
  "core dispatches catalogue and resolve"). Plugins may sync in any order: a
  relation whose end no subject names yet (a market that points at a token
  another plugin introduces) waits and is placed when one does, and a subject
  several plugins state is named by the one first in the investor's
  `source_order`, else by plugin id, never by who arrived first.
- A record's `currency` is the one the line trades in as the source states it,
  and core compares it as stated: a GBX record never joins the GBP line by ISIN,
  exchange and currency, so name such a line by its FIGI as well. A record
  that states no currency joins by ISIN only where its exchange holds exactly
  one of the security's lines. A receipt's line states the share's ISIN as
  `underlying`, never `self`: a `self` ISIN names the share.
- A `resolve` answer's records mark each identifier's `role`: `self` names the
  record itself, `underlying` its underlying and `unqualified` a value the
  source cannot place. On a crypto asset record, `self` on a CAIP-19 claims
  canonical issuance and a provider's platform list is `unqualified`; core
  refuses a batch whose asset record leaves a CAIP-19's role out
  ([ADR 0037](../decisions/0037-identity-backbone.md)).
- A filings source may accept `forms` in its filings operation's schema; core
  then passes the requested forms so the source can search beyond its most
  recent filings.

- A source that is asked about a subject it does not cover answers only
  `{"outcome": "empty", "data": null, "issues": [{"code": "not_covered",
  "severity": "warning", "message": "…"}]}`. That is not an error: core reads
  the next eligible source instead. Only this whole answer counts: data, a
  `partial` or `ok` outcome, or an error never gives way. Use it only where the
  source's answer says so unambiguously (filings.xbrl.org: the entity is not in
  the repository); a failure, an outage or an empty period stays what it is.
- A `news` `list` operation takes `native_ref` (and `limit` if it pages) and
  lists items under `data.news`, each with `title`, `url`, `published_at`
  (ISO) and, where the source states them, `id`, `publisher` and `language`.

Selection is core's: the investor's one `source_order` (settings.json), then
core's default order, free sources first; a source whose coverage excludes the
subject, or that is unconfigured, is skipped with its reason. How sources
combine follows the data's shape: filings take one source per declared
authority into core's `filings` read; news from every eligible source merge
into one feed in core's `news` read; single values (estimates, statements)
stand side by side, one row per source, with a read and row shape that arrive
with their first source's onboarding; prices come from one source per view.
Adding a source to a concept core reads needs no core change: declaring the
concept is enough.

Core validates the file with `identity.validate_manifest`; a contract newer
than the installed Pythia shows as `needs_update`. A bundled plugin lists
`contract.json` among its copied files in `scripts/dev/managed-plugins.mjs`.

### Installing a plugin means trusting it

There are no trust levels ([ADR 0044](../decisions/0044-product-direction.md),
amendment of 2026-09-30). Every enabled plugin is equal, whether Pythia ships
it, a community wrote it, or it is a byte-identical copy under another name.
Core never asks who a plugin is or which files it holds.

- **Any enabled plugin** can introduce subjects under the key schemes its
  contract declares, contribute evidence about existing ones, bind its records
  to a reference or device subject, and alias its provisional IDs. Its evidence
  counts like the reference package's.
- **Disagreement is a conflict.** When different plugins or sources state
  different values of a single-valued identifier, both values are kept, neither
  applies, and a question is asked when the subject is touched. The user's
  answer is a local override. One source's several values are no conflict, and
  neither are several sources stating the same values.
- **Disabling a plugin** keeps what it stated on the device, shown with its
  source: its subjects keep their labels and identifiers and open by ID, and
  what it stated no longer proves, blocks or contests while it is off.
- **`signoff` in `contract.json`** is Pythia's record of its audit, for readers.
  No code reads it. A plugin that is off in fresh profiles (DeFiLlama,
  NAVI, Hyperliquid, NSM) is a product default, not a level.
- **There is no protection from a buggy or malicious plugin** other than
  disabling it or answering the conflicts it raises. The user trusts what they
  install. Isolating plugin code stays required before an open marketplace.

### Correcting your own source

A plugin that knows its own source is wrong in a record states the corrected
value and keeps what the source said ([ADR 0044](../decisions/0044-product-direction.md),
amendment "a source adapter corrects its own source"). The record carries it in
`attributes.source_corrections`, a list of `SourceCorrection` with three fields: the
`field` (an identifier scheme the record states as `self`, or a descriptive
attribute it states), the `original` (the source's own text, exactly, so it can be
reported) and the `reason` (what is wrong and the evidence, at most 400
characters). The record's own identifier or attribute holds the corrected value.
Core refuses a correction of a field the record does not state, an original equal
to the stated value, a second correction of one field, or more than eight.

- **Only your own source's data.** A correction states that your provider's record
  is wrong. It never changes another plugin's or the reference's statement; if their
  value is wrong, report it to their owner. A misread of your source is a bug to fix
  in the plugin, not a correction.
- **Only while the source still states the original.** Compare the raw value with
  the original before applying the fix, and pass the raw value through once the
  source has fixed it; the entry is then stale and is deleted. The plugin does this
  in its own code; core cannot see the source, so it cannot check. The reference
  builder does it with its own `source_corrections.Table`, which counts applied,
  stale and absent entries in the build report.
- **It stays the source's statement.** The authority is unchanged (`source_asserted`);
  a correction earns no extra weight, and a conflict with another source is raised as
  before. Keep a list of what you corrected, and report each to the source, in the
  plugin's documentation (`docs/sources/<source>.md` for Pythia's own).
- **Nothing to register.** Core stores the record as emitted. The instrument page
  lists each correction with its original (`source_corrected`), and
  [identity data](identity-data.md) gives the query that lists them all.

The investor's own fix of a value is a different thing, a catalogue correction on
their device ([ADR 0044](../decisions/0044-product-direction.md), amendment "user
catalogue corrections"): it overrides every source, and it is not a plugin's statement.

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
