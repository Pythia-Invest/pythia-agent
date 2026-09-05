---
name: run-test-plan
description: Execute an existing test-plan document only when the user explicitly asks to run that plan or invokes $run-test-plan. Do not activate for ordinary tests, verification, or showing a preview.
disable-model-invocation: true
---

# Run test plan

Use this workflow only for the user's explicit request for this specific plan
operation. An existing plan, another skill's handoff, or a generic "go on" is
not permission to start it. Do ordinary development and testing directly.
Stop applying this workflow when the user switches back to free development.

## Preflight

Read `.private/plans/<branch>/test-plan.md` (or `current` when no branch), the
implementation plan, public product docs, root and nested `AGENTS.md`,
`.agents/change-validation.md`, and matching rules. If the runbook is missing,
draft, contains placeholders, or lacks criteria, scopes, bounds, evidence, or
cleanup, explain what is missing and ask whether the user wants the runbook
created or repaired; do not invoke another planning skill automatically.

Verify any required runtime qualification is current. Record the actual Git ref,
commit when one exists, and relevant tracked/untracked source state. A commit is
not required: explicitly authorized dirty source may be tested and recorded.
Behavior-affecting changes inside a scenario scope make only that evidence
stale.

Validate commands and targets without mutation, then batch all missing
approvals once. The agent owns setup, execution, evidence capture, and cleanup;
the user owns only approvals and named product judgments.

## Execute

For each selected scenario:

1. Recheck the source scope and target identity.
2. Execute within the runbook's time, attempt, service, data, and cost bounds.
3. Capture commands, outputs, identities, timing, observations, and evidence
   before cleanup.
4. Classify non-passes as hard stop, product failure, evidence gap, or runbook
   defect. Only unsafe, unowned, unauthorized, stale, or out-of-bound state
   forces immediate cleanup.
5. Make the live surface or a bounded trace visible before asking the exact
   verdict question. Never claim the user saw or tried something that was not
   actually shown.
6. Record deterministic proof as `PASS`, `PARTIAL`, `FAIL`, `BLOCKED`, or
   `STALE`, separately from `ACCEPT`, `ACCEPT WITH GAP`, `REJECT`, or
   `NOT REQUIRED`.

Preserve test integrity. Do not edit product code during the run. A narrow
runbook-command correction may be recorded when criteria, scope, authority,
bounds, and behavior do not change. Evidence challenging an accepted ruling
uses `.agents/decision-challenges.md`.

Write `.private/plans/<branch>/test-results.md` with source under test, scenario
summary, evidence, failures/blockers, cleanup, and stale or untested gaps. Do
not commit, push, publish private records, or merge evidence from incompatible
source states into a pass.
