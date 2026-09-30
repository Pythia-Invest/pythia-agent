# Hermes upgrade report template

Write the report for the contributor who decides whether to upgrade. Lead with
the answer, cite Hermes files and symbols at both tags, and say what was read
from source versus observed by running it.

```markdown
# Hermes <pinned tag> → <candidate tag>: impact on Pythia

**Short answer:** <upgrade, upgrade with changes, or wait, and the one or two
reasons that decide it>.

Scope: <commits and releases in the window; upstream release notes used; how the
two tags were compared; what was run versus only read>.

## Must change

Breaks Pythia or a Desk flow if we upgrade without a change. For each item: the
upstream change (commit or file:symbol), the index row it hits, the visible
consequence, and the Pythia fix or the decision it needs.

## Should check

Behavior or shape changes that may matter: new or changed fields, statuses,
events, config semantics, dependency or lock changes. Say how each will be
confirmed (wire capture diff, qualification, manual smoke).

## Known defects

Each entry of the contract's "Known defects at this pin": fixed, still present,
or changed in the candidate. New upstream defects that affect Pythia, with
upstream issue or pull-request links.

## Unchanged (checked)

Index surfaces verified as unchanged, so the reviewer knows they were read.

## Adoption candidates

New upstream capabilities worth adopting, ranked by user value against effort.
Note any that would need a product decision or ADR. These are proposals, not
part of the upgrade.

## Release artifact

| Item | Value |
| --- | --- |
| Tag | |
| Commit | |
| Package version (`/health` `version`) | |
| Tarball URL | |
| Tarball sha256 (two downloads) | |
| Python range and install extra | |
```
