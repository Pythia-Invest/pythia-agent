# 0039: Local-first reference data and data rights

## Context

The identity backbone (ADR 0037) joins each investor's providers onto open
reference claims from ESMA FIRDS, GLEIF, SEC, OpenFIGI and ISO 10383 market
identifier codes. Investors also connect providers whose terms are personal or
forbid redistribution, whether keyed (EODHD) or keyless (Yahoo). Two questions
need answers: where the reference data is built, and what Pythia may do with
provider data.

Publishing a central snapshot would raise redistribution questions that
fetching for local use does not. Those questions cover ISIN licensing, CUSIP
Global Services ISINs and OpenFIGI metadata, and all are still open.

This record summarizes published terms. It is not legal advice, and each
source's own wording governs.

## Ruling

**The reference builder runs on the device.** By default, the device fetches
directly from the sources for the investor's own use and builds its reference
data locally. It stores the result in the device's embedded SQLite stores.
Pythia publishes no snapshot and operates no service. Subject IDs are derived
from open identifiers (ADR 0037), so rebuilds and separate installations agree
on them. Refreshes run in the background inside the existing market-data
backend process, not in a new daemon. Search and pages use the last completed
build and never wait on a refresh or contact a source while the investor types.

**Fetching respects each source's terms and load.** Every request to the SEC
declares a User-Agent with a contact. That contact is the investor's configured
identity. Pythia ships no default contact, so SEC stages wait until the investor
configures one: the SEC plugin's required `sec_identity`. Requests stay within
each source's published rate limits and prefer delta files over full downloads.
A free OpenFIGI key is optional and held under credential custody.

**Provenance is shown.** Records keep their source and as-of date, and provenance
appears where data is shown (ADR 0028).

**Provider data.** Pythia is personal software: each installation serves one
investor. Provider data is used under that investor's own agreement with the
provider, whether the provider needs a key (EODHD) or not (Yahoo). Each plugin
carries its provider's terms and enforces what they require, for example no
local cache. Pythia itself never publishes, pools or redistributes provider
data.

