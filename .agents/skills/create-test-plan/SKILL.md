---
name: create-test-plan
description: Write or update a test-plan document only when the user explicitly requests one or invokes $create-test-plan. Ordinary testing, UI previews, and other skills do not trigger this workflow.
disable-model-invocation: true
---

# Create test plan

Use this workflow only for the user's explicit request for this specific plan
operation. An existing plan, another skill's handoff, or a generic "go on" is
not permission to start it. Do ordinary development and testing directly.
Stop applying this workflow when the user switches back to free development.

Own `.private/plans/<branch>/test-plan.md`. Draft it after decisions and
behavioral criteria freeze; finalize the same file only after integration,
deterministic checks, and any required runtime qualification are current.

## Qualify and allocate evidence

Guided acceptance is appropriate for a user-visible or cross-process workflow,
persistent-state change, major handoff, explicit walkthrough request,
or product judgment automation cannot supply. Docs-only and fully mechanical
work normally needs no runbook.

Read the implementation plan, public product docs, root and nested `AGENTS.md`,
`.agents/change-validation.md`, `.agents/testing.md`, matching rules, owning
source, and repository commands. Use one canonical runbook; never fork a second.

Put malformed inputs, retries, concurrency, recovery matrices, schemas, and
other mechanics in automated tests. Keep one representative live workflow and
only product judgments assigned to the user. Runtime qualification is a
prerequisite, not a scenario the user repeats.

## Write the runbook

Record:

- status, branch, scope, and frozen behavioral criteria;
- the smallest behavior-affecting source paths for each scenario;
- current automated and runtime-qualification prerequisites;
- exact commands, disposable state, bounds, evidence paths, and cleanup;
- hard stops versus failures that still allow useful partial evidence; and
- one exact verdict question for each user judgment.

Do not require a clean commit, signature, tag, provider, or private record to be
published. The runner records the actual ref plus tracked/untracked state it
tests. A behavior-affecting source edit invalidates only its affected scenario.

Suggested sections are Scope, Qualification, Source scopes, Frozen criteria,
Automated prerequisites, Runtime qualification, Bounds and isolation,
Continuation rules, Guided scenarios, Cleanup, Invalidation, and Results
location. Results belong beside the runbook as `test-results.md`.

Finalization requires runnable commands, observable pass/fail criteria, current
qualification where required, explicit approvals, and exact cleanup. Do not run
the plan, commit, push, install new dependencies, or cross an approval boundary.
