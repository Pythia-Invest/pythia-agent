# 0045: Plugin platform interface v1

**Status.** Accepted (2026-09-29). Implemented for core, market-data and
Hyperliquid. The other bundled connectors follow when the connector toolkit
moves into core.

## Context

[ADR 0044](0044-product-direction.md) ruling 6 says plugins use a small Pythia
platform interface and do not import harness internals. Roadmap stage 0 opens
with "Keep plugins independent of harness internals".

Until now a plugin found Pythia core by walking the pinned Hermes plugin
manager's private table (`get_plugin_manager()._plugins`) and importing modules
from the namespace Hermes had loaded core under. Market-data did this in its
`_platform.py`, and Hyperliquid and nine connectors repeated it.
[The Hermes contract](../../runtime/contracts/hermes.md) prescribed the pattern:
dependency helpers came from the manager's loaded module namespace, and
connectors were not to "invent import aliases or source loaders". Core's own
private reads of the manager were spread over four files.

Every plugin that copied the pattern tied itself to a private Hermes structure,
and a new plugin, such as the stage 0 DeFi source, had no supported way to
reach core.

## Ruling

- **Core publishes one module, `pythia_platform`.** At the end of its
  `register(ctx)`, core binds `sys.modules["pythia_platform"]` to its flat
  module `core/platform/v1.py`, and it registers `ctx.on_unload` to remove the
  binding. Every registration rebinds, so a reload never leaves a stale alias.
- **A plugin imports it inside its own `register(ctx)`.** It declares
  `requires_plugins: [pythia]`, so Hermes runs core's `register()` first. It then
  runs `import pythia_platform as platform` and `platform.require(1)`. While core
  is missing, disabled or failed to register, the import raises
  `ModuleNotFoundError`, and the plugin reports that it requires Pythia core.
- **v1 is what plugins already used, and nothing new:**
  - `API_VERSION` and `require`;
  - the modules `access`, `admission`, `configuration`, `request_context` and
    `subscription`;
  - `declare_operation`, `register_read_command`, `register_agent_tool`,
    `register_widget_presentation` and `read_bundled_asset`;
  - `price_sources`, `check_read`, `read_document` and `validate_live_market`.
- **Versioning is one integer.** Names are only added within a version. Removing
  a name or changing its meaning makes version 2. A plugin that needs a later
  addition checks for it with `hasattr`. `__all__` lists the surface, and a test
  freezes it.
- **The module is flat, not a package.** `from pythia_platform import access`
  works. `import pythia_platform.access` fails with "not a package" instead of
  loading a second copy of core's files.
- **Core's private reads of Hermes live in one file,
  `core/platform/harness.py`.** Core still has no public way to list the loaded
  plugins or find a tool's actual owner at the pin, so it reads `_plugins` and
  `_registration_order` there and nowhere else.
- **`tooling/check-boundaries.mjs` enforces this in `just check`.** Under
  `runtime/managed/plugins/`, a Python file may not import a Hermes module, read
  the plugin manager, or import a computed module name. Under
  `runtime/managed/core/`, only `harness.py` may read the plugin manager.

### This overrides the Hermes contract's "no import aliases" rule

This ADR overrides the rule in `runtime/contracts/hermes.md` that dependency
helpers come from the pinned manager's loaded module namespace and that
connectors must not "invent import aliases or source loaders". Publishing
`sys.modules["pythia_platform"]` is such an alias. The override follows from ADR
0044 ruling 6 ("Plugins use a small Pythia platform interface and do not import
harness internals") and the stage 0 clause "Keep plugins independent of harness
internals": the old rule required every plugin to read Hermes's private plugin
table. The contract now describes this one alias and still rules out any other.

## Consequences

- **What stays coupled to Hermes on purpose.** Core is a Hermes plugin
  ([ADR 0034](0034-core-and-optional-features.md)). Operations remain Hermes tools
  with `$comment` declarations ([ADR 0033](0033-native-feature-packages.md)).
  Plugins keep the public `ctx`: `register_tool`, `register_skill`,
  `register_cli_command`, `on_unload` and `plugin.yaml`. Core's ordinary Hermes
  imports, such as `tools.registry`, are unchanged. A single adapter for them is
  still planned, not built.
- **One core per process** remains the invariant. The interface adds no support
  for several Hermes homes in one process.
- **A Hermes pin bump** now requires rechecking `harness.py` and core's public
  Hermes imports. If load ordering by `requires_plugins` changed, the assembled
  qualification would fail on `import pythia_platform`.
- **An edited core kept from before v1** does not publish the interface. Updated
  plugins then refuse to register until the investor reconciles that core.
- **Temporary exceptions.** Market-data's connector toolkit (`wire`,
  `connector`, `process` and the rest) still lives in market-data. Until it
  moves into core, the nine bundled connectors reach it through the plugin
  manager, and market-data still imports `tools.registry`, `tools.interrupt` and
  `gateway.session_context`. The boundary check lists exactly those files, and
  it fails when a listed file no longer needs its exception, so the list only
  shrinks. The toolkit move empties it and adds v1 names for market-data's
  remaining Hermes needs.

## Rejected alternatives

- **A package on `PYTHONPATH`, or a `.pth` file in Hermes's environment.** Python
  would load core's files a second time under another name, so module state such
  as `identity_ops.CURRENT` and the connector budgets would split from Hermes's
  loaded copy. It would also read the checkout while Hermes runs the profile's
  copy, which the investor may have edited, and plugins are never installed as
  Python packages.
- **Importing `hermes_plugins.pythia`.** That name, and its `__home_<digest>`
  suffix when two homes share a process, are Hermes's own naming.
- **Hermes events, or a provide and require lookup between plugins.** Either is
  a capability registry, which AGENTS.md rules out.
- **Semver ranges, or the manifest's `api_version` and `version_range`.** The
  pinned Hermes parses `version_range` but never enforces it. One integer with
  additive changes is enough.
- **Wrapping `ctx.register_tool` and `$comment` behind `pythia_platform`.** That
  prepares a harness replacement that is not a stage 0 goal.
- **Routing core's ordinary Hermes imports through the adapter now.** ADR 0033
  accepts them. Only the private reads move.
