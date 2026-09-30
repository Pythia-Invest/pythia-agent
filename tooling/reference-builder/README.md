# Reference snapshot builder

Builds the open reference snapshot: issuers, securities and venue listings with
their identifiers, from public sources only. It runs locally on the user's device;
Pythia publishes no snapshot (ADR 0039).

Python 3.11+ standard library only. The snapshot is one SQLite file.

```sh
just reference-snapshot                      # default scope: every EU/EEA venue in FIRDS + US lines
just reference-snapshot --mics XAMS,XPAR --no-sec
just reference-snapshot --no-firds           # the US view: SEC and OpenFIGI only
just reference-snapshot --offline --cache <copied downloads>   # from a cache, no network
python3 tooling/reference-builder/run.py --help
```

## Sources and stages

| Stage | Module | Source |
| --- | --- | --- |
| Download with cache and checksums | `fetch.py` | every file below; FIRDS files are checked against ESMA's published MD5 |
| Venues | `mic.py` | ISO 10383 MIC CSV |
| Equity and ETF admissions | `firds.py` | ESMA FIRDS weekly `FULINS_E` (shares `ES`, depositary receipts `ED`) and `FULINS_C` (exchange-traded funds `CE`) files, optional daily `DLTINS` deltas (`--deltas`) |
| Activity and turnover | `firds.py` | ESMA FITRS `FULECR` equity transparency results for shares, depositary receipts and ETFs |
| Issuers | `gleif.py` | GLEIF `lei-records` API, batched by LEI |
| US tickers | `sec.py`, `sec_probe.py` | SEC `company_tickers_exchange.json` and the fund file `company_tickers_mf.json`, fingerprinted per build; `sec_probe.py` fingerprints the plugin's `submissions` and `companyfacts` for a fixed sample |
| Tickers and FIGIs | `openfigi.py` | OpenFIGI `/v3/mapping` |
| Rules | `rules.py`, `assemble.py`, `linking.py`, `link_review.py` | see below |
| Claims and questions | `claims.py`, `reconcile.py`, `source_drift.py`, `firds_audit.py` | typed FIRDS claims, the decisions they make and the questions they leave, the FIRDS drift fingerprint and odd cases (below) |
| Audit | `truth.py`, `truth_report.py`, `invariants.py` | the truth set and whole-build invariants (below) |
| Snapshot, manifest and package | `schema.py`, `writer.py`, `manifest.py`, `package.py` | |

Every source can be left out of a build (ADR 0044, A1) except the ISO 10383
venue codes and core's curated crypto table. `package.json` lists the sources
a build read (`included_sources`), under the names its `sources` entries carry
(`iso10383_mic`, `esma_firds`, `esma_fitrs`, `gleif_lei_records`, `openfigi`,
`sec_company_tickers`, `sec_fund_tickers`, `canonical_assets`), and core's
`reference-status` reports them. A source left out is not asked, so its
silence decides no identity fact: a missing FIGI marks no line suspect, an LEI
GLEIF was not asked about counts neither as retired nor as confirmed, and a
SEC title is never matched against a FIRDS instrument name as if it were the
LEI's. Such a build has fewer subjects, identifiers and links, and more open
questions. Canaries only require what the included sources can supply.