| Source | Terms relevant to fetching and local use | Operational limits |
| --- | --- | --- |
| [ESMA FIRDS](https://www.esma.europa.eu/legal-notice) | Reproduction allowed with the source acknowledged; no implied endorsement | Weekly full files and daily deltas |
| [GLEIF](https://www.gleif.org/en/meta/lei-data-terms-of-use), including the [ISIN-to-LEI file](https://www.gleif.org/en/lei-data/lei-mapping/download-isin-to-lei-relationship-files) | LEI data is CC0, with no implied endorsement. The ISIN-to-LEI file is described as open-source and publicly available | Daily LEI deltas; the ISIN-to-LEI file is a daily full file; the API serves batched lookups |
| [SEC](https://www.sec.gov/privacy) | Public information; citation requested | At most 10 requests per second, with a declared User-Agent ([fair access](https://www.sec.gov/os/accessing-edgar-data)) |
| [OpenFIGI](https://www.openfigi.com/docs/terms-of-service) | FIGIs are public domain (terms §1). The [FAQ](https://www.openfigi.com/about/faq) and [OMG FIGI 1.3](https://www.omg.org/spec/FIGI/1.3/PDF) Annex D.6 put metadata under MIT, and the FAQ endorses bulk mapping through the API | Keyless: 25 requests a minute, 10 jobs each. With a free key: 25 requests per 6 seconds, 100 jobs each |
| [ISO 10383 MIC](https://www.iso20022.org/sites/default/files/2020-02/ISO10383_Terms_of_use.pdf) | The full list may not be reproduced for third parties; local use is unaffected | Monthly |
| Provider plugins (keyed or keyless) | The investor's own agreement with each provider, carried and enforced by its plugin | As the provider's terms require |

## Consequences

**First run.** The prototype scope was EU regulated-market equities plus every
SEC ticker, about 17,000 OpenFIGI jobs. Its network-bound build took about 6
minutes with a free OpenFIGI key. Keyless, it took a little over an hour, almost
all of it in the OpenFIGI step. The build runs in stages. The first stages
supply SEC tickers and EU issuer and security names. The OpenFIGI step adds EU
tickers and FIGIs. Build progress and incomplete coverage are labelled. A free
key is the fast path, and it is never required.

**Load and breakage are per device.** Each install fetches from the sources
itself. Weekly full refreshes of the ISIN-to-LEI file alone would pull about
1.4 TB a month from GLEIF across 10,000 installs. Refreshes must therefore use
deltas where a source offers them, and refresh full files sparingly. A source
change breaks every device at once, so each stage reports
its failure visibly (ADR 0031) and keeps the last good build. A bug report cites
the as-of date of each source.

**A Yahoo-only install** needs no paid key. It gets EU and SEC-listed search
grouped by issuer and security, and delayed prices through Yahoo symbols derived
from ticker and MIC. It also gets a GLEIF profile, SEC filings, and ESEF filings
where they are available. The SEC parts arrive once `sec_identity` is
configured. Sections without a source say so and name what would fill them. A
provider improves exactly what it covers. Global coverage arrives through
plugins over time.

**Provider terms stay with the investor.** Anything the investor exports or
shares is their responsibility under the provider's terms. A multi-user or team
edition would need to revisit this ruling. One question remains open with EODHD:
may a personal key be used inside a local third-party tool, including sending
rows to the investor's own AI model provider?

## If Pythia later publishes a snapshot

A downloadable snapshot would need its own ADR and rights review. Its open points:

- OMG FIGI Annex D.2 restricts redistributing ISIN-to-FIGI mappings for every
  ISIN.
- ANNA and national agency terms for republishing ISINs, and the licence of the
  ISIN-to-LEI file, are unknown.
- [CUSIP Global Services](https://www.cusip.com/identifiers.html) ISINs (US,
  Canada, Bermuda, the Cayman Islands and many Caribbean jurisdictions) are
  claimed by its [legal terms](https://www.cusip.com/legal.html) and need a
  prefix filter or a licence.
- The OpenFIGI metadata notice needs confirming: MIT per the FAQ and Annex D.6,
  but the terms of service are silent.
- ESMA's terms for bulk redistribution need confirming.
- Delivery must be authenticated.
- Model verdicts stay out of any release.

## Rejected alternatives

**A central published snapshot now.** The rights questions above are open, and a
release cannot be recalled from installs. A snapshot that drives canonical
routing needs authenticated delivery, which Pythia's manual source updater does
not provide. It would also add a CI job, a release cadence and a key to
maintain.

**A Pythia cloud service.** It would add a runtime dependency, contrary to the
rule that Pythia adds no cloud dependency, under the same content limits. It
would also tie forks and self-hosters to Pythia's uptime.

## Amendment (2026-09-28): generating and consuming reference data are split

**Context.** Core found the builder's SQLite file by scanning the builder's
output folder, or a folder named by `PYTHIA_REFERENCE_DIR`. It depended on
how the builder happened to lay out its files, and it offered no checksum,
compatibility check. A later automated workflow should be able to
supply the catalogue without changing core.

**Ruling.** The builder generates a *reference package*. Core consumes only a
package that one import step has verified and installed into the device's
Pythia data. The contract is in
[reference packages](../architecture/reference-package.md):

- One versioned SQLite file, plus a `package.json` that carries the format
  version core checks, the build ID and build time, and the source list with
  as-of dates, licences and the notices each source requires. It also carries
  the SQLite file's SHA-256 and the builder's quality summary. A `claims` key
  is reserved for the builder's typed claims, open questions and verdicts, which
  this amendment does not define.
- The import step (`just reference-install`, core's
  `identity/reference_package.py`) refuses an incompatible format or a checksum
  mismatch, leaves the installed package in place and records the refusal. It
  installs with an atomic switch and keeps one package: going back to an older
  build is an ordinary install. Core exposes the installed package and the last
  refusal through the read-only `reference-status` operation, which Desk shows
  under Settings.
- Core no longer reads the builder's output folder, and `PYTHIA_REFERENCE_DIR`
  is removed. Development startup installs the checkout's own build
  automatically.

The ruling above still holds. The builder runs on the device, a local rebuild is
always possible, and subject IDs are derived the same way whoever builds the
package. Pythia publishes no package.

**Consequences.** Automation later adds only "download the latest package" in
front of the import step. Where that package is hosted, how it is signed and
how often devices check for updates need their own decision under "If Pythia
later publishes a snapshot" above. An installed Pythia has no lifecycle command
for the import step yet, so it runs core's installer directly with `--data-dir`.
A core release that changes the reference schema bumps the format version.
Until the investor installs a matching package, core reads no reference data,
and its status, search and pages say that the installed package is too old and
must be rebuilt, or that Pythia must be updated to read it (since format 6,
2026-09-30).

**Rejected alternatives.** *Keep scanning the builder's folder* couples core
to the builder's layout and gives no integrity check. *Keep the previous
package for rollback* would double the installed data (a full EU build is
about 200 MB) and, after going back, leave local rows re-keyed by the newer
release pointing at IDs the older one lacks; reinstalling the older package
goes through the same release change as any other install. *A core operation
that installs from a model-supplied path* would let a tool call name arbitrary
files. The import step remains a lifecycle action, and the agent only reads the
status.

## Amendment (2026-09-29): a prebuilt reference package as a maintained default

[ADR 0044](0044-product-direction.md) sets the direction toward a signed,
prebuilt reference package over open data, published by Pythia as a maintained
default. As direction, it has no more authority than the same plugins run
locally, and any plugin can contribute subjects and evidence through the same
contract; today the builder remains the only writer of reference data. The
package is delivered as downloads so that Pythia's services never receive
users' queries. Reviewed answers over open data could ship as a Pythia-maintained
answer list (ADR 0044, amendment A7, superseded for now by its amendment of
2026-09-30); raw model exchanges stay out of
releases. Publishing waits for the
checks listed in "If Pythia later publishes a snapshot" above. Raw model
exchanges stay out of releases. Pythia still never publishes, pools or
redistributes provider data.
