# Testing

Vitest is the JavaScript and TypeScript test runner. Workspace behavior belongs
in that workspace's `test/`; root policy and lifecycle behavior belongs in the
root `test/` tree. Keep production and test type surfaces separate.

Unit tests own deterministic local behavior. Integration tests own real
process, filesystem, loopback HTTP, or native-tool boundaries, and live in a
`test/integration` directory: the directory chooses the layer, never a
hand-kept file list. Qualification tests own assembled cross-workspace,
installation, and update behavior, and run nightly outside the ordinary
pull-request loop ([ADR 0037](../docs/decisions/0037-one-required-ci-gate.md)).
A guided local runbook under `.private/plans/<branch>/test-plan.md` is reserved
for a representative workflow or user judgment that automation cannot supply,
when explicitly requested. Ordinary tests and previews do not require a
test-plan document.

## Before adding or changing a test

Every new or changed test passes the authoring gate in the
[test-audit skill](./skills/test-audit/SKILL.md). It must name:

- the observable behavior it protects;
- the credible regression that makes it fail;
- why existing coverage misses that regression.

It must also need no production seam that only tests use. A test that would
break under a behavior-preserving refactor asserts implementation; rewrite it
at the owning boundary. Check it against the skill's junk patterns, too. The
September 2026 audit found these most often:

- negative checks that pass for an unrelated reason;
- assertions that can never fail;
- another library's behavior re-tested;
- the same contract replayed at several layers;
- exports kept alive only by tests.

A test that rejects bad input must fail when its guard is removed. Show it once
by breaking the guard and watching it go red, then restore the source.

Protect stable behavior and meaningful Pythia-owned invariants at the lowest
boundary that can prove them. Each contract has one primary test owner; prefer
extending a table-driven case to adding a near-duplicate. Prefer one
representative success and the consequential failure or ownership cases over
exhaustive permutations. A bug fix gets a regression test when the failure is
reproducible and the test is stable, and that test must fail on the unfixed
code. An automated test is not required when types, lint, a build, or focused
manual evidence better matches a low-risk change; report that evidence clearly.

Do not test source text, imports, class names, CSS declarations, incidental
copy, current collection sizes, or another tool's implementation. Do not add a
coverage target; measure coverage only to show a pruning campaign kept its
protection. Frontend tests are reserved for business logic,
accessibility-critical semantics, and critical interactions; review ordinary
visual fidelity in Design Lab.

## Desk browser tests

Desk's Playwright suite (`apps/desk/e2e/`) owns routing, keyboard, focus,
theme, and narrow-viewport interactions. It does not replay logic a unit test
already proves. CI runs every spec outside `e2e/live` against this checkout's
production Desk build with disposable state and no Hermes
(`just test-e2e-hermetic`). So those specs supply every API response through
route fixtures, and drive polling with Playwright's clock instead of waiting.
Specs that need a real Hermes profile live in `e2e/live` and run against a
running Desk (`just test-e2e <desk url>`). The suite never starts Hermes or
creates sessions.

## Hygiene

Tests must not use ambient credentials, ambient runtime environment, or
arbitrary sleeps. Desk tests clear `PYTHIA_*`, `HERMES_*` and `API_SERVER_*`
before they run (`apps/desk/test/setup-environment.ts`). Allocate unique
temporary paths and ports, synchronize on observable state with explicit
deadlines, and delete only resources the test created. Never write into the
checkout.

`tooling/check-tests.mjs` (part of `just check-static`) refuses:
- `.only`, and unconditional skips or todos;
- a conditional skip without an adjacent reason;
- `waitForTimeout`, snapshot matchers and retries;
- an empty test selection passing.

A conditional skip names its external condition next to it; delete a test
instead of skipping it forever. Do not mask flakes with automatic retries. Fix
them, or move them out of blocking CI with a reason and a named owner until
they are reliable.

Choose compatibility checks from `docs/support.md` for the behavior changed.
Use more than one synthetic configuration when testing configurable behavior;
avoid fixtures that only prove a contributor's hostname, account or filesystem.
Browser and installed-service claims need evidence from those actual surfaces.
