# Pythia Agent

Pythia is a local research companion for investors. It helps you investigate a
company, keep the evidence behind an investment case, and return to the reasons
you bought or passed. You remain responsible for the judgment and the trade.

This repository is an early technical preview. Its current front doors are
local feature development and explicit preview installation from a Git checkout.
There is no stable release yet, and assembled host behavior and usefulness with
real model, SEC, or EODHD credentials have not been qualified.

## Try the Git preview on Ubuntu

The installed preview supports Ubuntu x86-64. It installs the files in the
checkout exactly as selected, including a branch, tag, detached commit, or
uncommitted edits:

```sh
git clone https://github.com/Pythia-Invest/pythia-agent.git
cd pythia-agent
./install.sh --preview
```

Installation starts Pythia-owned user services and prints the Desk URL. The
defaults are Desk at <http://127.0.0.1:8644>, Basic Memory on port 8643, and
Hermes on port 8645. Read the [installation guide](docs/install.md) before
running it. Stable signed releases are a later channel and are not required to
try source you chose.

## Develop locally

Development is supported on macOS and Ubuntu:

```sh
corepack enable
just bootstrap
just dev-init
just dev
```

`just dev` runs Hermes, Basic Memory, and Desk in the foreground. It installs no
services or changes host networking. Each Git worktree has isolated profiles,
workspace/knowledge, sessions, Basic Memory state, caches, processes, and ports.
Worktrees share the permission-restricted Pythia configuration owner for native
OAuth and device settings, so authenticate once without copying credentials.

Desk has native hot reload. Managed Hermes/plugin/runner source does not trigger
an automatic restart: run `just dev-refresh` to briefly stop, prepare, and
replace all three consumers selected for this worktree. Data, authentication,
and native choices are preserved. See [development](docs/development.md) for
prerequisites, provider status, failure behavior, checks, and the development-
only Design Lab.

## What is here

- Pythia Desk, a localhost browser interface for conversations, approvals,
  history, device setup, skills, and tools.
- An exact, unmodified Hermes Agent runtime with Pythia skills and one copied
  native plugin.
- Bounded SEC filing/facts research through EdgarTools and daily market prices
  through the official EODHD SDK.
- Durable, user-readable Markdown research notes indexed by a separate,
  unmodified Basic Memory process.

Pythia uses Hermes's native sessions, approvals, OAuth, skills, plugins, and
platform toolsets. Optional provider credentials are not required for startup.
Hosted model and data-provider use sends those requests externally; installation
and updates also download pinned dependencies.

## Source, updates, and customization

An explicit preview install or `pythia rebuild` activates the current checkout
without fetching or changing Git. Routine preview `pythia update` is different:
it manually follows `origin/main` by fast-forward only and refuses dirty,
conflicted, diverged, or changed-after-check source. Credentials, configuration,
sessions, knowledge, local extensions, and capability choices live outside the
checkout and survive both paths.

Repository `AGENTS.md` and `.agents/` files guide contributors. They are not
automatically injected into the installed agent; explicit approved source
maintenance can read public source, so this is a consumer boundary rather than
a filesystem security claim. Private working records belong under ignored
`.private/`, while accepted decisions are distilled into public product docs or
ADRs. Read [updates and customization](docs/update-and-customization.md) and
[contributing](CONTRIBUTING.md) for the details.

Pythia is not a trading system, investment adviser, or security boundary around
Hermes. Services bind to `127.0.0.1`; see [security](SECURITY.md),
[ownership](docs/architecture/ownership.md), and
[third-party notices](THIRD_PARTY_NOTICES.md).

Pythia-authored source is licensed under [Apache-2.0](LICENSE).
