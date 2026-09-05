---
description: "Keep builder and runtime instructions minimal, owned, and separate."
paths:
  - ".agents/**/*"
  - "AGENTS.md"
  - "**/AGENTS.md"
  - "**/CLAUDE.md"
  - "runtime/seeds/**/*"
  - "runtime/managed/skills/**/*"
  - "runtime/managed/plugin/**/*"
  - "runtime/managed/runner/**/*"
  - "docs/prompting.md"
globs:
  - ".agents/**/*"
  - "AGENTS.md"
  - "**/AGENTS.md"
  - "**/CLAUDE.md"
  - "runtime/seeds/**/*"
  - "runtime/managed/skills/**/*"
  - "runtime/managed/plugin/**/*"
  - "runtime/managed/runner/**/*"
  - "docs/prompting.md"
---

# Agent instruction design

Before changing model-visible text, read [prompting guidance](../../docs/prompting.md).
It owns the research-backed principles and proportionate validation. This
includes instruction prose embedded in code, skill metadata, examples and
tool results, not just files named prompt. Ordinary mechanical changes in
these directories do not require prompt evaluation.
