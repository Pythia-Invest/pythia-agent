# SEC EDGAR source record

- **Status:** in onboarding, beside FIRDS as the amended ADR 0042 allows.
  Stages 1 to 3 are recorded here and stage 4 is listed, so sign-off is open.
  The SEC was in use before the
  [onboarding standard](../architecture/source-onboarding.md), so it keeps its
  current role (`grandfathered`) until it signs off. Its CIK to LEI links depend
  on FIRDS field 5 (see the odd cases).
- **Owner:**
  - Identity reference: `tooling/reference-builder/reference_builder/sec.py`
    (parse and fingerprint) and `linking.py` (the CIK joins).
  - Content: the `pythia-sec` plugin, `runtime/managed/plugins/sec/`
    (`identity.py`, `filings.py`, `financials.py`).
  - Content drift probe: `tooling/reference-builder/reference_builder/sec_probe.py`
    (`just reference-sec-probe`).
  - The audit: `tooling/reference-builder/reference_builder/sec_audit.py`
    (`just reference-sec-audit fetch|draw|label`).
- **Scope:**
  - `company_tickers_exchange.json`, read by the builder and by the plugin's
    `resolve`;
  - `company_tickers_mf.json`, read by the builder for US ETFs;
  - `data.sec.gov/submissions`, read by the plugin's `resolve` and `filings`;
  - `data.sec.gov/api/xbrl/companyfacts`, read by the plugin's `fundamentals`
    and `facts`.

  Not in scope: the Atom and current feeds, Forms 4 and 13G contents,
  full-text search and the frames API.
- **Measured on:**
  - the ticker files downloaded on 2026-09-28: 10,428 company rows and
    28,560 fund rows;
  - EDGAR's `form.idx` for 2025 Q3 to 2026 Q3, used to draw the sample;
  - `submissions` and `companyfacts` of the 48 sample filers read on
    2026-09-28: 24,955 filing rows and 495,646 fact rows;
  - for each filer, the EDGAR submission headers of 217 filings and the XBRL
    instances of 79 filings, read as the primary source;
  - 12 filings accepted on 2026-09-28, read from the current feed;
  - the local reference build of 2026-09-28 (scope XAMS, XETR and US), for the
    CIK joins.

  Raw responses stayed under `.local/`.
- **Changes to other sources' adapters:** none. The audit measured one FIRDS
  case through the CIK joins (field 5 naming another company) and recorded it
  in the [FIRDS record](firds.md).

Citations:

- [EDGAR application programming interfaces](https://www.sec.gov/search-filings/edgar-application-programming-interfaces),
  "API page" below (last reviewed by SEC 2025-04-08);
- [SEC webmaster FAQ](https://www.sec.gov/about/webmaster-frequently-asked-questions),
  "FAQ" below: the ticker files, accession numbers and EDGAR timestamps;
- [Accessing EDGAR data](https://www.sec.gov/os/accessing-edgar-data): ten
  requests a second and a declared User-Agent;
- [Regulation S-T Rule 13](https://www.ecfr.gov/current/title-17/section-232.13):
  filing dates;
- [Form 8-K](https://www.sec.gov/files/form8-k.pdf) General Instructions B and
  C, and [Release 33-8400](https://www.sec.gov/rules/final/33-8400.htm), which
  renumbered the items from 2004-08-23;
- [Release 33-10618](https://www.sec.gov/rules/final/2019/33-10618.pdf), which
  requires cover-page tagging on 10-K, 10-Q, 8-K, 20-F and 40-F, not 6-K.

No announced change to the JSON formats was found. SEC renamed Schedules 13D
and 13G (`SC 13G` to `SCHEDULE 13G`) in late 2024, which the plugin reads.

## 1. Field semantics

"Read today" describes `identity-backbone` on 2026-09-28.

### Ticker files

SEC documents these files only in the FAQ: "ticker/CIK/Company name
associations", which it updates periodically "but [does] not guarantee accuracy
or scope". `company_tickers.json` holds the same 10,428 CIK and ticker pairs
without the exchange.

| Field | Official definition | Pythia meaning | Measured behaviour | Read today |
| --- | --- | --- | --- | --- |
| `cik` | Central Index Key of the filer (FAQ) | The issuer's CIK, the `cik` scheme at issuer level. A CIK identifies a filer, not a security | 8,004 CIKs; 1,453 carry several tickers | Builder and plugin |
| `name` | "EDGAR conformed name" (FAQ) | The SEC title, a name of the issuer, never its identity | One title per CIK (0 with two) | Builder: an issuer name. Plugin: the resolve claim's name |
| `ticker` | Ticker associated with the CIK (FAQ) | A ticker line of the issuer, in SEC's spelling (`-` before a class: `BRK-B`) | 0 tickers on two rows; 544 with a class suffix; 1 placeholder (`NONE.`, no exchange). It includes exchange-listed notes and preferreds (T-Mobile's `TMUSI`, `TMUSL`, `TMUSZ` are senior notes on Nasdaq), and an ADR on an exchange beside the ordinary share on OTC under one CIK (ASML and `ASMLF`, ING and `INGVF`) | Builder and plugin |
| `exchange` | Not defined | The exchange group, mapped to an operating MIC: `Nasdaq` XNAS, `NYSE` XNYS, `CBOE` XCBO, `OTC` OTCM. `NYSE` also covers NYSE American and Arca, which are XNYS segments in ISO 10383 | Nasdaq 4,374, NYSE 3,302, OTC 2,542, CBOE 44, missing 166 | Builder and plugin |
| fund file `symbol` | Fund class ticker (FAQ lists the file with the company file) | A fund-class ticker, looked up in OpenFIGI; exchange-traded only when OpenFIGI types it `ETP` | 28,560 rows; 1 empty; 30 not in SEC's usual spelling (26 lower-case such as `elfnx`, `(NWAKX)`, `n/a`) | Builder |

Fund-file `cik`, `seriesId` and `classId` are not read.

### Submissions

The API page: the document holds "metadata such as current name, former name,
and stock exchanges and ticker symbols", and `filings.recent` holds "at least
one year's of filing or to 1,000 (whichever is more) of the most recent filings
in a compact columnar data array"; older filings are in the files that
`filings.files` names.

| Field | Official definition | Pythia meaning | Measured behaviour (48 filers, 24,955 rows) | Read today |
| --- | --- | --- | --- | --- |
| `cik`, `name`, `formerNames` | Current and former names (API page) | The filer's CIK and names, with each former name's dates | 48/48 | Plugin `resolve` |
| `tickers`, `exchanges` | Exchanges and tickers (API page) | Ticker lines, as in the ticker file | Equal to the ticker file for 48/48 filers | Plugin `resolve` |
| `stateOfIncorporation`, `…Description` | Not defined on the API page; the values are EDGAR's [state and country codes](https://www.sec.gov/submit-filings/filer-support-resources/edgar-state-country-codes) | The incorporation code. EDGAR codes are not ISO 3166: `DE` is Delaware | Present for 43/48 | Plugin `resolve` |
| `accessionNumber` | A unique identifier of an accepted submission; the first ten digits are the submitting entity's CIK, which may be a filing agent (FAQ) | The filing id, `sec:<accession>` | 0 malformed of 24,955 | Plugin |
| `form` | Not defined on the API page; the submission header's form type | The native form; amendments end in `/A` | 176 forms; 217/217 equal to the header's `TYPE` | Plugin |
| `filingDate` | "EDGAR assigned official filing date" (FAQ, header `FILED AS OF DATE`) | The filing date | 217/217 equal to the header. After 17:30 ET the date moves to the next business day, except Forms 3, 4 and 5 and Schedules 13D and 13G, which count until 22:00 (Regulation S-T Rule 13). The rule follows when transmission starts, so 26 of 32 filings accepted after 17:30 still carried that day: 18 Forms 3 and 4, 3 schedules, 2 SEC uploads and 3 accepted between 17:30 and 17:35 | Plugin |
| `reportDate` | "End date of reporting period of filing" (FAQ, header `PERIOD`) | The period end the filing reports | 217/217 equal to the header; empty on 23.7% of rows, on one periodic report (a 20-F of 2002) | Plugin |
| `acceptanceDateTime` | When EDGAR accepted the submission. The header gives it in Eastern time (FAQ: "Time (EST)") | The acceptance time in true UTC | Labelled `Z`. True UTC on 217/217 older filings. On the day of filing it is the Eastern wall-clock time labelled `Z`: 18/18 filings of 2026-09-28 against the current feed's offsets | Plugin, read by filing day |
| `items` | Form 8-K item numbers (Form 8-K) | The 8-K items; `2.02` is results of operations | Filled on 8-K rows, and on EFFECT (131), D (32) and CT ORDER (23) rows with other values. 8-Ks filed before 2004-08-23 use items 1 to 12 | Plugin, 8-K only |
| `primaryDocument`, `primaryDocDescription` | Not defined on the API page | The document link and a description | Description empty on 18% of rows, often only the form name | Plugin |
| `isXBRL`, `isInlineXBRL` | Not defined on the API page | Whether the filing has XBRL; with a 6-K, 10-K, 10-Q, 20-F or 40-F, whether companyfacts should carry its statements | 0/1 | Plugin |
| `size` | Not defined on the API page | The whole submission, every document included | 0 malformed | Plugin |

Relevant fields not read:

- `lei`: null for 48/48 filers, so it is no join path today.
- `fiscalYearEnd`: MMDD, and wrong for 52/53-week years. Apple's is `0926`
  while its year ended 2025-09-27. Periods come from dates instead.
- `category` (filer status), `sic`, `ein`, `entityType`, `act`,
  `fileNumber` and `filmNumber`.
- `core_type` and `isXBRLNumeric` are not in SEC's documentation.
  - `isXBRLNumeric` is set on 1,310 rows, for filings since about April 2026.
  - It is 0 on amendments that carry only a cover page (Owlet's 10-K/A,
    High-Trend's 20-F/A).
  - It would tell a cover-only filing apart, but it stays unread until SEC
    documents it.
  - The probe fingerprints both columns.

### Companyfacts

The API page: the XBRL APIs "aggregate facts from across submissions that use a
non-custom taxonomy (e.g. us-gaap, ifrs-full, dei, or srt)" and "apply to the
entire filing entity". Extensions and dimensional facts are left out. Frames are
"the dates that best align with a calendar quarter or year", with a duration of
"365 days +/- 30 days" for a year. The page says these APIs update "with a
typical processing delay of under a minute". The 2026 gap below contradicts it.

| Field | Official definition | Pythia meaning | Measured behaviour (48 filers, 495,646 rows) | Read today |
| --- | --- | --- | --- | --- |
| `facts.<taxonomy>.<concept>` | A non-custom concept | The native concept, kept with its taxonomy; `us-gaap` and `ifrs-full` are never merged | us-gaap 455,566, ifrs-full 37,908, dei 1,549, srt 243, and a few `invest`, `ecd`, `ffd`, `spac` and `rxp` rows | Plugin |
| `units.<unit>` | Unit of measure; ratios as `-per-` | The unit, such as `USD`, `shares` or `EUR/shares`; never converted | 81 units | Plugin |
| `val` | The reported value | The value as filed. No `decimals` is given | 28,410 of 28,461 rows of 79 filings match the filing's instance exactly; the rest are the one-day durations below | Plugin |
| `start`, `end` | Period dates | A duration when `start` is present, else an instant | A one-day duration comes as an instant (51 rows). The start and end dates decide the period | Plugin |
| `accn`, `form`, `filed` | The filing that reported the fact | The fact's provenance | Every row | Plugin |
| `fy`, `fp` | Fiscal year and period of the filing | The filing's fiscal focus, never the fact's period | For 79/79 filings, equal to the filing's `dei` focus. On 62% of full-year rows `fy` is not the period's end year: comparatives carry the filing's year, and a 52/53-week year ending 2026-01-03 (Helios) is `fy` 2026. `fp` is missing on 6,552 rows (1.3%) | Plugin, passed through |
| `frame` | The calendar frame the fact "most closely fits", on one fact per period | The latest filing's fact for a calendar period | On 42% of rows. It moves to the newest filing that reports the period: Owlet's FY2025 revenue is 105.708m in its 10-K and 106.159m in its Q2 2026 10-Q, which holds `CY2025` | Plugin, passed through |
| `dei` facts | Cover facts | Not statements | Only numeric cover facts: shares outstanding (42 filers), public float (27) and 2 others. When companyfacts lacks a filing's statements it still keeps one `dei` fact of it (Toyota, Turbo Energy) | Plugin: not counted as statements |

Unread: `label` and `description` of each concept (the taxonomy's own).

## 2. Adapter and drift alarms

The reference builder:

- [ ] Every field has one parse and one claim meaning, keyed by a global
  identifier. **Open:** the builder emits no typed SEC claims yet. Each
  meaning is carried in names and types: a CIK is the issuer's, an exchange
  label an operating MIC.
- [x] Only direct field values are `source_asserted`. A CIK the build joins to
  a LEI issuer is a rule's output (`isin_exch_us`, `share_class_figi`, the rule
  in `source_record`), written `rule_confirmed` since builder rules version 4;
  GLEIF's EDGAR registration and a CIK-only issuer's CIK stay
  `source_asserted`.
- [x] The adapter picks no winner and reads no other source. The parse keeps
  the first of two rows naming one ticker; none occur, and the fingerprint
  counts them.
- [x] An empty answer is recorded as absence: a row without an exchange gets
  no venue and no listing.
- [x] Unexpected input is counted, never coerced. The fund file's parse
  upper-cases symbols; the 30 odd spellings are counted.
- [x] A structural break fails the stage and keeps the last good build. The
  fingerprint is taken before the parse, and a broken file is never parsed.
- [x] Network-free tests use synthetic fixtures that cite the format
  (`test/test_sec_drift.py`).

The plugin (live, so it checks each response):

- [x] Each field has one meaning (the tables above).
- [x] A malformed value is counted under `drift`, left empty and shown as a
  warning.
- [x] An unknown form is logged. A column of another length refuses the
  read.
- [x] `acceptanceDateTime` is read by filing day. On the day of filing the
  value is Eastern time. From 00:00 to 06:00 ET the previous day's time is
  left out, because SEC's rewrite hour is unknown.
- [x] `fundamentals` checks that companyfacts holds the latest report with
  XBRL: 10-K, 10-Q, 20-F, 40-F and, since this audit, 6-K.
- [x] Tests: `runtime/test/python/test_sec_connector.py`.

Fingerprints, each compared with the newest older good record in
`.local/reference-builder/out/`:

| Fingerprint | Written by | Baseline, 2026-09-28 | Alarm |
| --- | --- | --- | --- |
| `sec_tickers`: columns per row, `exchange` vocabulary, counts | every build with US lines | 10,428 rows. Exchange missing 166, class suffix 544, malformed ticker 1, ticker on two rows 0, CIK under two titles 0, CIKs with several tickers 1,453 | A read column gone, or a file not in the `{fields, data}` shape, is a **break**: the build stops before the parse. New or vanished labels, shifted counts and presence rates are alarms (the thresholds of `source_drift.py`) |
| `sec_funds`: columns per row, counts | every build with the fund file | 28,560 rows. Symbol missing 1, malformed symbol 30 | As above; `symbol` gone is a break |
| `sec_filers`: top-level keys, `entityType` | `just reference-sec-probe` | 48 filers; `lei` present 0 | A key the plugin reads gone is a break |
| `sec_filings`: columns per row, form groups (periodic, current, ownership, other known, unknown), counts | the probe | 24,955 rows. Unknown form 0, unknown 8-K item 0, malformed acceptance time 0, unequal columns 0, periodic report without a report date 1 | A column the plugin reads gone is a break. A form outside the plugin's vocabulary is an alarm |
| `sec_facts`: keys per row, the taxonomy, form and `fp` vocabularies, counts | the probe | 495,646 rows; `fp` missing 6,552; companyfacts lacking the latest report 11 of 48 filers | `frame` or another read key gone is a break. Every change in the stale count is an alarm, up or down (`sec_probe.EXACT`) |

`just reference-audit` shows the ticker files' drift beside a snapshot and
fails on a break. The probe reads the frozen sample below: two requests per
filer, paced under seven a second, with the configured `sec_identity`.

## 3. Data audit

**Random sample:** `tooling/reference-builder/samples/sec-2026-09-28.json`.

- **Seed:** 20260928.
- **Drawn from:** filers in the company ticker file, grouped by the forms they
  filed in EDGAR's form index from 2025 Q3 to 2026 Q3.
- **Strata:**
  - 20-F filers on Nasdaq or NYSE (8) and on OTC only (2);
  - 40-F filers (6);
  - recent IPOs with no filing before 2025 (3 operating companies and 3
    SPACs);
  - 10-K filers split by filer status: accelerated (10) and smaller (10);
  - six named hard cases, which are not part of the draw: ASML, ING, Shell,
    Toyota, Berkshire Hathaway and Apple.

  ADRs: Cadeler and Turbo Energy in the draw, and ASML, ING, Shell and
  Toyota among the named cases.
- **Labelled against primary sources:**
  - each filing's EDGAR submission header, for form, filing date, period and
    acceptance time;
  - the filing's own XBRL instance, for facts, periods, fiscal focus, CIK,
    cover tickers and exchanges;
  - the current feed, for same-day acceptance times;
  - GLEIF, as the registry for the LEI.
- **Labelled on:** 2026-09-28, by `sec_audit.py` over cached data. `draw` reproduces the
  committed sample from the cache, and `label` prints the table below; the CIK to LEI rows
  take `--reference <snapshot>` and GLEIF. Responses stay under `.local/`.

| Field | Precision (Wilson 95%) | n |
| --- | --- | --- |
| Ticker file `ticker` names a current line of the CIK (against the filing cover; SEC spelling allowed) | 100% (93.9–100%) | 59 exchange lines |
| Ticker file `exchange` gives the right operating MIC (against the cover's exchange) | 100% (93.8–100%) | 58 lines; 2 are NYSE American |
| Ticker file equals `submissions` tickers and exchanges | 100% (92.6–100%) | 48 filers |
| `form`, `filingDate` and `reportDate` against the header | 100% (98.3–100%) each | 217 filings |
| Plugin `accepted_at` against the header | 100% (98.3–100%) | 217 filings |
| Same-day `acceptanceDateTime` is Eastern time labelled `Z` (against the current feed) | 100% (82.4–100%) | 18 filings |
| companyfacts value, dates and unit against the filing instance | 100% (99.99–100%) | 28,410 rows; 51 one-day durations counted apart |
| `fy`/`fp` against the filing's `dei` focus; CIK against `dei` | 100% (95.4–100%) each | 79 filings |
| Plugin `fundamentals` values against the filing instance | 100% (98.8–100%) | 322 values |
| Plugin `freshness` status right (companyfacts holds the latest XBRL report) | 87.5% (75.3–94.1%) before this audit's 6-K change; 48/48 after it is a regression check on the same filers, not an independent measure | 48 filers |
| Builder CIK to LEI link names the registrant's own LEI (against GLEIF) | 90.9% (62.3–98.4%) | 11 links in the sample |
| Builder name-only CIK to LEI links (`name_unique`, now removed) | 85.7% (48.7–97.4%) | 7 links in the XAMS and XETR build |

The builder links 11 of the 48 sample CIKs to a LEI. GLEIF has a LEI with a
matching legal name for 14 of the rest. That is recall, bounded by the
build's scope: US-only companies reach a LEI only through a FIRDS ISIN. The
GLEIF matches are by name, so they bound recall only roughly.

**Invariants:** `invariants.py` holds no SEC-specific invariant. The
fingerprint counts stand in: a ticker on two rows, a CIK under two titles,
unequal columns and an unknown 8-K item are 0 today, and any occurrence
raises an alarm.

### Odd cases

| Case | Count (unit) | Example | Explanation | Handling | Status |
| --- | --- | --- | --- | --- | --- |
| companyfacts lacks foreign issuers' 2026 XBRL reports | 12 reports of 10 sample filers: 4 IFRS 20-Fs filed 2026-04-10 to 06-10, and all 8 interim 6-Ks with XBRL filed in 2026. All 12 such 6-Ks filed from June to December 2025 are present, and so are US GAAP 20-Fs of 2026-04-30 and 07-07 | Toyota's 20-F of 2026-06-10: 2,109 ifrs-full facts in the filing, one `dei` fact in companyfacts. ING's and Shell's H1 2026 6-Ks | Unknown. The research of 2026-09-28 measured 8 of 22 FPIs; a 6-K was not checked then | `freshness` marks the result stale, now including 6-K. It served ING's and Shell's balance sheets at 2025-12-31 as fresh before. The facts are still served, marked. The probe alarms on every change in the stale count, so SEC catching up shows | Accepted limit, owner the SEC plugin: SEC's defect, covered by the stale mark and the probe. Reading the filing's own instance would be a new field use and is not a sign-off condition |
| A 40-F whose XBRL tags only the cover | 1 filer | Centerra Gold: its 40-Fs of 2025 and 2026 are absent, and the 2026 one tags only the cover; companyfacts' newest statements are FY2023 | The statements are HTML exhibits without XBRL | Marked stale, which is true: the facts are two years old. The reason says the filing is the current source, which is imprecise here | Accepted limit; `isXBRLNumeric` would separate it once documented |
| Same-day acceptance time is Eastern labelled `Z` | 18/18 same-day filings | 497K accepted 10:23:45 ET, given as `10:23:45Z` | SEC rewrites the day's values to UTC overnight | `accepted_utc` reads by filing day | Handled |
| Filing date after 17:30 ET | 26 of 32 late acceptances kept that day | Legence 10-K accepted 17:34:49, filed the same day | Regulation S-T Rule 13 works on transmission start; Forms 3 to 5 and Schedules 13D/G count until 22:00 | `filed_at` is SEC's date. The plugin wording was corrected | Handled |
| One-day duration given as an instant | 51 of 28,461 rows (79 filings) | IceCure `ProceedsFromIssuanceOfCommonStock` on 2025-08-01 | companyfacts drops `start` when it equals `end` | Periods come from dates. Balance-sheet metrics are true instants | Accepted limit |
| `fy`/`fp` label the filing | 62% of full-year rows | Helios' year ending 2026-01-03 is `fy` 2026 | Documented as the filing's focus | Exact dates only; annual means 330–400 days | Handled |
| Restated or recast values; `frame` follows the newest filing | 5,617 of 105,363 annual keys (5.3%) have several values | Owlet FY2025 revenue 105.708m (10-K), then 106.159m (10-Q) | Recasts, restatements and rounding | `fundamentals` serves the newest filed value with its form and accession | Open: a restatement flag in the planned fundamentals provenance record |
| Amendments | 20-F/A 5,052, 10-K/A 2,293 and 10-Q/A 1,550 fact rows; cover-only amendments carry none | Ameriprise's 10-K/A repeats its 10-K values | A full amendment re-files the statements | `freshness` skips amendments; `fundamentals` takes the newest filed | Handled |
| Taxonomy switch | 2 filers | Toyota: US GAAP to 2020-03-31, then IFRS; Athena Gold: 10-K US GAAP, then 20-F IFRS in 2026 | A change of basis | Taxonomies kept apart; the latest period wins | Handled; the basis goes into the planned provenance record |
| `NYSE` covers NYSE American and Arca | 2 of 58 sample lines; 3,302 `NYSE` rows | Titan Mining and Buda Juice (cover: `NYSEAMER`) | SEC names the exchange group | Operating MIC XNYS, with `sec_nyse_may_be_american_or_arca` | Accepted limit: the segment is unknown |
| A placeholder ticker | 1 row | `NONE.`, EBR Systems, no exchange | Unknown | Counted (`malformed_ticker`). No venue, so no listing | Counted |
| Rows without an exchange | 166 rows | Aircastle, SB Energy, SPACs before listing | Unknown | Counted (`exchange_missing`); no listing | Counted |
| Notes, preferreds, ADRs and OTC ordinary shares under one CIK | 1,453 CIKs with several tickers | T-Mobile's notes; ASML and `ASMLF` | SEC lists lines per filer, not per security | OpenFIGI types decide the row class; the receipt rule links an ADR | Handled in the builder |
| Ticker changed after the last filing | 1 of 59 | Grandstand `GRSD`; its 20-F cover says `GAMB` (renamed 2026-06-01) | The file is current; the cover is historical | None needed | Accepted |
| Cover spells class tickers differently | 2 of 59; more in the named cases | `WPAC-UN` against `WPAC U`; `BRK-B` against `BRK.B` | Filer's own spelling on the cover | SEC's spelling kept | Accepted |
| Odd fund symbols | 30 malformed, 1 empty of 28,560 | `elfnx`, `(NWAKX)`, `n/a` | Unknown | Counted; the OpenFIGI `ETP` filter decides | Counted |
| Pre-2004 8-K items read as drift | 41 items on 8-Ks of 1995–2004 | Items `5`, `7`, `12` | Release 33-8400 renumbered them | Now accepted before 2004-08-23 (`filings.unknown_8k_items`) | Fixed |
| Forms outside the plugin's vocabulary | 103 rows, 42 forms | `10QSB`, `REGDEX`, `40FR12B` | Retired and rare forms | Added to the vocabulary | Fixed |
| CIK joined to another company's LEI through FIRDS field 5 | 14 of 852 identifier links in the build share no name word with the LEI | Legence Corp. under Avio S.p.A.'s LEI; Samsara under TP ICAP (Europe); Rocket Lab under Frankfurter Wertpapierbörse; subsidiaries such as Pulte Mortgage and Sallie Mae Bank; renames such as LabCorp | `isin_exch_us` takes FIRDS field 5, which is the issuer or the venue operator, as the issuer | Flagged `cik_link_suspect`, kept | Open. Named fix: the FIRDS claims switch (an operator's LEI is unknown), GLEIF Level 2, then question Q1 |
| OTC rows under a registrant's CIK that are another company's line | 2 CIKs on the 2026-09-28 build whose OTC evidence named another LEI than their exchange tickers (a third, Critical Metals, is kept asked: see below) | CIBC's `CNDIF` (OpenFIGI: Canadian Copper, whose FIRDS LEI is `529900MWHGZGKPUSQ122`); ArcelorMittal's `ARCXF` (ArcelorMittal South Africa) | The SEC lists OTC lines per filer, and the OTC ticker's share class can be another company's | A CIK's Nasdaq, NYSE and Cboe tickers are its identifier evidence; its OTC rows count only when it has none from an exchange ticker (`link_otc_outranked`), and never against a lapsed exchange LEI. Open: a SEC line joined to a FIRDS security (`registrant_join@1`) still trusts an OTC-only row, the same pattern; none of the 141 joins is wrong on this build | Handled in the builder for links |
| A CIK whose LEIs are one company's and another's by a shared word | 2 CIKs on the 2026-09-28 build that identifiers link to two LEIs, exchange tickers do not settle and the name picks | SoftBank Group (`SoftBank Corp.` is its subsidiary); Ucore Rare Metals (`Purecore Metals`) | A shared name word is no identity | The one LEI whose GLEIF name, typed alternatives included, the SEC title is exactly wins and the other claim is flagged (`cik_lei_claim_rejected`); several LEIs named alike, and a lapsed LEI, stay asked: no tie-break picks a LAPSED LEI. Critical Metals Corp. (Nasdaq names the Ltd, whose registration has lapsed; an OTC row names the PLC) and Vishay Intertechnology and Vishay Precision Group (one lapsed LEI, `5493009O8F3QQJTCQR75`, claimed by both) stay asked. Open: whether the Ltd is the right entity, which offline data cannot show | Handled in the builder |
| A fund trust's CIK | 1 on the 2026-09-28 build | ProShares Trust II: one CIK, a LEI per series (Ultra VIX, Crude Oil) | A trust's CIK covers every series it runs | A CIK whose LEIs each issue only funds links to none and is asked nothing (`fund_trust`) | Handled in the builder |
| A name-only link to another entity | 1 of 7 `name_unique` links in the XAMS and XETR build; the rule made 162 of 4,338 links in the offline default-scope build of 2026-09-28 (FIRDS of 2026-09-26) | Biofrontera Inc. (CIK 1858685, Delaware) linked to Biofrontera AG | A unique normalised name is not identity (the standard's "bad code"; R2: unknown plus a question, never a stored guess) | No name links any more. A CIK no identifier links stays a CIK-only issuer, and a unique name match becomes an open issuer-identity question carrying the LEI as its candidate (`issuer_identity_name_candidate`): 169 questions in that build, the 162 former links and 7 CIKs whose identifier evidence conflicts. The truth set is unchanged apart from two ETFs now keyed by CIK as it expects (Bitcoin Mini Trust, iShares Bitcoin Trust). The questions are flags until the builder's question queue (PR #74) lands | Fixed |

## 4. Judgement cases

| Question type | Why code can't decide it | Question set | Development check | Gold set and threshold, or suggest-only |
| --- | --- | --- | --- | --- |
| Q1 `sec_registrant_lei@1`: is the SEC registrant (CIK, names and former names, incorporation, tickers) the same legal entity as LEI X (legal and other names, jurisdiction, registration)? Options: same entity; its parent; its subsidiary or financing vehicle; its predecessor or successor; unrelated, such as a venue or data vendor; cannot tell. Asked for identifier links with no shared name word (14), CIK-only issuers whose name matches one LEI issuer (166 in the 2026-09-28 default-scope build, each with its candidate) and LEIs several CIKs claim with no title that is exactly their name (none in that build). EDGAR's incorporation code and GLEIF's jurisdiction are features, not a rule | Whether two records name one company needs judgement once identifiers and GLEIF relationships leave a residual | Not written; owner `tooling/reference-builder/judge/` | Not done | Suggest-only; answers go to Repairs |
| Q2 `sec_6k_kind@1`: is this 6-K an interim or annual report, an earnings release, a statutory annual report, other regulatory news, or other? | The native form says nothing, so the filings kinds list every 6-K as `other` today; a 6-K's kind is in its exhibits | Not written; owner: the SEC plugin | Not done | Suggest-only |

Classes assigned to code or to Repairs instead:

- **Code:**
  - acceptance time zones and filing dates;
  - fiscal periods from dates, never `fy`/`fp`;
  - amendments by filing order;
  - restatements, found by comparing values across accessions (planned);
  - the balance identity, as an alarm (planned);
  - freshness;
  - 8-K items by date, and the form vocabulary;
  - an ADR against the ordinary share, from OpenFIGI types;
- **Repairs:**
  - CIKs without a LEI.
- **Accepted limits:**
  - facts marked stale while companyfacts lacks a foreign issuer's report;
  - every 6-K listed as `other`, until Q2 exists.

## Sign-off

Not signed off. `signoff` stays `grandfathered` in the plugin's
`contract.json`. Every SEC field checked against a primary source matched, and
the companyfacts gap for foreign issuers is an accepted limit covered by the
stale alarm. What remains before sign-off:

- [ ] **Typed claims for the CIK to LEI links.** The builder writes a joined
  CIK on a LEI issuer as a rule output (`rule_confirmed`, its rule in
  `source_record`) but emits no typed claim for it.
  Owner: the builder's claims migration.
- [ ] **The judgement questions** of section 4 written, passed through
  `decide()` and checked on a sampled build, suggest-only.
- [ ] **The founder's spot-check** of the sample below, recorded here with its
  date, in the pull request that sets `signed_off`.

The audit is re-runnable: `just reference-sec-audit fetch` fills the cache,
`draw` repeats the sample and `label` recomputes section 3.

**Spot-check sample for the founder.** Drawn with seeds 20260928 (values)
and 20260929 (lines) from the audited rows. Each links to the filing on EDGAR.

| Filer | Concept | Period | Value | Filing |
| --- | --- | --- | --- | --- |
| ASML Holding | us-gaap:Assets | 2025-12-31 | 50,566,600,000 EUR | 20-F [0001628280-26-011378](https://www.sec.gov/Archives/edgar/data/937966/000162828026011378/0001628280-26-011378-index.html) |
| Vail Resorts | us-gaap:Liabilities | 2026-04-30 | 4,769,856,000 USD | 10-Q [0000812011-26-000026](https://www.sec.gov/Archives/edgar/data/812011/000081201126000026/0000812011-26-000026-index.html) |
| Heidmar Maritime | us-gaap:NetIncomeLoss | 2025 | −22,561,132 USD | 20-F [0001193125-26-197112](https://www.sec.gov/Archives/edgar/data/2029471/000119312526197112/0001193125-26-197112-index.html) |
| Central Bancompany | us-gaap:NetIncomeLoss | 2025 | 390,853,000 USD | 10-K [0001628280-26-021067](https://www.sec.gov/Archives/edgar/data/2065601/000162828026021067/0001628280-26-021067-index.html) |
| Turbo Energy (stale) | ifrs-full:Equity | 2025-06-30 | 1,289,901 EUR | 6-K [0001213900-25-106215](https://www.sec.gov/Archives/edgar/data/1963439/000121390025106215/0001213900-25-106215-index.html) |
| Legence | us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax | 2025 | 2,550,491,000 USD | 10-K [0002052568-26-000008](https://www.sec.gov/Archives/edgar/data/2052568/000205256826000008/0002052568-26-000008-index.html) |
| Ameriprise Financial | us-gaap:NetIncomeLoss | 2025 | 3,563,000,000 USD | 10-K/A [0000820027-26-000016](https://www.sec.gov/Archives/edgar/data/820027/000082002726000016/0000820027-26-000016-index.html) |
| Apple | us-gaap:Assets | 2026-06-27 | 383,266,000,000 USD | 10-Q [0000320193-26-000020](https://www.sec.gov/Archives/edgar/data/320193/000032019326000020/0000320193-26-000020-index.html) |
| OR Royalties | ifrs-full:Liabilities | 2025-12-31 | 134,438,000 USD | 40-F [0001062993-26-001696](https://www.sec.gov/Archives/edgar/data/1627272/000106299326001696/0001062993-26-001696-index.html) |
| T-Mobile US | us-gaap:Assets | 2026-06-30 | 213,553,000,000 USD | 10-Q [0001283699-26-000101](https://www.sec.gov/Archives/edgar/data/1283699/000128369926000101/0001283699-26-000101-index.html) |

| Filer | Ticker file line | Latest cover | CIK |
| --- | --- | --- | --- |
| Owlet | `OWLT` NYSE | `OWLT` NYSE | [1816708](https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=1816708) |
| Apple | `AAPL` Nasdaq | `AAPL` NASDAQ | [320193](https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=320193) |
| T-Mobile US | `TMUS` Nasdaq | `TMUS` NASDAQ, and notes | [1283699](https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=1283699) |
| ING Groep | `INGVF` OTC (the ordinary share) | Not on the cover: OTC lines are not registered | [1039765](https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=1039765) |
| Iron Horse Acquisition II | `IRHO` Nasdaq | `IRHO` NASDAQ, with its unit and right | [2051985](https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=2051985) |