| Flag | What the build loses |
| --- | --- |
| `--no-firds` | EU and EEA lines and every ISIN, and with them FITRS and GLEIF, which are read for FIRDS's ISINs and LEIs: the US view, SEC lines with OpenFIGI's FIGIs under CIK-keyed issuers. A US line or security the full build keys by ISIN has no ID in it, so a device that switches to the US view flags its saved references to them as vanished: 579 lines keyed by a non-CGS ISIN and 839 securities (579 of them by such an ISIN, 260 by `cgs_isin`) on the 2026-09-28 build |
| `--no-fitrs` | the activity check and the turnover rank |
| `--no-gleif` | issuer names, entity status and EDGAR registrations. An issuer carries FIRDS's name; a venue operator's LEI is never confirmed as an issuer; a receipt's claim for its share's issuer is never stale, so the share's issuer is asked; a CIK one of whose shares has such an unknown issuer links to no LEI; and a receipt's stated share stays linked where GLEIF would show its issuer retired (8 receipts on the 2026-09-28 build) |
| `--no-openfigi` | FIGIs, EU tickers, US ETFs and the CIK links that rest on FIGIs. A corporate-action line without a FIGI is suspect, not inactive, so a receipt can keep a superseded share its FIRDS record states (Tenaris' ADR on the 2026-09-28 build) |
| `--no-sec` | US lines |

One documented default does move. Without OpenFIGI or SEC the build sees no
line outside the EEA, so an issuer's EEA admission request decides a primary
listing that the full build leaves unknown (169 securities without OpenFIGI,
116 without SEC, on the 2026-09-28 build). A primary is a choice, not an
identity fact (ADR 0044, A5).

`schema.py` is the only module that knows the table layout. The file is core's
reference store (`runtime/managed/core/identity/sql/reference.sql`) with subject
IDs from core's `subject_id()` under its versioned key rule (`subject_key@2`,
recorded in `release`; ADR 0037): a US, Canadian or other CGS-area ISIN never
keys a portable subject, so those securities are keyed by share-class FIGI and
listings by FIGI. `id_aliases` maps every other key a subject could have had
(ISIN-, FIGI-, LEI- or CIK-based) to its ID; an alias that is itself a subject,
or names two subjects, is dropped and counted. Every assertion and relation
states the kind of evidence it is, never where it came from (ADR 0044, A2;
package format 6): a value read from a source is `source_asserted`, and one a
builder rule derives is `rule_confirmed` with the rule in `source_record`: a
receipt edge of `receipt_issuer_share@2`, and a CIK the build joins to a LEI
issuer (`isin_exch_us`, `share_class_figi`; GLEIF's EDGAR registration states
it, so that one is `source_asserted`). Venues carry their ISO 10383 market category (`RMKT`,
`MLTF`…), which search uses to prefer a regulated listing over open-market
trading (outside the EEA, an exchange ISO leaves unspecified, `NSPD`, counts as
one). It also carries core's curated canonical crypto assets
(`runtime/managed/core/identity/canonical_assets.json`, rule
`canonical_assets@1`: chains, and per asset its canonical deployment and its
same-security deployments), so search finds those assets without a provider
and every install keys them alike. Its rows are Pythia's own list:
`source_asserted` from source `pythia`, the rule in `source_record`. The package
names no provider: each coin plugin's contract declares its own coin ids and
chain ids (`addressing.subjects`, `addressing.chain_codes`), and core aliases a
plugin's provisional coin IDs from there, on reads and when it
re-points saved rows to a new release. `just canonical-assets-drift` checks the
coin ids those contracts declare against CoinGecko and CoinMarketCap; the
evidence per row is in `truth/canonical-assets-audit.md`. Securities carry a notability
`rank` (FITRS turnover order, SEC file order, curated coin order) for search; a
security with both a turnover and a SEC rank keeps the more notable one.
Lines core cannot key are left out and counted in the manifest audit
(`schema`): SEC tickers whose exchange the SEC file leaves empty (no venue). A CGS-area security OpenFIGI
does not know yet (no share-class FIGI) has core's device-local key
(`security:cgs_isin:<ISIN>`, its lines without a FIGI
`listing:cgs_isin:<ISIN>:<MIC>:<currency>`), the same whichever source gives
the ISIN, counted as `securities_local_id`; the build that finds its FIGI
aliases the local ID to it. Rules version 2 wrote those IDs in the FIRDS
namespace (`security:provisional:esma_firds:isin:<ISIN>`,
`listing:provisional:esma_firds:line:<MIC>.<ISIN>.<currency>`); every build
aliases those forms too. A SEC-only security without a
share-class FIGI is keyed by its registrant's CIK and ticker
(`security:provisional:sec:id:<CIK>.<TICKER>`, its line
`listing:provisional:sec:ticker:<MIC>.<CIK>.<TICKER>`), never by the ticker
alone, and no alias maps the older ticker-only form: that alias would carry a
delisted company's reference to the ticker's next owner. Rows the writer ignores
(duplicate IDs of collapsed lines, or a constraint violation) are counted per
table under `writer_ignored`.

## Rules applied

Rules name kinds of evidence, never sources (ADR 0044, A2). Each assembled row
carries the kind it rests on (`model.Evidence`): `admission_register` (FIRDS),
`listing_directory` (OpenFIGI's home-exchange lines), `registrant_filing` (the
SEC ticker and fund files) and, on a receipt edge, `stated_underlying` (FIRDS
field 26). A rule tests that kind; `source` is provenance only, so another
source of the same kind decides alike (`test_decisions.py` renames every
source and gets the same decisions). `check_names.py`, run by `just check`,
fails when a builder module other than the named adapters and audits, or
core's `identity/*.py`, compares a field named source, plugin or provider with
a literal. Core's plugins are all equal: nothing in core ranks one by its name
(ADR 0044, amendment of 2026-09-30). The rules are versioned (below).

- **Activity.** FIRDS rarely sets termination dates. A line is `inactive` when
  it is terminated, is a corporate-action line without an OpenFIGI line, or its
  issuer's LEI is retired. It is `suspect` (demoted, kept) when it is a traded
  corporate-action line, or has neither an OpenFIGI line nor a FITRS result.
- **Scope.** Every venue in FIRDS, which covers the EU and EEA trading venues.
  `--mics` restricts a build to some operating MICs.
- **Venue policy.** `rules.TRADING_ONLY_VENUES` is the one explicit list of
  pan-European venues that trade instruments listed elsewhere (Cboe Europe,
  Aquis, Turquoise, Posit, Blockmatch, Sigma X, OneChronos, TP ICAP, Tradeweb,
  Bloomberg MTF, MarketAxess, systematic internalisers and OTFs). Their lines
  are left out unless one is the security's only market. Regulated markets,
  growth markets, the German regional exchanges and Tradegate all stay.
- **One line per venue operator.** A venue's segments (lit, off-book,
  midpoint, auction, a second retail book) are one listing, as core keys a
  listing by operating MIC and currency: the operator's own MIC wins, then a
  regulated-market segment, then a lit segment.
