# Reference packages

Generating Pythia's reference catalogue and consuming it are separate steps.
The reference builder (`tooling/reference-builder`) generates a **reference
package**. Core reads only a package that the import step has **installed**
into the device's Pythia data. The package is the only thing the two sides
share, so a later workflow can change where packages come from without
changing core ([ADR 0039](../decisions/0039-local-first-reference-data-and-rights.md)).

```text
reference builder ──▶ package directory ──▶ import step ──▶ installed package ──▶ core search and pages
 (just reference-snapshot)                  (just reference-install)
```

## The package

A package is a directory with two files, and a third when the build left
questions open:

- `reference-<YYYYMMDD>.sqlite3` is the versioned reference database. Its
  layout is core's `identity/sql/reference.sql`, and its `release` table
  records `schema_version` and the build ID (`release`).
- `package.json` is the manifest that describes the database.
- `questions-<YYYYMMDD>.json`, named by `claims`, lists what the build could
  not decide from its sources.

| Field | Meaning |
| --- | --- |
| `format` | Always `pythia-reference-package`. |
| `format_version` | The number core checks for compatibility. It covers the manifest layout and the database schema, and it equals the database's `release.schema_version`. Core installs only its own version (currently `5`: 3 added the curated `canonical_assets` table, 4 the listings' `most_liquid` flag, 5 their `trading_currency`). |
| `build_id` | The build, for example `reference-20260928`. It must match the database's `release.release`. |
| `built_at`, `as_of` | When the build finished (UTC), and the date its sources describe. |
| `builder_version`, `scope` | The builder's own version, and the venues and sources it covered. |
| `included_sources` | The sources the build read, named as their `sources` entries are (the part before any `:`), for example `["iso10383_mic", "esma_firds", "esma_fitrs", "sec_company_tickers", "sec_fund_tickers", "gleif_lei_records", "openfigi", "canonical_assets"]`. A build can leave out FIRDS, FITRS, GLEIF, OpenFIGI and SEC ([builder flags](../../tooling/reference-builder/README.md#sources-and-stages)); the ISO 10383 venue codes and core's curated crypto table are always included. Optional, a list of names: a package from before builder rules version 3 has none. |
| `database` | `file` (a plain file name in the same directory), `bytes` and `sha256`: the checksum of the SQLite file. |
| `sources` | One entry per source file or API: `source`, `url`, `version`, `as_of` (retrieval date), `retrieved_at`, `licence`, and `notice`, the attribution to show wherever that data is shown. |
| `quality` | The builder's quality summary: table row counts, canary results, the assembly audit and the identity truth-set scores (`tables`, `canaries`, `audit`, `truth_audit`). |
| `claims` | Optional: `file`, `bytes` and `sha256` of `questions-<YYYYMMDD>.json`, the questions the build left open where its sources did not decide a value (`{"build_id", "questions": [...]}`, each in core subject IDs with the resolution queue's `kind`, `reason`, candidates and evidence). `issuer_identity` has two shapes with the same fields: on a security it asks who issued it (FIRDS field 5 names a venue operator's LEI, or its receipts contradict it; `values` holds the claimed LEIs), and on a CIK-only issuer it asks whether that CIK is the candidate LEI's issuer (identifier links disagree; `values` holds the candidate LEIs). The installer copies and verifies it with the database. Core queues a question, once, only when the investor opens or watches its instrument (for an issuer question, also a candidate's) or the agent uses it; `home_market` and a question without candidates are never queued, and a new release supersedes the previous build's open questions. The user's answer is a local override ([ADR 0037](../decisions/0037-identity-backbone.md), amendment "questions on touch"). An older core ignores the key. |

The builder writes `package.json` into its output directory
(`.local/reference-builder/out/`, or `--out`) after each build, beside the
SQLite file and its fuller build record `manifest.json`. That output directory
is a package. Older SQLite files left in it are not part of the package. A
build whose canaries failed (written with `--no-gates` for inspection) is not a
package: the builder writes no `package.json` for it and removes an earlier one.

## Installing

`core/identity/reference_package.py` is the import step and core's reader. It
uses only the standard library.

```sh
just reference-install <package>   # a package directory or its package.json, relative to the checkout
just reference-status              # what is installed, and the last refusal, as JSON
```

These recipes run core's installer with the stack's Hermes Python and install
into Pythia's store directory, `<data>/store/reference/`, where `<data>` is the
stack's data root ([ADR 0034](../decisions/0034-core-and-optional-features.md),
2026-09-29 amendment). A reference an earlier Pythia installed in the core
plugin's Hermes data directory moves there first: core moves it on first use,
and an install moves it before installing. It moves by rename or, across file
systems, as a verified install that keeps the source, and it keeps its package
name, so nothing is re-keyed. The installer:

1. Reads `package.json` and refuses a package whose `format_version` is not the
   one this core reads. The message says whether to update Pythia or rebuild
   the package.
2. Copies the database (and the `claims` file, when named) into a staging
   directory, hashing it as it copies, and refuses the package if a checksum
   or size differs from `package.json`,
   or if the database's schema version or build ID disagrees with it. A refusal
   leaves the installed package untouched and is recorded in `refused.json`
   until a package installs, so Settings can show it.
3. Moves the verified copy to `packages/<build_id>-<sha256 prefix>/`, then
   switches `installed.json` (`current`, `installed_at`) with one atomic
   rename. Readers see either the old package or the new one.
4. Drops the replaced package. Reinstalling the installed package changes
   nothing.

