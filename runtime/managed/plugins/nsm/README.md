# FCA National Storage Mechanism connector

> **Notice: undocumented endpoint.** This plugin reads the JSON search that the
> FCA's own NSM web page calls (`POST https://api.data.fca.org.uk/search?index=nsm-search`,
> found in the page's JavaScript). The FCA does not document it or offer it as an
> API, and its publishing-hub FAQ says direct access to the NSM is not permitted.
> Pythia uses it anyway, at a low rate, by the founder's ruling (2026-09-28): if
> the FCA objects, it can block it. **It can change or break at any time.** When
> it does, the plugin reports a `source_drift` error, never "no disclosures".

Native `pythia-nsm` serves a UK issuer's regulated disclosures from the FCA
National Storage Mechanism, keyed by the issuer's LEI. It declares two of core's
concepts ([ADR 0040](../../../../docs/decisions/0040-data-concepts-and-agent-tools.md)):

- `filings` for the `fca` authority, the UK's national mechanism. Core takes one
  source per authority, so the investor's order decides between this plugin and
  filings.xbrl.org for UK filings.
- `news`: every disclosure is a regulatory announcement, merged into core's news
  feed with the other news sources.

It is keyless, ships `signoff: unsigned` and is installed disabled: it is off in
fresh profiles, labelled "not yet audited" wherever its data appears, and never
confirms identity ([ADR 0042](../../../../docs/decisions/0042-source-onboarding-standard.md)).
Its source record is [docs/sources/nsm.md](../../../../docs/sources/nsm.md).

## Operations

| Operation | Input | Result |
| --- | --- | --- |
| `resolve` | `identifiers.lei`; optional `refresh` | a `ClaimBatch` with one issuer claim (the LEI, the NSM native reference and the name of the issuer's newest disclosure it filed alone), or outcome `empty` when the NSM lists no disclosure of that LEI |
| `filings` | `native_ref`, optional `limit` (≤ 100), `kinds`, `refresh` | core's filing rows, newest first: `accession` (the disclosure id), `form` (the NSM headline code, such as `ACS` or `POS`), `kind`, `category`, `filed_at` and `accepted_at` (the NSM's "Filing Date/Time"), `published_at`, `format`, `parties` (every filer LEI), `url`, `via` |
| `news` | `native_ref`, optional `limit` (≤ 100), `refresh` | core's news rows: `title` (the headline), `published_at` (when the information was made public), `url`, `publisher` `FCA NSM`, `kind: regulatory`, `category` and `via` (RNS, GNW, ...) |

- **Kinds** come from the headline code: `ACS` annual, `IR` half-year, `QRF` and
  `QRT` quarterly, `FR` and `PRE` earnings releases, director, holding and Form 8
  dealings ownership, prospectus codes prospectus; a disclosure classed as
  inside information (`2.2`) is an event, and anything else `other`.
- **Kinds search the archive.** Without `kinds`, one search returns the issuer's
  newest 100 disclosures; for a large issuer that is two months of buy-back and
  holdings notices without its annual report. With kinds that have headline
  codes, the search asks for those codes across the whole archive.
- The NSM states no report period, accounting basis or language: they are null.
- A disclosure filed jointly (a base prospectus of an issuer and its finance
  subsidiary) lists every filer; it appears under each of them.

## Rate, cache and failures

One search per issuer serves resolve, filings and news; its answer is kept in
memory for five minutes (the NSM trails the wire by one to two minutes). The
local budget is one request at a time and ten a minute. `refresh` reads fresh.

Every answer is checked before it is kept (see the record's drift table):

- a changed envelope is `invalid_response`; a 404 or 400 from the search (it
  answers a query it cannot run with 404 "Unable to search the data") is
  `source_drift`; an issuer that listed disclosures earlier in the session and
  now lists none is `source_drift`;
- a row that cannot be read safely (another issuer's LEI, a superseded version,
  a test submission, a missing field, an unreadable time, id, code or link) is
  left out, counted, logged as `source_drift` and reported as a warning;
- an unknown field, category group, dissemination service or document format is
  logged and the row kept.

Synthetic tests: `runtime/test/python/test_nsm.py`.

Sources: [NSM](https://data.fca.org.uk/#/nsm/nationalstoragemechanism),
[NSM terms of use](https://data.fca.org.uk/artefacts/NSM_Terms_of_Use.pdf),
[publishing hub FAQ](https://data.fca.org.uk/artefacts/PUBLISHING_HUB_FAQs_v0.1.pdf).
