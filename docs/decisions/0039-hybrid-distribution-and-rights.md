# 0039: Hybrid distribution of the reference snapshot and data rights

## Context

Pythia is open-source software that investors install and run on their own
device. Its identity backbone (ADR 0037) joins each investor's providers onto
open reference claims: ESMA FIRDS, GLEIF, the GLEIF/ANNA ISIN-to-LEI file, SEC
company and ticker data, FIGIs from OpenFIGI and ISO 10383 market identifier
codes. Investors connect licensed providers such as EODHD, Yahoo, CoinMarketCap,
CoinGecko or IBKR with their own credentials, under terms that are personal and
forbid redistribution. A plugin shop that could sell optional enrichment may
follow later.

Three questions need one answer: who runs the reference build, what Pythia may
publish, and what must stay on the device. A September 2026 prototype built the
open reference data for EU regulated-market equities and every SEC-listed
ticker. A full rebuild took about six minutes and was network-bound. The lean
snapshot compressed to 4.2 MB. OpenFIGI mapping took about a minute with a free
key and 15–60 minutes without one.

Each published input must be allowed on the face of its own terms. Several
terms are silent or ambiguous, so the distribution has to hold even if every
open question is answered conservatively. This record summarizes published
terms; it is not legal advice, and each source's own wording governs.

## Ruling

**Public CI builds the open snapshot.** A scheduled workflow in the public
repository runs the reference builder over open sources. It publishes a
versioned snapshot, a NOTICE and a checksum manifest to GitHub Releases. The
release contains only inputs marked republishable in the rights table below.
An input whose terms are unclear stays out until its owner confirms in writing.
The snapshot is a release artifact, not a service. Installation fetches the
current release and later releases arrive through Pythia's update path. The
fetch sends no user data. Search, pages and the agent keep working offline on
the last installed release, and nothing on the typing path contacts the release
host.

**The same builder runs locally.** The builder is product code, and the device
runs that same code for steps that must not be published:

- the full ISO MIC list;
- US and Canadian ISINs, and ISIN-to-FIGI pairs for them;
- OpenFIGI tickers and names, until Bloomberg confirms their terms;
- exchange files the user imports, where the exchange's terms allow it;
- FCA FIRDS, only if the user opts in;
- overlays from the user's own credentials: a provider catalogue, a personal
  OpenFIGI key or an optional PermID token.

A self-hosted or offline install can build the entire snapshot locally from the
same code. Local outputs stay in local stores and never feed a published
release.

**Licensed provider data stays on the device and is never redistributed.**
Rows, symbols, identifiers and content obtained with a user's credentials live
only in local stores. They are never included in a snapshot, uploaded to or
pooled by a Pythia-operated service, or shared with other installs. Provider
plugins remain bring-your-own-key, and Pythia never proxies provider data. An
investor's own agent work with the model they configured in Hermes is their use
of their data. Any Pythia feature that would send licensed rows to another
service, such as a hosted matcher, needs its own decision and explicit opt-in.

**Paid enrichment is optional and later.** A paid plugin, if offered, would sell
Pythia's own labour and the licences Pythia pays for. It would deliver an
overlay over the open snapshot through a small signed-URL gateway, and it would
not become a runtime dependency. It may sell:

- curated links such as depositary receipt to ordinary share, share classes
  and ratios;
- rename and delisting history derived from successive snapshots;
- hosted matcher verdicts over open data;
- licensed coverage, once the economics below allow it.

It never gates, delays or degrades public data. It never contains anything
derived from users' provider rows. Any paid product that includes FIRDS data
says that FIRDS is available free of charge from ESMA. This ruling adopts no
paid tier and no licence.

### Rights by source

