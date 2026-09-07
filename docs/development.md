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

`just dev-init` downloads and hydrates the exact pinned Hermes, Basic Memory,
EdgarTools, and EODHD dependencies. `just dev` prints the local Desk URL and
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
just bootstrap # hydrate the exact pnpm lockfile
just check     # deterministic syntax, structure, dependency, lint, type, build
just test      # ordinary pull-request tests, including the platform smoke
just qualify   # broad install, update, and assembled-runtime qualification
just audit     # registry/network dependency audit
```

`just check` does not run tests or contact a package registry. `just audit` is
the only registry audit and checks the production dependency surface. Tests
and CI are credential-free and use synthetic provider fixtures. Use
`just test-fast` for the deterministic behavior suite and `just test-system`
for the small real-process lifecycle smoke. Qualification runs after changes
land on `main` and on explicit release-oriented runs; it is intentionally not
part of every pull request.

### Browser smoke tests

Desk has a Playwright smoke suite in `apps/desk/e2e/` that drives a Desk you
already started with `just dev`. It is not part of `just test`. Install the
pinned Chromium once (the workspace sets `ignore-scripts`, so Playwright does
not download it on install), then pass the Desk origin from `just dev-paths`:

```sh
pnpm --filter @pythia/desk exec playwright install chromium
just test-e2e http://127.0.0.1:<desk-port>
```

A Tailscale Serve origin works as well. Traces for failures land under
`.local/playwright/desk`. See
[ADR 0008](decisions/0008-desk-client-conventions.md) for the routing, data
fetching, and testing conventions the suite relies on.

## Foreground stack

Each checkout or Git worktree gets a deterministic stack name, three loopback
ports, a lowercase Hermes profile, and independent workspace, knowledge,
Basic Memory, cache, process, and test state. The worktree path is the identity;
`just dev-paths` prints the resolved paths and ports. Pythia never searches for
or adopts another running service.

```sh
just dev-init               # hydrate and configure exact pinned runtimes
just dev-init-recover       # remove a receipt-proven partial first profile
just dev                    # Hermes + Basic Memory + Desk, one foreground owner
just dev-refresh            # explicitly prepare and replace selected consumers
just status                 # owner-verified state for this worktree only
just stop                   # graceful stop for this worktree only
just dev-reset              # discard derived state/cache, preserve user data
just auth openai-codex      # native interactive Hermes OAuth
just auth openrouter api-key # native masked API-key entry (optional alternative)
just auth-status openai-codex
just model                 # choose shared provider/model defaults, once
```

`just dev` binds only `127.0.0.1` and exits with an actionable error if one of
its ports is occupied. Before launching Hermes, it also waits boundedly for the
API port to become reusable under Hermes's native bind semantics. `Ctrl-C` and
`just stop` propagate through the same foreground owner and clean up all three
children. A stale or foreign process receipt is reported but never signalled,
adopted, or deleted around.

Desk source uses Next.js hot reload while `just dev` is running. There is no
automatic watcher for managed Hermes, plugin, runner, or dependency source.
After changing those inputs, run `just dev-refresh`. A running refresh briefly
stops all three selected consumers, performs the shared uv/JavaScript locked
dependency preparation, refreshes copied/compiled assets, and restarts only
after all replacements are healthy. It preserves the profile, OAuth, settings,
workspace, knowledge, sessions, and native capability choices. If the stack is
stopped, the same command prepares the source but starts no service. A failed
refresh leaves no partial background stack; fix the error and retry explicitly.

Desk receives the exact pinned Hermes executable, active profile, config root,
state root, and lifecycle CLI as non-secret environment values. After a native
settings mutation it may invoke only `node $PYTHIA_DEV_LIFECYCLE_CLI
restart-hermes`. The CLI admits an owner-bound request, and the foreground
supervisor restarts only Hermes while keeping Desk and Basic Memory alive. It
waits for the old port to remain reusable under Hermes's native bind semantics,
then returns only after the replacement passes health, process-stability, and a
second health check. On macOS, the native port wait can include the upstream
TIME_WAIT interval. Concurrent requests for the same generation are coalesced.
Stale or foreign requests fail closed.

That `restart-hermes` operation is reserved for a settings-only change. It is
not a substitute for `just dev-refresh`, whose shared preparation requires all
three selected consumers to stop before managed files are replaced.

Managed tools receive only absolute runtime inputs: the managed source root,
the locked Python interpreter, the pinned running Node executable, and private
per-worktree EDGAR data/cache directories. Device settings remain under the
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

For ordinary chat, use Desk's provider/model/reasoning picker instead. On the
first send from an empty profile, Desk saves the explicitly selected,
authenticated provider and model through native profile config commands and
restarts Hermes before starting the run. This initializes only that profile,
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
`HERMES_HOME` printed by `just dev-paths`. Advanced custom-provider definitions
and other root configuration are not copied; configure those in the target
profile through Hermes.

The native dotted setters write each eligible field and verify the resulting
selection. If a write is interrupted, startup fails rather than guessing how
to repair a partial choice; complete that profile's choice with native Hermes.

Pythia never reads, copies, links, or logs `auth.json`. The native OAuth
providers supported by the pinned Hermes release are `anthropic`, `nous`,
`openai-codex`, `xai-oauth`, `qwen-oauth`, and `minimax-oauth`. Unsupported OAuth
names fail honestly; API-key providers are validated by Hermes. SEC identity
and EODHD token settings also use the shared private
Pythia configuration root; workspaces, knowledge, caches, sessions, processes,
and Basic Memory state remain isolated per worktree.

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

Managed plugins are refreshed by copy, not symlink. Profile/SOUL/workspace and
knowledge seeds are installed only in the first profile-initialization
transaction and are preserved thereafter. `just dev-reset` removes this
worktree's process/test state and fetch caches; it does not remove ownership
receipts, the shared Hermes credential root, profile, Basic Memory
configuration, workspace, or Markdown knowledge. If first profile
initialization is interrupted, Pythia refuses to adopt the partial scaffold.
`just dev-init-recover` accepts only the matching incomplete transaction
receipt and removes only that named partial profile before a clean retry.
An intent-only `started` receipt cannot prove ownership of a profile that later
appears, so that case fails closed for manual inspection instead of deleting it.

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

## Where changes belong

- `apps/desk` is the installed local interface; its routing, data fetching,
  and browser-test conventions are in
  [ADR 0008](decisions/0008-desk-client-conventions.md).
- `packages/ui` owns reusable interface primitives and the one token
  stylesheet that Tailwind utilities draw from (see
  [ADR 0007](decisions/0007-tailwind-styling-layer.md)).
- `apps/design-lab` is a development-only component workshop.
- `runtime/managed` owns the Pythia skills, plugin, instructions, and bounded
  data runners shipped with a release.
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
just builder-sync  # all three adapters
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
