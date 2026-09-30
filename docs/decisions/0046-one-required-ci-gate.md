# 0046: One required CI gate

*Numbered 0037 until 2026-09-30, when the identity backbone ADR took the same number; renumbered 0046 and every link updated.*

## Context

Until September 2026, pull-request CI was one five-minute job (`just check`
then `just test-fast` then `just audit`) plus a macOS and Ubuntu lifecycle
smoke, and no status check was required. Merging on green was a convention
that failed: three of 89 merged pull requests landed without a green run, one
of them turning `main` red. The post-merge "Broad qualification" workflow had
been red for 19 days on a stale fixture. Its red test step also stopped the
assembled qualification behind it from running at all, so nobody could see
whether installation and update still worked. The Desk browser suite ran only
by hand against a live stack, and four of its tests had gone stale unnoticed.

Measured over 316 runs, 19 of 25 recent CI failures were static checks that
take seconds locally. `just check` passed while CI failed on Desk test-file
types, because those were checked only inside `test:unit`. Turbo ran type
checks and unit tests one package at a time for no dependency reason. The
per-pull-request pnpm cache used more than the repository's 10 GB cache budget
and saved about two seconds. Python tests ran on the runner's system
interpreter, not the pinned one.

## Ruling

`.github/workflows/ci.yml` runs on every pull request and every push to
`main`. Its `CI gate` job is the only required status check. The gate needs
every blocking job, runs `if: always()`, and fails unless each one succeeded:

| Job | Runs |
| --- | --- |
| Static checks | `just check-static` |
| Types | `just check-types` |
| Build | `just check-build` |
| Browser tests, two shards | `just build-desk`, then `just test-e2e-hermetic --shard=N/2` |
| Tests | `just test-fast` on the pinned Python |
| macOS and Ubuntu lifecycle smoke | `just test-system` |

`just check` is `check-static`, `check-types` and `check-build` together, so
local and CI checks are the same commands. Every type surface, production and
test, is checked in `check`; test scripts do not type-check. Test layers are
chosen by directory (`test/integration`), never by hand-kept file lists. Turbo
tasks without real outputs depend on a `transit` node, not on `^self`.

The Desk browser suite runs against this checkout's production Desk build,
started on an ephemeral loopback port with disposable state and no Hermes
(`apps/desk/e2e/hermetic.mjs`). Specs that need a real Hermes profile live in
`apps/desk/e2e/live/` and stay manual (`just test-e2e <desk url>`). This amends
[ADR 0008](0008-desk-client-conventions.md).

The dependency audit runs in CI as an advisory job: a registry outage must not
block merges. The nightly workflow (`nightly.yml`) runs on every push to
`main`, on a daily schedule and by dispatch. It audits every dependency,
including development tools, and runs broad qualification. The qualification
test files and the assembled run are separate steps, so one red file cannot
hide the other. Superseded pull-request runs are cancelled; `main` runs are
not. The long-lived `identity-backbone` integration branch also runs `CI` on
every push, so its merge commits keep a verdict of their own. That adds no
second required check.

`tooling/check-workflows.mjs` enforces what can be enforced mechanically:
- actions pinned to full commits with a version comment;
- read-only permissions, and checkouts without persisted credentials;
- a timeout on every job;
- no `continue-on-error`, and no path or branch filters on the required
  workflow;
- pull-request-only cancellation, and no qualification in CI;
- every CI job either a need of the gate or listed as advisory.

A red `main`, or a red nightly run, is the first thing to fix: revert or
repair the owner. A failing test is not left red. It is fixed, or moved out
of the blocking path with an adjacent reason and a named owner until it is
reliable. Retries are never the fix.

## Rationale

A single aggregate check makes "merge only on green" a repository rule instead
of a convention, and lets jobs be added or split without touching branch
protection. Parallel jobs, with the browser suite split in two shards
that each build only Desk, keep the critical path near the pre-split five
minutes while adding the whole browser suite. Running the same `just` recipes locally and in CI
removes the gap agents fell into. Browser tests that nobody runs rot. Running
them against the real production build, with fixtures in place of Hermes,
proves the routing, keyboard and viewport contracts on every change. It does
this without process management or credentials in the test runner. Keeping
network-dependent and assembled evidence off the blocking path follows the
presubmit/post-submit split in *Software Engineering at Google* (ch. 23). That
split keeps the gate fast and deterministic while broad evidence still runs
on every `main` commit.

## Consequences

The repository ruleset for `main` requires `CI gate`. A new blocking job must be
added to the gate's `needs`, and `check-workflows` refuses a job that is in
neither `needs` nor the advisory list. Cache usage no longer includes a pnpm
store: a cold install takes about five seconds. Browser specs added outside
`e2e/live` must supply every API response through route fixtures. A request
that reaches Hermes fails. Root TypeScript tests are still not type-checked
because their `.mjs` imports are untyped; that is known follow-up work.

## Rejected alternatives

Requiring each job individually (every job rename would edit branch
protection, and a skipped job leaves a required check pending); retrying failed
tests (hides races that also affect users); keeping the audit blocking (a
registry outage or a newly published advisory in an unrelated package would
block every merge); running the browser suite against Desk and Hermes in CI
(needs the pinned runtime and credentials inside the runner, as ADR 0008
rejected); caching the pnpm store per pull request (unreachable by other refs,
over budget, and slower than a cold install).
