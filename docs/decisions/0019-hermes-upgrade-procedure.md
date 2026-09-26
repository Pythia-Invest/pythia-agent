# Hermes upgrade procedure

Status: accepted, 2026-09-23.

## Context

Pythia pins one exact, unmodified Hermes release ([ADR 0002](0002-runtime-and-salvage-contract.md)).
Moving that pin had no written procedure. The pin was copied into two records,
two pieces of lifecycle code and a test, with nothing checking they agreed.
Desk parses many Hermes fields, event names and saved strings that the contract
did not list, and its tests use hand-written fixtures that stay green when
Hermes changes. One drift already exists: Desk reads a saved steer row that
only a newer Hermes writes. Reviewing a candidate release meant rereading the
whole integration from memory.

## Decision

- `runtime/versions.json` is the single Hermes pin record. Code reads it through
  `scripts/dev/hermes-pin.mjs`: the installed source directory is keyed by its
  commit, and both development and installed readiness accept only a `/health`
  `version` equal to its `package_version`.
  `runtime/hermes/hermes-source.json` keeps the hydration command and
  repeats release, commit and archive; `just check` fails when they disagree.
- The contract `runtime/contracts/hermes.md` carries one touchpoint index: each
  Pythia dependency on Hermes behavior, its source anchor at the pin, how
  loudly it fails, and what covers it. A builder rule asks every Hermes-facing
  change to keep its row and coverage current. The contract also lists known
  defects at the pin, to recheck on each upgrade.
- Upgrading is the explicit-only `upgrade-hermes` builder workflow: choose a
  release and check upstream regressions, write an impact report against the
  index, bump and verify the pin, hydrate, rerun the wire capture (`just capture-hermes`,
  [ADR 0020](0020-hermes-wire-capture-goldens.md)) and review its diff, fix and document, run the
  checks and a Desk smoke test, then record `qualified_at`.

## Rationale and consequences

The index turns an upgrade into a bounded walk instead of a rediscovery, and
the rule keeps it from rotting the way the contract's plugin file list did.
Mechanical checks own what code can check: pin agreement and the health
version. Coverage stays honest: a row covered only by hand-written fixtures is
labelled as such, and the wire capture is the preferred way to close that gap.

Contributors must update an index row when they touch a Hermes dependency.
Prose that names the version (notices, product docs and pinned links) is still
text; the workflow finds it by searching for the old commit, tag and version.
The workflow never patches Hermes, pins an untagged commit, or runs real model
providers without approval.

A separate registry document was rejected because it would drift from the
contract that already owns these facts. Relying on tests alone was rejected
because a test does not explain why a seam exists or where it lives upstream.
Deriving `hermes-source.json` at build time was rejected as more machinery than
an agreement check. A version check per request was rejected; readiness is the
boundary where a wrong gateway matters.
