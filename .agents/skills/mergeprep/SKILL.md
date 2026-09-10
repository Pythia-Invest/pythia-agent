---
name: mergeprep
description: Drive an existing pull request to human-merge readiness by triaging review, fixing material defects, settling checks, and reconciling base drift. Use when the user says "mergeprep" or "prepare PR for merge".
---

# Mergeprep

Drive one existing PR to human-merge readiness. Read governing instructions and
`.agents/change-validation.md`; use `gh` for GitHub operations.

An explicit mergeprep request authorizes relevant fixes, verification, commits,
normal pushes, review replies, handled-thread resolution and re-review requests.
It includes marking a draft ready after its blockers are resolved, unless the
user reserves that decision. It does not authorize merge, deploy, rebase,
force-push, changed product scope or publication of private records. Existing
session restrictions still apply; a workflow name cannot override them.

## Establish the target

Resolve the PR, worktree, exact `head -> base`, local/remote SHAs, draft state,
mergeability, configured checks/review requirements and base drift. Fetch before
judging freshness. Stop only the affected path if the destination is unexpected
or reconciling local/remote work would overwrite unrelated changes.

GitHub owns live PR state. For an interrupted or long-running session, keep a
small ignored `.private/plans/<branch>/mergeprep.md` note with the expected head,
findings, actions, evidence and next step. Never commit status-only bookkeeping
that creates a new head and restarts the checks it records.

## Readiness loop

1. Inspect checks, review bodies, conversation comments and all unresolved inline
   threads for the same head. Use the GitHub API when summary views omit threads.
   Restart inspection when the head changes. A green review status does not
   prove its comments were addressed; skipped, timed-out or stale coverage is
   not a passing review.
2. Let an active automated review finish delivering its report, then classify
   all known findings before batching fixes. Classify each as material fix,
   already fixed, duplicate/stale, invalid, nitpick/overengineering, or decision
   escalation. A material fix needs acceptance or a demonstrated correctness,
   security, data-integrity, operability or required-gate defect. Record concise
   reasons for declined findings; reviewer preference cannot change a ruling.
3. Diagnose failed checks from logs before editing or retrying. Do not convert
   outages, unavailable secrets or rate limits into speculative source fixes.
   Use `resolve-conflicts` for relevant base drift. Continue independent fixes
   while a genuine product/authority decision is pending.
4. Make the smallest coherent correction in existing owners, add proportionate
   regressions for behavioral defects and verify affected consumers. Reuse
   valid evidence; follow the repository's required checks without blindly
   rerunning every suite. Commit relevant changes and push normally.
5. Verify the new remote head and that each accepted fix is present before
   replying to and resolving its thread. Re-fetch threads to confirm closure.
   Declined/invalid findings get their concise rationale. Update the PR body
   when behavior, compatibility or verification changed; fold facts into the
   existing body without appending duplicate summaries.
6. After every push, wait for applicable current-head checks and review. Scan
   delivered comments again. Request missing configured automated review or a
   required human re-review once per head when the workflow supports it. Do not
   invent a review bot or wait for optional human approval. Track requests to
   avoid duplicates; pending automation is not itself a blocker.
7. Recheck head/base, mergeability, requirements, threads and body before calling
   the PR ready. All intended fixes must be pushed, applicable checks must pass,
   configured review must settle and no material finding or decision may remain
   unresolved. Report explicitly when required evidence cannot be obtained.

Wait without busy polling and give concise progress updates. External outage,
unavailable required reviewer or new authority can block completion; ordinary
pending checks do not require the user to say “continue.”

Once ready, post one brief `Mergeprep finished` comment summarizing material
changes, grouped declines and current-head readiness. Check for an existing
completion comment for this run/head before posting. Report URL, head SHA,
checks, review/thread state, compatibility actions, residual risk and readiness.
Never merge the PR.
