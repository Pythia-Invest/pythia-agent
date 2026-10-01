# Development

Pythia Agent uses a shallow pnpm workspace: first-level `apps/*` are
applications and first-level `packages/*` are source-first libraries. Apps may
depend on packages; packages never depend on apps. Cross-workspace imports use
the package's public entrypoint, not a source-file path. A new package also
needs a one-line reason in `docs/decisions/`.

Development is supported on macOS and Ubuntu. Contributor prerequisites are
Node 22.16.0, pnpm 10.20.0, Python 3.12.11, uv 0.9.28, and
[just](https://just.systems/) 1.46.0. The version files and
`tooling/toolchain.json` are authoritative.

Start from a clone or Git worktree:

```sh
corepack enable
just bootstrap
just dev-init
just dev
```

For sibling worktrees managed under one predictable directory, run these from
the main checkout:

```sh
just worktree <branch>        # create or attach an existing local/remote branch
just worktree-list            # list every registered worktree
just worktree-remove <branch> # remove its clean managed worktree
just worktree-prune           # offer to remove clean worktrees with no remote branch
```

Managed worktrees default to `~/worktrees-pythia-agent`. Set
`PYTHIA_AGENT_WORKTREE_BASE` to another absolute or `~`-prefixed directory when
needed. The helper wraps native Git for contributor checkouts only; it is not
part of installation, updating, or the Pythia runtime. Predictable sibling
paths support the repository's worktree-isolated development stacks and make
cleanup targetable. Direct Git commands remain supported. Runtime-integrated
worktree management and automatic branch or conflict cleanup remain outside the
product because source checkout policy belongs to the contributor.

`just dev-init` downloads and hydrates the exact pinned Hermes and declared
managed dependencies. `just dev` prints the local Desk URL and
runs the stack in the foreground; it does not install services, enable linger,
or change host networking.

For reusable interface work, run the development-only Design Lab separately:

```sh
pnpm --filter @pythia/design-lab dev
```

The Lab uses synthetic examples and is not part of the installed runtime. To
reach it through Tailscale Serve, set `PYTHIA_DESIGN_LAB_DEV_ORIGIN` to the
exact HTTPS origin you forward (for example
`https://your-machine.your-tailnet.ts.net:9444`) so Next allows hot reload from
that host; the Lab has no API identity check, so keep it on a trusted tailnet.

## Repository checks

Run these commands from the repository root:

```sh
just bootstrap    # hydrate the exact pnpm lockfile
just check-static # seconds: format, lint, structure, boundaries, workflows
just check        # check-static plus every type surface and the production builds
just test         # ordinary pull-request tests, including the platform smoke
just qualify      # broad install, update, and assembled-runtime qualification
just audit        # registry/network audit of production dependencies
```

Run `just check-static` before every push and `just check` before asking for a
merge; most CI failures are static checks that take seconds locally.
`just check` does not run tests or contact a package registry. Tests and CI are
credential-free and use synthetic provider fixtures. Use `just test-fast` for
the deterministic behavior suite and `just test-system` for the small
real-process lifecycle smoke.

CI ([ADR 0046](decisions/0046-one-required-ci-gate.md)) runs the same recipes
as parallel jobs behind one required `CI gate` check. Merge only when it is
green. The nightly workflow runs broad qualification and a full dependency
audit on every push to `main`, daily, and by dispatch. It is intentionally not
part of every pull request, but a red nightly run is fixed first.

### Browser tests

Desk's Playwright suite lives in `apps/desk/e2e/`. Install the pinned Chromium
once (the workspace sets `ignore-scripts`, so Playwright does not download it
on install). After `just check-build`, run the hermetic suite against this
checkout's production Desk with disposable state and no Hermes. CI requires
this suite:

```sh
pnpm --filter @pythia/desk exec playwright install chromium
just test-e2e-hermetic
```

Specs in `apps/desk/e2e/live/` need a real profile. Run every spec against a
Desk you started with `just dev`, passing its origin from `just dev-paths`:

```sh
just test-e2e http://127.0.0.1:<desk-port>
```

A Tailscale Serve origin works as well. Traces for failures land under
`.local/playwright/desk`. See
[ADR 0008](decisions/0008-desk-client-conventions.md) for the routing, data
fetching, and testing conventions the suite relies on.

## Foreground stack

Each checkout or Git worktree gets a deterministic stack name and loopback ports,
a lowercase Hermes profile, and independent workspace, cache, process and test
state. The worktree path is the identity;
`just dev-paths` prints the resolved paths and ports. Pythia never searches for
or adopts another running service.

```sh
just dev-init               # hydrate and configure exact pinned runtimes
just dev-init-recover       # remove a receipt-proven partial first profile
just dev                    # Hermes, its settings server and Desk, one foreground owner
just dev-refresh            # explicitly prepare and replace selected consumers
just status                 # owner-verified state for this worktree only
just stop                   # graceful stop for this worktree only
just dev-reset              # discard derived state/cache, preserve user data
just auth openai-codex      # native interactive Hermes OAuth
just auth openrouter api-key # native masked API-key entry (optional alternative)
just auth-status openai-codex
just model                 # choose shared provider/model defaults, once
```

`just dev` runs three services: Hermes's API server, Hermes's settings server
(`hermes serve --isolated`, which Desk's Settings reads and writes through; see
[ADR 0021](decisions/0021-hermes-settings-server.md)) and Desk. The settings
server's port is `43000` plus the stack's slot, apart from the three
consecutive ports of the other services. `just dev` binds only `127.0.0.1` and
exits with an actionable error if one of its ports is occupied. Before launching Hermes, it also waits boundedly for the
API port to become reusable under Hermes's native bind semantics. `Ctrl-C` and
`just stop` propagate through the same foreground owner and clean up both
children. A stale or foreign process receipt is reported but never signalled,
adopted, or deleted around. The one exception is a receipt whose supervisor
and every child have provably exited, as after the owner was killed without
cleanup: each recorded PID is free or now belongs to a process with a
different start time or command. `just dev`, `just dev-init`, `just stop` and
`just dev-reset` then rename it to `foreground.json.stale-<time>` beside itself
and continue, without signalling anything. If any recorded process might still
be running, or its identity cannot be read, the receipt stays authoritative.

When the supervisor has provably exited but a recorded child still runs and
holds a port (as when the owner died while its Hermes kept listening),
`just stop` terminates each child whose live PID, start time and command match
the receipt exactly, skips any recorded PID that is free or now belongs to
another process, waits for the stack's ports to be released, then sets the
receipt aside and reports what it stopped. It never signals a process it cannot
match to the receipt, and never touches another worktree's stack.

Desk source uses Next.js hot reload while `just dev` is running. There is no
automatic watcher for managed Hermes, plugin, runner, or dependency source.
After changing those inputs, run `just dev-refresh`. A running refresh briefly
stops both selected consumers, performs the shared uv/JavaScript locked
dependency preparation, refreshes copied/compiled assets, and restarts only
after all replacements are healthy. It preserves the profile, OAuth, settings,
workspace, knowledge, sessions, and native capability choices. If the stack is
stopped, the same command prepares the source but starts no service. A failed
refresh leaves no partial background stack; fix the error and retry explicitly.

Desk receives the exact pinned Hermes executable, active profile, config root,
state root, and lifecycle CLI as non-secret environment values. After a native
settings mutation it may invoke only `node $PYTHIA_DEV_LIFECYCLE_CLI
restart-hermes`. The CLI admits an owner-bound request, and the foreground
supervisor restarts only Hermes while keeping Desk alive. It
waits for the old port to remain reusable under Hermes's native bind semantics,
then returns only after the replacement passes health, process-stability, and a
second health check. On macOS, the native port wait can include the upstream
TIME_WAIT interval. Concurrent requests for the same generation are coalesced.
Stale or foreign requests fail closed.

That `restart-hermes` operation is reserved for a settings-only change. It is
not a substitute for `just dev-refresh`, whose shared preparation requires all
selected consumers to stop before managed files are replaced.

Managed tools receive absolute runtime inputs: the managed source root and the
pinned Hermes and Node executables. Core lifecycle probes run with Hermes's
prepared Python interpreter before startup or after shutdown; fresh setup does
not create a second Python environment or export `PYTHIA_PYTHON`.
Device settings remain under the
canonical Pythia config root. No legacy config alias or credential value is
added; ambient EDGAR and provider credentials are removed before startup.

The shared, permission-restricted Pythia Hermes root owns development model
credentials and initial model defaults. Authenticate and choose a model once
from any initialized worktree:

```sh
just auth openai-codex
just auth-status openai-codex
just model
```

For an API-key provider instead, use (for example) `just auth openrouter api-key`.
Hermes prompts for the secret; never pass the key as a command argument.
The provider name is interpreted by native Hermes. Named worktree profiles use
its root credential fallback; an explicit profile credential takes precedence.
These commands explicitly select native `-p default`, irrespective of a sticky
active-profile choice.

`just model` opens Hermes's native provider/model chooser against the shared
root `config.yaml`. During `just dev-init`, startup, or explicit refresh, an
empty profile model selection inherits `provider`, `default` (model name), and
optional `base_url` and `api_mode`. Credentials are never included. Both provider
and model must be selected; Pythia does not guess from available accounts or
switch to a paid provider. Endpoints containing embedded credentials, query
parameters, or fragments are rejected.

If that selection names a custom provider, preparation first inherits its
matching native `providers` or `custom_providers` definition. It copies only
the selected definition's supported non-secret fields (endpoint, transport,
model metadata and environment-variable names), through native config setters
with readback. Legacy list entries are translated as Hermes translates them
(the endpoint becomes `api`, `model` becomes `default_model`, `api_mode`
becomes `transport`); an existing profile definition takes precedence. A
`providers.<id>` block for a built-in provider (timeouts, per-model options)
is settings, not a definition, and is left alone, as is a disabled entry.
Inline keys, headers, credential commands and arbitrary request bodies are
rejected with guidance to configure the profile through Hermes. Unrelated
providers and general configuration are never merged. If a provider write
succeeds but its readback does not match, preparation stops; the written row
then belongs to the profile, and a later run leaves it in place.

