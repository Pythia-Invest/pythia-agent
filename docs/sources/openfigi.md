# OpenFIGI source record

- **Status:** not started. OpenFIGI was in use before the
  [onboarding standard](../architecture/source-onboarding.md), so the
  `pythia-openfigi` plugin keeps its current role (`grandfathered`,
  [ADR 0042](../decisions/0042-source-onboarding-standard.md)) until its turn.
  This record holds what the plugin reads today and the evidence behind its
  exchange-code vocabulary. The stages below are open.
- **Owner:** the `pythia-openfigi` plugin, `runtime/managed/plugins/openfigi/`
  (`mapping.py` parses answers and writes claims; `vocabulary.json` says what
  every exchange code is; `contract.json` holds the code-to-MIC table, its
  exchange codes only). The reference builder reads OpenFIGI through its own
  client, `tooling/reference-builder/reference_builder/openfigi.py`, which is
  not covered here.
- **Scope:** `POST https://api.openfigi.com/v3/mapping`:
  - `ID_ISIN` jobs, one per lookup, for core's `resolve` (a claim batch);
  - `ID_ISIN` and venue-qualified `TICKER` jobs for the agent's `mapping`
    (every candidate, nothing decided).

  Not in scope: the search and filter endpoints and any bulk mapping. OpenFIGI
  introduces subjects on demand only
  ([ADR 0044](../decisions/0044-product-direction.md), note "OpenFIGI
  introduces subjects on demand only").
- **Measured on:**
  - two keyless calls on 2026-09-30: Toyota's ISIN `JP3633400001` (143 lines)
    and the documented `exchCode` values (1,106 codes);
  - the local reference build of 2026-09-28 and its cached OpenFIGI answers:
    91,917 listing FIGIs on venue lines keyed from FIRDS and SEC, and 20,751
    unfiltered ISIN answers;
  - the exchange-code research of 2026-09-30: 297 keyless requests (see
    [Exchange codes](#exchange-codes)).

  Raw responses stayed on the device and are not committed.
- **Changes to other sources' adapters:** none.

Citations:

- [OpenFIGI API documentation](https://www.openfigi.com/api/documentation):
  the mapping request and response fields, and the rate limits;
- [OMG FIGI 1.3](https://www.omg.org/spec/FIGI/1.3/PDF): the FIGI, composite
  and share-class levels; Annex D.2 restricts redistributing ISIN-to-FIGI
  mappings, so the contract declares `hostable: false`;
- [OpenFIGI terms of service](https://www.openfigi.com/docs/terms-of-service)
  and [FAQ](https://www.openfigi.com/about/faq): FIGIs are public domain and
  the metadata is under MIT ([ADR 0039](../decisions/0039-local-first-reference-data-and-rights.md)).

## 1. Field semantics

| Field | Official definition | Pythia meaning | Measured behaviour | Read today |
| --- | --- | --- | --- | --- |
| `figi` | The instrument's FIGI at trading-venue level | The line's `figi` (`self`) and its native reference, scope `figi` | On every line | yes |
| `compositeFIGI` | The country-level composite that groups one market's venue lines | The line's `composite_figi` | A composite's own line has `figi` equal to it. Toyota: JP, GR, US, MM and seven EO composites | yes |
| `shareClassFIGI` | The share class, across countries | The line's `share_class_figi` (`self`) | Null on 6 of Toyota's 143 lines; the line then carries none. 4 of 20,751 ISIN answers span two share classes, for example a stapled security that took over a trust's ISIN | yes |
| The job's ISIN | The identifier OpenFIGI maps to each line | The line's `isin` (`self`) at security scope: the mapping is OpenFIGI's own statement, as GLEIF's ISIN filter is GLEIF's, so it is not an echo | Toyota's answer held only ordinary share lines (all `Common Stock`), none of its ADR | yes |
| `exchCode` | Bloomberg exchange code | `provider_venue`; an operating MIC only through `venue_codes`, which holds the order books (below); any other code's `venue_note` says what it is | Codes name order books, second books, trade reports, dark venues, country composites (US, GR, JP) or the OTC composite (EO), whose lines use X-prefixed codes | yes |
| `ticker` | The exchange ticker as Bloomberg writes it | An attribute, never a key or identifier; kept only in core's ticker grammar, since core refuses a batch with a malformed one | MTF lines add a currency (`7203USD`). 9,324 of 1,187,119 cached lines fall outside the grammar, mostly with `/` (`AMD/B`) | yes |
| `name` | Security name | The line's `name` | Upper case | yes |
| `marketSector` | Bloomberg market sector | `asset_class: equity` for `Equity`; nothing otherwise | ETFs and receipts are Equity too | yes |
| `securityType`, `securityType2`, `securityDescription` | Bloomberg security types and description | not read into claims; the agent's `mapping` shows them | | no |

Every line is kept as a claim. A line whose code is a composite (US, GR, JP,
EO and the other country composites) is a line like any other: it carries its
FIGI and its composite FIGI, and no operating MIC. The composite's FIGI also
reaches core as each venue line's composite FIGI. AU is Australia's composite
code, not the ASX: other lines named an AU line as their composite in 1,042
cached answers. The ASX's own line is AT (XASX).

### Exchange codes

`exchCode` is Bloomberg's code for the venue (or composite) a line belongs to.
Pythia keeps a vocabulary of what every code means,
`runtime/managed/plugins/openfigi/vocabulary.json`, and derives from it what the
plugin maps. Dropping data is almost never right, so no line is dropped for its
code. Only a real public order book becomes a line with an operating MIC; every
other line is kept, parked without one, and says why. Visibility filters come
later, downstream.

**Kinds.** Each code has one:

| Kind | What it is | Maps to an operating MIC | Entries |
| --- | --- | --- | --- |
| `exchange` | A public order book: an exchange, a lit MTF book, an ATS, a systematic internaliser such as Lang & Schwarz (LU) | yes, and it is in the contract's `venue_codes` | 110 |
| `second_book` | A second code on an operating MIC that already has a main code (gettex GZ on XMUN, Quotrix QT on XDUS, Japannext's X and U markets JU and JW beside JE) | no: the line is the main code's; `of` names it | 47 |
| `us_unlisted_trading` | A US exchange line (UN, UA, UP, UW, UF and the other US exchanges and ATSs): OpenFIGI gives a US security a line on every US venue it trades on, not only where it lists | no: the listing comes from SEC, and OpenFIGI's US lines join it by FIGI | 22 |
| `trade_report` | APA and off-exchange publication: the X-prefixed codes under the EO composite, E1, EU and XL on XLON, XE, XV, XX, X9, XZ, XO, XT, UV | no | 22 |
| `dark` | A dark or block-crossing venue (B3 BlockMatch, L1 and L3 Liquidnet, PO Posit, MatchNow) | no | 13 |
| `composite` | A country composite (US, GR, JP, AU and others) or the OTC composite EO | no | 23 |
| `unknown` | Seen, but no MIC resolved it, or a descriptive string that is no code | no | 47 |

That is 284 entries for the 285 distinct strings seen: OpenFIGI spells one code
two ways, `TT (Taiwan Stock Exchange)` and `TT (Taipei Stock Exchange)`, and the
plugin reads both as `TT` (XTAI). A code that is in none of these is "not in the
vocabulary".

**What the claim says.** A line on an `exchange` code carries its operating MIC.
Every other line carries `provider_venue` and a `venue_note`, the reason in
words, in the claim as stored (`claims.claim`, `$.attributes.venue_note`), for
example "venue code XV is a trade report (Cboe Europe BOTC), not an order book",
"venue code QT is a second book on XDUS (Boerse Duesseldorf - Quotrix); GD is
the line there", "venue code ER is unknown: no MIC resolved it through OpenFIGI's
micCode filter" or "venue code AB is not in the vocabulary". Core leaves such a
line `unmatched` for want of an operating MIC, so it is parked but understood; the
[identity data queries](../architecture/identity-data.md) answer "why was this
record not placed?" in SQL.

**Method** (measured 2026-09-30, keyless, 297 requests, no 429). OpenFIGI's
`micCode` filter returns only the lines whose MIC is exactly that value, and each
returned line carries its `exchCode`, so a hit pairs a MIC with a code (the API
refuses `micCode` and `exchCode` in one job, so a pair cannot be tested
directly). The runs were:

- the two value lists: 483 `micCode` and 1,106 `exchCode` values;
- Toyota (`JP3633400001`) and Barrick (`CA06849F1080`) against all 483 MICs;
- 166 sweeps over about 45 further ISINs picked from the cached answers to carry
  the still-unknown codes, each against the MICs of the plausible countries;
- a second ISIN for every code confirmed by one ISIN (10 requests), and 19
  reverse jobs (`ID_ISIN` with `exchCode` returned the same FIGI as the
  `micCode` job in 184 of 185 codes; the miss is the `TT` spelling above);
- the cached answers of the 2026-09-28 build (170,985 `micCode` jobs over 55 MICs
  and 1,187,119 lines), which carry most of the European evidence;
- each MIC read against the ISO 10383 list (snapshot of 2026-09-28) for its
  operating MIC and market category.

215 codes resolved to a MIC this way (214 by OpenFIGI, one the `TT` spelling),
23 are composites (a code is a composite when at least 90% of its lines name
themselves as composite and other lines name it), 6 are descriptive strings on
bond lines (`BSE`, `EURONEXT-AMSTER`, `EURONEXT-DUBLIN`, `EUWAX STUTTGART`,
`LUXEMBOURG`, `TRACE`), and 41 stayed unresolved. The 215 became 110 `exchange`,
47 `second_book`, 22 `us_unlisted_trading`, 22 `trade_report` and 13 `dark` entries. The contract held 47
codes before this change; OpenFIGI's own pairing agrees with 46, and they keep
their MIC. The 47th, AU, is a composite and is out; the contract now holds the
110 `exchange` codes. Raw responses stayed on the
device and are not committed.

**Unresolved (41), by lines in the cached answers:** ER (51,317), XW (40,619),
XF (36,410), XU (33,581), XQ (25,996), EP (22,273), EZ (22,239), XY (11,919), JJ
(935), XD (570), XP (222), TF (56), TS (56), B1 (55), XR (10), OU (9), QU (9), UZ
(9), M0 (5), SX (5), PB (4), SR (4), AO (3), GB (3), NS (3), PM (3), QM (2), SC
(2), UK (2), ZH (2), GK (1), KY (1), LC (1), MW (1), NP (1), OM (1), P2 (1), TP
(1), UH (1), UJ (1), XM (1). The micCode filter accepts 483 values and ISO 10383
has MICs outside them (DRSP, TRAX, XJPX, BAPE, ECHO and others, about a dozen of
them APAs), so a code whose MIC is outside that list cannot be resolved here. XW, XF,
XU, XQ, XY, XD and XP behave like trade-report codes (currency-suffixed tickers
under the EO composite, hundreds of thousands of lines); that is an inference,
not OpenFIGI's statement, and their `unknown` note says so. ER, EP and EZ (Toyota
has 5, 3 and 3 lines) have currency-suffixed tickers too but name no composite.
All stay parked until one is confirmed.

**Judgement calls.** The kinds come from the research's evidence (the ISO market
category, the EO composite and currency-suffixed-ticker pattern, and each code's
line counts), plus these choices, which are the founder's rulings where marked:

- *Trade reports.* A code is a `trade_report` when its MIC is an APA in ISO 10383
  (X1, X2, X9, XE, XV, XX, XZ), or its lines sit under the EO composite with
  mostly currency-suffixed tickers on an exchange's MIC (E1, EU, XA, XB, XG, XH,
  XJ, XL, XS), or it is X-prefixed under the EO composite whatever its MIC name
  says (XC, XN, XO, XT). XC (Cboe CXE order books, 30% currency-suffixed
  tickers) and XN (Oslo Boers) are the weakest: their MIC names are order books,
  but their lines are the off-book pattern. UV (FINRA Other OTC) is a trade
  report by ruling. UD (FINRA's Alternative Display Facility, a quote and trade
  report facility) is a judgement: it is not an order book.
- *Dark.* The name says dark, block, non-displayed or cross: B3, HD, L1, L3, PO,
  S1, S2, S4, TK, TO, TR, TV, TW. TO, TR and TV are Cboe Canada's MATCHNow.
- *Main and second books.* Where the contract already held a code for an
  operating MIC it stays the main. Elsewhere the main is the code whose segment
  MIC is the operating MIC, then the one with the most lines, with one choice
  the lines do not settle: BS is B3's main (BN has as many lines).
- *US codes* (manager ruling on the pull request): the US exchange codes are
  not mapped. OpenFIGI gives a line for every US exchange a security trades on
  under unlisted trading privileges, so mapping UN, UA, UP, UF, UW and the rest
  would show a Nasdaq stock as listed on NYSE, Arca and Cboe. US listings come
  from SEC. These 22 codes (OC, OD, UA, UB, UC, UF, UM, UN, UP, UQ, UR, UT, UW,
  UX, VF, VG, VJ, VK, VL, VP, VT, VY) keep their MIC in the vocabulary as kind
  `us_unlisted_trading` and are parked with the note "venue code UN is a US
  exchange line (...) from unlisted trading: the listing comes from SEC". PQ
  (OTC Markets, under the US composite) stays `exchange` and mapped to OTCM, as
  before; UD and UV are trade reports.
- *RFQ venues.* B2, B4, WT and T2 (Bloomberg's and Tradeweb's MTFs, nearly all
  ETPs) are `exchange`: ISO lists them as trading venues, and they are not trade
  reports. They are not lit order books either; a filter can separate them.
- *Order books by ruling.* LU (Lang & Schwarz) and PQ (OTC Link ATS) are
  `exchange`, as the ruling says.

**Toyota.** The 143 lines of `JP3633400001` are 143 claims (before, 11 composite
lines were dropped and 132 claims were made). 18 are `exchange` lines with an
operating MIC: the 11 the contract already mapped (XJPX, XFRA, XDUS, XSTU, XMUN,
XHAM, TGAT, XWBO, XBUL, XLON, OTCM) and 7 more (JE SBIJ, JL XJAX, JN XNGO, JV
ODXE, LU LSSI, MF XMEX, MU BIVA). The other 125 are parked with a reason: 69
trade reports, 26 unknown, 14 dark, 11 composites and 5 second books (GZ, JU, JW,
LA, QT).

## 2. Adapter and drift alarms

- [x] Every field has one parse and one claim meaning, keyed by a global
  identifier (the FIGI).
- [x] The adapter picks no winner and reads no other source.
- [x] An empty answer is recorded as absence: "no match" is `empty`, never
  proof that the instrument does not exist.
- [x] An exchange code the vocabulary lacks is kept, not dropped: the claim says
  "not in the vocabulary".
- [ ] Unexpected input is counted, never coerced. Today a malformed FIGI or
  field type fails the whole answer (`invalid_response`).
- [ ] Fingerprint checks: not defined.
- [x] Network-free tests use synthetic fixtures
  (`runtime/test/python/test_openfigi_connector.py`).

## 3. Data audit

Not started.

## 4. Judgement cases

None: the plugin decides nothing. Core's join decides where a line belongs.

## Sign-off

- [ ] Every stage meets its exit criteria.
- [ ] Every open item is closed, or accepted with a limit and an owner.
- [ ] The reviewer, date and PR are recorded.
