# FCA National Storage Mechanism source record

[Source onboarding](../architecture/source-onboarding.md) defines the stages
([ADR 0042](../decisions/0042-source-onboarding-standard.md)).

- **Status:** in onboarding (stages 1 to 3 measured; not signed off). The plugin
  ships `signoff: unsigned` and installed disabled: off in fresh profiles,
  labelled "not yet audited", never confirming identity. The founder
  spot-checks before any sign-off.
- **Owner:** `runtime/managed/plugins/nsm/` (`records.py` parses and counts
  drift; `__init__.py` reads, caches and raises the alarms).
- **Scope:** the NSM search `POST https://api.data.fca.org.uk/search?index=nsm-search`,
  filtered to one disclosing organisation's LEI and latest versions, newest
  100 disclosures, optionally narrowed by headline codes; the documents it
  links under `https://data.fca.org.uk/artefacts/NSM/`. Served as `filings`
  (authority `fca`) and `news`.
- **Measured on:** 2026-09-28, one machine: 66 search answers for 22 LEIs
  (a newest-100 page, the oldest disclosure and the all-versions count each),
  the headline category list, one code-filtered search, and 40 linked
  documents. 1,792 disclosures. Nothing was stored in the repository.
- **Changes to other sources' adapters:** market-data's shared public HTTP
  transport sends a request that carries a `json` body as a POST of that body
  (the NSM search accepts only POST). GET requests are unchanged.

### Access: an undocumented endpoint (founder ruling C2)

The endpoint is the one the NSM web page calls; its index name
(`nsm-search`) and request shape were read from the page's JavaScript. The FCA
does not document it, and its publishing-hub FAQ says "Direct access to the
NSM or other datasets is not permitted"; the NSM terms of use allow reuse of
the information "for any lawful purpose". The founder ruled on 2026-09-28
(C2, option b): "we can just use the API and if they don't like it they will
block it. Just add a small notice to the plugin that it's undocumented usage
and can break at any time." Consequences: the notice is in the plugin's
README, its tool descriptions and its contract attribution; the rate is low
(one request at a time, ten a minute, answers kept five minutes); a blocked or
changed endpoint is reported as `source_drift`, never as an empty list.

