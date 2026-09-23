# 0036: Replaceable Desk top bar

## Context

Features need to supply a complete Desk header while users keep the ability to
replace it locally. The existing native plugin widget declaration, compiler and
host already deliver trusted React modules without a Desk rebuild. A separate
slot registry or editor would duplicate those owners.

## Ruling

The whole top bar is one native module contribution with input contract
`pythia.desk-topbar.v1`, using the existing `WidgetProps<TopBarContext>` envelope.
`desk/top-bar.json` in the user-owned workspace selects `{plugin, presentation}`
and JSON settings. The native declaration determines the presentation's asset;
users do not duplicate that association in configuration. A missing file uses the
product default;
explicit `renderer: null` selects the core header. Invalid configuration remains
untouched and restores a visible core fallback. The initial product default is
the existing title, chat filter, shortcut and navigation actions.

Desk reads the selection through its existing checked workspace storage, validates
the native declaration and asset, and loads it through `WidgetHost`. It rechecks
selection and current native authority every 15 seconds while active and on window
focus. Native settings mutations withdraw the contribution while native restart
and readback run. Missing, disabled, incompatible and crashing contributions
retain core title, search and navigation controls. Module cache entries cache code
only, never permission. Replacement or withdrawal cancels host transport demand.

Native widget metadata retains only hashes and byte counts for unchanged assets,
bounded by the plugin's declared asset set. Each request still opens and validates
the current file; edits, replacements or missing files invalidate reuse. Content
reads remain fresh and native access checks run on every operation. This keeps
the periodic recheck inexpensive without adding filesystem watchers or caching
permission decisions.

The SDK's base component props parameterize data, display options and settings;
they have no financial defaults. Financial presentations explicitly select their
own types. Generic protected transport types are separate from top-bar context.
The context supplies generic title/query controls, actions, available native chat
summaries, `openChat`, and `prepareChat`. Preparation preserves existing unsent
text and never sends a message. No domain identity or market-data helper belongs
in this context. Feature components and source dependencies can be bundled into a
top-bar artifact by the existing compiler. React, shared UI and supported TanStack
hooks bind to Desk's actual runtime and query context. The SDK Popover portal
propagates widget style scope; shared UI retains popup behavior and accessibility.

Read and update transport remain strictly read-only. A separate explicit
`/api/data/invoke` mutation route accepts only deliberate native plugin operation
exports. It uses ordinary admission, JSON/CSRF checks, bounded request bytes and
deadlines. Native ownership, enablement, schema and tool permissions still decide
whether an operation may run. It is not an arbitrary tool gateway. Mutations belong
in deliberate user actions. Feature query keys use `['plugin', pluginId, ...]` so
native settings changes can withdraw cached feature data generically.

## Rationale and consequences

One existing module system serves supplied and community top bars. Users edit an
ordinary file and explicitly compile their module; application builds and runtime
compilation are unnecessary. No additional store, regions, layout editor,
dependency resolver or registry is introduced. Current chat summaries remain a
bounded list, not a promise of global history search. Plugins remain trusted
frontend code with Desk-origin access, so server permissions remain mechanical.

Source imports are build dependencies: component code is bundled into the artifact.
Native `requires_plugins` remains the backend package load-order declaration; it
neither installs dependencies nor makes a disabled operation available. Consumers
must display an unavailable state when their operation dependency is denied.

## Rejected alternatives

Configurable header regions and a layout editor add competing layout ownership.
Direct component imports into Desk require rebuilding it for every custom header.
Runtime cross-plugin component resolution duplicates ordinary source bundling.
Bundling TanStack Query would create a second cache context. Calling arbitrary
native tools or weakening automatic read-only requests would widen authority.