- **Currency.** A listing carries two. `currency` is the key currency (core
  keys a listing by ISIN, operating MIC and currency): FIRDS field 13, the
  instrument's notional currency, on a FIRDS line (Apple is USD on every
  record). `trading_currency` is the currency the line trades in, set only
  where its venue decides it: a venue that quotes everything in one currency
  (`rules.SINGLE_CURRENCY_VENUES`: the German exchanges, Tradegate and Vienna
  in euros, the US exchanges and OTC Markets in dollars), and an OpenFIGI home
  line, which takes its venue country's (`rules.COUNTRY_CURRENCY`: SIX CHF,
  Tokyo JPY) as both. A home venue that quotes in a minor unit
  (`rules.MINOR_UNIT_VENUES`: London GBX, Johannesburg ZAc, Tel Aviv ILA) keeps
  the country's currency as key and decides no trading currency: the quote
  carries its unit. Elsewhere it is unknown (IWDA on Amsterdam):
  labels, search rows and read checks then claim no currency, and the Desk
  shows the quote's own. On the default-scope build 116,519 of 135,547 venue
  lines have one (1,096 London, Johannesburg and Tel Aviv home lines have none). Bloomberg's slashes leave a home line's ticker (`BP/` is
  `BP`, `RCI/B` is `RCI-B`; Hong Kong codes keep four digits).
- **ETFs.** FIRDS `CE` instruments become `etf` securities. ETCs and ETNs are
  debt instruments in FIRDS and are not covered yet.
- **US ETFs.** The SEC company file leaves most exchange-traded funds out. The
  SEC fund file carries only CIK, series, class and symbol: no fund name and
  no exchange. Its tickers go through OpenFIGI's US line for the name and the
  security type (`ETP` is exchange-traded; mutual-fund classes are not).
  OpenFIGI shows an ETF's lines on every US exchange alike, except that only a
  Nasdaq-listed ETF has a Nasdaq (`UQ`) line, so Nasdaq ETFs are placed on
  XNAS and the others are counted as `unplaced_not_nasdaq` in the audit.
  Placed ETFs are issuer-less `etf` securities (a fund trust's CIK covers every
  series); an ETF that FIRDS also lists joins that security by share-class
  FIGI. SEC company-file lines OpenFIGI types as `ETP` are ETFs too.
