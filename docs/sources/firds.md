# ESMA FIRDS source record

- **Status:** in onboarding, stage 1.
  - The field table below is mostly complete.
  - Stages 2 to 4 and sign-off are open.
  - FIRDS was in use before the
    [onboarding standard](../architecture/source-onboarding.md), so it keeps its
    current role until it signs off.
- **Owner:** `tooling/reference-builder/reference_builder/firds.py`. Its FIRDS
  records are used by `assemble.py`, `rules.py` and `linking.py`.
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
- **Changes to other sources' adapters** (planned):
  - ISO 10383: read the LEI column, for the operator-LEI case;
  - GLEIF: fetch Level 2 relationships, for financing subsidiaries;
  - SEC: an issuer claim joined by ISIN, for another company's LEI.

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
| 8 `IssrReq` | "Whether the issuer … has requested or approved the trading or admission to trading … on a trading venue". Q&A 1687 adds the case where the venue is aware of the issuer's approval | `issuer_requested_admission` | True on 30,353 records. Always true on Euronext Paris and Amsterdam; true on 189 of 23,394 Düsseldorf, 219 of 31,491 Stuttgart and 0 of 10,576 Tradegate records. 17,917 ISINs have no issuer-requested EEA venue | **No** |
| 9 `AdmssnApprvlDtByIssr` | Date the issuer approved admission or trading | `issuer_approval_date` | Set on 26,438 records | No |
| 10 `ReqForAdmssnDt` | Date of the request for admission | `admission_request_date` | Set on 28,525 records | No |
| 11 `FrstTradDt` | Date of admission, or of first trade, quote or order | `first_trade_date` | — | Yes: the listing's `valid_from` |
| 12 `TermntnDt` | "Where available, the date and time when the financial instrument ceases to be traded or to be admitted to trading" | `termination_date` (where available) | Set on 19,493 records. 19,130 of them are `9999` placeholders, mostly Stuttgart. 28 lie in the past | Yes. **A missing date is read as "alive"** |
| 13 `NtnlCcy` | "Currency in which the notional is denominated"; the rest of the definition covers derivatives. RTS 23 has no trading-currency field for equities | `notional_currency` (instrument level) | 0 ISINs carry two values; Apple is USD on all 40 records | Yes, **as the listing currency: wrong meaning** |
| 26 `DerivInstrmAttrbts/UndrlygInstrm/Sngl/ISIN` | "For ADRs, GDRs and similar instruments, the ISIN code of the financial instrument on which those instruments are based" | `underlying_isin` | 3,626 of 3,666 receipt ISINs state one. It is often superseded or outside the build | Yes. The edge is dropped when its target is not in the build |
| `TechAttrbts/RlvntTradgVn` (ESMA technical field) | The most relevant market in terms of liquidity (RTS 22 Art. 16; RTS 1 Art. 4 for shares) | `most_liquid_eu_market` | A foreign share's is a German floor or Tradegate: Linde on XGAT, Accenture on MUNB, Chubb and Berkshire on STUB. It is an issuer-requested venue for 10,893 ISINs; for 362 it is not, although another venue is | Yes, **as the primary venue: wrong meaning** |

Relevant fields not read:

- Field 4, the commodity-derivative indicator: not relevant to equities.
- Fields 8, 9 and 10: parse them in stage 2.
  - Field 8 separates listings the issuer sought from inclusions a venue made
    on its own initiative.
  - It drives primary precedence only after its odd case below is explained.

## 2. Adapter and drift alarms

- [ ] Parse fields 8, 9 and 10.
- [ ] Emit each field under its meaning above. Field 5 is not the issuer,
  field 13 is not the trading currency, and the relevant venue is not the
  primary.
- [ ] Count `9999` termination dates, `NOISIN` underlyings, withdrawn currency
  codes and unknown CFI prefixes.
- [x] Check each file against ESMA's published MD5 (`fetch.py`).
- [ ] Write network-free tests with synthetic records that cite RTS 23, one per
  odd case.

Proposed fingerprint checks. None is implemented yet.

| Check | Baseline, week of 2026-09-26 | Alarm |
| --- | --- | --- |
| ISINs with two `Issr` values | 0 | Any |
| ISINs with two `NtnlCcy` values | 0 | Any |
| `IssrReq` true rate per segment MIC | as in field 8 above | A segment moves by more than 10 points |
| Share of `TermntnDt` that are `9999` | 19,130 of 19,493 | A large shift |
| Records per CFI category and per venue | as measured | Open: a threshold is needed |
| Elements under `RefData` not in the field table | none | Any |
| Week-over-week churn | 63 new and 32 dropped `ES`/`ED` ISINs, 4,670 new (ISIN, venue) pairs, 0 changed issuers (09-19 to 09-26) | Open: a threshold is needed |

