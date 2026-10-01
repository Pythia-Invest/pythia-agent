# 0045: Plugin platform interface v1

**Status.** Accepted (2026-09-29). Implemented for core and every bundled
plugin. The connector toolkit moved into core on 2026-09-30, and each connector
now depends on core alone.

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
  `ModuleNotFoundError: No module named 'pythia_platform'`. The plugin adds no
  message of its own: Hermes records that error as the plugin's load failure.
- **v1 is what plugins use, and nothing more:**
  - `API_VERSION` and `require`;
  - `declare_operation`, `register_read_command`, `register_agent_tool` and
    `register_widget_presentation`;
  - `price_sources`, `check_read`, `read_document`, `validate_live_market` and
    the vocabulary `FilingKind`;
  - the modules `access`, `admission`, `configuration`, `request_context` and
    `subscription`;
  - the connector toolkit: the modules `connector`, `wire` and `process`;
  - `identifiers`, core's identifier forms (added for the Sui experiment, [ADR 0048](0048-sui-defi-experiment.md));
  - for a plugin that coordinates other plugins' reads (market-data), five
    wrappers of Hermes's public API: `tool_schemas`, `dispatch`, `interrupted`,
    `session` and `session_platform`.
- **An exported module offers only its frozen members.** v1 exports a view of
  each module, not the module, and a member outside the list raises
  `AttributeError`, so core's other contents, such as `access.native_tool_owners`
  and its Hermes plugin objects, stay private. The frozen members are:
  - `access`: `ContextUnavailable`, `eligible_tools`, `native_access_scope`,
    `owned_tools`;
  - `admission`: `AdmissionError`;
  - `configuration`: `value`, `needs_configuration`;
  - `request_context`: `cancel_signal`, `cancelled`, `usage`;
  - `subscription`: `Subscription`;
  - `connector`: `WorkerReads`, `SourceFailure`, `qualify_failure`,
    `NativeBatch`, `worker_batch`, `worker_item`, `ResidentTransport`,
    `Transport`, `connection`, `failed_item`, `detail`, `item_failures`,
    `qualify_items`, `worker_failure`, `emit`, `ReadCache`,
    `ReadCancelled`, `parallel`, `StreamingWorker`, `retry_after`;
  - `wire`: `WireError`, `require`, `validate`, `validate_parameters`,
    `validate_read_result`, `parameter_schema`, `CRITERIA`;
  - `process`: `run_worker`, `WorkerError`;
  - `identifiers`: `normalize_identifier`, `IdentifierError` and `sui_caip19`. A
    plugin states an identifier in the form core joins on (a Sui coin type as
    CAIP-19, a Sui package or object ID in 64-digit lowercase form), rather than
    copying core's profile (ADR 0037). `sui_caip19(coin_type)` is a Sui coin
    type's key, or None where core gives none (a generic type, or one past
    CAIP-19's 128 characters). It is the one name beyond the general ones: the
    three plugins that key Sui coins each held the same seven lines, and the
    profile is core's.
- **Versioning is one integer.** Names and members are only added within a
  version. Removing either or changing its meaning makes version 2. A plugin
  that needs a later addition checks for it with `hasattr`. `__all__` and the
  member lists are the surface, and a test freezes both.
- **The module is flat, not a package.** `from pythia_platform import access`
  works. `import pythia_platform.access` fails with "not a package" instead of
  loading a second copy of core's files.
- **One core serves a process.** While another core's interface is still
  published, `publish` raises instead of rebinding, and unloading a core
  removes the binding only if it is still that core's.
- **Core's reads of the plugin manager's private state live in one file,
  `core/platform/harness.py`.** Core still has no public way to find a tool's
  actual owner at the pin, so it reads `_plugins` and `_registration_order`
  there and nowhere else. Core also uses two other private Hermes seams, each
  in the one file that needs it: `model_tools._clear_tool_defs_cache` in
  `core/platform/access.py`, before it computes the tools a caller may run, and
  the API server adapter's `_expected_api_key` and `_check_auth` in
  `core/platform/http.py`, which authenticate the protected HTTP adapter.
- **The connector toolkit is core's.** Bounded worker and HTTPS reads, budgets,
  caching, batching, safe failures, logging and the market-data wire contract
  live in `core/platform/connector/`. [ADR 0033](0033-native-feature-packages.md)
  already gives platform support bounded execution and cleanup, and every
  connector needs them whether or not it contributes prices. A connector
  declares `requires_plugins: [pythia]` and nothing else. Market-data keeps the
  financial backend, its tool, reads, selection, delivery and widgets.
- **`tooling/check-boundaries.mjs` enforces this in `just check`, with no
  exceptions.** Under `runtime/managed/plugins/`, a Python file may not import
  a Hermes module: any `hermes_*` module or one of the pinned Hermes's other
  top-level packages and modules, also in a comma-separated or
  backslash-continued import or after `;` or `:`. It may not read the plugin
  manager or import dynamically: `importlib`, `import_module`, `__import__` and
  `sys.modules` all fail, as do `from sys import modules` and an aliased `sys`.
  Under `runtime/managed/core/`, only `harness.py` may read the plugin
  manager, and each of the other two seams stays in its file. The check is a
  line scan of known patterns, not a sandbox.

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
- **A Hermes pin bump** now requires rechecking `harness.py`, the two other
  private seams in `access.py` and `http.py`, and core's public Hermes imports.
  If load ordering by `requires_plugins` changed, the assembled qualification
  would fail on `import pythia_platform`.
- **An edited core kept from before v1** does not publish the interface. Updated
  plugins then refuse to register until the investor reconciles that core.
- **No compatibility shim is kept.** A plugin written to the old
  `runtime/contracts/hermes.md` rule, whether user-edited or third-party, looked
  up market-data in Hermes's plugin table and imported its `wire`, `connector`
  or `process` modules. Market-data no longer holds them, so such a plugin stops
  loading until it moves to `pythia_platform`. The same holds for market-data's
  retired `credentials.py` token reader.
- **Disabling market-data no longer unloads unrelated sources.** SEC, OpenFIGI,
  GLEIF, filings.xbrl.org and NSM depend on core alone and keep serving identity
  and filings. Price connectors still register; their contributions become
  sources again when market-data is enabled.

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
- **Market-data publishing its own toolkit to connectors.** That would be a
  second platform, and connectors would still fail whenever market-data is
  disabled.
- **Exporting whole modules and freezing only the top-level names.** Every
  member of an exported module, including Hermes objects, would then be part of
  the interface by accident.
