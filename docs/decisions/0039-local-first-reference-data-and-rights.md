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
on them. Refreshes run in the background. Search and pages use the last
completed build and never wait on a refresh or contact a source while the
investor types.

**Fetching respects each source's terms and load.** Every request to the SEC
declares a User-Agent with a contact. That contact is the investor's configured
identity; Pythia ships no default contact. Requests stay within each source's
published rate limits and prefer delta files over full downloads. A free
OpenFIGI key is optional and held under credential custody.

**Attribution is shown in the app.** Records keep their source and as-of date,
and provenance appears where data is shown (ADR 0028). A sources view carries
ESMA's source acknowledgement, the GLEIF CC0 statement, the SEC and ISO 10383 as
sources, the FIGI MIT notice and a statement that no source endorses Pythia.

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
| [SEC](https://www.sec.gov/os/accessing-edgar-data) | Public information; citation requested | At most 10 requests per second, with a declared User-Agent |
| [OpenFIGI](https://www.openfigi.com/docs/terms-of-service) | FIGIs are public domain (terms §1). The [FAQ](https://www.openfigi.com/about/faq) and [OMG FIGI 1.3](https://www.omg.org/spec/FIGI/1.3/PDF) Annex D.6 put metadata under MIT, and the FAQ endorses bulk mapping through the API | Keyless: 25 requests a minute, 10 jobs each. With a free key: 25 requests per 6 seconds, 100 jobs each |
| [ISO 10383 MIC](https://www.iso20022.org/sites/default/files/2020-02/ISO10383_Terms_of_use.pdf) | The full list may not be reproduced for third parties; local use is unaffected | Monthly |
| Provider plugins (keyed or keyless) | The investor's own agreement with each provider, carried and enforced by its plugin | As the provider's terms require |

## Consequences

**First run.** The prototype scope was EU regulated-market equities plus every
SEC ticker, about 17,000 OpenFIGI jobs. Its network-bound build took about 6
minutes with a free OpenFIGI key. Keyless, it took a little over an hour, almost
all of it in the OpenFIGI step. The build runs in stages. The first stages
supply SEC tickers and EU issuer and security names. The OpenFIGI step adds EU
tickers and FIGIs. The app shows progress and labels coverage that is not yet
complete. The free key is offered as the fast path, and it is never required.

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
where they are available. Sections without a source say so and name what would
fill them. A provider improves exactly what it covers. Global coverage arrives
through plugins over time.

**Provider terms stay with the investor.** Anything the investor exports or
shares is their responsibility under the provider's terms. A multi-user or team
edition would need to revisit this ruling. One question remains open with EODHD:
may a personal key be used inside a local third-party tool, including sending
rows to the investor's own AI model provider?

## If Pythia later publishes a snapshot

A downloadable open snapshot could later speed up first run. It would need its
own ADR and rights review covering these questions:

- **ISINs.** OMG FIGI Annex D.2 says ISIN-to-FIGI mappings cannot be freely
  redistributed because of ISIN licensing, and that applies to every ISIN. It
  is also unknown whether ANNA or national numbering agencies license the
  republishing of ISINs taken from ESMA or GLEIF, and what licence the
  ISIN-to-LEI file carries.
- **CUSIP Global Services.** [CGS](https://www.cusip.com/identifiers.html)
  assigns ISINs for the US and Canada, has agents in Bermuda and the Cayman
  Islands, and represents many Caribbean jurisdictions. Its
  [legal terms](https://www.cusip.com/legal.html) claim those ISINs. They also
  appear in FIRDS and the ISIN-to-LEI file, so publishing needs a filter on
  issuing prefix or a distributor licence.
- **OpenFIGI metadata.** It is MIT according to the FAQ and Annex D.6, but the
  terms of service are silent, so the required notice needs confirmation.
- **ESMA.** Bulk reuse in redistributed datasets and the exact attribution
  wording need confirmation.
- **Trust.** Delivery must be authenticated, for example by a manifest hash
  pinned in source. Model verdicts stay out of any release until a separate
  decision.

## Rejected alternatives

**A central published snapshot now.** The rights questions above are open, and a
release cannot be recalled from installs. A snapshot that drives canonical
routing needs authenticated delivery, which Pythia's manual source updater does
not provide. It would also add a CI job, a release cadence and a key to
maintain.

**A Pythia cloud service.** It would add a runtime dependency, contrary to the
rule that Pythia adds no cloud dependency, under the same content limits. It
would also tie forks and self-hosters to Pythia's uptime.
