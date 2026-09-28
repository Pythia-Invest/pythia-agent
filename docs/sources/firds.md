# ESMA FIRDS source record

- **Status:** in onboarding, stage 2 in shadow mode.
  - Stage 1: the field table below is complete for the fields the builder
    reads.
  - Stage 2: the adapter emits typed claims, counts unexpected input and
    fingerprints every build. The claims do not feed the snapshot yet: the
    builder's decisions are unchanged, and the audit compares them with the
    claims.
  - Stage 3 (random sample), stage 4 (judgement) and sign-off are open.
  - FIRDS was in use before the
    [onboarding standard](../architecture/source-onboarding.md), so it keeps its
    current role until it signs off.
- **Owner:** `tooling/reference-builder/reference_builder/firds.py`: the parse,
  the adapter (`claims()`, `FIELDS`) and the fingerprint (`observe()`,
  `measure()`). The meanings are core's `SourceMeaning` vocabulary.
  `claims.py` holds the claim shape and the per-build record,
  `source_drift.py` the fingerprint comparison, and `firds_audit.py` the
  odd-case counts and the comparison with today's decisions. FIRDS records are still
  used directly by `assemble.py`, `rules.py` and `linking.py`.
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
  - ISO 10383: `mic.py` reads the LEI column, for the operator-LEI case. Only
    the FIRDS audit uses it; it confirms nothing.
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
| 5 `Issr` | "LEI of issuer or trading venue operator". A UCITS sub-fund's own LEI (Q&A 1502). A depositary receipt's underlying issuer (Q&A 1503). The head office, never a branch (Q&A 1501) | `issuer_or_venue_operator_lei` | One value per ISIN: 0 ISINs have two values in either week, and 0 changed between the weeks. 838 ISINs carry an LEI listed in ISO 10383 as a venue operator's; for 591 of them it is the operator of a venue that reports that ISIN | Yes, **as the issuer: wrong meaning** |
| 6 `TradgVnRltdAttrbts/Id` | "Segment MIC for the trading venue or systematic internaliser, where available, otherwise operating MIC" | venue segment of the admission | — | Yes |
| 7 `ShrtNm` | FISN under ISO 18774 | share class and form | — | Yes |
| 8 `IssrReq` | "Whether the issuer … has requested or approved the trading or admission to trading … on a trading venue". Q&A 1687 adds the case where the venue is aware of the issuer's approval | `issuer_requested_admission` | True on 30,353 records. Always true on Euronext Paris and Amsterdam; true on 189 of 23,394 Düsseldorf, 219 of 31,491 Stuttgart and 0 of 10,576 Tradegate records. 17,917 ISINs have no issuer-requested EEA venue. 71 segments answer true on every record (audit) | As a claim only (shadow mode) |
| 9 `AdmssnApprvlDtByIssr` | Date the issuer approved admission or trading | `issuer_approval_date` | Set on 26,438 records | As a claim only |
| 10 `ReqForAdmssnDt` | Date of the request for admission | `admission_request_date` | Set on 28,525 records | As a claim only |
| 11 `FrstTradDt` | Date of admission, or of first trade, quote or order | `first_trade_date` | — | Yes: the listing's `valid_from` |
| 12 `TermntnDt` | "Where available, the date and time when the financial instrument ceases to be traded or to be admitted to trading" | `termination_date` (where available) | Set on 19,493 records. 19,130 of them are `9999` placeholders, mostly Stuttgart. 28 lie in the past | Yes. **A missing date is read as "alive"** |
| 13 `NtnlCcy` | "Currency in which the notional is denominated"; the rest of the definition covers derivatives. RTS 23 has no trading-currency field for equities | `notional_currency` (instrument level) | 0 ISINs carry two values; Apple is USD on all 40 records | Yes, **as the listing currency: wrong meaning** |
| 26 `DerivInstrmAttrbts/UndrlygInstrm/Sngl/ISIN` | "For ADRs, GDRs and similar instruments, the ISIN code of the financial instrument on which those instruments are based" | `underlying_isin` | 3,626 of 3,666 receipt ISINs state one. It is often superseded or outside the build | Yes. The edge is dropped when its target is not in the build |
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
- [ ] Switch the builder's decisions onto the claims (a later change).

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

- **Random sample:** not drawn yet. The plan is about 600 live securities,
  stratified by kind × venue type (regulated, floor, trading-only) × region,
  labelled against exchange sites, issuer filings and GLEIF.
