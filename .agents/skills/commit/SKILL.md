---
name: commit
description: Create a session-scoped commit from relevant local changes. Use when the user says "commit", "commit this", or "commit and push".
---

# Commit

An explicit request to commit authorizes one session-scoped commit; pushing is
separate and requires explicit authorization.

Inspect status and staged, unstaged, and untracked changes. Determine scope from
the current request and actual diff. Stage explicit paths only, never `git add
.` or `git add -A`. Preserve unrelated user work.

Never stage `.private/`, `.local/`, generated `.claude/`, `.codex/`, or
`.cursor/` projections, credentials, investment data, provider responses,
databases, caches, logs, model output, dependencies, or other ignored device
state. Accepted decisions required for the work must already be distilled into
public docs or ADRs; the private record is not a commit prerequisite.

Inspect the staged diff and `git diff --cached --check`. Write an imperative
subject under 72 characters, with a conventional prefix when useful. Commit
without asking again when scope is clear. Respect hook failures and never bypass
them. Do not amend, rebase, or force-push.

Report the hash, message, and short stat. Push normally only when the same user
request explicitly asks for it.
