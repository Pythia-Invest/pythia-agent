# ESMA FIRDS source record

- **Status:** issuer and the primary of shares decided by FIRDS claims
  (field 8) signed off (PR #74, below); receipt underlying and ETF primaries
  stay in onboarding. FIRDS feeds
  the reference builder and has no plugin `contract.json`, so the #62 gate
  records nothing in code for it: this record is its sign-off.
  - Stage 1: the field table below is complete for the fields the builder
    reads.
  - Stage 2: the adapter emits typed claims, counts unexpected input and
    fingerprints every build. The build decides FIRDS securities' issuer,
    primary and receipt underlying from the claims, and asks where they do
    not decide.
  - Stage 3: a stratified random sample of 100 rows is labelled against
    primary sources (below and [the sample](firds-signoff-sample.md)).
  - Stage 4: the questions ship in the package, and core queues one in
    Repairs only when its instrument is opened, watched or used by the agent
    (ADR 0037, amendment "questions on touch").
  - FIRDS was in use before the
    [onboarding standard](../architecture/source-onboarding.md), so it keeps its
    current role until it signs off.
- **Owner:** `tooling/reference-builder/reference_builder/firds.py`: the parse,
  the adapter (`claims()`, `FIELDS`) and the fingerprint (`observe()`,
  `measure()`). The meanings are core's `SourceMeaning` vocabulary.
  `claims.py` holds the claim shape and the per-build record,
  `source_drift.py` the fingerprint comparison, and `firds_audit.py` the
  odd-case counts. `assemble.issuer_lei` and `reconcile.py` decide from the
  claims; `linking.link_receipts` applies field 26.
- **Scope:**
  - the weekly `FULINS_E` and `FULINS_C` full files and the optional `DLTINS`
    daily deltas;
  - CFI categories `ES` (shares), `ED` (depositary receipts) and `CE` (ETFs),
    with `EP` (preference shares) planned;
  - every EU and EEA venue.

  FITRS transparency data comes from the same module, but it is a separate
  source and needs its own record.
- **Measured on:** the FULINS files published for the week of 2026-09-26, with
  the 2026-09-19 files for comparison. That is 322,590 `ES`, `ED`, `CE` and `EP`
  records covering 29,172 ISINs. Counts marked "local build" come from an
  offline build of 2026-09-28, which also joined OpenFIGI, GLEIF and SEC data.
  Counts marked "audit" come from `just reference-audit` on that build: the
  builder's scope, `ES`, `ED` and `CE`, is 321,306 records and 29,002 ISINs.
- **Changes to other sources' adapters:**
  - ISO 10383: `mic.py` reads the LEI column, for the operator-LEI case and a
    venue's operating entity.
  - GLEIF: an operator LEI names the issuer only when GLEIF registers the
    entity in the ISIN's country.
  - Planned: GLEIF Level 2 relationships, for financing subsidiaries.
  - Planned: an SEC issuer claim joined by ISIN, for another company's LEI.

Citations:

- [Delegated Regulation (EU) 2017/585](https://eur-lex.europa.eu/eli/reg_del/2017/585/oj/eng)
  (RTS 23), Annex Table 3, "RTS 23" below;
- [ESMA Q&A on MiFIR data reporting](https://www.esma.europa.eu/sites/default/files/library/esma70-1861941480-56_qas_mifir_data_reporting.pdf),
  "Q&A" below;
- [RTS 22, Art. 16](https://eur-lex.europa.eu/eli/reg_del/2017/590/oj/eng).

**Upcoming change: the revised RTS 23.** ESMA's final report is
ESMA12-2121844265-384, dated 23 June 2025.

- It renumbers fields.
- It adds field 6b, "Venue of first admission to trading". Only the primary
  venue populates it, so it is future evidence of the primary venue.
- It applies 18 months after publication in the Official Journal. Stage 1
  reopens then.

## 1. Field semantics

"Read today" describes the builder on `identity-backbone` on 2026-09-28.

| Field (RTS 23, XML) | Official definition | Pythia meaning | Measured behaviour | Read today |
| --- | --- | --- | --- | --- |
| 1 `FinInstrmGnlAttrbts/Id` | "Code used to identify the financial instrument" (ISIN) | security ISIN, role `self` | — | Yes |
| 2 `FullNm` | "Full name of the financial instrument" | security name as reported | Abbreviated and upper-case (`GLENCORE PLC DL -,01`) | Yes: a name fallback |
| 3 `ClssfctnTp` | ISO 10962 CFI code | security kind | — | Yes |
| 5 `Issr` | "LEI of issuer or trading venue operator". A UCITS sub-fund's own LEI (Q&A 1502). A depositary receipt's underlying issuer (Q&A 1503). The head office, never a branch (Q&A 1501) | `issuer_or_venue_operator_lei` | One value per ISIN: 0 ISINs have two values in either week, and 0 changed between the weeks. 838 ISINs carry an LEI listed in ISO 10383 as a venue operator's; for 591 of them it is the operator of a venue that reports that ISIN | Yes, **as the issuer: wrong meaning**. The operator's LEI is no issuer claim: see the odd cases |
| 6 `TradgVnRltdAttrbts/Id` | "Segment MIC for the trading venue or systematic internaliser, where available, otherwise operating MIC" | venue segment of the admission | — | Yes |
| 7 `ShrtNm` | FISN under ISO 18774 | share class and form | — | Yes |
| 8 `IssrReq` | "Whether the issuer … has requested or approved the trading or admission to trading … on a trading venue". Q&A 1687 adds the case where the venue is aware of the issuer's approval | `issuer_requested_admission` | True on 30,353 records. Always true on Euronext Paris and Amsterdam; true on 189 of 23,394 Düsseldorf, 219 of 31,491 Stuttgart and 0 of 10,576 Tradegate records. 17,917 ISINs have no issuer-requested EEA venue. 71 segments answer true on every record (audit) | As a claim only (shadow mode) |
| 9 `AdmssnApprvlDtByIssr` | Date the issuer approved admission or trading | `issuer_approval_date` | Set on 26,438 records | As a claim only |
| 10 `ReqForAdmssnDt` | Date of the request for admission | `admission_request_date` | Set on 28,525 records | As a claim only |
| 11 `FrstTradDt` | Date of admission, or of first trade, quote or order | `first_trade_date` | — | Yes: the listing's `valid_from` |
| 12 `TermntnDt` | "Where available, the date and time when the financial instrument ceases to be traded or to be admitted to trading" | `termination_date` (where available) | Set on 19,493 records. 19,130 of them are `9999` placeholders, mostly Stuttgart. 28 lie in the past | Yes. **A missing date is read as "alive"** |
| 13 `NtnlCcy` | "Currency in which the notional is denominated"; the rest of the definition covers derivatives. RTS 23 has no trading-currency field for equities | `notional_currency` (instrument level) | 0 ISINs carry two values; Apple is USD on all 40 records | As the listing's key currency only; never shown or compared as its trading currency |
| 26 `DerivInstrmAttrbts/UndrlygInstrm/Sngl/ISIN` | "For ADRs, GDRs and similar instruments, the ISIN code of the financial instrument on which those instruments are based" | `underlying_isin` | 3,626 of 3,666 receipt ISINs state one. It is often superseded or outside the build | Yes. The edge is dropped when its target is not in the build. `NOISINFOUND9` (238 records on 44 ISINs, 40 of them receipts in scope) is ESMA's "no underlying" placeholder, never an ISIN: no claim, counted (`underlying_placeholder`), so the receipt is read as one that states none |
| `TechAttrbts/RlvntTradgVn` (ESMA technical field) | The most relevant market in terms of liquidity (RTS 22 Art. 16; RTS 1 Art. 4 for shares) | `most_liquid_eu_market` | A foreign share's is a German floor or Tradegate: Linde on XGAT, Accenture on MUNB, Chubb and Berkshire on STUB. It is an issuer-requested venue for 10,893 ISINs; for 362 it is not, although another venue is | Yes, **as the primary venue: wrong meaning** |

Every field in the table is also a claim with the meaning in its "Pythia
meaning" column; the admission itself (field 6) is `admitted_to_trading`, the
full name `instrument_full_name`, the FISN `fisn` and the CFI `cfi`.
Instrument claims are keyed `isin:<ISIN>`, admission claims
`isin:<ISIN>@<segment MIC>`. A missing element, a `9999` termination date and a
`NOISIN` underlying are no claim.

Relevant fields not read:

- Field 4, the commodity-derivative indicator: not relevant to equities.
- `TechAttrbts/RlvntCmptntAuthrty` and `TechAttrbts/PblctnPrd`: the reporting
  authority and publication period, which answer no question we ask.
- Field 8 separates listings the issuer sought from inclusions a venue made on
  its own initiative. It is parsed, but drives no decision until its odd case
  below is explained.

## 2. Adapter and drift alarms

- [x] Parse fields 8, 9 and 10.
- [x] Emit each field under its meaning above (`firds.FIELDS`). Field 5 is not
  the issuer, field 13 is not the trading currency, and the relevant venue is
  not the primary. Each field has one meaning from core's vocabulary, and no
  two fields share one (a test holds both).
- [x] Count `9999` termination dates, `NOISIN` underlyings, withdrawn currency
  codes and malformed ISINs and LEIs (core's grammar and check digit). Unknown
  CFI prefixes cannot occur: records are selected by prefix. An unknown field 8
  value shows as a new vocabulary value.
- [x] Check each file against ESMA's published MD5 (`fetch.py`).
- [x] Network-free tests with synthetic records that cite RTS 23
  (`test_claims.py`): each field's claim, the placeholders, the counters, a
  changed input that trips alarms, a rare field that empties, a count that
  disappears, a dropped field that breaks the build, and a build whose
  snapshot is identical with and without the claims.
- [x] The builder decides from the claims: issuer (field 5 with the ISO 10383
  operator check), primary (field 8 for an EEA primary) and receipt underlying
  (field 26).

The fingerprint is written on every build to `firds-<date>.json` beside the
snapshot, and compared with the newest older good build's (`source_drift.py`).
A break stops the build before the snapshot is written; `just reference-audit`
fails on it. A build written anyway with `--no-gates` is recorded as not good,
is no package, and never becomes the baseline. The claims themselves are not
persisted: 1.27 million of them, mostly the snapshot's own admissions again.

| Check | Baseline, week of 2026-09-26 (audit scope) | Alarm |
| --- | --- | --- |
| Elements under `RefData` and the records carrying each | 24 paths | A new path; a path gone (a **break** when the adapter reads it); a presence rate that moved by 5 points or more, or by more than half for a path on 100 or more records |
| Records | 321,306 | A move of more than 20%; none at all is a **break** |
| Records per CFI category, segment MIC, notional currency and field 8 value, and per segment and field 8 value | as measured | A new value; a value with 100 or more records gone; a value with 1,000 or more records whose count moved by more than half |
| ISINs with two `Issr`, `NtnlCcy` or relevant-venue values; receipts with two underlyings | 0 each | Any |
| ISINs without `Issr` | 0 | Any |
| Malformed ISINs, issuer LEIs and underlying ISINs | 0 each | Any |
| `9999` termination dates | 19,103 records | A move of more than half |
| `NOISIN` underlyings | 203 records | A move of more than half |
| Withdrawn notional currencies | 153 records | A move of more than half |
| Any named count | as above | The count disappears |

Against the files of 2026-09-19 the fingerprint raised two alarms, both for one
real change: in the builder's scope (`ES`, `ED`, `CE`), Hanover's `HANB`
segment grew from 1,846 to 8,305 records, all but two answering field 8 false.

## 3. Data audit

- **Random sample:** 100 rows, seed 20260928, from the local build: 70
  decided values (issuer 30 and primary 30, each stratified by the venue type
  of the relevant or primary venue: regulated, MTF, other; receipt underlying
  10) and 30 questions (issuer 8, home market 14 across its three causes,
  receipt 8). Each is labelled against a primary source: the GLEIF record, the
  exchange's page, the issuer's or fund issuer's page, the depositary's
  programme page. [The sample](firds-signoff-sample.md) lists every row with
  its evidence. Results are under sign-off.
- **Truth set:** `tooling/reference-builder/truth/` is a regression suite,
  not a quality measure.
- **Invariants:** `invariants.py` (PR #45). The ratchet limits there are
  temporary, pending the fixes named above.
- **Decisions and questions:** the FIRDS section of `just reference-audit`, from
  `firds-<date>.json` and the manifest. On the local build (live securities):

  | Field | FIRDS decides | Asked instead (question type) |
  | --- | --: | --- |
  | Issuer | 28,087 securities carry field 5's LEI as issuer; 141 more take the SEC registrant joined by ISIN or FIGI (`registrant_join@1`) | 19 `issuer_identity` on securities, all contested: a share its receipts claim for another live issuer, or a receipt of it under the same field 5 (Nestlé and its ADR; REA Group; Barrick). 469 securities whose only claim is an operator's LEI offer nothing to choose and are counted (`issuer_unknown_venue_lei`), not asked |
  | Primary | 10,863 from issuer-requested admissions (field 8) | None since rules version 2: the primary is a choice (ADR 0044, A5), so 10,271 stay unknown and counted: 10,071 with no request and no line outside the EEA, 169 with a request beside a line outside the EEA, 31 with requests at several venues and none the most liquid |
  | Receipt underlying | 2,754 receipts link to the field 26 security of their own issuer, or of an issuer claimed for it while it is asked; 49 more receipts (46 whose field 26 is empty, 3 SEC ADRs) take their issuer's one live share (`receipt_issuer_share@2`); 3 more were vetoed by name and stay asked (`receipt_name_disagrees`: Concord Medical's ADR under China Medical System, Huazhu, a receipt named only "Depositary Receipts") | 839 `receipt_underlying` (42 because field 26 names another issuer's security; 105 with field 26 empty and no share of the issuer in the build to offer), 10 `receipt_conflict` |

  The SEC stage adds 166 name-only issuer questions (#73) and, where a CIK's
  identifier links conflict and no rule decides, `issuer_identity` questions
  (8 before, 3 now: four CIKs are decided by the exchange-ticker and exact-name
  rules, ProShares Trust II is a fund trust, no issuer, and no tie-break picks a
  lapsed LEI, so Critical Metals and Vishay Intertechnology stay asked). All 1,037
  (1,698 before rules version 5) are in the package's `claims` file; core queues one only when its
  instrument is opened, watched or used by the agent. A security
  without a primary the package can write is priced on its line at the most
  liquid EU market (9,770 lines), labelled so and never primary. The
  `share_primary_silent` invariant counts every live share that has neither a
  written primary nor that label: 1,072, of which 1,052 are SEC OTC-only
  shares, which no rule places, and 20 shares whose most liquid venue has no
  line. The OpenFIGI home lines decided before
  (London, SIX, Toronto, ASX, Tokyo and others) are written since they take
  their venue country's currency: 4,946 before.

  **ISIN-country suggestion: removed in rules version 2.** A share's one
  exchange line in its ISIN's country used to be attached to the home-market
  question as a suggested answer. Both went with ADR 0044's A5: the line is an
  inference, not evidence, and core's default listing order already ranks
  home-country lines first. The measurement behind it still describes that
  default: on the build of PR #74 it agreed with 7,684 decided share
  primaries and disagreed with 28 (99.6%), and it fails for Irish and
  Luxembourg funds, whose local line is often a technical listing.

  Securities without a request and with a line outside the EEA keep the SEC
  or OpenFIGI line as before (7,581); those sources are onboarded next.

### Odd cases

| Case | Count (unit) | Example | Explanation | Handling | Status |
| --- | --- | --- | --- | --- | --- |
| Venue operator's LEI in field 5 | 838 ISINs; 610 live securities left without an issuer (2026-09-28 build) | `CH1129677105` Medmix under TP ICAP (Europe): ISO 10383 lists `213800R54EFFINMY1P02` for 13 MICs. 274 are TP ICAP, 118 Bloomberg Trading Facility, 22 Börse Frankfurt. The issuer requested the admission (field 8) on only 12 of the 469 without a candidate | RTS 23 field 5 is "issuer or venue operator": where the issuer did not request the admission, the venue writes its own LEI | The issuer is unknown when the LEI is in ISO 10383's LEI column (and GLEIF does not register it in the ISIN's country). The SEC registrant joined to the security by ISIN or share-class FIGI is then its issuer (`registrant_join@1`, 141 of the 610: Warby Parker; the SEC title equals the FIRDS name for 138, and 3 are renames such as AltC to Oklo). With no registrant and no other claim there is nothing to choose, so the security is counted (`issuer_unknown_venue_lei`, 469) and no question is written | Decided or counted |
| Financing subsidiary or another company in field 5, contradicted by the share's receipts | 12 shares and 3 of their receipts filed under the same field 5 (offline build of 2026-09-29) | Nestlé under Nestlé Capital Markets (its CDRs name Nestlé S.A.); REA Group under News Corp; MonotaRO under W.W. Grainger | Field 5 on a receipt is its underlying's issuer (Q&A 1503), so the two records disagree | Issuer unknown, `issuer_identity` asked with the receipts' LEI and field 5 as candidates (`assemble.contested`); a retired LEI's claim or one from a company with shares of its own does not count. Two of the 12 were right as filed (Welltower, Barrick), so neither LEI is a suggestion | Asked |
| Financing subsidiary in field 5, uncontradicted | 36 issuers named like a financing vehicle (`issuer_financing_vehicle` warning) | Brambles Finance; Orica Finance; JTEKT under Toyota Industries (not a vehicle) | Not explained by RTS 23 or the Q&A | A `parent_of` claim from GLEIF Level 2 consolidation, which the builder does not read yet; the rest go to a judgement question | Open |
| Another company's LEI in field 5 | 14 of 852 CIK to LEI identifier links in the local build of 2026-09-28 (XAMS, XETR and US) share no name word with the LEI; they include venue and data-vendor LEIs, subsidiaries and renames ([SEC record](sec.md)) | Lee Enterprises under Berkshire Hathaway's LEI; Legence Corp. under Avio S.p.A.'s | Unknown | An identifier conflict with the SEC registrant joined by ISIN; the SEC record's question Q1 | Open |
| Notional currency copied to every venue | Every ISIN | Apple USD on Xetra | Field 13 is the notional currency | A `notional_currency` claim, kept as the listing's key currency. The trading currency is a separate field (`listings.trading_currency`), set only where the venue decides it: 75,099 lines on German venues and Vienna show EUR instead of field 13. Other FIRDS lines show no currency (IWDA on Amsterdam) | Fixed for single-currency venues; open elsewhere until a venue-specific source exists |
| Withdrawn currency codes | 153 records (audit): 63 `XXX` (UBS internaliser), 68 `BGN` after Bulgaria adopted the euro on 2026-01-01, 16 NLG, 4 SKK, 1 DEM, 1 HRK | — | Stale records | Counted (`withdrawn_notional_currency`); never coerced | Counted |
| Placeholder termination dates | 19,130 records; 19,103 in the audit scope | Mostly Stuttgart | A placeholder for "none" | No claim, counted (`termination_placeholder`) | Counted |
| Delisted securities without a termination date | Only 28 records with a past date | JDE Peet's, Just Eat, VMware, US Steel still active | Field 12 is set only "where available" | Lifecycle from other dated evidence (first-trade dates, admission counts, GLEIF successors) | Open |
| Relevant venue on a German floor for foreign shares | Common | Chubb on STUB | A liquidity measure, not the home market | `most_liquid_eu_market`, never the primary | Open |
| Field 8 true on a whole segment | 55 of 55 records on XGLO, WSE's Global Connect MTF segment (27 US and 12 DE ISINs), and 53 of 53 on Vorvel (`HMTF`); 71 segments with at least 20 records answer true on every one (audit) | Apple and ASML on XGLO; Telecom Italia on HMTF | A venue reporting habit on XGLO and HMTF, not issuer requests. Q&A 1687 does not explain it. Other always-true segments are plausible (Euronext Amsterdam and Paris, growth markets), and no ISO 10383 attribute or field 9/10 date separates them | `firds.FIELD8_VENUE_HABIT` names XGLO and HMTF: field 8 there decides nothing, and a primary resting only on them is unknown plus a question (30). The always-true list is counted (`issuer_requested_on_every_record`) so a new candidate shows | Accepted open item |
| Field 8 true for US large caps on the Bulgarian exchange | 122 true of 377 `JBUL` records (audit) | Cisco, Costco, UnitedHealth, Morgan Stanley | Unexplained; the segment also answers false, so it is not a whole-segment habit | Where the SEC shows the US line (Cisco on Nasdaq), the primary is asked (`requested_in_eea_listed_outside`). Not added to the venue-habit list without an explanation | Open |
| Several issuer-requested countries | 2,413 ISINs (audit) | Erste Group: Vienna, Bucharest, Prague | Dual listings, and the segment convention above | Co-primary, or a question where only always-true segments add a country | Open |
| The venue's own spelling in field 2 | 19,483 ISINs carry several full names (audit) | SLB: 7 names | Each venue reports its own | Every name is a claim; none is the name | Counted |
| A share that states an underlying | 302 `ESXXXX` ISINs (audit) | Argentine CEDEARs of US shares | Receipts classified as shares | Counted; asked as `receipt_conflict` (10 live). A stated ISIN of the same issuer is not settled by name: Liberty SiriusXM (non-voting) states its voting class, CC Japan Income & Growth (`ESNTFR`) its ordinary share, and only Ascential states a predecessor ISIN | Open |
| A receipt that states itself | 121 receipts (audit) | James Hardie CUFS | Field 26 repeats the receipt's ISIN | No underlying: the issuer's one live share is its underlying (`receipt_issuer_share@2`, 49 of the 121 have one), unless the receipt's name disagrees with its issuer's (Concord Medical under China Medical System: `receipt_name_disagrees`), and two share classes or none leave it asked | Decided or asked |
| Share classes share a sub-fund LEI | 3,542 ETF ISINs in 1,176 sub-funds | VWRL and VWCE | Q&A 1502 | `share_class_of` by the same sub-fund LEI, in code | Open |
| Underlying superseded or outside the build | 116 receipts (local build) whose underlying is in the build but inactive | — | FIRDS keeps the old ISIN | Keep the edge by global identifier and follow `successor_of` | Open |
| `NOISIN` underlying placeholder | 203 records on 40 receipt ISINs in the audit scope (238 on 44 in all): the receipts without an underlying | `US00689A1051` Adimmune GDS states `NOISINFOUND9` | ESMA's placeholder for "no ISIN found" | No claim, counted (`underlying_placeholder`). The receipt is read as stating none: its issuer's one live share would be its underlying, and none of the 40 has one in the build (39 have no share of the issuer, 1 has two classes), so they stay asked | Counted |

## 4. Judgement cases

| Question type | Why code can't decide it | Question set | Development check | Gold set and threshold, or suggest-only |
| --- | --- | --- | --- | --- |
| The issuer role of a field 5 LEI (issuer, subsidiary or vehicle, parent, unrelated) when it is a venue operator's or a group entity's (`issuer_identity`: 22 open) | Whether an entity is "the company" needs judgement once GLEIF relationships leave a residual | Not written | Not done | Suggest-only. The existing Jev gold set has no issuer rows |
| The underlying of a receipt field 26 does not resolve (`receipt_underlying`, `receipt_conflict`: 849 open) | FIRDS names a superseded or unheld ISIN, or none | Not written | Not done | Suggest-only; the issuer's shares are the candidates |

The questions ship in the package's `claims` file. Core queues one when its
instrument becomes relevant; the agent may suggest an answer and the user's
answer is a local override (ADR 0037, amendment "questions on touch").

Classes assigned to code or to a question instead:

- **Code:**
  - ISIN successions, from first-trade dates, admission counts and GLEIF
    successors (Jev fails these);
  - fund share classes, from the sub-fund LEI;
  - a receipt's underlying, from field 26 and `successor_of`;
  - the trading currency, from venue-specific evidence.
- **Unknown, with a question in the package:** a receipt with no usable
  field 26 (`receipt_underlying`).
- **Unknown, without a question:** the trading currency until a venue-specific
  source exists.
- **Unknown and counted, never asked:** the primary venue when no
  issuer-sought listing exists, or when an EEA request conflicts with a
  primary outside the EEA. Which listing a view shows is a preference or a
  documented default (ADR 0044, A5); since rules version 2 the build asks no
  `home_market` question.

## Sign-off

**Signed off in PR #74** for the issuer and for the primary of shares that
FIRDS claims decide (field 8); no rule-made primary is covered. After the
maintainer's review of this record and [the
sample](firds-signoff-sample.md). Measured on the offline build of 2026-09-28
(FIRDS week of 2026-09-26):

| Field | Decided values labelled | Correct | Wilson 95% lower bound | Wrong or unclear |
| --- | --: | --: | --- | --- |
| Issuer (field 5) | 30 | 28 | 78.7% | field 5 names another company: Ubiquiti under Ubiquity Global Services; China Risun under its Hong Kong subsidiary |
| Primary (field 8), shares | 22 | 21 | 78.2% | Orpea's old ISIN, requested only on a Crédit Agricole internaliser |
| Primary (field 8), ETFs | 8 | 5 | – | an HSBC UCITS ETF whose home is London, which FIRDS cannot see; two ETFs whose issuer names no primary listing |
| Receipt underlying (field 26) | 30 (10, then 20 after the issuer-agreement fix) | 30 on the company | 88.6% | on the class: AngloGold's BDR points at its terminated NYSE ADS; Sabesp's CEDEAR at the NYSE ADR, BYMA names the B3 share |

Questions: 25 of 30 were right to ask (83%). Only 9 of the 30 carry the true
answer among their candidates: most answers lie outside the build (TSX
Venture, Cboe NL, Tel Aviv, an LEI GLEIF does not hold). The ISIN-country line
suggests an answer for General Dynamics and PepsiCo (their US line) and
TotalEnergies (Euronext Paris); they stay questions until a curator approves.
BCE and RELX now get their home line as the suggestion (Toronto, London), since
home lines take their venue country's currency. Rules version 2 removed the
suggestion and the home-market question (ADR 0044, A5).

Decisions and limits:

- **Issuer:** signed off. The known error class, field 5 naming another company
  that is no venue operator (Legence under Avio, Ubiquiti), is fixed by the
  SEC registrant's issuer claim. Owner: the SEC onboarding.
- **Primary, shares:** signed off for primaries field 8 decides (21/22 in the
  sample, all field 8 decisions). The ISIN-country line decides nothing and
  is not signed off.
- **Primary, ETFs:** accepted limit until a source that sees non-EEA listings
  (OpenFIGI home rows for ETFs, an exchange list) is onboarded. Owner: the
  OpenFIGI onboarding.
- **Receipt underlying:** proposed for sign-off after the issuer-agreement fix
  and its re-sample (30/30 on the company). The class of a receipt whose
  programme changed is an accepted limit, owned by lifecycle (`successor_of`).
- **Open with an owner:** the `JBUL` field 8 pattern; the Crédit Agricole
  internaliser answering field 8 true; answers outside a question's
  candidates (future work).
- **Judgement:** every question type stays suggest-only until it has a
  question set and gold set; the user's answer on the device is a local
  override (ADR 0037, amendment "questions on touch").
