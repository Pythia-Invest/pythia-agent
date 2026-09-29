# Desk Markdown platform hint

Status: accepted, 2026-09-22.

## Context

Hermes's API hint assumes an unknown plain-text client and forbids Markdown,
headings, bullets and code fences. It also asks for brief conversation rather
than a document. Desk supports Markdown; these restrictions caused real research
answers to omit useful structure even though the renderer worked correctly.

## Decision

Fresh Pythia profile configuration seeds native `platform_hints.api_server.replace`.
The replacement states that Desk supports Markdown and preserves the native
file/media delivery limitations verbatim. It removes the generic formatting ban
and the adjacent brevity/document restriction. It does not demand headings,
specific answer length, a template, or an investment conclusion.

Existing profiles and their custom hints remain device-owned. Adoption requires
an explicit native config change and Hermes restart; fresh chats pick up the
new instructions. Existing answers and cached session prompts are preserved.

## Rationale and consequences

The supported native configuration seam keeps Hermes unmodified and accurately
describes the consuming UI. CLI and other platform instructions are unaffected.
The model remains free to use plain prose when appropriate. Static assembly
verification proves the replacement is delivered, not that every model will
choose headings. A live inference comparison is separate opt-in verification.

Appending Markdown advice was rejected because it leaves contradictory native
instructions. Patching Hermes, rewriting generated text and enforcing a universal
answer template were rejected. Automatically replacing existing profile hints
was rejected because they are user-owned configuration.
