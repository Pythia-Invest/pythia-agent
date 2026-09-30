---
description: "Gate every new or changed test on the behavior it protects, and keep suites hermetic, fast and honest."
paths:
  - "**/test/**/*"
  - "**/*.test.*"
  - "**/*.spec.*"
  - "apps/desk/e2e/**/*"
  - "**/vitest*.config.*"
  - "apps/desk/playwright.config.ts"
globs:
  - "**/test/**/*"
  - "**/*.test.*"
  - "**/*.spec.*"
  - "apps/desk/e2e/**/*"
  - "**/vitest*.config.*"
  - "apps/desk/playwright.config.ts"
---

# Test authoring

[Test allocation](../testing.md) owns the full guidance; the
[test-audit skill](../skills/test-audit/SKILL.md) owns the junk-pattern list
and the audit procedure. Before adding or changing a test:

- Name the observable behavior it protects, the credible regression that fails
  it, and why existing coverage misses that regression. If you cannot, do not
  add it. Extend the contract's existing owner or table instead of adding a
  near-duplicate at another layer.
- Test at the real boundary. Do not add an export, flag or parameter only a
  test uses, and delete production code whose only callers are tests.
- A test that would break under a behavior-preserving refactor asserts
  implementation: no source text, class names, CSS, copy, snapshots, another
  library's behavior, or expected values computed by the code under test.
- A test that rejects bad input must fail when its guard is removed. Break the
  guard once, watch the test go red for that reason, then restore the source.
  The most common defect found in September 2026 was a negative check passing
  for an unrelated reason (a missing file, profile or header).
- A bug fix's regression test must fail on the unfixed code.

Keep tests hermetic: unique temporary paths and ports, no ambient credentials or
runtime environment, no changes to tracked files, synchronization on observable
state, never on time. Desk browser specs outside `e2e/live` supply every API
response through route fixtures and drive polling with Playwright's clock.
Unit and integration layers are chosen by directory (`test/integration`).

`just check-static` runs `tooling/check-tests.mjs`, which refuses `.only`,
unconditional or unexplained skips, `waitForTimeout`, snapshots, retries and an
empty selection passing. Never add retries or a skip to make a test pass: fix
the cause, or move it out of the blocking path with an adjacent reason and a
named owner.