Hermes expands `${VAR}` references when it reads configuration, so a root
definition whose fields reference environment variables is copied with the
values they had at that moment, including values from the root `.env`. Keep
secrets out of templated provider fields; credentials belong in `key_env`
names or the native credential pool.

An environment-variable name is not a credential: Hermes does not inherit the
root `.env` into named profiles. Shared authentication belongs in Hermes's
native root credential pool, configured explicitly with `just auth <provider>
api-key`. Defining a custom endpoint does not prove its credentials work. In
this pin, custom model discovery reads the profile's configured key/environment;
a shared credential pool usable for inference does not by itself guarantee
authenticated live model discovery. Saved model metadata remains available.
The pinned `auth status` dispatcher also lacks a custom-provider branch and
reports those providers as logged out even when their native pool resolves.
Do not use that message, or a configured picker row alone, as proof of custom
inference readiness. Native credential resolution and an explicitly authorized
inference check answer different questions.

For ordinary chat, use Desk's provider/model/reasoning picker instead. On the
first send from an empty profile, Desk saves the explicitly selected,
authenticated provider and model through native profile config commands and
restarts Hermes before starting the run; if that run fails on the provider's credentials,
Desk clears the saved pair again. This initializes only that profile,
not shared defaults or credentials. Later choices are native per-message
overrides without a restart and reset to the profile default on reload.
Existing or partial profile choices are preserved. `just model` remains an
optional central-default setup command, not a prerequisite for UI selection.

