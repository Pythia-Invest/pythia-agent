# Testing

Vitest is the JavaScript and TypeScript test runner. Workspace behavior belongs
in that workspace's `test/`; root policy and lifecycle behavior belongs in the
root `test/` tree. Keep production and test type surfaces separate.

Unit tests own deterministic local behavior. Integration tests own real process,
filesystem, HTTP, or native-tool boundaries. Acceptance tests own assembled
cross-workspace behavior. A guided local runbook under
`.private/plans/<branch>/test-plan.md` is reserved for a representative workflow
or user judgment that automation cannot supply, when explicitly requested.
Ordinary tests and previews do not require a test-plan document.

Tests must not use ambient credentials or arbitrary sleeps. Allocate unique
temporary paths and ports, synchronize on observable state with explicit
deadlines, and delete only resources the test created. A skipped test needs an
adjacent external-condition reason and follow-up owner.

Choose compatibility checks from `docs/support.md` for the behavior changed.
Use more than one synthetic configuration when testing configurable behavior;
avoid fixtures that only prove a contributor's hostname, account or filesystem.
Browser and installed-service claims need evidence from those actual surfaces.
