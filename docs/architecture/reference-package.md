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

A package is a directory with two files:

- `reference-<YYYYMMDD>.sqlite3` is the versioned reference database. Its
  layout is core's `identity/sql/reference.sql`, and its `release` table
  records `schema_version` and the build ID (`release`).
- `package.json` is the manifest that describes the database.

| Field | Meaning |
| --- | --- |
| `format` | Always `pythia-reference-package`. |
| `format_version` | The number core checks for compatibility. It covers the manifest layout and the database schema, and it equals the database's `release.schema_version`. Core installs only its own version (currently `2`). |
| `build_id` | The build, for example `reference-20260928`. It must match the database's `release.release`. |
| `built_at`, `as_of` | When the build finished (UTC), and the date its sources describe. |
| `builder_version`, `scope` | The builder's own version, and the venues and sources it covered. |
| `database` | `file` (a plain file name in the same directory), `bytes` and `sha256`: the checksum of the SQLite file. |
| `sources` | One entry per source file or API: `source`, `url`, `version`, `as_of` (retrieval date), `retrieved_at`, `licence`, and `notice`, the attribution to show wherever that data is shown. |
| `quality` | The builder's quality summary: table row counts, canary results, the assembly audit and the identity truth-set scores (`tables`, `canaries`, `audit`, `truth_audit`). |
| `claims` | **Reserved** for the builder's typed claims, open questions and verdicts, which will ship as a separate file in the package that this key names. Format 2 packages omit it and format 2 core ignores it. Its layout, and whether it needs a new format version, are decided when the builder emits it. |

The builder writes `package.json` into its output directory
(`.local/reference-builder/out/`, or `--out`) after each build, beside the
SQLite file and its fuller build record `manifest.json`. That output directory
is a package. Older SQLite files left in it are not part of the package.

## Installing

`core/identity/reference_package.py` is the import step and core's reader. It
uses only the standard library.

```sh
just reference-install <package>   # a package directory or its package.json, relative to the checkout
just reference-status              # what is installed, as JSON
just reference-rollback            # swap back to the previous package
```

These recipes run core's installer with the stack's Hermes Python and install
into the core plugin's native data directory,
`<profile>/plugin-data/<core namespace>/reference/`. The installer:

1. Reads `package.json` and refuses a package whose `format_version` is not the
   one this core reads. The message says whether to update Pythia or rebuild
   the package.
2. Copies the database into a staging directory, hashing it as it copies, and
   refuses the package if the checksum or size differs from `package.json`,
   or if the database's schema version or build ID disagrees with it. A refusal
   leaves the installed package untouched.
3. Moves the verified copy to `packages/<build_id>-<sha256 prefix>/`, then
   switches `installed.json` (`current`, `previous`, `installed_at`) with one
   atomic rename. Readers see either the old package or the new one.
4. Keeps the replaced package as `previous` for rollback and drops installed
   copies older than that. Reinstalling the current package changes nothing.

One installer runs at a time per data directory. Search and pages never wait
for it.

In development, `just dev-init`, `just dev` and `just dev-refresh` install this
checkout's builder output automatically when it has a `package.json`.
`PYTHIA_DEV_REFERENCE_PACKAGE` points them at another package directory.
Startup never fails over reference data: a missing or refused package is
reported in one line.

## Reading

Core resolves the reference database through `installed.json` alone. It never
reads the builder's output folder or scans for loose `reference-*.sqlite3`
files, and no environment variable redirects it. A package whose format this
core does not read counts as no reference data. Loose files left in the old
`reference/` location are ignored and kept.

The `reference-status` operation (tool `pythia_reference_status`) reports the
installed build, format, dates, sources with their as-of dates and licences,
the deduplicated notices, and the previous build. Desk shows it under
**Settings → Reference data**.

## Later: automated packages

An automated workflow adds one step in front of the import step: download the
latest package, then install it exactly as above. Core, the package contract
and the installer stay the same. Hosting, signing and update cadence are open
questions for a later ADR. Until then Pythia publishes no package, and the
builder keeps running on the device.
