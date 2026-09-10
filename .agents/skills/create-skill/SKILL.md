---
name: create-skill
description: Create or update a reusable repository skill with valid frontmatter, generic instructions, and native discovery. Use when the user says "create skill", "new skill", or asks for a repeatable contributor workflow.
---

# Create skill

Read [instruction maintenance](../../../docs/prompting.md#maintain-builder-guidance)
before changing a skill; preserve its activation policy and check adjacent
guidance for conflicting requirements.

Use a skill for a repeatable multi-step workflow that has a specific structure
and is easy to execute incorrectly. Use docs or a rule for one-step knowledge.

Search `.agents/skills/` first. Update an overlapping skill rather than creating
a competing owner. Ask one short round of questions only when name, trigger,
outputs, or tool-specific requirements cannot be derived.

Create `.agents/skills/<kebab-name>/SKILL.md`. Frontmatter must contain a
matching lowercase `name` and a description explaining what the skill does and
when it activates. Keep the body tool-neutral; describe actions rather than
tool names. Put lengthy templates or contracts in `references/` and link them
relatively. Include only resources the skill actually needs. Define the expected output and authority
boundary, including what an invocation does and when it stops. Do not make a
workflow require multiple edited files just to qualify as a skill.

For an update, compare triggers, role/model policy, side effects, review and
completion behavior against the previous version and referenced workflows.
Preserve useful exceptions or explicitly explain intentional changes. Keep
explicit-only controls in both frontmatter and native invocation metadata.
Choose representative positive and negative activation cases; a request to
explain or audit a workflow must not execute it. Check tool-specific blocks
against the actual repository adapter rather than copying retired tool syntax.

Codex and compatible tools discover `.agents/skills/` natively from the working
directory through the repository root; do not create a `.codex/skills` copy.
Run the repository's Claude skill adapter and builder checker after changes.
Generated projections are ignored and never canonical.

Do not add machine configuration, private records, runtime seeds, credentials,
symlinks, hook activation, or a second skills registry. Report the canonical
path, trigger phrases, supporting resources, adapters refreshed, and checks.
