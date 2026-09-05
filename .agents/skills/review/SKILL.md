---
name: review
description: Independently review an uncommitted or explicitly scoped committed diff in fresh context. Use when the user says "review", "check my changes", or wants a quality pass on current work.
---

# Review

Review one frozen target independently. If this context implemented or
materially designed it, use a fresh native reviewer; do not label self-review
independent.

## Procedure

1. Resolve the requested base/head or include tracked changes plus untracked,
   non-ignored files. Record the exact target identity. Stop edits during the
   cold first pass.
2. Read public product/architecture docs, root and nested `AGENTS.md`, matching
   `.agents/rules/*.md`, and relevant callers and consumers. A private plan may
   supply acceptance criteria but is not public product authority.
3. Trace behavior through producer, transport/proof, consumer, state mutation,
   promotion, failure, and fallback. Check builder/runtime separation,
   credentials, preservation, concurrency, publication, and source ownership.
4. For external contracts, require installed source/types, official docs, or a
   bounded approved observation. A custom DTO or fixture is not its own oracle.
5. Draft the complete findings before reading implementer claims or test
   summaries. Then verify those claims as evidence.

Lead with material findings ordered by severity. Each includes a path/line,
issue, violated contract or criterion, and smallest credible fix. Wording,
optional refactors, and speculative hardening are non-blocking. If no issue is
found, say so and name residual evidence gaps.

On closure, inspect the exact fix and adjacent seams rather than restarting a
whole review unless the design materially changed. A ruling that appears
materially wrong uses `.agents/decision-challenges.md`, not a disguised review
fix. Do not edit, commit, push, or run broad formatters.