Citations: the NSM page's column list (JavaScript), "Page" below, names
`submitted_date` "Filing Date/Time", `publication_date` "Publication
Date/Time", `document_date` "Document Date", `lei` "Disclosing Organisation
LEI", `company` "Disclosing Organisation Name", `headline` "Description",
`type` "Category" and `tag_esef` "ESEF AFR Type". The category list is the
page's own supporting index (`GET https://api.data.fca.org.uk/getsuppdata?index=nsm-category`,
748 entries, 134 codes). [NSM investor user guide](https://www.fca.org.uk/publication/primary-market/nsm-investor-user-guide.pdf),
[terms of use](https://data.fca.org.uk/artefacts/NSM_Terms_of_Use.pdf),
[FAQ](https://data.fca.org.uk/artefacts/PUBLISHING_HUB_FAQs_v0.1.pdf).

## 1. Field semantics

| Field | Official definition | Pythia meaning | Measured behaviour (1,792 rows) | Read |
| --- | --- | --- | --- | --- |
| request `company_lei` | Page: four slots, name, LEI, `disclose_org`, `related_org` | Disclosures whose disclosing organisation has this LEI | Any other slot shape answers HTTP 404 "Unable to search the data" (5 of 5 variants) | Sent |
| request `latest_flag: Y` | Page filter | Latest version of each disclosure | Every row `Y` | Sent |
| request `type_code` | Page filter by headline code | Search by kind across the archive | Shell `ACS`+`IR`: 19 rows, all of those codes | Sent for kinds with codes |
| `hits.total` (`relation: eq`) | Search engine count | Disclosures of the LEI in the archive | 13 to 3,016 per UK issuer; 0 for Apple and ASML | Yes (alarm) |
| `disclosure_id` | Not documented | `accession`/`id` of the disclosure, stable across versions | UUID (RNS, GNW, BWI), 7-digit RNS id (older), `NI-` number (uploads), PRN id with underscores | Yes |
| `seq_id`, `hist_seq` | Not documented | Version id and number | `hist_seq` 2 on 6 rows; the link then uses `seq_id` | No (latest only) |
| `lei` | Page: "Disclosing Organisation LEI" | Every filer; the issuer is one of them | `;`-joined on 7 rows (joint base prospectuses); never another issuer's alone | Yes (`parties`) |
| `company` | Page: "Disclosing Organisation Name" | The filer's name at filing time | `;`-joined like `lei`, sometimes with a trailing `;`; former names kept (53 rows) | Resolve name only |
| `headline` | Page: "Description" | Title | Free text; the standard wording for routine notices | Yes |
| `type`, `type_code` | Page: "Category"; headline code from the category list | Category name; `form` is the code | 65 codes in the sample, all in the category list | Yes |
| `category_group` | Not on the page | Drift vocabulary only | 9 values, including "Regulator announcement" (11 rows, not in the site's filters) | Drift only |
| `classifications_code`, `classifications` | Classes of regulated information; the NSM labels `2.2` "Inside information" | `event` when `2.2` is among the classes | Empty 911, `0.0` 492, `3.1` 208, `2.2` 31, missing 61; `;`-joined on 6 | Yes (kind) |
| `submitted_date` | Page: "Filing Date/Time" | `accepted_at` and `filed_at` (filing time, UTC) | ISO with `Z`; fractional seconds on 93 upload rows | Yes |
| `publication_date` | Page: "Publication Date/Time" | News `published_at`: when the information was made public | Median 97 s before submission; 53 rows over an hour (32 direct uploads, 20 FCA, 1 RNS), up to 115 days | Yes |
| `document_date` | Page: "Document Date" | None | Missing 44%, a date 5%, a timestamp 51% | No |
| `source` | Page: "Source" | `via`: the dissemination service | RNS 1,590, GNW 97, Direct Upload 73, FCA 20, PRN 8, BWI 4 | Yes |
| `document_format` | Not documented | `format` (`text`, `pdf`, `ixbrl`, `html`, null for Other) | Plain text 1,702, PDF 74, Tagged 9, Other 7 | Yes |
| `download_link` | Not documented | `url`, under the artefacts origin | `NSM/<source>/<id>.html` or `NSM/<source>/<id>/<file>`; 40 of 40 sampled resolve | Yes |
| `IsTestSubmission` | Not documented | A test row is left out | `false` on 13 upload rows | Yes (drop) |
| `tag_esef`, `html_link`, `json_link`, `csv_link` | Page: "ESEF AFR Type" | None yet | ESEF AFR packages (`.xbri`, `.zip`) on 9 rows | No |
| `related_org` | Page: related organisation filter | None | `[{lei?, company}]` on 6 rows (finance subsidiaries, a counterparty) | No |
| `last_updated_date`, `lei_remediation_flag`, `ContentVersionId`, `ProcessType`, `RegionOfIncorporation` | Not documented | None | Nanosecond index times; always `N`; upload metadata | No |

Relevant fields not read: the ESEF links (`tag_esef`, `html_link`, `json_link`)
could give a UK annual report's viewer and xBRL-JSON, and the ESEF file name
carries its period end (`<LEI>-<YYYY-MM-DD>`); `related_org` names a
counterparty or subsidiary. `period_end`, `basis` and `language` are null.

Kinds (core's `FilingKind`) from the headline code: `ACS` annual (the DTR 4.1
annual financial report), `IR` half-year, `QRF`/`QRT` quarterly, `FR`/`PRE`
earnings release, `DSH`, `HOL` and the Takeover Code Form 8 codes
(`RET`, `FEE`, `FEO`, `FER`, `DCC`) ownership, `PDI`, `PSP`, `PFT`, `FCA01`
prospectus; class `2.2` event; any other code `other`.

## 2. Adapter and drift alarms

- [x] Every read field has one parse and one meaning, keyed by the requested
  LEI (`records.py`).
- [x] Picks no winner and reads no other source. A joint disclosure lists every
  filer and appears under each.
- [x] An empty answer is an empty list; only a previously non-empty issuer
  turning empty is an alarm.
- [x] Resolve claims only the requested LEI (echoed) and a name; core's gate
  makes it an unaudited residual.
- [x] Unexpected input is counted, never coerced; rows that cannot be read
  safely are left out and reported.
- [x] A structural break fails the read (`invalid_response` or
  `source_drift`); nothing is retained from it.
- [x] Network-free synthetic tests: `runtime/test/python/test_nsm.py`.

A live connector has no build, so each answer is checked as it arrives, logged
as `source_drift` for maintainers and, when rows were dropped or the read
failed, shown in the answer.

| Check | Baseline (2026-09-28) | Alarm |
| --- | --- | --- |
| Envelope | `hits.total.value` int with `relation: eq`, `hits.hits` list, `timed_out: false` | `invalid_response`, not retained (`changed_shape`) |
| HTTP 404 or 400 from the search | Only for a malformed query | `source_drift` error (`query_refused`) |
| Empty answer for an issuer listed earlier in the session | Never: an archive does not shrink | `source_drift` error (`known_lei_empty`) |
| Field set | The 29 fields above | `unknown_field`, row kept |
| Required fields | 12 fields present on every row | `missing_field`, row dropped |
| Filter holds | The LEI among the row's filers; `latest_flag: Y`; the requested codes | `foreign_lei`, `not_latest`, `foreign_code`, row dropped |
| Test rows | None | `test_submission`, row dropped |
| Shapes | Times ISO with `Z`; id `[A-Za-z0-9_-]`; code `[A-Z][A-Z0-9]{1,5}`; link under `NSM/` | `malformed_*`, row dropped |
| Vocabularies | 9 groups, 9 services, 5 formats | `unknown_group`/`_source`/`_format`, row kept |

The alarm for an empty known issuer lives in memory for the session: a
restart forgets it. The periodic probe below covers the gap.

## 3. Data audit

Random sample, frozen with seed 20260928 (script over cached answers):

- **Frame:** 875 GB-incorporated issuers with an LEI and ordinary shares on
  XLON in the reference build (GLEIF LEIs, FITRS turnover ranks).
- **Strata:** the six named issuers; turnover-rank terciles (large 3, mid 5,
  small 4, drawn from 273, 273 and 275); unranked 2 (of 48); controls without
  NSM filings, Apple and ASML.
- **Documents:** 2 disclosures per issuer drawn from its newest page, 40 in
  all, fetched once and labelled against the document itself (the issuer's own
  announcement) and GLEIF names for the LEI.
- **Labelling date:** 2026-09-28.

| Issuer | Stratum | LEI | Disclosures |
| --- | --- | --- | --- |
| Shell PLC | named | `21380068P1DRHMJ8KU70` | 2,070 |
| BP P.L.C. | named | `213800LH1BZH3DI6G760` | 2,971 |
| Unilever PLC | named | `549300MKFYEKVRWML317` | 1,773 |
| RELX PLC | named | `549300WSX3VBUFFJOO66` | 3,016 |
| HSBC Holdings PLC | named | `MLU0ZO3ML4LN2LL2TL39` | 1,763 |
| AstraZeneca PLC | named | `PY6ZZQWO2IZFZC3IOL08` | 900 |
| Derwent London PLC | large | `213800BXKQ9KZNUR1M61` | 847 |
| Anglo American PLC | large | `549300S9XF92D1X8ME43` | 884 |
| Oxford Nanopore Technologies PLC | large | `213800IRWQ2Q6M2CDW55` | 368 |
| Cerillion PLC | mid | `213800ISIZMUC3P46850` | 269 |
| Intercede Group PLC | mid | `2138001HHZHVUMKZ8968` | 335 |
| The Alumasc Group PLC | mid | `2138002MV11VKZFJ4359` | 182 |
| Wolfram Resources PLC | mid | `213800PZFXCGPDWACF30` | 32 |
| Invinity Energy Systems PLC | mid | `213800XX6UAMF51CYM12` | 47 |
| Sunrise Resources PLC | small | `213800MGDOE974QHPZ44` | 381 |
| Scancell Holdings PLC | small | `2138008RXEG856SNP666` | 432 |
| Fulcrum Metals PLC | small | `21380058R5JN7ZOLZK12` | 158 |
| Shoe Zone PLC | small | `21380016X1OWIRVRSI65` | 259 |
| Hellenic Dynamics PLC | unranked | `213800IM978BOB5QZA69` | 195 |
| Electric Guitar PLC | unranked | `894500943SA9KY5T9V86` | 13 |
| Apple Inc. | control | `HWUPKR0MPOU8FGXBT394` | 0 |
| ASML Holding N.V. | control | `724500Y6DUVHQD6OXN27` | 0 |

| Field | Precision (Wilson 95%) | n |
| --- | --- | --- |
| LEI keying: the document is the issuer's (its name or a GLEIF former name) | 100% (91.0–100) | 39 (1 PDF unreadable by script) |
| `url` resolves to the disclosure | 100% (91.2–100) | 40 |
| `published_at`: the document's own release date (London) | 100% (91.0–100) | 39 (2 Shell buy-back notices headed with the trade date, see odd cases) |
| `kind` other than `other` | 100% (78.5–100) | 14 |
| Name per LEI on every row: current or GLEIF former name | 99.7% (1,787 of 1,792) | 1,792; 5 rows under an interim name GLEIF does not list |

Invariants on every answer (limit 0): no row of another LEI, no superseded
version, no test submission. All held on the 1,792 rows.

Periodic probe: a maintainer re-reads the 20 sampled LEIs; each must list at
least its recorded count, and Apple and ASML none.

### Odd cases

| Case | Count (unit) | Example | Explanation | Handling | Status |
| --- | --- | --- | --- | --- | --- |
| Undocumented endpoint; a malformed query answers 404 | 5 of 5 variants | three-slot `company_lei` | Not an API; the page's own call | `source_drift` error, never empty | Handled |
| A disclosure has several filers | 7 rows (4 issuers) | Shell plc and Shell International Finance B.V. base prospectus | Joint filings | Every filer in `parties`; listed under each | Handled |
| The name is the one at filing time | 53 rows (3 issuers) | U.K. SPAC PLC under Hellenic Dynamics' LEI; Becket Invest and Miotal under Wolfram Resources' | Renames keep the LEI | Resolve names from the newest sole-filer row; 5 Miotal rows unconfirmed by GLEIF | Handled; Miotal open |
| Annual reports are crowded out of the newest page | 2 of 20 issuers | Shell's newest 100 span 14 May–28 Sep 2026: buy-backs and PDMR notices | Daily routine notices | `kinds` search by headline code | Handled |
| Results without an annual financial report (`ACS`) | 5 of 20 issuers | Intercede, Scancell, Fulcrum, Invinity (AIM) and Alumasc: `FR` only on their newest page | DTR 4.1 binds regulated-market issuers; AIM results are announcements | `earnings_release`; `annual` finds nothing for them | Accepted limit |
| Inside information is rarely classed | 31 of 1,792 rows carry `2.2`; 8 of 26 sampled `other` read as events | AstraZeneca "Fixed-duration Calquence combo approved in US" (`MSCL`) | Classification is optional for the filer | `other`; a later judgement question could suggest `event` | Open |
| Several classes in one field; placeholder `0.0` | 6 and 492 rows | `3.1;2.2` | — | Split on `;`; `0.0` means none | Handled |
| Publication time stated by the uploader | 53 rows over an hour before submission | Electric Guitar annual report: published 115 days before it was submitted | Direct and FCA uploads carry the document's date | News uses it as published; filings use the submission time | Accepted limit |
| Buy-back notices headed with the trade date | 2 of 2 sampled Shell `POS` | Headed 21 May, released 22 May 10:39 | The notice reports the previous day's purchases | NSM time is the release time (Yahoo showed it at the same minute, research 2026-09-28) | Handled |
| A group outside the site's filters | 11 rows | "Regulator announcement": price monitoring, suspension, restoration | Exchange notices | Vocabulary; a new value is only reported | Handled |
| Identifiers of three shapes | 1,792 rows | UUID, `5599260`, `NI-000145170`, `202308010200PR_NEWS_UKDISCLO_0013` | Per dissemination service | One pattern admits all; the first adapter dropped the PRN ids, which the audit caught | Handled |
| Archive placeholders | 4 of 20 issuers | Oldest disclosure `2010-12-31T00:00:00Z` | Back-filled history | Not on the newest page; not read | Accepted |
| Non-text documents | 16 rows | `.docx`, `.xml`, ESEF `.xbri`/`.zip` | Direct uploads | `format` null for Other; link kept | Handled |

## 4. Judgement cases

| Question type | Why code can't decide it | Question set | Development check | Gold set and threshold, or suggest-only |
| --- | --- | --- | --- | --- |
| None yet | — | — | — | — |

Classes assigned to code or to Repairs instead:

- The issuer is the disclosing organisation's LEI: an identifier join, no
  judgement. A joint filer is listed as a party, never merged.
- An unclassified material event stays `other` (open); a suggest-only question
  would be the route if the Desk needs it.

## Sign-off

- [ ] Every stage meets its exit criteria (kind precision rests on 14 labels;
  the event gap is open).
- [ ] The founder's spot-check of the sample.
- [ ] Reviewer, date and PR are recorded.

Open items accepted for the first version: the endpoint is undocumented and
may be withdrawn (founder ruling C2); the empty-issuer alarm is per session.
