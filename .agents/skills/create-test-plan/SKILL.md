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
source, and repository commands. Use an implementation plan if one exists; it
is not a prerequisite for an explicitly requested standalone walkthrough. Use
one canonical runbook, including `current` for a detached/unborn branch. In
draft mode mark unresolved commands/scopes instead of guessing; finalization
removes placeholders and requires current prerequisite evidence. Missing
qualification keeps the runbook draft, without launching `implement-plan`.

Put malformed inputs, retries, concurrency, recovery matrices, schemas, and
other mechanics in automated tests. Keep one representative live workflow and
only product judgments assigned to the user. Runtime qualification is a
prerequisite, not a scenario the user repeats. Explain why each retained
scenario needs a live seam, a product judgment or a requested walkthrough.
Show the main feature through a faithful surface when practical; state the
limitation when no such surface is available. A dev server can demonstrate UI
behavior, but production-specific criteria need production-runtime evidence.

## Write the runbook

Record:

- status, branch, scope, and frozen behavioral criteria;
- the smallest behavior-affecting source paths for each scenario;
- current automated and runtime-qualification prerequisites;
- exact commands, disposable state, bounds, evidence paths, and cleanup;
- hard stops versus failures that still allow useful partial evidence; and
- one exact verdict question for each user judgment.

Give behavioral criteria stable IDs and map each scenario to them. Name
prerequisite dependencies so a failure blocks only scenarios that require it.
Reuse approved session resources across meaningful scenarios and put shared
cleanup at the end; hard stops still trigger immediate safe cleanup. Never ask
the user to replay mechanical checks or collect evidence the agent can capture.

Do not require a clean commit, signature, tag, provider, or private record to be
published. The runner records the actual ref plus tracked/untracked state it
tests. A behavior-affecting source edit invalidates only its affected scenario.

Suggested sections are Scope, Qualification, Source scopes, Frozen criteria,
Automated prerequisites, Runtime qualification, Bounds and isolation,
Continuation rules, Guided scenarios, Cleanup, Invalidation, and Results
location. Use [the compact template](./references/runbook-template.md) as a
starting point; omit inapplicable resource fields rather than inventing limits.
Results belong beside the runbook as `test-results.md`.

Finalization requires runnable commands, observable pass/fail criteria, current
qualification where required, explicit approvals, and exact cleanup. Do not run
the plan, commit, push, install new dependencies, or cross an approval boundary.