| Source | Published terms | In the public snapshot | On the device |
| --- | --- | --- | --- |
| [ESMA FIRDS](https://www.esma.europa.eu/legal-notice) | Reproduction allowed with the source acknowledged; transformed data carries ESMA's disclaimer; sold documents must say the material is free from ESMA; no implied endorsement | Yes, with attribution | Yes |
| [GLEIF Level 1 and 2](https://www.gleif.org/en/meta/lei-data-terms-of-use) | CC0; no implied endorsement | Yes | Yes |
| [GLEIF/ANNA ISIN-to-LEI](https://www.gleif.org/en/lei-data/lei-mapping/download-isin-to-lei-relationship-files) | Both parties call the file freely available [without restriction](https://anna-web.org/anna-and-gleif-isin-to-lei-mapping-service-jurisdiction-expansion/); no formal licence named | Yes | Yes |
| [SEC](https://www.sec.gov/privacy) | Public information; citation requested; fair access limits apply to fetching | Yes | Yes |
| [FIGIs](https://www.openfigi.com/docs/terms-of-service) | Dedicated to the public domain (terms §1) | Yes | Yes |
| [OpenFIGI metadata](https://www.openfigi.com/about/faq) (ticker, name, exchange code, security type) | MIT according to the FAQ and the [OMG FIGI specification](https://www.omg.org/spec/FIGI/1.3/PDF) Annex D.6; the terms of service are silent | Only after Bloomberg confirms, with the MIT notice | Yes |
| ISINs and ISIN-to-FIGI pairs | EU ISINs from ESMA or GLEIF carry low risk. US and Canadian ISINs are claimed by [CUSIP Global Services](https://www.cusip.com/legal.html). Annex D.2 says ISIN-derived FIGI mappings cannot be freely redistributed | EU ISINs yes; US and Canadian ISINs no, until CUSIP Global Services replies | Yes |
| [ISO 10383 MIC](https://www.iso20022.org/sites/default/files/2020-02/ISO10383_Terms_of_use.pdf) | The full list, or a substantial part, may not be reproduced for third parties | Only the codes used in published records | Full list |
| [FCA FIRDS](https://www.fca.org.uk/legal) | Personal or single-firm use; no storage in a retrieval system without written permission | No | Opt-in only; the terms are unclear even for local use |
| Exchange listing files | No exchange checked grants redistribution; [Euronext](https://www.euronext.com/en/terms-use) forbids robots and databases | No | User import where the terms allow it; never automated for Euronext |
| [Open PermID](https://developers.lseg.com/content/dam/devportal/api-families/open-permid/permid_org_faq.pdf) | Basic fields CC BY 4.0, extended fields CC BY-NC; bulk files were discontinued in 2021 | No, until the field split and bulk access are confirmed | Per-user token |
| Licensed and personal-use providers (EODHD, Yahoo, CoinGecko and other bring-your-own-key connectors) | Personal use; no redistribution | Never | Yes |

A "Yes" in the snapshot column still requires the attribution in the NOTICE. A
row moves between columns only through a recorded change to this table.

## Rationale

**Cost.** Public-repository GitHub Actions are free on standard hosted runners
([billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)).
GitHub Releases state no limit on total release size or bandwidth for files
under 2 GiB ([releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)).
A 10 MB snapshot refreshed weekly by 10,000 installs is about 430 GB a month.
That is $0 on Releases, and an object-store mirror with free egress stays at
about $0–17. The estimated infrastructure cost is therefore about $0 from 100
to 10,000 installs. The real cost is an estimated 2–6 maintainer hours a month
for source breakage and releases, and it does not grow with installs. A free
central snapshot costs maintainer time, not infrastructure money.

**When licensing makes sense.** Paying users needed equals monthly cost divided
by price net of about 8% payment fees. With an assumed 3% conversion:

- Curation labour of about 8 hours a month breaks even at roughly 43–87 paying
  users at $10–20 a month.
- The cheapest useful licensed feeds break even at roughly 4,000–21,000 installs.
- Enterprise reference masters break even at roughly 15,000–60,000 installs.

No licence is worth taking before about 100–300 paying users. SEDOL
distribution would come first, then a Twelve Data–class feed.

**Operations.** A source change breaks one CI job, which a maintainer fixes once.
Installs keep the last good release in the meantime. Every bug report can cite
one snapshot version. First run takes about a minute instead of up to an hour.
The snapshot fits the invariant that Pythia adds no cloud dependency: it is a
versioned artifact like the pinned Hermes release, and the same builder remains
the self-host path.

## Consequences

**Attribution.** Every release ships a NOTICE containing:

- ESMA's source acknowledgement, its transformed-data disclaimer and a
  no-endorsement statement;
- the GLEIF CC0 statement and a no-endorsement statement;
- a citation of the SEC as the source;
- the MIT notice for FIGIs, and for OpenFIGI metadata once it is published;
- ISO 10383 as the source of the MIC codes used.

Records keep their source and source release so pages and widgets can show
provenance (ADR 0028). Local additions carry their own source labels and are
never exported. Model-generated verdicts may ship only as a built release
artifact, never as repository content.

**Versioning and staleness.** Releases are immutable. Each is identified by
build date and schema version and lists every source file with its as-of date.
The device verifies the checksum and schema before it activates a release
atomically. It keeps the previous release for rollback, and a failed build or
download leaves the last good release active. Subject IDs are opaque and carried
forward between releases with aliases, so saved references are never rewritten
(ADR 0037). The app shows the snapshot's age and marks it stale when it falls
behind the published schedule. FIRDS rarely sets termination dates, so the
builder detects inactive listings itself rather than trusting their absence.
The default cadence is weekly, following FIRDS's weekly full files.

**Unanswered questions.** Nothing is published while its rights question is
open. A release cannot be recalled from every install, so publishing only the
confirmed rows is the one reversible choice. A positive answer moves a row into
the snapshot without changing the architecture, and a negative answer changes
nothing that has already shipped. The CI job holds one project OpenFIGI key as a
repository secret to map FIGIs, and the OpenFIGI terms say nothing about who may
hold a key.

**A Yahoo-only user** needs no paid key. They get:

- search over EU regulated-market equities and every SEC-listed US ticker,
  grouped by issuer and security with the primary listing first;
- delayed prices through Yahoo symbols derived from ticker and MIC;
- a company profile from GLEIF;
- filings and as-reported facts from the SEC for the US, and from ESEF for the
  EU, where coverage is patchy.

Until Bloomberg confirms the metadata terms, EU tickers come from a local
OpenFIGI step. It takes about 15 minutes keyless or under a minute with a free
key, and search works by name before it completes. US ISINs appear only where
the local build supplies them. Sections without a source, such as estimates,
transcripts and normalized fundamentals, say they are not covered and name
what would fill them. Adding a provider improves exactly what it covers. In the
prototype audit, EODHD raised ISIN coverage of US listed shares from about 49%
to 98%. Global coverage is not a day-one promise; plugins and local imports add
it over time.

## Rejected alternatives

**Fully local build on every device.** This is the cleanest legally, but the
first run can take up to an hour without an OpenFIGI key. Every refresh
repeats about 45–60 MB of downloads per install. Five to eight fragile sources
break on every machine separately, each as a local bug report without a
reproducible build ID. At 10,000 installs, GLEIF alone would serve about 1.4 TB
a month of the same file. The local builder remains the fallback and self-host
path, not the default.

**A Pythia cloud service as the only path.** The first run is instant, but the
content limits are the same. It adds a runtime dependency, an API that costs
about $20–200 a month and on-call duty. It contradicts the no-cloud-dependency
invariant. It ties forks and self-hosters to Pythia's uptime and pricing, which
would make local-first nominal.

**Publishing unclear rows now and withdrawing them later.** Released files
cannot be recalled from installs, so this is not reversible.

## Open questions to confirm by email

Record each answer here, or in a superseding ADR, before changing the rights
table.

1. **OpenFIGI (Bloomberg).**
   - Do the MIT terms cover the returned ticker, name, exchange code, security
     type, market sector and share-class and composite FIGI fields in a public,
     commercially usable dataset? What notice is required?
   - Is project-level bulk mapping from CI with one key acceptable?
   - Does Bloomberg object to publishing ISIN-to-FIGI pairs whose ISINs come
     from ESMA (Annex D.2)?
2. **GLEIF and ANNA.** What licence does the ISIN-to-LEI file carry? Does
   republishing ISINs sourced from ESMA or GLEIF, joined to FIGIs and tickers,
   require an ANNA or national numbering agency licence?
3. **CUSIP Global Services.** Do US and Canadian ISINs taken from FIRDS or GLEIF
   need a distributor licence in a free or a paid dataset? What is the smallest
   such licence?
4. **ESMA.**
   - Is bulk reuse of FIRDS allowed in redistributed and paid datasets?
   - What is the exact attribution wording?
   - Does the "sold documents" clause apply to datasets?
   - Are FITRS files covered by the same terms?
5. **LSEG Open PermID.** Are quote-level ticker and MIC basic (CC BY) fields?
   Can registered users still get bulk files?
6. **EODHD.** Is a personal key used inside a local third-party tool, with the
   data kept only on that device, personal use?
7. **FCA**, only if UK coverage matters. Will it give written permission to
   include FCA FIRDS in a public snapshot?
