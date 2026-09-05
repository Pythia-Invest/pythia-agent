---
name: mergeprep
description: Drive an existing pull request to human-merge readiness by triaging review, fixing material defects, settling checks, and reconciling base drift. Use when the user says "mergeprep" or "prepare PR for merge".
---

# Mergeprep

Use `gh` for all GitHub operations. Never merge, deploy, rebase, force-push, or
publish private records.

## Readiness loop

1. Resolve the exact PR, `head -> base`, local/remote head SHAs, mergeability,
   configured checks, reviews, comments, unresolved threads, and base drift.
   Restart inspection if the head changes.
2. Classify each finding as material fix, already fixed, duplicate/stale,
   invalid, nitpick/overengineering, or decision escalation. A material fix must
   cite acceptance or a demonstrated correctness, security, data-integrity, or
   operability defect.
3. Prefer the smallest correction in an existing owner. Use `resolve-conflicts`
   for material base drift. Ask the user only when public docs and accepted
   decisions cannot resolve a genuine choice.
4. Add a focused regression for behavioral defects, run the smallest proving
   check, then follow `commit` and push normally to the PR branch.
5. After the push, verify the remote head, reply to and resolve handled threads,
   and wait for current-head checks and re-review. Do not resolve a material
   thread before its fix is pushed and verified.
6. Repeat until current-head checks pass, required review settles, material
   threads close, mergeability is current, the PR body matches the head, public
   decisions are self-contained, and no intended fix remains local.

Pending automation is not a blocker; wait without busy polling. External
outage, unavailable required reviewer, or a choice needing new authority is a
real blocker. Decline speculative machinery with a concise rationale rather
than coding it.

Once ready, post one brief `Mergeprep finished` comment summarizing material
changes, declined groups, and current-head readiness. Report the URL, head SHA,
checks, review/thread state, compatibility actions, residual risk, and readiness.