- **Issuer (FIRDS securities).** RTS 23 field 5 is the LEI of the issuer *or of
  the trading venue operator*. Its one LEI is the issuer, unless ISO 10383 lists
  it for a venue's operating entity: then it is the issuer only when GLEIF
  registers that entity in the ISIN's country (a bank's or an exchange's own
  share; for a receipt, whose field 5 is the underlying issuer's LEI, the
  underlying's country), and otherwise the issuer is unknown. An unknown issuer
  is decided or asked only where there is something to decide with: when field 5
  is only a venue operator's LEI, the SEC registrant a line joins to the
  security by ISIN or share-class FIGI is its issuer (rule `registrant_join@1`,
  `rule_confirmed`: the operator's LEI says nothing about the issuer, so it
  cannot contradict the registrant; a LEI the registrant's CIK links to later,
  as for any SEC line, is the issuer instead); otherwise it is asked
  (`issuer_identity`) with the lines' issuers and any contested LEIs as
  candidates, and with no candidate nothing is asked: the security is counted
  (`issuer_unknown_venue_lei`, 469 on the 2026-09-28 build) because a question
  that offers nothing to choose cannot be answered. Field 5 on a receipt is its underlying's issuer (ESMA
  Q&A 1503), so a receipt stating a share (field 26) under another LEI that
  issues no share of its own and that GLEIF has not retired contradicts the
  share's field 5: Nestlé S.A.'s
  Toronto CDRs state the share FIRDS files under Nestlé Capital Markets, a
  financing subsidiary. That share's issuer is unknown and asked too, with
  the receipts' LEI and field 5 as candidates (`assemble.contested`), and so
  is a receipt of it filed under the same field 5 (Nestlé's ADR). A
  receipt LEI that issues a share of its own (14 CDRs of other companies
  stating Thermo Fisher) contradicts the receipt's field 26 instead, which is
  the receipt's question; a retired LEI's claim (Merck Sharp & Dohme Corp. on
  Merck & Co.) is stale.
- **Primary venue (FIRDS securities, `reconcile.py`).** Field 8 names the EEA
  admissions the issuer requested; it decides only an EEA primary.
  - A request beside a line outside the EEA from a listing directory or a
    registrant filing (an OpenFIGI home-exchange line, a SEC exchange line)
    leaves the primary unknown (`requested_in_eea_listed_outside`: Ferrari,
    Stellantis, Shell).
  - Among requested admissions, the most liquid EU market (the relevant
    venue) picks the line when it belongs to a requested venue's operating
    entity (ISO 10383 LEI); with one requested venue, that venue. Deutsche
    Börse runs the Frankfurt regulated market on Xetra and the floor, and
    Xetra is its main venue (`reconcile.MAIN_VENUE`), so SAP lists on Xetra.
    Requested venues of several entities with none the most liquid leave it
    unknown.
  - Field 8 on `firds.FIELD8_VENUE_HABIT` segments (Warsaw GlobalConnect,
    Vorvel) decides nothing.
  - Without a request, a line outside the EEA decides as before: a US ISIN's
    first SEC exchange line, another ISIN's OpenFIGI home-exchange line, else
    its SEC line. With none, the relevant venue is only a liquidity measure:
    the primary is unknown (`most_liquid_only`).
  - An unknown primary is a coverage count, never a question: which listing a
    view shows is a preference or a documented default (ADR 0044, A5). The
    build log and the manifest count live securities without a written
    primary (`securities_without_primary`), and so does the `primary_missing`
    invariant. The line in the ISIN's country is an inference, not evidence,
    so it decides nothing and is not suggested either; core's default order
    already puts home-country lines first.
  - A security still without a primary the package can write is priced on
    its line at FIRDS' most liquid EU market, marked `most_liquid` (the Desk labels it "most liquid EU
    line") and never primary; core ranks it after home-country lines.
  - A SEC security's primary is its first US exchange line.
- **OpenFIGI multi-row answers.** Prefer the venue's main exchange code, reject
  currency-suffixed MTF tickers, then prefer the shortest ticker.
- **Share-class tickers.** On Nasdaq Stockholm and Copenhagen a class OpenFIGI
  glues on (`VOLVB`, found through the FISN `…/SH B` or `…/B Aktie`) is written
  as the venue writes it, after a space (`VOLV B`), which core's ticker grammar
  accepts; core turns the space into `-` for provider symbols (`VOLV-B.ST`).
  Helsinki writes classes glued (`KESKOB`) and keeps them so.
- **Names.** Use the GLEIF legal name when it is Latin script. Otherwise use the
  typed alternative-language name, then the transliterated legal name. Never use
  a previous name. SEC titles drop their state and ADR markers (`/DE/`,
  ` DE`, `/ADR`), and display names re-case all-capitals names (`rules.display_case`): legal forms
  keep their usual spelling (N.V., PLC, AG, Inc), and the issuer's tickers,
  words without a vowel and short uncommon words stay capitals (ASML, KPN,
  ING); accented capitals re-case like any other (Nestlé, Møller, Spółka,
  Türkiye).
  Mixed-case names are kept as written.
- **CIK to LEI.** Link only by identifier agreement: a FIRDS US ISIN mapped to
  the SEC ticker, a shared share-class FIGI, or GLEIF's SEC EDGAR registration.
  A name never links: a CIK no identifier links stays a CIK-only issuer. When its
  SEC title normalises to exactly one active LEI issuer's name, that match is an
  open issuer-identity question with the LEI as its candidate
  (`issuer_identity_name_candidate`; the name-only join once linked Biofrontera
  Inc. to Biofrontera AG), carried in the package's questions file. Conflicts
  never merge, and a disagreement no rule decides stays unresolved and asked.
  - **Exchange tickers outrank OTC rows.** A CIK's Nasdaq, NYSE and Cboe
    tickers are its identifier evidence; its OTC rows count only when it has none
    from an exchange ticker, since OTC Markets lists foreign lines and unrelated
    companies' tickers under a registrant's CIK (CIBC's `CNDIF` is Canadian
    Copper's share class). An OTC row that disagreed is counted
    (`link_otc_outranked`).
  - **Lapsed and retired LEIs.** A lapsed LEI (registration not renewed) is
    common (a fifth of them) and still names its entity, so the sole exact name
    may pick it (Vishay Intertechnology's); a retired, merged, annulled or
    inactive one is never picked by a name. The exchange-over-OTC ranking refuses
    a lapsed exchange LEI, the mark of a redomicile: the OTC evidence stays beside
    it and the CIK stays asked (Critical Metals Corp.: Nasdaq names the lapsed
    Ltd, an OTC row the PLC).
  - A CIK that identifiers link to several LEIs links to the one whose GLEIF
    name the SEC title is, exactly (`_named`); the other claims are flagged
    `cik_lei_claim_rejected`. With none, or several, it links to none and is
    asked (`cik_lei_conflict`, an `issuer_identity` question with the LEIs as
    candidates). A CIK whose LEIs each issue only funds is a multi-series fund
    trust (ProShares Trust II: one CIK, a LEI per series) and no issuer of any:
    no link and no question (`fund_trust`).
  - When several CIKs link one LEI by identifier, the one whose SEC title is
    exactly the LEI's name links (FIRDS gives Lee Enterprises' ISIN Berkshire
    Hathaway's LEI); when several are, or the LEI is retired, none links and each CIK is asked with the LEI as candidate;
    when none is, none links (`lei_contested_unnamed`: FIRDS puts venue and
    data-vendor LEIs such as TP ICAP's or Bloomberg's on US ISINs).
  - **Exact name, not a shared word.** The name test is equality of the
    normalised full names (`rules.normalized_name`: legal forms and punctuation
    go, and the SEC's state and ADR markers from the title), against the
    issuer's current GLEIF names, typed alternatives included (SoftBank Group's
    Japanese-registered record names it in Latin script). A shared word matched
    the wrong entity for CANADIAN, ARCELORMITTAL, METALS and VISHAY, so it no
    longer decides anything; it only raises the review flag below. An issuer
    GLEIF did not describe has only a FIRDS instrument name, which names a
    security, not the entity, so it matches no title.
  - **What a name may do.** A name may break a tie only among candidates the
    identifiers already name, and may veto a rule (`receipt_name_disagrees`), but
    never creates a link. Nothing here links on a name; a CIK no identifier links
    stays CIK-only.
  Two cases are flagged for review and left as built: an identifier link whose
  SEC title shares no name word with any GLEIF name of the LEI (`cik_link_suspect`:
  a rename, or a wrong LEI in FIRDS such as Lee Enterprises under Berkshire
  Hathaway's), and a CIK-only issuer named like a LEI issuer
  (`issuer_split_lei_cik`: probably one company split in two).
- **Receipts.** Every `depositary_receipt_of` names a security of the build. A
  FIRDS receipt's stated underlying ISIN (field 26) is kept when an active
  security of the build carries it and that security's issuer is the
  receipt's (field 5 on a receipt is the underlying issuer's LEI, ESMA Q&A
  1503), or both issuers are asked with a shared candidate (Nestlé's ADR and
  CDRs). A stated security of another issuer (14 Canadian receipts stating
  Thermo Fisher) is asked, with it as the first candidate. FIRDS often names a superseded ISIN or one
  outside the scope; then the underlying is unknown and asked
  (`receipt_underlying`, the issuer's shares as candidates). A share whose CFI
  says share while field 26 states an underlying is asked too
  (`receipt_conflict`): a stated ISIN of the same issuer is not settled by
  its name (two share classes share a name), so it is asked too. SEC ADRs, New York registry
  shares outside FIRDS, and FIRDS receipts whose field 26 states none (empty,
  its own ISIN, or the `NOISINFOUND9` placeholder, which is no claim) name no
  underlying (neither does OpenFIGI), so rule
  `receipt_issuer_share@2` links a receipt to its issuer's one ordinary
  share that is not inactive, when that share is active with an active ticker
  line (a share search cannot show folds nothing in). An issuer with a
  preferred share or several such shares, with a ticker line or not, gets no
  edge (`receipt_without_underlying`; a FIRDS receipt with field 26 empty is
  then asked as `receipt_underlying`, with the shares as candidates): a shared
  issuer never picks a share class (ADR 0044, A3), so a FIRDS class A beside a
  SEC-only class B no longer takes the receipt. A FIRDS receipt's field 5 can be
  a venue's guess (no admission its issuer requested), which the SEC registrant
  behind an ADR is not, so a name may veto the rule: when the receipt's own name
  and the names of its share and issuer share no leading word (Concord Medical
  Services' ADR under China Medical System Holdings), nothing is decided, the
  question stays and the receipt is flagged `receipt_name_disagrees` (3 on the
  2026-09-28 build: Concord, Huazhu, now H World, and a receipt named only
  "Depositary Receipts"). The name never links. On that build the rule links 247
  receipts (198 before FIRDS receipts with no stated underlying were
  included); Inficon, Erste Bank Polska and Anadolu Efes, whose issuer has a
  second share without an active line, get none. The edge is `rule_confirmed` and names its
  rule in `source_record`: a display default, never a validated fact (ADR
  0044, A6). No source
  states share classes, so the builder writes no `share_class_of`. Core's
  search folds a receipt into its share only through this relation, and the
  audit lists any second fold target or fold cycle.
- **Noise.** Auxiliary segments (midpoint, auction) collapse onto the lit
  segment. SEC warrants, units, rights, preferreds and funds are labelled by
  `row_class`, not merged into the share line.
- **Canaries.** ASML on XAMS (ticker, FIGI, LEI, CIK, primary), SAP on Xetra,
  LVMH on Euronext Paris and Nokia on Nasdaq Helsinki (ticker, FIGI, LEI,
  primary), ASML's Nasdaq line under the same issuer, Apple on Nasdaq and the
  Direxion Daily TSLA Bull 2X ETF must resolve when the scope covers their
  venue, or no snapshot is written (`--no-gates` writes it anyway for
  inspection).

### Rules versions

`config.BUILDER_VERSION` versions the rules. It is written into every
assertion's `adapter_version`, `package.json` and the release table, and a
rule change bumps it with a line here:

- **5** (2026-09-30, roadmap stage 0): fewer avoidable questions, each rule
  measured on the 2026-09-28 build (1,698 questions before, 1,035 after):
  a security whose only issuer claim is a venue operator's LEI and that has
  nothing to choose between is counted, not asked (`issuer_unknown_venue_lei`,
  469); the SEC registrant joined to such a security is its issuer
  (`registrant_join@1`, 141); a FIRDS receipt with no stated underlying takes
  its issuer's one live share as a SEC ADR does, unless the receipt's name
  disagrees with its issuer's (`receipt_issuer_share@2`, 49 more edges, 3
  vetoed and asked; the rule id moves to `@2` because its evidence basis
  now includes FIRDS field 5 on a receipt); a CIK's exchange tickers outrank its
  OTC rows, the name tie-break between a CIK's several LEIs and between several
  CIKs' one LEI is exact full-name equality instead of a shared word, no
  name picks a retired LEI and the exchange ranking refuses a lapsed one
  (Critical Metals stays asked), and a multi-series fund trust has no CIK-to-LEI link (5 CIKs link a
  LEI, 1 trust skipped).
- **4** (2026-09-30, roadmap stage 0; package format 6): rows state the kind of
  evidence they are, never where they came from: an identifier a source
  states is `source_asserted`, a relation a source states (FIRDS field 26)
  too, and what a builder rule derives is `rule_confirmed` with the rule in
  `source_record`: a `receipt_issuer_share@1` edge, and a CIK joined to a LEI
  issuer (`isin_exch_us`, `share_class_figi`); core's curated crypto rows are
  `source_asserted` from source `pythia` (`canonical_assets@1`). The package
  carries no provider coin ids, chain ids or provisional-coin aliases: each
  coin plugin's contract declares its own.
- **3** (2026-09-30, roadmap stage 0): key rule `subject_key@2`: a CGS-area
  security without a share-class FIGI is keyed `cgs_isin`, not in the FIRDS
  namespace, with aliases from the old IDs; Circle's native USDC on Sui is a
  curated USDC deployment; every source can be omitted, and a source left out
  decides nothing by its silence (no suspect line for a missing FIGI, no stale
  or confirmed LEI without GLEIF); a SEC title never matches a FIRDS
  instrument name as if it were the LEI's.
- **2** (2026-09-29, roadmap stage 0): rules test evidence kinds instead of
  source names; identifier link conflicts become `issuer_identity` questions
  instead of a winner by CIK order; the receipt rule counts every share that
  is not inactive and no longer narrows several to the FIRDS-listed one; the
  primary listing is no longer asked (`home_market` and its `isin_country`
  suggestion are gone); SEC-only subjects are keyed by CIK and ticker.
- **1**: the rules before roadmap stage 0.

## Claims, questions and the FIRDS adapter

`firds.claims()` turns every FIRDS field the builder reads into a `Claim`
`(subject_key, value, source, source_field, meaning, as_of, record_digest, correction)`,
in the one meaning RTS 23 gives it: `firds.FIELDS` maps each field to core's
`SourceMeaning` vocabulary (`runtime/managed/core/identity/vocabulary.py`). The
adapter picks no winner and reads no other source; a missing element or a
placeholder is no claim. Instrument claims are keyed `isin:<ISIN>`, admission
claims `isin:<ISIN>@<segment MIC>`. The build decides FIRDS securities' issuer,
primary and receipt underlying from these claims (rules above).

Where the evidence does not decide, the value stays empty and the build asks a
question, never storing a guess as fact. A primary listing is the exception:
it is a choice, not an identity fact (ADR 0044, A5), so an undecided one is
counted and never asked. `questions-<date>.json` holds them in
core subject IDs (each with its question type, the resolution queue's `kind` and
`reason`, candidates and evidence), and `package.json` names it under `claims`.
A conflict always cites the records it rests on (`record:<digest>`: a FIRDS
record, or for a CIK's conflicting links also GLEIF's), since core's queue
refuses a conflict that cites nothing.
Core installs and verifies the file with the package, and queues a question
in Repairs only when its instrument is opened, watched or used by the agent;
a question without candidates is not queued. The user's answer is a local
override ([ADR 0037](../../docs/decisions/0037-identity-backbone.md), amendment
"questions on touch").
#73's name-only CIK→LEI matches are carried the same way
(`issuer_identity_name_candidate`).

`firds-<date>.json` beside the snapshot, written last, holds the drift
fingerprint (below), the audit report and whether the build was good; the
manifest carries the same report under `firds`. `just reference-audit` prints
the FIRDS section: drift alarms against the previous good build's record, the
odd cases with examples, field 8 per segment, how FIRDS securities got their
primary line, and the open questions.

### Source corrections

When a source is wrong in a way the builder can show, its adapter states a
labelled correction of that source's own value: never another source's, and never
a rule. `source_corrections.json` lists each one by source, record key (for FIRDS,
`isin:<ISIN>`), the source's own field (`Issr`), the `original` the source states, the
`value` to use, and a `reason` of at most 400 characters that says what is wrong and
cites the evidence. The adapter itself reads its source as it is; the build passes
its claims through `claims.corrected` with core's `source_corrections.Table`, which
sets `Claim.correction = (original, reason)` on each corrected claim. That claim's
value is the corrected one, so the build decides from it.
`Claims.corrected` keeps them; the writer puts each into the reference's
`source_corrections` table (`subject_id`, `source`, `field`, `original`, `value`,
`reason`), so the source's original stays readable
([identity data](../../docs/architecture/identity-data.md)). The table is additive:
no format bump, and a package built before it has none.

A correction applies only while the source still states `original`. If the source
fixes its error the raw value passes through and the entry is counted stale; an
entry whose record the build did not read is counted absent. The manifest's
`audit.source_corrections` and the build counts list `applied`, `stale` and
`absent` with the entries to retire under `retire`. Each entry is a maintainer's
to report to the source (the lists of entries and what was reported are in
`docs/sources/<source>.md`); a build without FIRDS reads none.

### FIRDS field semantics

The [FIRDS source record](../../docs/sources/firds.md) lists every field the
adapter reads: its official definition with citations, its claim meaning, its
measured behaviour and its odd cases with their counters.

### Drift fingerprint

`source_drift.py` records, per build, what a source delivered: every element path and
how many records carry it, the values of categorical fields (for FIRDS: CFI
category, segment MIC, notional currency, field 8, and field 8 per segment),
and named counts (placeholders, malformed identifiers, withdrawn currencies,
identifiers with two values of a single-valued field). The build
compares it with the newest older good build's record and reports, with
examples:

- a new or missing element, a presence rate that moved by 5 points or more, and
  for an element on 100 or more records, a presence that moved by more than
  half (a rare field that empties);
- a new categorical value, a value with 100 or more records that disappeared,
  and a value with 1,000 or more records whose count moved by more than half;
- a total record count that moved by more than 20%;
- a named count that became non-zero, moved by more than half, or disappeared.

These are alarms to review and never block. A `break` is a change the adapter
cannot absorb: no records, or a field it reads that the source stopped sending.
A break stops the build before the snapshot is written (`--no-gates` writes it
anyway, without `package.json`, and records the build as not good, so it never
becomes the next baseline) and fails `just reference-audit`.

### SEC fingerprints and the content probe

`sec.observe` fingerprints each SEC ticker file before it is parsed
(`sec_tickers-<date>.json` and `sec_funds-<date>.json` beside the snapshot): the
columns each row carries, the exchange labels, and counts of what the parse would
otherwise absorb (a ticker on two rows, a CIK under two titles, a malformed CIK or
ticker, a row without an exchange). A read column that stops arriving, or a file
that is not the documented `{fields, data}` shape, is a break: the build stops
before the parse, as for FIRDS, and `just reference-audit` fails on it.

The SEC plugin reads `submissions` and `companyfacts` live, so they have no build.
`just reference-sec-probe` reads them for the frozen audit sample
(`samples/sec-2026-09-28.json`, two requests per filer, cached under
`.local/reference-builder/sec-probe/`) and writes `sec_filers`, `sec_filings` and
`sec_facts` records beside the builds: their fields, form groups, the taxonomy and
`fp` vocabularies, and counts such as unknown forms, unknown 8-K items and filers whose
companyfacts lacks their latest report with XBRL (the plugin's own `freshness`
check). Every change in that stale count is an alarm, up or down. `just
reference-sec-audit fetch|draw|label` re-runs the onboarding audit: `fetch` fills
`.local/reference-builder/sec-audit/`, `draw` repeats the frozen sample from it, and
`label` compares each field with its primary source (EDGAR headers, the filings' XBRL
instances, GLEIF for `--reference` links). The [SEC source record](../../docs/sources/sec.md)
has the field meanings, the baselines and the audit.

## Identity truth set and audit

`truth/instruments.json` holds about 270 hard identity cases: ADRs and New York
registry shares, dual and cross listings, share classes, preferreds, ETFs and
fund share classes, redomiciled and re-ISINed companies, renames, mergers,
spin-offs, delisted names, OTC lines, crypto coins and multi-chain tokens. A
bond and an FX pair are kept as `future_kind` entries: they are not scored
until core has those subject kinds (stress test M1). Each entry gives the expected issuer (LEI, CIK), security
(ISIN, share-class FIGI, CAIP-19), listings (ticker at operating MIC, trading
currency, primary), relations, the row it folds into in search, former ISINs
and tickers, and Yahoo, EODHD, CoinMarketCap and CoinGecko symbols. Only public
identifiers; `sources` names what each entry was checked against (FIRDS, GLEIF,
SEC, OpenFIGI, provider symbol conventions) on the version date. US and other
CUSIP-area ISINs are included only where ESMA FIRDS publishes them; otherwise the
entry is located by FIGI.

```sh
just reference-audit                          # newest snapshot in .local/reference-builder/out/
just reference-audit --reference <file> --failures
just reference-audit --write-baseline         # accept the current results as the baseline
```

The audit locates each entry (ISIN, share-class FIGI, CAIP-19, FIGI, then
ticker at MIC) and scores checks by category: `coverage`, `lifecycle` (delisted
names and former ISINs and tickers stay inactive), `issuer`, `security`,
`separate` (two entries never share a security), `listing` (ticker, currency,
FIGI), `primary`, `relation`, `fold` (core's search directory, and for entries
with `search`, the line the row for that query shows: the first of `search.rows`
the build has), `symbols`
(core's page derivation with the installed `contract.json` files) and
`subject_key` (the ID core's current key rule derives from the entry's
identifiers). `subject_key` is reported apart from the headline score: a
difference means the key rule and the build's evidence differ, not a defect, and
the baseline records the key rule it was taken with.
Checks outside the build's scope (its venues, SEC, FIRDS CFI prefixes, crypto
kinds present) are n/a, not failures; an entry with no in-scope line is out of
scope. A check that passed in `truth/baseline.json` and fails now, or a subject
ID that changed without an `id_aliases` row, is a regression and fails the
command. The builder runs the same audit after writing a snapshot and records
the scores under `truth_audit` in the manifest; it never blocks a build. Both
also list build counts to review from the manifest's audit: primaries left unknown
because an EEA request sits beside a line outside the EEA, live securities
written without a primary listing,
`issuer_split_lei_cik` and `cik_link_suspect` flags, and every `skipped_*`
count (identifiers or relations the schema rejected). The baseline is taken on a
default-scope build (every EEA venue and US lines, every source); an XAMS-only
build, or one without a source, reports checks it cannot pass as regressions. `--write-baseline`
lists every truth entry's subject ID that changed since the previous baseline
and writes nothing unless `--accept-id-changes` is given; the accepted changes
are kept in the baseline under `accepted_id_changes`.

The same command then checks 16 whole-build invariants (`invariants.py`): rules
every row must satisfy, so a systematic error shows up as a count rather than as one
truth entry. Twelve are errors: a line on a German exchange or Vienna not in euros,
a withdrawn currency code (BGN since 2026, XXX), a share or receipt in its ISIN
country's currency instead of its venue's (RFQ platforms, internalisers and ETFs,
which list in several currencies, excepted), a ticker whose currency suffix
disagrees with its line, one ticker on one venue naming two securities, a listing
segment where most lines have no ticker, more than one or an inactive primary, an
open-market primary beside a NYSE/Nasdaq line, name casing and encoding, and a
trading venue recorded as issuer. Four are warnings to review: a US share with no US
line (usually delisted), an old ISIN left active beside its successor, a financing
vehicle as issuer, and a Munich primary beside a Xetra line.

An error above its limit fails the command; a warning never does. Limits are the
exact counts on the default-scope build of the FIRDS week of 2026-09-26. Rules with
a pending fix also carry headroom: twice the drift measured against the previous
week (a few rows where the count did not move; 57 rows on 92 tickers whose
currency suffix disagrees with their line's trading currency), stored as a share of the count so it shrinks with every lowered
limit and is 0 once a rule is cleared. Ordinary weekly data passes and a jump fails.
A count below its limit is reported as `under (lower to N)`: a fix lowers the limit
in the same change. Raising a limit needs a stated reason in the pull request. When
a rule fails, the audit lists the rows that are new since the previous build
(`--previous`, by default the next older `reference-*.sqlite3` beside the file). The
builder records the counts under `truth_audit.invariants` in the manifest, even when
the truth-set audit fails, and never blocks on them.

Conventions: US tickers use the SEC's `-` class separator (`BRK-B`); Nordic
tickers keep the exchange's space (`VOLV B`, Yahoo `VOLV-B.ST`); the listing
currency is the venue's trading currency, not FIRDS' notional currency; an
OTC-only receipt has no primary expectation. To add an entry, check it against
the primary sources, add it with its sources, run the audit and update the
baseline in the same change.

Venue and currency evidence from devices: core records the venue and trading
currency a price source states on its own reads (ADR 0037, "Read checks") and,
while those reference fields are not signed off, only labels a difference. To
count agreements and differences per venue against the reference a device used:

```sh
python3 tooling/reference-builder/read_check_audit.py --identity <identity.sqlite3> --reference <reference.sqlite3>
```

It prints counts and reference listing IDs only; keep its output out of commits.

## Configuration

| Setting | Purpose |
| --- | --- |
| `sec_identity` in `${XDG_CONFIG_HOME:-~/.config}/pythia/settings.json` | The SEC plugin's configured contact, required for the SEC download: SEC fair-access rules require a name and email in the User-Agent. It is sent only to SEC and never written to the outputs. |
| `--sec-file` | Use an already downloaded `company_tickers_exchange.json` instead. The rest still downloads, and the SEC fund file is skipped, so there are no US fund ETFs. |
| `--offline` | Build from the download cache (`--cache`) only, whatever the age of its files: no request is sent, the ESMA file index is answered from the cached FIRDS and FITRS files, and OpenFIGI's micCode list from the cached jobs. Anything the build needs that is not cached (a GLEIF record, an OpenFIGI answer, a file) stops the build with its URL, and so does a FIRDS or FITRS file set with a part missing (`1of2` without `2of2`). Needs no SEC contact or OpenFIGI key. |
| `OPENFIGI_API_KEY` | OpenFIGI key. Otherwise `openfigi_api_key` from `${XDG_CONFIG_HOME:-~/.config}/pythia/secrets.json`. Get one: it is free. A keyed first build takes about 40 minutes (about 230k mapping jobs); keyless rate limits (10 jobs per 2.5 s) stretch that to about 16 hours. Answers are cached, so later builds only send new jobs. The key is sent only in the OpenFIGI request header. |

## Outputs

`.local/reference-builder/out/` (git-ignored, override with `--out`) receives
`reference-<YYYYMMDD>.sqlite3`, `firds-<YYYYMMDD>.json` (the FIRDS fingerprint
and report, above), `manifest.json` (source URLs, retrieval times and versions,
row counts, audit counts, canary results, the FIRDS report and SHA-256
checksums) and `package.json` (`package.py`). With `package.json`, the directory
is a [reference package](../../docs/architecture/reference-package.md). Core
reads only a package installed with `just reference-install`; development
startup installs this one automatically. `just reference-install` runs the
stack's copy of core, so after a format change build to this folder and run
`just dev-refresh`: it copies the checkout's core, then installs the build.
`.local/reference-builder/downloads/` (override with `--cache`) caches source
files and API answers: OpenFIGI answers (in `openfigi-answers.sqlite3`) for 30
days, GLEIF records and the SEC and MIC files for one day; `--offline` uses
them whatever their age.

## Rights

The snapshot's `release.sources` entry records each source's URL, version, retrieval
time and licence label. Only MIC codes that listings reference are included,
never the full ISO list. The snapshot stays on the device that built it;
redistributing OpenFIGI tickers and names, and ISIN-to-FIGI pairs, is
unconfirmed.
