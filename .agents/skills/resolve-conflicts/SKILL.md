---
name: resolve-conflicts
description: Resolve active Git conflicts or integrate a stale branch while preserving both sides' intent. Use when the user says "resolve conflicts", "branch is behind", "re-apply changes", or a PR cannot merge cleanly.
---

# Resolve conflicts

## Diagnose and understand

Inspect status, current operation, branch-only commits, destination changes, and
the merge base. Classify each overlap as additive, structural, overlapping,
stale, or superseded. Read both versions and their intent before editing; never
pick ours or theirs blindly.

Prefer a normal destination merge into the current branch. Rebase, force-push,
and creating a replacement branch require explicit user authorization. During
an existing merge or cherry-pick, resolve every unmerged state (`UU`, `DD`,
`AU`, `UA`, `DU`, `UD`, `AA`, rename, and binary) according to intent, then
continue the operation. Preserve the original branch when re-applying stale
work elsewhere.

Hunt semantic conflicts after text markers are gone: renamed contracts,
changed required fields, missing registration, lifecycle ordering, duplicate
handlers, moved safety checks, configuration drift, and tests that no longer
protect the same behavior. Read root/nested instructions and public decisions
for touched paths.

Build and run focused tests. Inspect the final destination-to-head diff and
compare intended branch changes so nothing was dropped. Commit the conflict
resolution only when the user's request authorizes it; do not push unless
explicitly requested. Never reset or delete unrelated changes.
