# Qualification and bundled review

## Runtime qualification

Run assembled qualification after deterministic checks and before freezing the
review target. The supervisor selects scenarios and judges evidence; delegated
executors only run bounded checks.

Record one representative path per changed assembled seam plus a failure path
only when failure behavior changed. Capture exact criteria, source scope,
commands, state, bounds, evidence, cleanup, and `PASS`, `FAIL`, or
`EVIDENCE GAP`. Keep raw receipts in ignored `.private/` or `.local/` state.
Route every verified `RQ-*` defect to its owning implementation task with a
deterministic regression. Behavior-affecting edits invalidate only affected
evidence.

## Bundled independent review

After integration, qualification, generated adapters, and plan bookkeeping
settle, freeze the feature-complete target. Follow
`.agents/skills/review/SKILL.md`. Use a dedicated prompt-surface reviewer when
model-visible input changes.

Combine material findings into a stable blocker register in the private
execution record. Verify each against accepted behavior, send one coherent fix
wave to owning implementers, rerun affected evidence, and return the exact delta
to the same reviewers for closure. Stop only for a real authority/scope/resource
boundary or repeated non-progress; do not create an open-ended hardening loop.