This is seed-once defaulting, not synchronized configuration. Any existing
model choice, including a partial choice, is preserved. Changing shared
defaults affects only unconfigured profiles, not stacks already using them.
After choosing defaults for an already-running unconfigured stack, run
`just stop` and `just dev`, then start a new conversation. Set a different
stack choice through native `hermes -p <profile> model` with the executable and
`HERMES_HOME` printed by `just dev-paths`. More advanced custom-provider settings
outside the supported inheritance fields remain native profile configuration.

The native dotted setters write each eligible field and verify the resulting
selection. If a write is interrupted, startup fails rather than guessing how
to repair a partial choice; complete that profile's choice with native Hermes.

Pythia never reads, copies, links, or logs `auth.json`. The native OAuth
providers supported by the pinned Hermes release are `anthropic`, `nous`,
`openai-codex`, `xai-oauth`, `qwen-oauth`, and `minimax-oauth`. Unsupported OAuth
names fail honestly; API-key providers are validated by Hermes. Saved legacy
SEC identity and EODHD token values remain in the private Pythia configuration
root, but core no longer exposes their tools or settings controls. Workspaces,
caches, sessions and process state remain
isolated per worktree. Retained legacy knowledge also stays with its stack.

A deployment's model is configured through native Hermes on that device;
Desk owns Pythia-specific settings. Development credentials and model defaults
are never copied from the development machine into it. Qualification that runs
development and installed modes on one host selects explicit isolated roots
rather than relying on their shared default XDG path.

