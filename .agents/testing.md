# Testing

Vitest is the JavaScript and TypeScript test runner. Workspace behavior belongs
in that workspace's `test/`; root policy and lifecycle behavior belongs in the
root `test/` tree. Keep production and test type surfaces separate.

Unit tests own deterministic local behavior. Integration tests own real process,
filesystem, loopback HTTP, or native-tool boundaries. Qualification tests own
assembled cross-workspace, installation, and update behavior outside the
ordinary pull-request loop. A guided local runbook under
`.private/plans/<branch>/test-plan.md` is reserved for a representative workflow
or user judgment that automation cannot supply, when explicitly requested.
Ordinary tests and previews do not require a test-plan document.

Protect stable behavior and meaningful Pythia-owned invariants at the lowest
boundary that can prove them. Prefer one representative success and the
consequential failure or ownership cases over exhaustive permutations. A bug
fix gets a regression test when the failure is reproducible and the test is
stable. An automated test is not required when types, lint, a build, or focused
manual evidence better matches a low-risk change; report that evidence clearly.

Do not test source text, imports, class names, CSS declarations, incidental
copy, current collection sizes, or another tool's implementation. Do not add a
coverage target. Frontend tests are reserved for business logic,
accessibility-critical semantics, and critical interactions; review ordinary
visual fidelity in Design Lab. Desk's Playwright smoke suite (`apps/desk/e2e/`)
owns routing, keyboard, theme, and narrow-viewport interactions against a
running Desk named by `PYTHIA_DESK_URL`; it never starts the stack or creates
sessions. Delete tests whose protected behavior no longer
exists or is better owned at another boundary.

Tests must not use ambient credentials or arbitrary sleeps. Allocate unique
temporary paths and ports, synchronize on observable state with explicit
deadlines, and delete only resources the test created. A skipped test needs an
adjacent external-condition reason and follow-up owner. Do not mask flakes with
automatic retries; fix them or move them out of blocking CI with a reason and
owner until they are reliable.

Choose compatibility checks from `docs/support.md` for the behavior changed.
Use more than one synthetic configuration when testing configurable behavior;
avoid fixtures that only prove a contributor's hostname, account or filesystem.
Browser and installed-service claims need evidence from those actual surfaces.
