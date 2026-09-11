# Qualification and bundled review

## Runtime qualification

Qualify changed assembled runtime seams only when narrower evidence cannot
prove them, following `.agents/change-validation.md`. When needed, run this
after deterministic checks and before freezing the review target. The supervisor
selects scenarios and judges evidence; delegated executors run bounded checks.
Documentation-only changes do not require a runtime qualification. Reuse an
existing authorization for the same target/actions/bounds. When new authority
is needed, make one concrete request covering the bounded scenario and needed
repair/rerun reserve; elapsed time does not grant approval. Provider-free owned
disposable checks need no extra permission only when they cross no root approval
boundary. Opening a listener, starting a long-lived service, changing credentials
or deleting user data still needs applicable authorization, even with fake
providers. Reuse existing authorization for the same actions and targets.
Executors cannot broaden scenarios or decide the verdict; inspect their
underlying evidence before classifying it.

Record one representative path per changed assembled seam plus a failure path
only when failure behavior changed. Capture exact criteria, source scope,
commands, state, bounds, evidence, cleanup, and `PASS`, `FAIL`, or
`EVIDENCE GAP`. Keep raw receipts in ignored `.private/` or `.local/` state.
Route every verified `RQ-*` defect to its owning implementation task with a
deterministic regression. Behavior-affecting edits invalidate only affected
evidence.

## Bundled independent review

After integration, qualification, generated adapters, and plan bookkeeping
settle, freeze the feature-complete target. Do not edit from partial findings;
wait for all assigned first-pass reports. Follow
`.agents/skills/review/SKILL.md`. Use a dedicated prompt-surface reviewer when
model-visible input changes.

Combine reports into a deduplicated blocker register in the private execution
record: ID, violated criterion, evidence, owner and status. Verify candidates
against accepted behavior, then freeze the material set for one coherent fix
wave. Rerun affected evidence and return the exact delta to the same reviewers
for closure, not another whole-diff discovery pass. Contract uncertainty calls
for qualification rather than speculative defensive code.

Continue safe in-scope repair while blockers close. A cycle makes progress when
at least one blocker closes and none is introduced, worsened or reopened. After
two consecutive non-progress cycles, checkpoint the causes and needed decision
or evidence instead of oscillating. A genuine authority/scope/resource boundary
can require an earlier checkpoint. Do not create an open-ended hardening loop.
