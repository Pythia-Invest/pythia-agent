# 0006: Proportionate testing and bounded source files

## Context

Pythia is a local standalone agent whose consequential seams are credentials,
investor-owned state, native runtime adaptation, process ownership, and
supported-platform lifecycle behavior. Early tests had begun to mix those
contracts with assertions about source text, CSS details, imports, current
catalog contents, and broad assembled builds. The latter increased maintenance
and CI time without comparable confidence.

Several lifecycle, installation, qualification, and presentation files had also
grown beyond the repository's existing 400-line production and 600-line test
thresholds because the checker covered only JavaScript and TypeScript inside
`apps/` and `packages/`.

## Ruling

Tests protect stable behavior and meaningful Pythia-owned invariants at the
lowest boundary that can prove them. An automated test is not mandatory for
every change when types, lint, build evidence, or a focused manual observation
better matches the risk. Source-reading tests, incidental presentation
assertions, and coverage targets are not proxies for confidence.

Ordinary pull requests run deterministic checks and focused tests plus a small
macOS and Ubuntu lifecycle smoke suite. Broader installation, update, and
assembled qualification runs after changes reach `main` and remains explicitly
available before releases. Provider-backed, sandbox, screenshot-regression,
and whole-host qualification remain separate future work.

Hand-authored production source has a 400-line review threshold and tests have a
600-line threshold across the repository's supported source languages. A
genuinely cohesive exception needs a concrete reason near the start of the
file. The check also keeps tests outside production source trees and requires
explained TypeScript suppressions. Its own fixture tests prove the policy
boundaries.

## Rationale

Fast focused tests give precise failures and preserve refactoring freedom.
Real-process tests remain necessary where mocks cannot prove signal, socket,
filesystem, ownership, or platform behavior, but their cost must buy a specific
contract. Separating broad qualification prevents the slowest assembled case
from setting the ordinary development pace.

Line thresholds are design tripwires rather than quality scores. Applying them
to every owned source surface catches unclear ownership early, while reasoned
exceptions preserve judgment for cohesive declarative files.

## Consequences

Contributors choose and report evidence in proportion to regression risk.
Frontend automation is limited to business logic, accessibility-critical
semantics, and critical interactions; Design Lab and human review own ordinary
visual fidelity. Flaky tests are fixed or moved out of blocking CI with a
reason and owner rather than hidden by retries.

The default suite may shrink when a test protects only implementation shape.
CI duration has no fixed aggregate ceiling: slow or unstable files and suites
are reviewed individually as the product grows. Existing oversized production
files are split before the expanded structure check becomes authoritative.

## Rejected alternatives

The project rejects blanket test-per-change requirements, line or branch
coverage gates, source and CSS snapshots, automatic flaky-test retries, full
assembled qualification on every pull request, default live-provider tests,
and advisory-only file limits. It also rejects importing a second lint stack,
dependency graph framework, or mandatory Git hook without a demonstrated need.