`just auth-status openai-codex` is a direct, read-only native status check for
that provider. It requires `just dev-init` to have prepared the native command,
but does not bootstrap, build, copy a plugin, create a profile, or start the
stack. Its result says nothing about another configured provider. Authentication
may require a new Hermes session; it does not require a source refresh.

Managed plugins are refreshed by copy, not symlink. Profile/SOUL/workspace seeds
are installed only in the first profile-initialization
transaction and are preserved thereafter. `just dev-reset` removes this
worktree's process/test state and caches, including fetched downloads and the
document cache; it does not remove ownership receipts, the shared Hermes
credential root, profile, workspace, Pythia's store or retained legacy Markdown
knowledge. If first profile
initialization is interrupted, Pythia refuses to adopt the partial scaffold.
`just dev-init-recover` accepts only the matching incomplete transaction
receipt and removes only that named partial profile before a clean retry.
An intent-only `started` receipt cannot prove ownership of a profile that later
appears, so that case fails closed for manual inspection instead of deleting it.

## Reference data

Search and instrument pages read the reference package installed in the
stack's store, `<data>/store/reference/`, never the builder's output folder
([reference packages](architecture/reference-package.md)). The store is per
worktree (`just dev-paths` prints its data root), and core finds it through
`PYTHIA_DATA_ROOT`. A store from before the move to `<data>/store` is moved
there the first time the stack uses it; the old identity file stays behind as
`identity.moved.sqlite3`. Open Markets or Repairs once on each stack you keep
before the Hermes pin is bumped, and do not run older code in the same checkout
afterwards
([ADR 0034](decisions/0034-core-and-optional-features.md), 2026-09-29
amendment). The old `plugin-data/…/documents/` cache is left behind and can be
deleted by hand.

**Do not run an older build on a stack a newer one has opened.** A build that
includes device subjects migrates the stack's identity store to schema 6 the
first time it opens it, keeping the old file as `identity.before-v6-<id>.sqlite3`.
An older build that then opens the same stack (an older commit in the same
checkout) cannot read it: it keeps the store aside as `identity.v6-<id>.sqlite3`
and starts empty, and Repairs reports a reset. Your bindings and answers are in that set-aside file. To
restore them, stop the stack, move the fresh `identity.sqlite3` aside, rename
`identity.v6-<id>.sqlite3` to `identity.sqlite3`, and start the newer build
([ADR 0037](decisions/0037-identity-backbone.md), amendment "device subjects"). A column added
within schema 6 is nullable and added when core opens the store, so it does not make an older build
set the store aside. To read the stores directly, see [identity data](architecture/identity-data.md).
`just dev-init`,
`just dev` and `just dev-refresh` install this checkout's
`.local/reference-builder/out/` package when there is one; set
`PYTHIA_DEV_REFERENCE_PACKAGE` to use another package directory. To install
one by hand:

```sh
just reference-snapshot                  # build a package (network; see tooling/reference-builder)
just reference-install <package>         # verify its checksum and format, then install it
just reference-status                    # what is installed, and the last refusal
just reference-remove                    # set it aside: search and pages read the device's subjects alone
```

## Updating a stack that predates the identity backbone

A development profile (or installed device) created before the identity
backbone keeps its native choices when the code moves on. Pythia enables the
default plugins, hides core's toolset and turns off Hermes's own skill writing
only when it creates a profile, so on an existing one do it once, with the stack
stopped. `just dev-paths` prints the `hermes_root`, `profile` and `cache` the
commands need; they use the stack's own managed Hermes, never a global one.

