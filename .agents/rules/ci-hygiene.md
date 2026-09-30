---
description: "Keep one fast, hermetic, required CI gate whose jobs run the same just recipes as local checks."
paths:
  - ".github/**/*"
  - "justfile"
  - "turbo.json"
  - "package.json"
  - "apps/*/package.json"
  - "packages/*/package.json"
  - "tooling/check-*.mjs"
  - "tooling/run-*.mjs"
globs:
  - ".github/**/*"
  - "justfile"
  - "turbo.json"
  - "package.json"
  - "apps/*/package.json"
  - "packages/*/package.json"
  - "tooling/check-*.mjs"
  - "tooling/run-*.mjs"
---

# CI hygiene

[ADR 0037](../../docs/decisions/0037-one-required-ci-gate.md) owns the design and
[keeping CI clean](../change-validation.md#keeping-ci-clean) the full guidance;
`tooling/check-workflows.mjs` enforces the mechanical invariants.

- `CI gate` is the only required check. A new blocking job joins the gate's
  `needs`; a job that must not block goes on the checker's advisory list with a
  reason in the workflow. Never add path filters to `ci.yml`.
- CI logic lives in `just` recipes that contributors run locally, not in YAML.
  Every tsconfig is type-checked in its workspace's `check` script; test scripts
  never type-check. Turbo tasks without outputs depend on `transit`, not
  `^self`.
- Blocking jobs are hermetic: no credentials, providers or Hermes, and the
  network only to install pinned dependencies. Audits, Hermes captures and
  assembled qualification belong to `nightly.yml`.
- No retries, `continue-on-error` or skips to get green. A nondeterministic
  failure is a bug: record the run and signature and fix the cause.
- Keep the gate near five minutes. State the cost of anything that adds more
  than 30 seconds to the slowest job, and what it protects.
- Before pushing, run `just check-static`; before asking for a merge, run
  `just check` and the affected tests. Merge only on a green `CI gate` for the
  head commit. A red `main` or nightly run is fixed before new work.
