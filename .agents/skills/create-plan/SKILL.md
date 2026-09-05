---
name: create-plan
description: Create an implementation plan only when the user explicitly requests a plan or invokes $create-plan. Do not activate for ordinary coding, discussion, debugging, or requests to think through an approach.
disable-model-invocation: true
---

# Create plan

Use this workflow only for the user's explicit request for this specific plan
operation. An existing plan, another skill's handoff, or a generic "go on" is
not permission to start it. Do ordinary development and testing directly.
Stop applying this workflow when the user switches back to free development.

Create a plan another agent can execute without reconstructing the design.

## Establish context and decisions

1. Resolve the real branch (use `current` if unborn or detached) and write to
   `.private/plans/<branch>/<feature>.md`. Ask before replacing an existing
   plan.
2. Read root and nested `AGENTS.md`, `docs/product.md`, applicable architecture
   docs and ADRs, matching `.agents/rules/*.md`, current owning code, and any
   relevant private working record. Public product contracts outrank a private
   note unless the user explicitly changes them.
3. State the trust boundary. Record each material user ruling as an invariant
   with its source, rationale, and rejected alternatives. Do not silently
   strengthen or weaken it.
4. Ask one or two questions at a time only for choices that materially change
   behavior, scope, architecture, authority, or validation. Repository and
   native-contract facts are not user questions.
5. When an external contract shapes the work, read
   `references/native-contract.md` and schedule the smallest qualification
   before dependent implementation.

## Build the task graph

Give every task one coherent responsibility, explicit dependencies and write
ownership, observable old-versus-new criteria, narrow verification, and any
approval boundary. Cite the decisions it realizes. Assign waves only when
writers and generated outputs are disjoint; serialize shared contracts.

End implementation with one bundled independent review. Classify autonomous
runtime qualification separately from guided local acceptance. Add a test-plan
document task only if the user explicitly requested that document. Otherwise
record suitable verification in the implementation plan without invoking
`create-test-plan` or requiring a separate runbook.

Use `references/plan-template.md`. Record rule candidates without creating
them during planning.

## Compliance and completion

Freeze the draft and have a fresh reviewer inspect the request, plan, governing
public sources, owning code, task graph, authority boundaries, and rejected
alternatives. Correct material findings in their owning sections and obtain a
focused closure review; do not turn preferences into requirements.

Before declaring the plan ready, identify every accepted product or
architecture decision that the implementation must distill into public docs or
an ADR. The public artifact must preserve context, ruling, rationale,
consequences, and relevant rejected alternatives. Raw plans stay ignored and
need not be committed.

Do not implement, commit, push, or cross an external-write boundary. If evidence
challenges an accepted ruling, follow `.agents/decision-challenges.md`.

## References

- `.agents/skills/create-test-plan/SKILL.md`
- `.agents/skills/implement-plan/SKILL.md`
- `.agents/skills/review/SKILL.md`
- `.agents/decision-challenges.md`
- `references/native-contract.md`
- `references/plan-template.md`
