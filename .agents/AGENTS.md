# Builder-only area

Read the repository-root `AGENTS.md` first. This directory is the canonical
home for public development-agent skills, roles, cross-cutting rules, and
on-demand builder references.

Codex discovers `.agents/skills/` natively. Generated copies for tools with a
different native format are local and ignored; edit only this canonical tree.
Do not put runtime skills, investor context, private working records, machine
configuration, or credentials here. Ordinary Pythia startup and runtime
discovery must not consume this directory.

Before editing instructions, read [prompting guidance](../docs/prompting.md).
Keep detailed guidance in one owner and route to it from the relevant entry
point. Preserve native explicit-invocation settings for opt-in workflows.
