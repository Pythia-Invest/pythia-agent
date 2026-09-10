---
name: commit
description: Create a session-scoped commit from relevant local changes. Use when the user says "commit", "commit this", or "commit and push".
---

# Commit

An explicit request to commit authorizes one session-scoped commit; pushing is
separate and requires explicit authorization.

Inspect status and staged, unstaged, and untracked changes. Determine scope from
the current request and actual diff. If no relevant change exists, report that
without creating an empty commit. Stage explicit paths or selected hunks only,
never `git add .` or `git add -A`. A relevant filename does not make all its
hunks relevant. Preserve unrelated worktree changes and pre-existing staged
content; unrelated entries already in the index must not enter this commit.
Use a scoped commit/index when needed without resetting the user’s index. Ask
only when intended and unrelated work cannot be separated reliably.

Never stage `.private/`, `.local/`, generated `.claude/`, `.codex/`, or
`.cursor/` projections, credentials, investment data, provider responses,
databases, caches, logs, model output, dependencies, or other ignored device
state. Accepted decisions required for the work must already be distilled into
public docs or ADRs; the private record is not a commit prerequisite.

Inspect the staged diff and `git diff --cached --check`. Write an imperative
subject under 72 characters, with a conventional prefix when useful. Commit
without asking again when scope is clear. Respect hook failures and never bypass
them. Do not amend, rebase, or force-push.

Verify the resulting commit contains exactly the intended changes and that
unrelated staged/worktree content remains. Report the hash, message, and short
stat. Push normally only when explicitly authorized for this branch; set upstream
tracking when needed. Report a rejected push without rewriting remote history.