One package is installed at a time; there is no separate rollback. Going back
to an older build is an ordinary install of that package, a release change
like any other. `packages/` belongs to the
installer: it removes anything else there, including leftovers of an
interrupted install, so never point it at a package inside that directory. One
installer runs at a time per store directory. Search and pages never wait for
it.

In development, `just dev-init`, `just dev` and `just dev-refresh` install this
checkout's builder output automatically when it has a `package.json`.
`PYTHIA_DEV_REFERENCE_PACKAGE` points them at another package directory.
Startup never fails over reference data: a missing or refused package is
reported in one line that names the package still in use, and a refusal also
shows in Settings.

## Reading

Core resolves the reference database through `installed.json` alone. It never
reads the builder's output folder or scans for loose `reference-*.sqlite3`
files, and no environment variable redirects it. A package whose format this
core does not read counts as no reference data. Loose files left in the old
`reference/` location are ignored and kept.

The `reference-status` operation (tool `pythia_reference_status`) reports the
installed build, format, dates, the sources the build included
(`included_sources`), each source file with its as-of date and licence, the
deduplicated notices, and the last refused package with its reason. Desk
shows it under **Settings → Reference data**.

## Later: automated packages

An automated workflow adds one step in front of the import step: download the
latest package, then install it exactly as above. Core, the package contract
and the installer stay the same. Hosting, signing and update cadence are open
questions for a later ADR. Until then Pythia publishes no package, and the
builder keeps running on the device.

## Known limits at the finish line

The identity backbone reached its finish line
([ADR 0044](../decisions/0044-product-direction.md) ruling 9, roadmap stage 0)
with these limits accepted. Each has an owner or a trigger; none is a silent
gap.

**Reference data** (counts from the offline default-scope build of
2026-09-29, FIRDS week of 2026-09-26; the ratchets in
`tooling/reference-builder/reference_builder/invariants.py` fail a build that
exceeds them by more than 2%):

- `primary_missing` is at 11,997: live securities with lines whose evidence
  decided no primary. The primary is a choice, not an identity fact (ADR
  0044, A5), so they are counted and not asked; the rest are SEC or OpenFIGI
  gaps until those sources are onboarded.
- `questions_open` is at 1,698 since rules version 2: questions the build
  left open in the package's `claims` file (637 `issuer_identity`, 895
  receipt questions and 166 SEC name-only issuer questions). It asks no
  `home_market` question (10,271 before).
- Shares without a primary: `share_primary_silent` is at 1,072: 1,052 SEC
  OTC-only shares, which no rule places, and 20 shares whose most liquid
  venue has no line. A security without a written primary is priced on its
  most liquid EU line (9,770 lines), labelled so and never primary. See the
  [FIRDS record](../sources/firds.md).
- Issuers: 12 shares whose receipts name another live issuer in FIRDS field 5
  (Nestlé's Toronto CDRs name Nestlé S.A., its share names Nestlé Capital
  Markets), and 3 receipts of them filed under the same field 5 (Nestlé's
  ADR), have an unknown issuer and an `issuer_identity` question with both
  LEIs as candidates. Two were right as filed: Welltower, whose page says
  "Issuer unknown" and whose profile and filings need the issuer until the
  user answers its question, and an old Barrick ISIN. The
  builder reads no GLEIF parent relationships, so a wrong field 5 that no
  receipt contradicts stays as filed (JTEKT under Toyota Industries;
  `issuer_financing_vehicle` warns on 36 issuers named like financing
  vehicles).
- Currency read checks: London, Johannesburg and Tel Aviv home lines (1,096)
  quote in a minor unit and carry no trading currency, so a price source's
  stated currency is not compared there; the venue still is.
- The package leaves the fields its sources do not decide unknown, with a
  question. Core asks one only when its instrument is opened, watched or used
  by the agent, and the user's answer changes that device's reads, never the
  package ([ADR 0037](../decisions/0037-identity-backbone.md), amendment
  "questions on touch").
- SEC is `grandfathered`, not signed off. Remaining steps
  ([SEC record](../sources/sec.md#sign-off)): typed claims for the CIK to LEI
  links, the judgement questions written and checked on a sampled build, and
  the founder's spot-check of the sample.

**Sources and reads:**

- News and fundamentals were architecture probes, not production features.
  News has a core read that merges sources and drops duplicates, but no Desk
  section, and the read sits in core's hidden toolset, so the agent cannot
  call it; the FCA NSM plugin is the only source that declares it.
  Fundamentals and estimates have their selection rule and report identity
  but no read, row shape or source yet
  ([ADR 0040](../decisions/0040-data-concepts-and-agent-tools.md)).
- Parallel reports are linked at read time, not stored in the backbone; ADR
  0040 ("Report identity and parallel reports") lists what the fundamentals
  work adds.
- "Also:" reads a source once, for the view only. Nothing remembers it per
  subject: a source the investor wants every time goes in `source_order`,
  which puts it first for every concept it serves. Where one source serves, a
  display (unsigned) source comes after every audited one: it serves unnamed
  only if nothing audited can (NSM for a UK issuer filings.xbrl.org does not
  cover), and otherwise is an "Also:" link (NSM beside filings.xbrl.org).
- Plugin trust levels have two of three levels in code: display and confirm
  ([ADR 0042](../decisions/0042-source-onboarding-standard.md), amendment).
  Suggest arrives with the first plugin that needs it; until then a user's
  own vendor addressed by `resolve` needs the investor's confirm per subject.
