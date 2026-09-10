---
name: review
description: Independently review an uncommitted or explicitly scoped committed diff in fresh context. Use when the user says "review", "check my changes", or wants a quality pass on current work.
---

# Review

Review one frozen target independently. If this context implemented or
materially designed it, delegate to a fresh native reviewer. Self-review may
help preparation but cannot satisfy independent review.

## Independence and allocation

Inherit the selected model's capability according to repository/user policy,
**not the implementation conversation**. Use an isolated context and a
self-contained brief: observed problem, requested behavior, acceptance criteria,
exact target/base and governing-source locations. Do not supply author
conclusions, rationale or test summaries before the first-pass findings. If the
harness cannot provide independent context, report the missing review rather
than claiming it happened.

Use one reviewer for bounded ordinary changes. For changes to authority,
persistence, schema/identity, concurrency, publication/readiness, external side
effects or cross-stage orchestration, use two independent reviewers when agents
are available: correctness/contract propagation and bypasses/failure paths/missing
proof. Add a dedicated prompt-surface reviewer when model-visible instructions
change, unless this is the sole surface and the assigned reviewer already owns
that focus. Reviewers inherit the selected model unless the user specifies
otherwise. No nested panels or fixed reviewer count for ordinary development;
this allocation applies only when this review workflow is selected. Report an
unavailable required seat as a review gap.

## Procedure

1. Resolve the requested base/head or include tracked changes plus untracked,
   non-ignored files. Record exact target identity and pause edits during the
   first pass. For a task sharing dirty files, freeze the session delta against
   its recorded starting state rather than attributing unrelated edits to it.
2. Read public product/architecture docs, root and nested `AGENTS.md`, matching
   rules and relevant callers/consumers. A private plan may supply acceptance
   criteria but does not replace public product authority or explicit user
   rulings.
3. Trace producer, transport/proof, consumer, state mutation, promotion, failure
   and fallback. Check builder/runtime separation, credentials, preservation,
   concurrency and native ownership. Scope bypass analysis to real authority
   boundaries; do not invent adversaries or unsupported requirements.
4. For external contracts, require installed source/types, official docs or a
   bounded authorized observation. A custom DTO or fixture is not its own oracle.
5. Complete the cold findings before inspecting author claims and test evidence.
   Then verify those claims; tests do not establish their own contract's truth.
   Return one consolidated report after the assigned pass. Intermediate updates
   are progress only; the owner waits for all first passes before editing.

Lead with material findings ordered by severity. Each includes path/line,
issue, violated contract or acceptance criterion, evidence and smallest credible
fix. Wording, optional refactors and speculative hardening are non-blocking. If
no issue is found, say so and name residual evidence gaps.

For closure, the same reviewers inspect listed fixes, exact delta and adjacent
contracts; restart a whole review only after material redesign. Report any
blocker introduced by a fix, while keeping incidental unrelated improvements
separate. A ruling that appears materially wrong uses
`.agents/decision-challenges.md`, not a disguised review fix. Do not edit,
commit, push or run broad formatters.
