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

## Test audit (2026-09)

By September 2026 the suite had grown to about 30,000 lines. That is typical
of agent-written tests: each small change added a test, whether or not it
protected anything new. The project adopted OpenClaw's test-audit method as
the `test-audit` builder skill, with its authoring gate and junk-pattern list,
and ran one campaign across every workspace. Seven read-only lanes produced
per-test ledgers, and implementation lanes applied them with a deliberate
mutation proving each repaired guard. Independent reviewers then checked that
no contract lost its only proof.

The campaign removed about a tenth of the test lines and several hundred lines
of production code that only tests kept alive. It stopped short of the 20%
goal because most remaining tests guarded real contracts; deleting without a
named remaining proof is not allowed. It found about a dozen negative tests
that passed for the wrong reason, a desktop focus bug, a test-run hazard that
could delete a live stack's view records, and a qualification fixture that had
kept the nightly run red for 19 days.

Every new or changed test now passes the skill's authoring gate
([test allocation](../../.agents/testing.md)). `tooling/check-tests.mjs`
refuses the mechanical patterns: focused, unexplained or permanent skips, hard
waits, snapshots, retries, and an empty selection passing. Coverage is
measured during a campaign to show protection was kept, never set as a target.
