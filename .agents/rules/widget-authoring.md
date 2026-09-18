---
description: "Package native feature widgets with shared host dependencies and explicit data contracts."
paths:
  - "packages/widget-sdk/**/*"
  - "apps/desk/src/components/widgets/**/*"
  - "apps/desk/src/client/widget-modules.ts"
  - "apps/desk/src/server/widget*.ts"
  - "runtime/managed/core/platform/widgets.py"
  - "runtime/managed/plugins/**/presentation.py"
  - "runtime/managed/plugins/**/widgets/**/*"
  - "docs/architecture/plugins.md"
globs:
  - "packages/widget-sdk/**/*"
  - "apps/desk/src/components/widgets/**/*"
  - "apps/desk/src/client/widget-modules.ts"
  - "apps/desk/src/server/widget*.ts"
  - "runtime/managed/core/platform/widgets.py"
  - "runtime/managed/plugins/**/presentation.py"
  - "runtime/managed/plugins/**/widgets/**/*"
  - "docs/architecture/plugins.md"
---

# Widget authoring

Follow the [SDK guide](../../packages/widget-sdk/README.md),
[shared runtime decision](../../docs/decisions/0032-local-widget-sdk.md) and
[native feature boundary](../../docs/architecture/plugins.md).

Features own widget entries, data contracts, bindings and declared assets. Generic
Desk hosting must not dispatch on market-data or provider-specific widget names.
Use the existing native plugin declarations and protected transport; do not create
a second widget inventory, arbitrary file server or tool execution gateway.

Compile explicit module artifacts using the supported builder. Bind React and
public SDK imports to the host runtime; preserve compatibility checks and scoped
styles. Do not bundle another React/UI copy, apply a document reset, import Desk
internals, or compile/install dependencies during dashboard reads. Keep editable
source and user selections intact. Legacy HTML is an explicit separate format;
never silently upgrade it into same-origin executable code.

Module widgets are trusted frontend code, not sandboxed content. Presentation
access does not grant data-operation access. Use the host's coordinated read/update
path with explicit input semantics, read-only operation checks and current native
authority. Neither cached modules nor retained results establish permission after
disablement or an access change. Cleanup must release data demand and widget-owned
effects when a contribution is removed.

Reuse shared UI wherever its semantics fit. The SDK accepts supported domain input
contracts; it does not require every plugin's data to become financial observations.
For financial views, also follow the [market widget rule](./market-widgets.md).
Reserve loading geometry, preserve healthy state across updates, and expose useful
errors without hiding failures as empty data. Qualify new host/runtime boundaries
in the actual production build; compiler success alone is insufficient.
