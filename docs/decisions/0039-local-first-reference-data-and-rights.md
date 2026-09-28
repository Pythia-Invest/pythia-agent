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

## Amendment (2026-09-28): plugin-owned prebuilt data packages

A cold local build takes tens of minutes and loads every source once per
device. Investors also need fixes to reference data without waiting for their
own next rebuild. A review of the open sources' terms found that GLEIF (CC0),
SEC tables (public, cited), ESMA FIRDS and FITRS (credited, marked as
transformed) and FIGIs (public domain) may be republished with a notice, while
US and Canadian ISINs and ISIN-to-FIGI pairs, the Nasdaq Trader files and all
provider data must stay on the device.

These passages are superseded: "Pythia publishes no snapshot" under the
builder ruling, and the rejected alternative "A central published snapshot
now". The rest of this ADR stands: local building is the default path and no
Pythia service exists.

**A plugin may ship prebuilt packages of its own data.** A package is local to
the plugin that owns it, built in CI by the same builder code a device runs.
Only open-data plugins host packages: every source in the package must be on
the hostable list and the plugin's contract must declare `rights.hostable:
true` ([ADR 0038](0038-plugin-addressing-contract.md)). Provider plugins never
do. CI refuses to publish a package with a source labelled unknown or
local-only.

**Static, signed and versioned.** Each plugin publishes static files: a signed
index and its packages. There is no server, account or API. An index entry
names the plugin, package, data version, schema version, key rule
(`subject_key@1`, [ADR 0037](0037-identity-backbone.md)), each source with its
URL, as-of date and licence, the SHA-256 and the size. Every package carries a
NOTICE with the attribution its sources require. The device verifies the index
signature against the release trust root it already holds and each package's
hash before use.

- **Update.** On refresh the device reads the index, downloads a newer package
  whose schema version it supports, assembles the packages and its local stages
  into one reference build and replaces the previous build atomically.
- **Rollback.** The device keeps the previous builds and returns to the last
  good one when a new build fails its checks.
- **Yank.** A bad version is marked yanked in the next index. Devices stop
  using it, fall back to the newest version that is not yanked, or rebuild
  locally.

**A local rebuild is always possible.** Packages are an accelerator, never a
requirement; the investor can turn them off and build everything on the
device. Keys use only hostable identifiers, so a package and a local build
derive identical subject IDs. Local-only data (US and Canadian ISINs, their
ISIN-to-FIGI pairs, the investor's provider claims) is added on the device and
never enters a package. Model verdicts and investor state never enter one
either.

Consequences: the reference builder gains a package mode, and core an index
reader and assembly step within the existing background refresh; there is no
new daemon. Before the first public package: Bloomberg's confirmation for
OpenFIGI metadata, a referenced-only MIC subset, a recorded permission date for
filings.xbrl.org facts, and confirmation of ESMA's terms for bulk
redistribution. Rejected: one central Pythia snapshot (it couples every plugin
to one release and owner, and a disabled plugin's data would still ship), and a
hosted query service (a runtime dependency the product rules out).
