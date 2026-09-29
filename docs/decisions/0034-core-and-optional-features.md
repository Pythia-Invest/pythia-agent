# 0034: Separate Pythia core from optional features

## Context

The singular `runtime/managed/plugin/` directory contains Pythia's core Hermes
adapter, while `plugins/` contains feature packages. The names obscure ownership.
The core also still registers the original SEC and EODHD tools, with dedicated
skills, workers, dependencies and settings controls. Those provider capabilities
belong in their own integrations rather than in the platform host.

## Ruling

Pythia-owned host support lives in `runtime/managed/core/`. Optional financial,
provider and other feature packages live in `runtime/managed/plugins/`. Core owns
Desk context, baseline operating guidance and shared protected transport; features
own their domain functionality and feature-specific skills.

Core continues to use the exact unmodified Hermes native extension mechanism.
Its installed native identity remains `pythia`, with the existing profile-local
destination and state. This is the adapter by which Pythia supplies its core to
Hermes, not another optional investment feature or an alternative plugin system.
Native access checks and existing enablement choices remain authoritative.

Remove the legacy core SEC/EODHD tools, their standalone skills, dedicated
workers, provider dependencies and settings controls. Later connector PRs must
provide and qualify their respective capabilities explicitly. No placeholder
operation, silent forwarding or replacement provider is installed here. Saved
credentials, settings, research and native user choices remain untouched.

Retain the shared connector execution helpers and the native session-context
helper. They have current consumers and do not grant arbitrary code execution.

Core lifecycle checks use the interpreter in the prepared Hermes environment.
They run as bounded processes outside the gateway, because they must work before
Hermes starts and after it stops. They do not start an agent conversation or add
packages to Hermes. Source preparation inputs live under `runtime/hermes/`.
Fresh preparation creates no separate managed Python environment and does not
export `PYTHIA_PYTHON` as a general execution environment.

Existing old Python environments remain untouched. Only legacy Basic Memory
transition and service-preservation code refers to their historical paths; those
paths do not cause a fresh environment to be installed. Core startup must not
depend on an optional research plugin. A future scripting plugin owns its
libraries, environment and guidance through native Hermes execution mechanisms.

## Consequences

Core support is recognizable in source and has no SEC/EODHD tool surface.
Financial foundations remain a feature package with no concrete provider in this
increment. Existing consumers of the retired tools lose those operations until
their respective integrations are installed; this is an intentional removal.
Historical provider contracts remain reference evidence, not current availability.

Keep this cleanup separate from financial implementation, Python quality tooling
and optional research execution environments. A future research-environment
feature may supply libraries and guidance through native Hermes execution, but
that proposal does not add an execution service or alter this PR's behavior.

## Rejected alternatives

Keeping provider tools in core would make an optional data subscription part of
the platform boundary. Adding stub connectors would disguise missing support.
Changing Hermes or adding a separate loader to avoid its native plugin mechanism
would duplicate runtime ownership. Renaming installed identities or deleting
saved provider values is unnecessary for clarifying source ownership.
Keeping an otherwise empty Python environment for one standard-library lifecycle
probe would unnecessarily couple core supervision to a former provider environment.

## Amendment (2026-09-29): Pythia's own data directory and store

[ADR 0044](0044-product-direction.md) ruling 6 puts Pythia's stores in Pythia's
own data directory, and roadmap stage 0 asks for it. This replaces "the
existing profile-local destination and state" above for core's state. Core's
native identity, `pythia`, and its copy in the profile are unchanged.

- **Location.** Core keeps `identity.sqlite3` and the installed reference
  package in `<data>/store/`. `<data>` is the per-stack data root that already
  holds the workspace: `~/.local/share/pythia` when installed and
  `~/.local/share/pythia/dev/<stack>` in development. The document cache moves
  to `<cache>/documents/`, the per-stack cache root.
