---
description: "Package features through native Hermes ownership and shared protected transport."
paths:
  - "runtime/managed/core/**/*"
  - "runtime/managed/plugins/**/*"
  - "scripts/dev/managed-plugins.mjs"
  - "scripts/dev/files.mjs"
  - "docs/architecture/plugins.md"
globs:
  - "runtime/managed/core/**/*"
  - "runtime/managed/plugins/**/*"
  - "scripts/dev/managed-plugins.mjs"
  - "scripts/dev/files.mjs"
  - "docs/architecture/plugins.md"
---

# Feature plugins

Follow [plugin authoring](../../docs/architecture/plugins.md) and
[ADR 0033](../../docs/decisions/0033-native-feature-packages.md). Pythia-supported
and community features use the same native plugin mechanism. Keep domain tools,
skills, deliberate operation exports and supplied presentation assets under the
feature's package ownership; shared contracts and SDKs remain reusable dependencies.

Keep product host support under `runtime/managed/core/` and optional features
under `runtime/managed/plugins/`. Core uses Hermes's native extension hook but
does not own provider-specific research tools; see
[ADR 0034](../../docs/decisions/0034-core-and-optional-features.md).

Use native registration, discovery and enablement. An exported operation must
belong to its actual native tool owner. Authentication, profiles, HTTP admission,
execution bounds and cleanup belong to the shared platform adapter. Do not add
plugin-specific bearer checks, arbitrary tool dispatch or another registry.

Bundled native skills use explicit qualified discovery at the pinned release;
do not assume they enter the automatic prompt skill index. Keep descriptions and
supporting files scoped to the feature. Builder instructions are not runtime
skills or automatically installed context.

Distinguish shipped payloads, fresh-profile defaults and existing user choices.
Only update proven managed contents. Preserve and report edited or unowned
packages; neither disabling a plugin nor updating Pythia authorizes replacement
of user code. Community packages do not need release allowlist entries.

Check the copied native seam and affected consumers when changing package or
operation contracts. For financial meaning and connector execution, use the
[financial connector rule](./financial-connectors.md).
