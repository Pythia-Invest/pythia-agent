---
name: implement-plan
description: Execute an existing implementation plan only when the user explicitly asks to implement that plan or invokes $implement-plan. Do not activate for ordinary development, fixes, or a generic request to proceed.
disable-model-invocation: true
---

# Implement plan

Use this workflow only for the user's explicit request for this specific plan
operation. An existing plan, another skill's handoff, or a generic "go on" is
not permission to start it. Do ordinary development and testing directly.
Stop applying this workflow when the user switches back to free development.

The supervisor owns the whole plan, integration, evidence, and judgment;
implementers own bounded edits. In this selected workflow, delegate product
implementation and review fixes; the supervisor updates bookkeeping, inspects
changes and runs verification. Reuse a worker for adjacent tasks or fixes when
its ownership remains coherent. If native implementers are unavailable, report
that limitation and execute authorized edits directly; independent review still
requires a separate context.

Inherit the user-selected model for implementers, qualifiers and reviewers.
Honor an explicit user override and report an unexpected effective fallback
when the tool exposes it. Do not introduce automatic cost-based routing. A
cross-provider/harness worker needs explicit user authorization and repository
support. Review context isolation follows the review
skill; copying the supervisor transcript is not independent review.

## Preflight

1. Locate the approved plan under `.private/plans/<branch>/`. Read it in full,
   including decisions, rejected alternatives, task graph, ownership, waves,
   acceptance, qualification, and review.
2. Read root and nested `AGENTS.md`, governing public docs/ADRs, matching
   `.agents/rules/*.md` and `.agents/change-validation.md`.
3. Inspect current source and worktree state. Preserve unrelated changes and
   stop only when an intended writer cannot avoid overlapping user work.
   Reconcile moving baselines before integration; mark exactly which tasks are
   authorized now and which await scope, ownership or external resources. An
   existing plan does not make its prerequisite mechanisms proven.
4. Trace every plan invariant to its source. A material challenge uses
   `.agents/decision-challenges.md`; never drift in code.
5. When the plan identifies a material native contract, read
   `references/native-contract-qualification.md` and qualify it before
   dependent work.

## Execute safe waves

Give an implementer exactly one task with acceptance criteria, ownership,
dependencies, governing sources, verification, and decision invariants. State
that other work may be active and unrelated changes must survive. Parallelize
only disjoint writers; serialize shared files and generated output.

After each task, inspect the actual diff, callers, consumers, native path,
failure behavior, tests, and scope. Reject unsupported abstractions, partial
work, custom translations without an owning invariant, and fixtures without
contract provenance. Route ordinary corrections to the same implementer.

Follow `references/qualification-and-review.md` after assembled deterministic
checks. Final validation reruns affected focused checks and appropriate
repository gates, then records exact outcomes and gaps in the private execution
log. Create or finalize a separate test-plan document only when the user has
explicitly requested it. Do not automatically invoke `create-test-plan` or
`run-test-plan`; ordinary verification does not need either workflow.

## Public decision completion gate

Before material work is declared locally validated or complete, compare the
accepted decisions in private records with public product docs and ADRs.
Distill every lasting product or architecture decision into a self-contained
public owner with context, ruling, rationale, consequences, and relevant
rejected alternatives. Do not publish raw records, require ignored runbooks to
be committed, or treat distillation as permission to publish or deploy.

Finish with a decision-fidelity and subtraction audit: map each invariant to
implementation and evidence, record deviations, and remove project-owned
machinery that the native path or a current requirement does not need. Report
files, tests, review verdicts, qualification, risks, and approvals still open.
Use truthful status: implementing, locally-validated, rollout-pending or complete.
Local code completion does not close required acceptance or external rollout.
Do not commit or push.

## References

- `.agents/skills/create-test-plan/SKILL.md`
- `.agents/skills/review/SKILL.md`
- `.agents/decision-challenges.md`
- `references/native-contract-qualification.md`
- `references/qualification-and-review.md`