```sh
just stop
just reference-snapshot   # network; builds .local/reference-builder/out/ (tooling/reference-builder)
just dev-refresh          # copies the new plugins, installs that package, starts nothing

export HERMES_HOME="<hermes_root>"
HERMES="<cache>/hermes-source/.venv/bin/hermes"
PROFILE="<profile>"

# 1. Enable the plugins a fresh profile enables.
for plugin in pythia pythia-market-data pythia-sec pythia-openfigi pythia-gleif \
    pythia-xbrl-filings pythia-yahoo-discovery pythia-coingecko \
    pythia-coinmarketcap pythia-eodhd; do
  "$HERMES" -p "$PROFILE" plugins enable "$plugin" --no-allow-tool-override
done

# 2. Hide core's pythia-core toolset, and keep Desk chat's tools off cli and cron.
"$HERMES" -p "$PROFILE" tools disable pythia-core --platform api_server
for platform in cli cron; do
  "$HERMES" -p "$PROFILE" tools disable pythia-core pythia-desk pythia-sec \
      pythia-xbrl-filings pythia-gleif pythia-eodhd pythia-yahoo-discovery \
      pythia-coinmarketcap pythia-openfigi --platform "$platform"
done

# 3. Keep Hermes from writing its own skills (the fresh profile's choice). Its notice
#    that creation_nudge_interval is not a recognized key is expected.
"$HERMES" -p "$PROFILE" config set skills.creation_nudge_interval 0
"$HERMES" -p "$PROFILE" config set skills.write_approval true
"$HERMES" -p "$PROFILE" config set curator.enabled false
```

- **Plugins.** An existing profile gets the new plugin directories but no
  enablement, so Settings → Data → Data sources lists no source and a read on a
  subject reports `unresolved_identity`. The ten in the loop are the ones marked
  `enabledByDefault: true` in `scripts/dev/managed-plugins.mjs`; enable an
  opt-in one (`pythia-nsm`, `-hyperliquid`, `-defillama`, `-navi`, `-sui`) the
  same way.
