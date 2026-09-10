---
name: resolve-conflicts
description: Resolve active Git conflicts or integrate a stale branch while preserving both sides' intent. Use when the user says "resolve conflicts", "branch is behind", "re-apply changes", or a PR cannot merge cleanly.
---

# Resolve conflicts

## Diagnose and understand

Inspect status, current operation, branch-only commits, destination changes, and
the merge base and relevant commit messages on both sides. Include rename,
delete and binary entries from Git’s unmerged index; text markers alone are
not a complete conflict inventory. Classify each overlap as additive, structural, overlapping,
stale, or superseded. Read both versions and their intent before editing; never
pick ours or theirs blindly.

Prefer a normal destination merge into the current branch. Rebase, force-push,
and creating a replacement branch require explicit user authorization. During
an existing merge, cherry-pick or rebase, preserve the operation and resolve
every unmerged state according to intent. Continuing an operation that creates
a commit or rewrites history still needs applicable session authorization;
otherwise leave the resolution ready and report the remaining action. An
existing rebase does not authorize starting a new one. Skip a commit only when
its entire intended change is demonstrably superseded and skipping is within
the authorized operation. Preserve the original branch when re-applying work.

Reconcile dependency manifests first and regenerate conflicted lockfiles using
their owning package manager and current dependency policy. Do not hand-merge
generated output or restore obsolete generated files from one side.

Hunt semantic conflicts after text markers are gone: renamed contracts,
changed required fields, missing registration, lifecycle ordering, duplicate
handlers, moved safety checks, configuration drift, and tests that no longer
protect the same behavior. Read root/nested instructions and public decisions
for touched paths.

Use `.agents/change-validation.md`: build affected executable consumers and run
focused tests when relevant; prose-only resolutions need scope/link checks.
Verify Git has no unmerged entries, then inspect the combined staged/worktree
result as well as the eventual destination-to-head diff. Compare intended branch
changes and retained destination behavior so neither side is silently dropped. Commit the conflict
resolution only when the user's request authorizes it; do not push unless
explicitly requested. Never reset or delete unrelated changes.
