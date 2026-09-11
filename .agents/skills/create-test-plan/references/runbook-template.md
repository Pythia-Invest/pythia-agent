# Guided runbook template

Use only for an explicitly requested test-plan document. Replace placeholders
before finalizing; leave unavailable prerequisites visible and the plan draft.
Do not require a commit or duplicate existing automated/runtime proof.

```markdown
# Test plan: {feature}
Branch: {branch or current}
Status: draft | finalized

## Scope and qualification
Requested behavior, existing implementation plan if any, and why guided work
is useful. State which judgments belong to the user.

## Frozen behavioral criteria
| ID | Required behavior | Governing source |
| --- | --- | --- |

## Source scopes and prerequisites
| Scenario | Behavior-affecting paths/commands | Automated/runtime evidence | Dependencies |
| --- | --- | --- | --- |

## Bounds and isolation
Exact target/configuration, disposable state, required authority, applicable
time/call/cost limits and owned services. Evidence locations contain no secrets.

## Continuation
Hard stops, meaningful partial evidence, dependent scenarios and safe reuse.

## S1: {representative scenario}
- Proves / why retained:
- Criteria IDs:
- Agent setup and action: {actual commands and working directory}
- Deterministic expected behavior:
- User-visible surface or trace:
- User verdict question: {exact question, or NOT REQUIRED}
- Evidence path:
- Applicable bound:
- Scenario-specific cleanup, if any:

## Session cleanup
Exact owned targets, stop/removal commands and readback proving cleanup.

## Invalidation
A change to a scenario's behavior-affecting scope stales only its evidence.
Record actual source state at execution, including authorized dirty source.

## Results
Write test-results.md beside this runbook. Record actual source, criterion IDs,
commands/evidence, deterministic outcome, user verdict, gaps and cleanup.
```

A user verdict cannot turn failed or missing mechanical proof into `PASS`.
`ACCEPT WITH GAP` yields `PARTIAL`; required unanswered judgments remain pending.
