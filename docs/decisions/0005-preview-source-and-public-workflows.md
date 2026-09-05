# 0005: User-selected preview source and public contributor workflows

## Context

The technical preview must support ordinary feature work and honest local forks
before Pythia has a stable signer, CI release history, real-provider
qualification, or public host evidence. Contributors also need reusable builder
workflows without depending on private planning archives, while ordinary Hermes
startup must not confuse repository-maintenance guidance with investor context.

## Ruling

An explicit preview install or rebuild activates the checkout the user selected,
including arbitrary refs and local edits, without fetching or reconciling Git.
Routine preview update remains a separate manual operation for recorded clean
`main` and follows `origin/main` by fast-forward only. Stable signing and host
qualification remain later release concerns, not preview source-eligibility
gates.

The public monorepo is the complete development home. Canonical builder skills,
roles, and rules live under `.agents/`; only tools that need another native
format receive ignored copy-based adapters. Working records stay under ignored
`.private/plans/<branch>/`, and accepted decisions are distilled into public
documentation with their rationale and relevant alternatives.

Repository builder instructions are excluded from automatic runtime consumers.
The native seeded workspace `AGENTS.md` remains valid investor context. Explicit
approved source maintenance may read public source; no filesystem sandbox is
claimed.

## Rationale

Users should be able to run code they deliberately checked out without Pythia
becoming a release permission system. Keeping update stricter protects a simple
fast-forward path without taking away rebuild for a fork. One canonical public
builder workspace avoids synchronized repositories and lets future contributors
understand accepted decisions without raw private records.

## Consequences

Activation receipts describe local-source status truthfully. Dirty or non-main
source can rebuild but cannot use routine preview update until the user restores
and rebuilds recorded clean `main`. Install/update/rebuild preparation and
activation preserve device-owned credentials, settings, data, and native
choices. Public checks validate builder adapters in disposable destinations, so
a fresh clone needs neither pre-generated files nor active hooks.

The preview documentation must distinguish tested deterministic behavior from
evidence still missing: stable publication, real-provider usefulness, assembled
host qualification, and real Ubuntu reboot behavior are not implied.

## Rejected alternatives

The project rejects clean-main, signed-tag, CI, or local-test prerequisites for
an explicit preview activation; automatic stash/reset/rebase/merge; converting
an arbitrary checkout to `main`; automatic managed-source watchers; a custom Git
worktree manager; a second synchronized development repository; publishing raw
private records; projecting native `.agents` skills into `.codex/skills`; hook
activation by default; and describing an input allowlist as filesystem security.
