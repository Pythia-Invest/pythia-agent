---
name: create-pr
description: Commit relevant work, integrate the destination branch, push normally, and open an issue-linked GitHub pull request. Use when the user says "create PR", "open a PR", or asks to propose completed branch work through GitHub.
---

# Create PR

An explicit request authorizes relevant staging, commit, destination update,
normal push, and PR creation. It does not authorize merge, deploy, rebase,
force-push, unrelated work, or publishing `.private/` records.

## Procedure

1. Read root/nested instructions and inspect status, branch, remotes, recent
   history, and an existing PR. Resolve `head -> base` from the user, approved
   plan/current work, existing PR, or default branch, in that order. Resolve the
   configured remote instead of assuming `origin`. Stop on the destination
   branch or an ambiguous destination; never silently retarget an existing PR.
2. Use `gh` for GitHub reads/writes. Fetch the remote and inspect committed,
   staged, unstaged and untracked changes. Include relevant work and exclude
   unrelated changes, secrets, ignored state and generated tool projections.
   Inspect the full base-to-head proposal: a scoped new commit does not make
   earlier branch commits suitable for this PR.
3. Resolve the issue from the user, relevant plan, branch number or a confident
   `gh` match; ask if no confident match exists. Read the current issue title
   and use `#N Issue title`. Settle ambiguous scope, issue and destination before
   committing or publishing. Do not create an issue merely to satisfy a title.
4. Run the smallest relevant sanity check under `.agents/change-validation.md`.
   Reuse applicable current evidence and run required checks; neither a blanket
   build nor a blanket ban on local tests is appropriate. Do not claim stale or
   unexecuted verification.
5. Ensure accepted material decisions are present in self-contained public docs
   or ADRs, then follow the `commit` skill for relevant local changes. Private
   plans may inform the body but are neither published nor required to commit.
6. Fetch again. If base is not an ancestor of head or integration is unsafe,
   follow `resolve-conflicts`. Recheck affected verification after integration;
   never rebase or force-push by default.
7. Build a concise body with What changed, Why, material Key decisions when
   present, Compatibility, Issue, and concrete Test plan. Use `Closes #N` only
   when the PR fully resolves the issue.
8. Pass the exact multiline body through a body file or structured argument.
   Push normally and create with `gh pr create`, or update the matching existing
   PR instead of creating a duplicate. Read it back to verify URL, title, body,
   head, base, and head SHA against the published proposal. Do not wait for CI
   or post comments.

On success return only the PR URL. If blocked, report the concrete blocker
instead of returning a URL that implies success. Do not merge, deploy, sign/tag,
or bypass hooks.
