# Implementation plan template

```markdown
# {Title}

Branch: `{branch}`
Issue: #{number, if any}
Created: {date}
Status: planning | implementing | locally-validated | rollout-pending | complete

## Context
## Decisions
| # | Decision | Source | Ruling / invariant | Rationale | Rejected alternatives |
|---|---|---|---|---|---|

## Native contract
- Dependency/baseline and owner:
- Operation-specific contract:
- Evidence source:
- Required Pythia transformations:
- Prohibited reinvention:
- Unresolved assumptions and checkpoint:

## Scope
### In scope
### Out of scope

## Execution boundary
- Authorized now:
- Approval-gated or later:

## Risks and edge cases
## Implementation tasks
| ID | Title | Depends on | Owns | Status | Acceptance criteria |
|---|---|---|---|---|---|

## Execution waves
| Wave | Tasks | Why ownership is disjoint |
|---|---|---|

## Rule candidates
## Quality gates
## Runtime qualification
- Required:
- Changed assembled seams and criteria:
- Approval/resource envelope:
- Evidence owner and location:

## Guided local acceptance
- Required:
- Validation-plan task:
- Canonical artifact: `.private/plans/{branch}/test-plan.md`

## Review procedure
## Public decision distillation
- Public docs/ADRs that must receive accepted material decisions:

## Plan compliance review
## Execution log
```

Omit the native-contract section only when no external or moving contract shapes
the design. Private plans and evidence remain ignored; public decisions must be
self-contained.