- **Plumbing.** The lifecycle passes `PYTHIA_DATA_ROOT` and `PYTHIA_CACHE_ROOT`
  to Hermes. Without an absolute `PYTHIA_DATA_ROOT`, identity answers
  "unavailable" and writes nothing anywhere else. It never falls back to the
  profile or HOME. Without `PYTHIA_CACHE_ROOT`, documents are read again each
  time.
- **The move.** An earlier store sits in the core plugin's Hermes data
  directory (`<profile>/plugin-data/<core namespace>/`). The first use in a
  process moves it once, under a lock in the store directory, and never over an
  existing store.
  - The identity store is copied with SQLite's backup, checked for integrity
    and a schema version, and published only where none exists. The old file
    is then renamed `identity.moved.sqlite3`, never deleted, and `MOVED.json`
    beside it names the new place.
  - The reference moves by rename. Across file systems it is installed from the
    same package with its checksum verified, and the source is kept. The
    package keeps its name, so nothing is re-keyed.
  - An identity store that cannot be moved (unreadable, corrupt or not an
    identity store) is left as it was. Identity then stays unavailable for
    that process, with the reason in the log and in search, rather than start
    empty. The remedy is to move the file aside or recover it, then restart
    Pythia.
  - While an earlier copy is still in place beside the store (a move stopped
    after publishing, older code run again, or a reference copy kept),
    `reference-status` (shown in Settings) and the Repairs notice say that both
    are present, until the earlier copy is deleted by hand. Nothing in it is
    merged.
  - The development reference install runs the same move before it installs.
- **Purge keeps the store.** `pythia uninstall --purge` removes configuration,
  state and cache. The store holds the investor's answers and bindings, so it
  stays, like the workspace.

**Consequences.** Once moved, a Hermes upgrade no longer changes where the
store is. Operationally:

- Every kept stack must use identity once on this code before the Hermes pin
  is bumped. A new Hermes may name the plugin data directory differently, and
  the move would then not find the old store.
- Never run code from before this amendment in the same checkout afterwards.
  It starts with an empty store in the old place; the answers are still in
  `identity.moved.sqlite3`, and the new code reports both stores as present.
- The old document cache, `<plugin-data>/documents/`, is not moved and can be
  deleted by hand, like a reference copy left in the old place (logged with its
  size).

**Rejected.**
- *Moving the identity store in a lifecycle step (install or `just dev`).*
  Core owns the store and its format, and the lock makes a move on first use
  safe. A lifecycle step would have to know the schema. The development
  reference install only runs core's own reference move early.
- *Copying the identity store and keeping the original in place.* Code from
  before the move would keep writing the old file and diverge silently.
  Renaming it makes that visible and still keeps it.
- *A store under `<config>`.* Every development stack shares it, and it is
  meant for settings.
- *Falling back to the profile or HOME without a data root.* That would
  recreate state outside Pythia's directory.

## Amendment (2026-09-30): the connector toolkit is core's

The shared connector execution helpers this ADR retained lived in the
market-data feature, so every connector required market-data, and disabling it
also unloaded the identity and filings sources.
[ADR 0044](0044-product-direction.md) ruling 6 asks for plugins that use a small
Pythia platform interface.

- **Ruling.** The helpers and the market-data wire contract move into core, in
  `core/platform/connector/`, and plugins reach them through `pythia_platform`
  ([ADR 0045](0045-plugin-platform-interface.md)). Every connector declares
  `requires_plugins: [pythia]` and needs no other plugin.
- **Why core.** [ADR 0033](0033-native-feature-packages.md) already gives
  platform support bounded execution and cleanup, and connectors that contribute
  no prices (SEC, OpenFIGI, GLEIF, filings.xbrl.org, NSM) need the toolkit too.
- **What stays a feature.** Financial foundations remain a feature package, as
  ruled above: market-data keeps the financial backend, its tool, reads,
  selection, delivery and widgets.
- **Rejected.** Market-data publishing its own toolkit API: a second platform,
  and connectors would still fail whenever market-data is disabled. Folding
  market-data into core.
