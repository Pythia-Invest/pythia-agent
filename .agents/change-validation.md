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
