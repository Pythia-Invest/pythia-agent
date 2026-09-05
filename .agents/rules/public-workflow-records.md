---
description: "Keep working records private and make accepted decisions public and self-contained."
paths:
  - ".agents/skills/**/*"
  - ".agents/agents/**/*"
  - "docs/decisions/**/*"
  - "AGENTS.md"
globs:
  - ".agents/skills/**/*"
  - ".agents/agents/**/*"
  - "docs/decisions/**/*"
  - "AGENTS.md"
---

# Public workflow records

Working plans, grilling notes, test plans, results, and raw receipts belong in
ignored `.private/plans/<branch>/`. Never require those records to be tracked,
committed, published, or available to an ordinary runtime.

Before material work is called complete, distill accepted product or
architecture decisions into public documentation or an ADR. Preserve enough
context, the ruling, rationale, consequences, and relevant rejected alternatives
for a contributor to understand the result without the private record. This is
a workflow completion criterion, not a publication approval gate.