- **Toolsets.** Core registers every plugin operation in a `pythia-core`
  toolset that Hermes would offer the model by default. Run step 2 after step
  1, because Hermes records a plugin's toolset only while its plugin is
  enabled. `"$HERMES" -p "$PROFILE" tools list --platform api_server` should
  then show `pythia-core` disabled and `pythia-desk` and the provider toolsets
  enabled ([agent tools](architecture/agent-tools.md#profiles)).
- **Reference data.** Search and instrument pages read an installed reference
  package and Pythia publishes none: build one as above, or install a package
  you have with `just reference-install <package>`. An installed deployment has
  no import step yet, so Settings → Reference data reports none until Pythia
  publishes a package
  ([reference packages](architecture/reference-package.md#later-automated-packages)).
- **Installed devices.** Updating one runs migration `0002-agent-tool-surface`,
  which does steps 2 and 3, but it does not enable the new plugins. Enable them as
  in step 1 with that device's Hermes, then repeat the `tools disable` for
  `cli` and `cron`, since their toolsets are only known once enabled.
- **Market data's old identity file.** The earlier market-data plugin kept
  provider mappings, overrides and a source order in `identity.sqlite3` (and
  `preferences.sqlite3`) in its private data directory. The new plugin renames
  each to `identity-retired.sqlite3` (`preferences-retired.sqlite3`) beside it on
  its first start, never over an earlier one and never deleting, and logs the
  source orders it held. Nothing is copied: the order is now `source_order` in
  `settings.json`, and core derives every address again from open identifiers
  ([retired state](../packages/market-data/IDENTITY.md#retired-state)).

## Optional Tailscale access

Desk can be reached through native Tailscale Serve during development. It still
listens only on loopback; `just dev` never configures Tailscale or host networking.
Use your own machine's Tailscale DNS name and exact Tailscale user login:

```sh
PYTHIA_DESK_TAILSCALE_ORIGIN=https://your-machine.your-tailnet.ts.net:9443 \
PYTHIA_DESK_TAILSCALE_LOGIN=you@example.com just dev
```

In another terminal, inspect `tailscale serve status` and choose an unused HTTPS
port. Using the Desk port printed by `just dev-paths`, run:

```sh
tailscale serve --https=9443 http://127.0.0.1:<desk-port>
```

Open the configured HTTPS address from a device signed into that Tailscale user.
Keep Serve in the foreground; Ctrl-C removes its temporary forwarding. Stop the
stack separately with `just stop`. Each simultaneous worktree needs its own
HTTPS port and origin. Keep personal configuration outside committed source.
There is no Tailscale dependency when these settings are absent. The same
optional access settings work for an installed Desk; see [hosting](hosting.md).

Desk checks the exact origin and Serve-provided user identity before privileged
API access. Mutations retain JSON and CSRF checks. HTTPS browser cookies are
Secure. Tagged Tailscale clients have no user identity and are not admitted.
Never use Funnel or expose the underlying HTTP listener to a network.

This trusts the local Serve proxy and same-user local processes. Next's public
development assets and hot-reload endpoint do not use Desk's API identity check;
use a trusted development tailnet and restrict network access with Tailscale
ACLs. This is not a multi-user hosted service or an authentication layer for
arbitrary reverse proxies. Tailscale handles certificates and forwarding; Desk
uses Next's native `allowedDevOrigins` for remote hot reload.

## Upgrading Hermes

Hermes is one exact release recorded in `runtime/versions.json`; code reads the
pin from there and `just check` rejects a disagreeing
`runtime/hermes/hermes-source.json`. Every Pythia dependency on Hermes
behavior has a row in the contract's
[touchpoint index](../runtime/contracts/hermes.md#touchpoint-index), and its
[known defects](../runtime/contracts/hermes.md#known-defects-at-this-pin) say
what the next release must fix. An upgrade is an explicit
`upgrade-hermes` workflow: review the candidate against the index, bump the
pin, hydrate with `just dev-init`, rerun the wire capture and review its diff,
fix and document, then run `just check`, `just test`, `just qualify` and a Desk
smoke test. [ADR 0019](decisions/0019-hermes-upgrade-procedure.md) records why.

## Where changes belong

- `apps/desk` is the installed local interface; its routing, data fetching,
  and browser-test conventions are in
  [ADR 0008](decisions/0008-desk-client-conventions.md).
- `packages/ui` owns reusable interface primitives and the one token
  stylesheet that Tailwind utilities draw from (see
  [ADR 0007](decisions/0007-tailwind-styling-layer.md)).
- `apps/design-lab` is a development-only component workshop.
- `runtime/managed` owns Pythia core support, optional feature packages,
  standalone skills and shared execution helpers shipped with a release.
- `runtime/contracts` records the exact upstream behavior Pythia relies on.
- `docs/decisions` contains short, durable decisions rather than raw working
  notes.

Builder instructions in `AGENTS.md` and `.agents/` are intentionally public so
contributors can work consistently. They are excluded from every runtime and
model-input allowlist during ordinary startup. Explicit user-approved source
maintenance may read them like other public source; the boundary prevents
automatic injection and is not a filesystem sandbox.

## Builder workflows and private records

The canonical reusable builder skills, roles, and rules live under `.agents/`.
Codex uses native `.agents/skills` discovery. Other supported tools need only
the copy adapters relevant to them:

```sh
just ai-sync       # Claude skills
just sync-agents   # Claude and Codex roles
just sync-rules    # Claude and Cursor rules
just builder-sync  # both adapters
```

The adapters write ignored local destinations and refuse unowned collisions.
Nothing runs them for you by default, so a fresh clone or worktree has no
`.claude/skills` until you do. To keep them current automatically, opt in once
per repository with `just setup-hooks`: it points `core.hooksPath` at the
tracked `.githooks/` directory, whose `post-checkout` and `post-merge` hooks
re-run the three adapters after branch checkouts, worktree creation, pulls,
and merges. The setting is shared by every worktree of the clone and never
blocks a Git operation. `just check-ai-workspace` validates the canonical
source and exercises fresh projections in disposable destinations, so CI needs
no generated adapter files, tool configuration, or hooks.

Working plans, interviews, test runbooks, results, and raw receipts belong in
ignored `.private/plans/<branch>/`. Before material work is complete, record
accepted product or architecture decisions in public documentation or an ADR,
including context, ruling, rationale, consequences, and relevant rejected
alternatives. The contributor-only worktree recipes wrap native Git for managed
sibling checkouts; they do not enter Pythia's runtime or installed lifecycle.

Existing Basic Memory installations must complete the explicit staged
[Workspace transition](update-and-customization.md#workspace-transition) before
preparation replaces dependencies or owned services. Preview is read-only;
staging preserves notes/configuration and the old usable environment. Fresh
native-session guidance evidence is required before retirement. Routine startup
does not migrate personal notes or overwrite user-owned instruction seeds.