- **Truth set:** `tooling/reference-builder/truth/` is a regression suite,
  not a quality measure.
- **Invariants:** `invariants.py` (PR #45). The ratchet limits there are
  temporary, pending the fixes named above.
- **Odd-case counts and the comparison with today's decisions:** the FIRDS
  section of `just reference-audit`, from `firds-<date>.json` and the
  manifest. For each field FIRDS speaks to, the outcome follows from the FIRDS
  claims alone: `decided`, `co_primary`, `unknown` plus a question,
  `conflict` plus a question, or `outside_firds` (FIRDS cannot decide it; other
  sources must). Today's value is then compared with it. On the local build
  (live securities or lines, then all):

  | Field | FIRDS outcome / today | Live | All | Example |
  | --- | --- | --: | --: | --- |
  | Issuer | decided / agrees | 27,927 | 28,164 | ASML |
  | Issuer | unknown + issuer question (an operator's LEI) / today holds a guess | 786 | 838 | Vastned under TP ICAP |
  | Primary | outside FIRDS (no EEA request) | 17,620 | 17,866 | Alphabet, Chubb, Bunge, FEMSA |
  | Primary | decided / agrees | 8,389 | 8,432 | ASML on XAMS (XGLO decides nothing) |
  | Primary | co-primary / agrees | 2,389 | 2,389 | UniCredit: Euronext Milan and Frankfurt |
  | Primary | decided / today outside the EEA | 148 | 148 | DSM-Firmenich (XAMS, today SIX); Cisco and Costco (JBUL, today Nasdaq) |
  | Primary | decided / differs | 131 | 131 | Fresenius (XEMA, today Berlin) |
  | Primary | unknown + home-market question / today holds a guess | 30 | 30 | NVIDIA, requested only on XGLO |
  | Primary | co-primary / today outside the EEA, or differs | 6 | 6 | Shell (XAMS and XPRM, today LSE) |
  | Currency | outside FIRDS / today is the notional currency | 119,447 | 120,048 | 39,750 German lines in USD |
  | Receipt | decided / agrees | 2,790 | 2,795 | |
  | Receipt | decided / today has no edge | 490 | 514 | HDFC Bank ADR |
  | Receipt | decided / differs | 196 | 196 | Sany Heavy ADR |
  | Receipt | unknown + receipt question | 161 | 161 | Arm ADR (field 26 states itself) |
  | Receipt | conflict + receipt question (a share stating an underlying) | 10 | 38 | Argentine CEDEARs |

  Open questions FIRDS leaves: issuer 786 live (838 in all), home market 30,
  receipt 171 (199). A `decided / today outside the EEA` row is not yet a
  finding: FIRDS sees only EEA requests, and the SEC, OpenFIGI or an exchange
  list must say whether the issuer sought the non-EEA listing too. Lee
  Enterprises under Berkshire Hathaway's LEI needs the SEC claim.

### Odd cases

| Case | Count (unit) | Example | Explanation | Handling | Status |
| --- | --- | --- | --- | --- | --- |
| Venue operator's LEI in field 5 | 838 ISINs; 623 securities (local build) | Vastned Retail Belgium under TP ICAP MTF | Field 5 allows the venue operator's LEI | The issuer is unknown when the LEI is in ISO 10383's LEI column, and a judgement question opens | Open |
| Financing subsidiary in field 5 | 38 securities (local build) | Nestlé Capital Markets on Nestlé shares; Brambles Finance; Orica Finance | Not explained by RTS 23 or the Q&A | A `parent_of` claim from GLEIF Level 2 consolidation; the rest go to a judgement question | Open |
| Another company's LEI in field 5 | Not counted | Lee Enterprises under Berkshire Hathaway's LEI | Unknown | An identifier conflict with the SEC registrant joined by ISIN | Open |
| Notional currency copied to every venue | Every ISIN | Apple USD on Xetra | Field 13 is the notional currency | A `notional_currency` claim; the trading currency comes from a venue-specific source | Fix in review (PR #47) |
| Withdrawn currency codes | 153 records (audit): 63 `XXX` (UBS internaliser), 68 `BGN` after Bulgaria adopted the euro on 2026-01-01, 16 NLG, 4 SKK, 1 DEM, 1 HRK | — | Stale records | Counted (`withdrawn_notional_currency`); never coerced | Counted |
| Placeholder termination dates | 19,130 records; 19,103 in the audit scope | Mostly Stuttgart | A placeholder for "none" | No claim, counted (`termination_placeholder`) | Counted |
| Delisted securities without a termination date | Only 28 records with a past date | JDE Peet's, Just Eat, VMware, US Steel still active | Field 12 is set only "where available" | Lifecycle from other dated evidence (first-trade dates, admission counts, GLEIF successors) | Open |
| Relevant venue on a German floor for foreign shares | Common | Chubb on STUB | A liquidity measure, not the home market | `most_liquid_eu_market`, never the primary | Open |
| Field 8 true on a whole segment | 55 of 55 records on XGLO, WSE's Global Connect MTF segment (27 US and 12 DE ISINs), and 53 of 53 on Vorvel (`HMTF`); 71 segments with at least 20 records answer true on every one (audit) | Apple and ASML on XGLO; Telecom Italia on HMTF | A venue reporting habit on XGLO and HMTF, not issuer requests. Q&A 1687 does not explain it. Other always-true segments are plausible (Euronext Amsterdam and Paris, growth markets), and no ISO 10383 attribute or field 9/10 date separates them | `firds.FIELD8_VENUE_HABIT` names XGLO and HMTF: field 8 there decides nothing, and a primary resting only on them is unknown plus a question (30). The always-true list is counted (`issuer_requested_on_every_record`) so a new candidate shows | Accepted open item |
| Field 8 true for US large caps on the Bulgarian exchange | 122 true of 377 `JBUL` records (audit) | Cisco, Costco, UnitedHealth, Morgan Stanley | Unexplained; the segment also answers false, so it is not a whole-segment habit | Shows in the comparison as `decided / today outside the EEA` (148 rows in all, these among them). Not added to the venue-habit list without an explanation | Open |
| Several issuer-requested countries | 2,413 ISINs (audit) | Erste Group: Vienna, Bucharest, Prague | Dual listings, and the segment convention above | Co-primary, or a question where only always-true segments add a country | Open |
| The venue's own spelling in field 2 | 19,483 ISINs carry several full names (audit) | SLB: 7 names | Each venue reports its own | Every name is a claim; none is the name | Counted |
| A share that states an underlying | 302 `ESXXXX` ISINs (audit) | Argentine CEDEARs of US shares | Receipts classified as shares | Counted; the comparison lists the 38 in the build | Open |
| A receipt that states itself | 121 receipts (audit) | James Hardie CUFS | Field 26 repeats the receipt's ISIN | No underlying; counted | Counted |
| Share classes share a sub-fund LEI | 3,542 ETF ISINs in 1,176 sub-funds | VWRL and VWCE | Q&A 1502 | `share_class_of` by the same sub-fund LEI, in code | Open |
| Underlying superseded or outside the build | 116 receipts (local build) whose underlying is in the build but inactive | — | FIRDS keeps the old ISIN | Keep the edge by global identifier and follow `successor_of` | Open |
| `NOISIN` underlying placeholder | 203 records on 40 receipt ISINs: the 40 receipts without an underlying | — | A placeholder | No claim, counted (`underlying_placeholder`) | Counted |

## 4. Judgement cases

| Question type | Why code can't decide it | Question set | Development check | Gold set and threshold, or suggest-only |
| --- | --- | --- | --- | --- |
| The issuer role of a field 5 LEI (issuer, subsidiary or vehicle, parent, unrelated) when it is a venue operator's or a group entity's (`issuer_identity` in the comparison: 838 securities) | Whether an entity is "the company" needs judgement once GLEIF relationships leave a residual | Not written | Not done | Suggest-only. The existing Jev gold set has no issuer rows |

Classes assigned to code or to Repairs instead:

- **Code:**
  - ISIN successions, from first-trade dates, admission counts and GLEIF
    successors (Jev fails these);
  - fund share classes, from the sub-fund LEI;
  - a receipt's underlying, from field 26 and `successor_of`;
  - the trading currency, from venue-specific evidence.
- **Unknown, with a Repairs question:** the primary venue when no
  issuer-sought listing exists, or when an EEA request conflicts with a
  primary outside the EEA (`home_market`); the trading currency until a
  venue-specific source exists (`trading_currency`); a receipt with no usable
  field 26 (`receipt_underlying`).

## Sign-off

Not started.
