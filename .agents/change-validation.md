# Change validation

Select the cheapest sufficient evidence for the changed behavior; these are
choices by scope, not a ladder every task must climb:

- Small isolated changes need focused deterministic checks or tests.
- Shared contracts, lifecycle, credentials, packaging and cross-workspace
  changes need checks of affected consumers and failure boundaries.
- Use `just check` and `just test` for broad integration or publication
  readiness, and whenever the affected scope requires the full gates. Required
  CI and explicitly agreed acceptance checks still apply.
- Qualify a changed assembled runtime seam only when narrower evidence cannot
  prove it, after deterministic checks and within existing authorization.

Add regressions for meaningful behavior, not tests that merely mirror the
implementation or match instruction wording. Once sufficient checks pass, finish;
broaden or repeat them only for new edits, failures or unresolved concerns.

Keep network/registry auditing in `just audit`. Provider calls, credentials,
external writes, host services, destructive actions, and long-lived processes
remain separately approval-gated. Use disposable state, own every resource,
and clean it in `finally` or an equivalent guaranteed path.

Report exact commands, outcomes, and untested gaps. Do not reuse green evidence
after behavior-affecting source changes.

Documentation and instruction-only changes normally need link, scope and
projection checks, not an application build or live model run. For prompt
behavior changes, follow [prompting guidance](../docs/prompting.md); do not treat
matching prompt snapshots as proof of better judgment.

## Keeping CI clean

CI is described in [ADR 0037](../docs/decisions/0037-one-required-ci-gate.md);
`tooling/check-workflows.mjs` enforces its mechanical invariants. Beyond those:

- Before pushing, run `just check-static` (seconds). Before asking for a
  merge, run `just check` and the tests for what changed. CI runs the same
  `just` recipes, so a local pass predicts CI.
- Merge only when `CI gate` is green on the head commit. A cancelled or
  skipped run is not green.
- A red `main` or red nightly run comes before new work: revert or repair the
  owner, and read the failing log instead of re-running it.
- Never add retries, `continue-on-error`, or a bare skip to make CI pass. A
  nondeterministic failure is a bug: record the run and signature and fix the
  root cause. Until it is fixed, move it out of the blocking path with an
  adjacent reason and a named owner.
- CI logic lives in `just` recipes, not in workflow YAML. A new blocking check
  joins an existing job or becomes a job in the gate's `needs`. A job that
  should not block is added to the checker's advisory list, with a reason in
  the workflow.
- Keep the gate hermetic. Blocking jobs use no credentials, providers or
  Hermes, and reach the network only to install pinned dependencies.
  Registry audits, Hermes captures and assembled qualification stay nightly.
- Keep the gate fast: about five minutes median. A change that adds more than
  30 seconds to the slowest job says so in its pull request and names what it
  protects. Turbo tasks without outputs depend on `transit`, not `^self`.
  Every tsconfig is type-checked in its workspace's `check` script, and test
  layers are chosen by directory.
- Timing assertions in blocking tests keep at least five times the measured
  CI margin, noted beside the assertion; anything tighter is a benchmark, not
  a test.
