---
name: create-rule
description: Add or update reusable project guidance in its narrowest reliable instruction layer. Use when the user says "create rule", "add rule", "remember this", or provides reusable process feedback.
---

# Create rule

## Classify and place

Extract the behavior, reason, observed failure, audience, affected paths, and
needed activation. A repeatable procedure belongs in `create-skill`; a lasting
product or architecture choice belongs in public `docs/`; deployed Hermes
behavior belongs in its actual runtime input, not builder guidance.

Search root/nested `AGENTS.md`, `.agents/README.md`, all adjacent rules and
references, public decisions, and `CLAUDE.md` pointers. Update the existing
owner for overlap. Put brief universal guidance in root `AGENTS.md`, detailed
universal builder guidance in `.agents/<topic>.md`, directory guidance in the
nearest nested `AGENTS.md`, and genuinely cross-cutting path guidance in
`.agents/rules/<topic>.md`. Mechanical requirements belong in code or tests.

Rules use frontmatter with a concise `description` and identical `paths` and
`globs` lists. Generated Claude and Cursor copies are delivery only; never use
`.codex/rules` for Markdown instructions. Give every nested `AGENTS.md` a thin
`CLAUDE.md` containing `@AGENTS.md`.

Preserve every substantive instruction and repair inbound links when moving
guidance. Run the rule sync and builder checker using the repository's current
commands. Report canonical owner, pointers, visibility, preservation, and
validation. Do not edit user-level tool configuration or runtime seeds.
