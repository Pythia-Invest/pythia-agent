---
description: "Keep every Pythia dependency on Hermes behavior listed in the contract's touchpoint index with its coverage."
paths:
  - "apps/desk/src/server/hermes*.ts"
  - "apps/desk/src/server/types.ts"
  - "apps/desk/src/server/device-settings*.ts"
  - "apps/desk/src/server/native-session-context.ts"
  - "apps/desk/src/client/hermes-*.ts"
  - "apps/desk/src/client/chat-message.ts"
  - "apps/desk/src/client/chat-reconciliation.ts"
  - "apps/desk/src/client/run-*.ts"
  - "apps/desk/src/components/chat/tool-copy.ts"
  - "runtime/versions.json"
  - "runtime/contracts/hermes.md"
  - "runtime/hermes/**/*"
  - "runtime/managed/core/**/*"
  - "runtime/managed/plugins/**/*"
  - "runtime/managed/runner/native_session_context.py"
  - "runtime/seeds/profile/**/*"
  - "scripts/dev/hermes-pin.mjs"
  - "scripts/dev/managed-plugins.mjs"
  - "scripts/dev/runtime-*.mjs"
  - "scripts/install/**/*"
  - "tooling/qualification/**/*"
  - "apps/desk/test/fixtures/hermes/**/*"
globs:
  - "apps/desk/src/server/hermes*.ts"
  - "apps/desk/src/server/types.ts"
  - "apps/desk/src/server/device-settings*.ts"
  - "apps/desk/src/server/native-session-context.ts"
  - "apps/desk/src/client/hermes-*.ts"
  - "apps/desk/src/client/chat-message.ts"
  - "apps/desk/src/client/chat-reconciliation.ts"
  - "apps/desk/src/client/run-*.ts"
  - "apps/desk/src/components/chat/tool-copy.ts"
  - "runtime/versions.json"
  - "runtime/contracts/hermes.md"
  - "runtime/hermes/**/*"
  - "runtime/managed/core/**/*"
  - "runtime/managed/plugins/**/*"
  - "runtime/managed/runner/native_session_context.py"
  - "runtime/seeds/profile/**/*"
  - "scripts/dev/hermes-pin.mjs"
  - "scripts/dev/managed-plugins.mjs"
  - "scripts/dev/runtime-*.mjs"
  - "scripts/install/**/*"
  - "tooling/qualification/**/*"
  - "apps/desk/test/fixtures/hermes/**/*"
---

# Hermes touchpoints

The [touchpoint index](../../runtime/contracts/hermes.md#touchpoint-index) is
what makes a Hermes upgrade reviewable, so keep it true:

- When you add or change a dependency on Hermes behavior (a route, field, event,
  command, output string, config key, tool shape or private seam), update its
  index row and its coverage in the same change.
- Prefer covering it with the wire capture of real pinned output over a
  hand-written fixture; a fixture cannot detect Hermes drift.
- Do not parse Hermes text without an index row that names its source anchor.
- Read the pin from `runtime/versions.json` (`scripts/dev/hermes-pin.mjs` in
  JavaScript); never copy the version or commit into code.
