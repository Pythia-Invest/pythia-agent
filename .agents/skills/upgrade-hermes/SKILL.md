---
name: upgrade-hermes
description: Move Pythia's exact Hermes pin to a newer upstream release, review its impact against the touchpoint index, and qualify it. Use only when a contributor explicitly asks to upgrade or bump Hermes or invokes $upgrade-hermes; not for ordinary Hermes-facing code changes or general questions about Hermes.
disable-model-invocation: true
---

# Upgrade Hermes

Pythia runs one exact, unmodified Hermes release described by the
[contract](../../../runtime/contracts/hermes.md) and
[ADR 0019](../../../docs/decisions/0019-hermes-upgrade-procedure.md). This
workflow moves that pin. It edits the checkout and runs local checks, then
reports; it does not commit, push or open a pull request unless asked.

Boundaries:

- Never patch, vendor or fork Hermes, and never pin an untagged commit, to make
  an upgrade work. If only that would work, stop and report the choice.
- Starting `just dev` and any run against a real model provider need the user's
  explicit approval; never use credentials on your own initiative.
- A request to assess a release stops after the report in step 2.
- A new upstream feature is a separate product decision: list it in the report
  and build it only when the user asks.

## Steps

1. **Choose the release.** Use the tag the user names, or propose the newest
   release tag. Check its release notes and upstream open issues and pull
   requests for regressions in the surfaces Pythia uses. Recheck each entry in
   the contract's "Known defects at this pin" against the candidate; a defect
   that blocks upgrading must be fixed in it.
2. **Review the impact.** Compare the pinned and candidate tags (not `main`)
   along every row of the contract's touchpoint index, and scan the upstream
   changes for new capabilities. Write the report from
   [the template](./references/upgrade-report.md) under `.private/plans/<branch>/`
   and give the user its short answer. Stop if a must-change item has no
   acceptable path.
3. **Bump the pin.** Edit the Hermes entry in `runtime/versions.json`
   (`release`, `package_version`, `commit`, `source_url`, `license_url`, tag
   tarball `url` and `sha256`) and mirror release, commit, archive URL and hash
   into `runtime/hermes/hermes-source.json`. Download the tag tarball,
   confirm its sha256 on two downloads and that it resolves to the recorded
   commit. `just check` fails while the two records disagree.
4. **Hydrate.** Run `just dev-init` to download, verify and hydrate the new
   source.
5. **Capture.** Rerun the wire capture (`just capture-hermes`, ADR 0020) and
   review the golden diff. Every changed golden points at index rows to recheck.
6. **Fix and document.** Make the must-change code changes. Update index rows
   and coverage, the contract, and ADRs that state current Hermes behavior.
   Remove resolved known defects and record new ones. Search for the old
   commit, release tag and package version to find remaining text and pinned
   links (for example `docs/product.md`, `THIRD_PARTY_NOTICES.md`,
   `runtime/managed/python/NOTICE.md` and the contract).
7. **Verify.** Run `just check`, `just test` and `just qualify`, plus the manual
   `tooling/qualification/workspace-*.py` scripts named in the index. With the
   user's approval for a live run, smoke-test Desk: a chat with a tool call,
   steering mid-run, research agents and their drawer, an approval, skill and
   toolset toggles in settings, and reloading a finished chat. Otherwise report
   the smoke as not run.
8. **Record.** Set `qualified_at` in `runtime/versions.json` to the date the
   checks passed. Report changed files, verification with gaps, and the adopted
   and deferred features for the pull request description.
