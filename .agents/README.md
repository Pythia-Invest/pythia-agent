# Development-agent workspace

## Context

Pythia Agent needs ordinary planning, implementation, review, Git, and guided
acceptance workflows in its public development home. Raw working records may
contain exploratory context that is useful while work is active but should not
become a publication dependency or ordinary Hermes input.

## Ruling

`.agents/` is the canonical public home for reusable repository-builder
guidance:

- `skills/` contains reusable contributor workflows. Codex and other tools
  discover this directory natively.
- `agents/` contains the three reusable role definitions.
- `rules/` contains cross-cutting builder guidance with tool-neutral path
  metadata.
- `change-validation.md`, `testing.md`, and `decision-challenges.md` are
  on-demand references shared by the workflows.

Codex and compatible tools use native `.agents/skills` and `AGENTS.md`
discovery. The copy adapters in `scripts/` generate only ignored, tool-native
files where formats differ: Claude skills/rules/roles, Cursor rules, and Codex
TOML roles. They never project runtime seeds and never remove files they did not
previously generate. Repository task aliases are documented by the root
`justfile`; the direct commands are:

```sh
node scripts/ai-sync.mjs
node scripts/sync-agents.mjs
node scripts/sync-rules.mjs
node tooling/check-ai-workspace.mjs
```

Private planning and acceptance records belong in
`.private/plans/<branch>/`. Durable decisions belong in public product docs or
`docs/decisions/`; raw private records are not publication inputs.

## Rationale

One public canonical workspace makes everyday contribution possible without an
internal archive. Native discovery keeps the adapter surface small, while
copying the few incompatible formats gives contributors the same reviewed
instructions without symlinks or machine configuration.

## Consequences

Start builder sessions in this repository or its worktree. A session opened in
another project may retain that project's instructions and skill catalog after
a shell directory change; start a fresh session in the intended project when
that happens. Treat other repositories as reference unless explicitly in scope.

Ordinary development and verification do not require a plan or runbook.
`create-plan`, `implement-plan`, `create-test-plan` and `run-test-plan` are
explicit-only workflows, including their cross-skill handoffs. Use the native
invocation controls as well as precise descriptions; do not re-enable implicit
selection while updating a skill.

### What selecting a workflow does

The skills retain different boundaries deliberately. Reading, explaining or
comparing one does not execute it. The user’s requested scope and existing
session authority take precedence; accepted authorization does not expire
between tasks. These are builder workflows, not investor-facing Hermes skills.

| Skill | Expected result and stopping point |
| --- | --- |
| [grill-me](./skills/grill-me/SKILL.md) | Interview and private decision record; derive facts and delegated engineering details without extra votes. Wait for answers and the next requested action. |
| [create-plan](./skills/create-plan/SKILL.md) | Source-backed private plan with dependencies, ownership, qualification and independent compliance review; no implementation. |
| [implement-plan](./skills/implement-plan/SKILL.md) | Supervised bounded implementation, assembled evidence, public decisions and independent review; no commit/push or implied rollout. |
| [review](./skills/review/SKILL.md) | Frozen independent findings and focused closure; no fixes. Isolated context inherits model capability, never the author's transcript. |
| [create-test-plan](./skills/create-test-plan/SKILL.md) | One draft/finalized private runbook for an explicitly requested walkthrough; no execution. |
| [run-test-plan](./skills/run-test-plan/SKILL.md) | Execute the authorized finalized runbook, show evidence, collect named user judgments and clean up; no product fixes during an attempt. |
| [commit](./skills/commit/SKILL.md) | Commit exactly the intended changes while preserving unrelated staged/worktree content; push only when separately authorized. |
| [create-pr](./skills/create-pr/SKILL.md) | Commit relevant work, integrate the resolved base, push and create/update the matching issue-linked PR; no merge or CI-wait loop. |
| [mergeprep](./skills/mergeprep/SKILL.md) | Inspect/fix/push, handle review and wait for current-head readiness, including authorized replies; stop before human merge. |
| [resolve-conflicts](./skills/resolve-conflicts/SKILL.md) | Reconcile both sides' intent and semantic contracts; completing history-changing operations needs applicable authority. |
| [create-skill](./skills/create-skill/SKILL.md) | Update the canonical workflow and relevant adapters; verify activation, references and intentional behavior changes. |
| [create-rule](./skills/create-rule/SKILL.md) | Place guidance in its narrowest owner, preserving applicable exceptions and delivery pointers. |

Model selection follows root contributor guidance: inherit the selected model
unless instructed otherwise. More detailed delegation applies only inside a
selected workflow; ordinary development remains direct. Review allocates extra
independent perspectives to consequential boundaries and prompt changes, without
creating a standing panel for every edit. See the review skill for allocation.

These choices preserve scoped autonomy and independent evidence while avoiding
unrequested workflow transitions. They do not claim that static instruction
checks prove model behavior. Representative live comparisons remain opt-in, as
explained by the prompting reference.

Detailed instruction design lives in [prompting guidance](../docs/prompting.md).
Root and nested `AGENTS.md` files route to it so access does not depend on a
tool automatically interpreting `.agents/rules`. The existing adapters deliver
scoped copies for Claude and Cursor; other clients need their documented native
discovery path. Validate projections separately from live model behavior.

Generated projections are local and ignored. Checks use disposable destinations
and protect unknown user files. Ordinary Pythia startup does not load builder
guidance; explicit approved source maintenance may read it. Before material work
is complete, lasting accepted decisions must be distilled from private records
into public docs with enough context for a contributor to understand them.

## Rejected alternatives

The project rejects a second synchronized development repository, publishing or
committing raw private runbooks, copying skills into `.codex/skills`, using
`.codex/rules` for Markdown instructions, symlink projections, default hook
activation, blanket deletion of tool directories, and projecting the seeded
runtime `AGENTS.md` as builder guidance.
