# Managed runtime guidance

Read the repository-root `AGENTS.md` first. Before changing skills, seeds,
operating context, tool descriptions or model-visible results, read
[prompting guidance](../docs/prompting.md) and inspect the assembled native input.

Everything below `runtime/managed/` is versioned product source. Runtime
consumers may read only the explicit files installed by the lifecycle code;
this `AGENTS.md`, tests, contracts, and fixtures are builder guidance excluded
from automatic product/runtime model context and must never be copied into a
Hermes profile. They may be read for explicit user-approved source maintenance.
The separately seeded `runtime/seeds/workspace/AGENTS.md` is intentional
user-owned native context, so enforce this boundary by source role and
allowlist rather than by rejecting every file named `AGENTS.md`.

Keep the Hermes boundary native: external skills, one copied profile-local
plugin, and native MCP configuration. Do not add a Pythia capability registry,
combined skill/tool state, Hermes patch, symlink projection, or ambient-secret
fallback.

Preserve provenance, dates, units and the distinction between evidence,
estimates and judgment. Validate mechanically checkable facts in code where
practical. Missing data is not zero; an empty result is not a failed request,
and neither establishes universal absence. Preserve useful partial results
with their limitations. Do not prescribe the investor's conclusion or strategy.

Provider tests are network-free. Fixtures are synthetic and must cite the
public type or test that shaped them. Never record provider responses.
