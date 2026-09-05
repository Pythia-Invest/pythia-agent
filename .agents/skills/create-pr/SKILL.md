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
   history, and an existing PR. Resolve `head -> base` from the user, current
   public work, existing PR, or default branch. Stop on the destination branch.
2. Use `gh` for GitHub reads/writes. Fetch the remote. Include all relevant
   tracked/untracked work and exclude unrelated changes, secrets, ignored state,
   and generated tool projections. Follow the `commit` skill.
3. Resolve the issue number from the user, current public branch context, or a
   confident `gh` match; never invent it. Title the PR `#N Issue title`.
4. Run the smallest relevant repository sanity check. Use current implementation
   evidence; do not claim a test that was not run.
5. Fetch again. If base is not an ancestor of head or integration is unsafe,
   follow `resolve-conflicts`. Never rebase or force-push by default.
6. Ensure accepted material decisions are present in self-contained public docs
   or ADRs. Private plans may inform the body locally but are neither published
   nor required to be committed.
7. Build a concise body with What changed, Why, material Key decisions when
   present, Compatibility, Issue, and concrete Test plan. Use `Closes #N` only
   when the PR fully resolves the issue.
8. Push normally, create with `gh pr create`, and read it back to verify URL,
   title, head, base, and head SHA. Do not wait for CI or post comments.

Return only the PR URL. Do not create a duplicate PR, merge, deploy, sign/tag,
or bypass hooks.