## 3. Data audit

- **Random sample:** not drawn yet. The plan is about 600 live securities,
  stratified by kind × venue type (regulated, floor, trading-only) × region,
  labelled against exchange sites, issuer filings and GLEIF.
- **Truth set:** `tooling/reference-builder/truth/` is a regression suite,
  not a quality measure.
- **Invariants:** proposed in the reference-invariants branch (PR #45). The
  ratchet limits there are temporary, pending the fixes named above.

### Odd cases

| Case | Count (unit) | Example | Explanation | Handling | Status |
| --- | --- | --- | --- | --- | --- |
| Venue operator's LEI in field 5 | 838 ISINs; 623 securities (local build) | Vastned Retail Belgium under TP ICAP MTF | Field 5 allows the venue operator's LEI | The issuer is unknown when the LEI is in ISO 10383's LEI column, and a judgement question opens | Open |
| Financing subsidiary in field 5 | 38 securities (local build) | Nestlé Capital Markets on Nestlé shares; Brambles Finance; Orica Finance | Not explained by RTS 23 or the Q&A | A `parent_of` claim from GLEIF Level 2 consolidation; the rest go to a judgement question | Open |
| Another company's LEI in field 5 | Not counted | Lee Enterprises under Berkshire Hathaway's LEI | Unknown | An identifier conflict with the SEC registrant joined by ISIN | Open |
| Notional currency copied to every venue | Every ISIN | Apple USD on Xetra | Field 13 is the notional currency | A `notional_currency` claim; the trading currency comes from a venue-specific source | Fix in review (PR #47) |
| Withdrawn currency codes | 63 `XXX` records (UBS internaliser); 68 `BGN` records after Bulgaria adopted the euro on 2026-01-01; also SKK, NLG, DEM, HRK | — | Stale records | Count and alarm; never coerce | Open |
| Placeholder termination dates | 19,130 records | Mostly Stuttgart | A placeholder for "none" | Parse as no date and count it | Open |
| Delisted securities without a termination date | Only 28 records with a past date | JDE Peet's, Just Eat, VMware, US Steel still active | Field 12 is set only "where available" | Lifecycle from other dated evidence (first-trade dates, admission counts, GLEIF successors) | Open |
| Relevant venue on a German floor for foreign shares | Common | Chubb on STUB | A liquidity measure, not the home market | `most_liquid_eu_market`, never the primary | Open |
| Field 8 true on a whole segment | 55 of 55 records on XGLO, WSE's Global Connect MTF segment (27 US and 12 DE ISINs) | Apple and ASML | Probably a venue reporting convention, not issuer requests. Q&A 1687 does not explain it | Count segments where field 8 is always true, and keep them out of primary precedence | Open |
| Share classes share a sub-fund LEI | 3,542 ETF ISINs in 1,176 sub-funds | VWRL and VWCE | Q&A 1502 | `share_class_of` by the same sub-fund LEI, in code | Open |
| Underlying superseded or outside the build | 116 receipts (local build) whose underlying is in the build but inactive | — | FIRDS keeps the old ISIN | Keep the edge by global identifier and follow `successor_of` | Open |
| `NOISIN` underlying placeholder | 203 records on 40 receipt ISINs: the 40 receipts without an underlying | — | A placeholder | Dropped today; count it | Open |

## 4. Judgement cases

| Question type | Why code can't decide it | Question set | Development check | Gold set and threshold, or suggest-only |
| --- | --- | --- | --- | --- |
| The issuer role of a field 5 LEI (issuer, subsidiary or vehicle, parent, unrelated) when it is a venue operator's or a group entity's | Whether an entity is "the company" needs judgement once GLEIF relationships leave a residual | Not written | Not done | Suggest-only. The existing Jev gold set has no issuer rows |

Classes assigned to code or to Repairs instead:

- **Code:**
  - ISIN successions, from first-trade dates, admission counts and GLEIF
    successors (Jev fails these);
  - fund share classes, from the sub-fund LEI;
  - a receipt's underlying, from field 26 and `successor_of`;
  - the trading currency, from venue-specific evidence.
- **Unknown, with a Repairs question:** the primary venue when no
  issuer-sought listing exists.

## Sign-off

Not started.
