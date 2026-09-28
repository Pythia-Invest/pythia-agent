# Reference snapshot builder

Builds the open reference snapshot: issuers, securities and venue listings with
their identifiers, from public sources only. It runs locally on the user's device;
Pythia publishes no snapshot (ADR 0039).

Python 3.11+ standard library only. The snapshot is one SQLite file.

```sh
just reference-snapshot                      # default scope: every EU/EEA venue in FIRDS + US lines
just reference-snapshot --mics XAMS,XPAR --no-sec
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
| US tickers | `sec.py` | SEC `company_tickers_exchange.json` and the fund file `company_tickers_mf.json` |
| Tickers and FIGIs | `openfigi.py` | OpenFIGI `/v3/mapping` |
| Rules | `rules.py`, `assemble.py`, `linking.py` | see below |
| Claims (shadow mode) | `claims.py`, `drift.py`, `firds_audit.py` | typed FIRDS claims, the FIRDS drift fingerprint and odd cases, and today's decisions against the claims (below) |
| Audit | `truth.py`, `truth_report.py`, `invariants.py` | the truth set and whole-build invariants (below) |
| Snapshot and manifest | `schema.py`, `writer.py`, `manifest.py` | |

`schema.py` is the only module that knows the table layout. The file is core's
reference store (`runtime/managed/core/identity/sql/reference.sql`) with subject
IDs from core's `subject_id()` under its versioned key rule (`subject_key@1`,
recorded in `release`; ADR 0037): a US, Canadian or other CGS-area ISIN is an
assertion, never a key, so those securities are keyed by share-class FIGI and
listings by FIGI. `id_aliases` maps every other key a subject could have had
(ISIN-, FIGI-, LEI- or CIK-based) to its ID; an alias that is itself a subject,
or names two subjects, is dropped and counted. Identifier assertions carry
authority `snapshot`. Venues carry their ISO 10383 market category (`RMKT`,
`MLTF`…), which search uses to prefer a regulated listing over open-market
trading. It also carries core's curated native-coin seed
(`runtime/managed/core/identity/native_coins.json`: chains, provider chain ids
and each provider's coin id for BTC, ETH, SOL and a few other native coins), so
search finds those coins without a provider. Securities carry a notability
`rank` (FITRS turnover order, SEC file order, curated coin order) for search; a
security with both a turnover and a SEC rank keeps the more notable one.
Lines core cannot key are left out and counted in the manifest audit
(`schema`): SEC tickers whose exchange the SEC file leaves empty (no venue) and
OpenFIGI-only home lines (no trading currency). A CGS-area security OpenFIGI
does not know yet (no share-class FIGI) keeps a local, non-portable ID
(`security:provisional:esma_firds:isin:<ISIN>`, lines without FIGI or ticker
`listing:provisional:esma_firds:line:<MIC>.<ISIN>.<currency>`), counted as
`securities_local_id`; the build that finds its FIGI aliases the local ID to it. Rows the writer ignores
(duplicate IDs of collapsed lines, or a constraint violation) are counted per
table under `writer_ignored`.

## Rules applied

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
  are left out unless one is the security's only market. When FIRDS names such
  a venue as the relevant venue of a security with other lines, the primary
  moves to one of those lines: lines in the ISIN's country first, then the
  order of `rules.PRIMARY_FALLBACK` (Xetra, Euronext Paris, Euronext
  Amsterdam, Euronext Milan, Frankfurt, Tradegate), then the earliest
  listing. Regulated markets, growth markets, the German regional exchanges
  and Tradegate all stay.
- **One line per venue operator.** A venue's segments (lit, off-book,
  midpoint, auction, a second retail book) are one listing, as core keys a
  listing by operating MIC and currency: the operator's own MIC wins, then a
  regulated-market segment, then a lit segment.
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
- **Primary venue.** Start from the FIRDS relevant venue. For a non-EEA ISIN
  with a real home-exchange line in OpenFIGI, use the home exchange (Shell and
  Unilever move to XLON). A US ISIN's primary is its first US exchange line
  from the SEC: OpenFIGI shows US lines on every US exchange, so it cannot name
  the home one. A non-US security with a SEC exchange line and no line in its
  ISIN's country (Linde, Accenture, Medtronic: Irish holding companies of US
  businesses) takes that US line too (`us_exchange_no_home_line`), unless its
  primary is an EEA regulated-market admission: Stellantis and Ferrari stay on
  Euronext Milan. Move a German floor exchange (Frankfurt, Stuttgart, Munich,
  Düsseldorf, Hamburg, Hanover, Berlin) to Xetra when a live Xetra line exists
  (`german_floor_to_xetra`), except that a regional regulated-market admission
  moves only to a regulated Xetra line. Known debatable results in the XAMS build: DSM-Firmenich moves to
  XSWX; Coca-Cola Europacific Partners and Accsys Technologies (AIM plus
  Euronext Amsterdam) move to XLON. OpenFIGI does not tell AIM from the LSE
  main market, so the rule cannot separate these cases without turnover
  evidence from both venues.
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
- **CIK to LEI.** Link by identifier agreement first: a FIRDS US ISIN mapped to
  the SEC ticker, a shared share-class FIGI, or GLEIF's SEC EDGAR registration.
  Fall back to a unique normalised name match on both sides. Conflicts become
  flags, never merges. When several CIKs link one LEI by identifier, one whose SEC
  title matches the LEI's names wins, then CIK order (FIRDS gives Lee
  Enterprises' ISIN Berkshire Hathaway's LEI); when none matches, none links
  (`lei_contested_unnamed`: FIRDS puts venue and data-vendor LEIs such as TP
  ICAP's or Bloomberg's on US ISINs). Generic words (GROUP, HOLDINGS, BANK…)
  do not count as a match. Two cases are flagged for review
  and left as built:
  an identifier link whose SEC title shares no name word with any GLEIF name of
  the LEI (`cik_link_suspect`: a rename, or a wrong LEI in FIRDS such as Lee
  Enterprises under Berkshire Hathaway's), and a CIK-only issuer named like a
  LEI issuer (`issuer_split_lei_cik`: probably one company split in two).
- **Receipts.** Every `depositary_receipt_of` names a security of the build. A
  FIRDS receipt's stated underlying ISIN is kept when a security of the build
  carries it; FIRDS often names a superseded ISIN or one outside the scope, so
  such an edge is dropped and counted (`firds_underlying_outside_build`). SEC
  ADRs and New York registry shares name no underlying (neither does
  OpenFIGI), so rule `receipt_issuer_share@1` links a receipt to its issuer's
  one active ordinary share with an active ticker line (a share search cannot
  show folds nothing in), preferring the FIRDS share when the issuer also has
  a SEC-only line (counted). An issuer with a preferred share or several
  candidate shares gets no edge (`receipt_without_underlying`). No source
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

## Claims and the FIRDS adapter

Sources are being moved onto typed claims one at a time; FIRDS is the first.
`firds.claims()` turns every FIRDS field the builder reads into a claim
`(subject_key, field, value, source, source_field, meaning, as_of, record_digest)`
in the one meaning RTS 23 gives it (`claims.MEANINGS`, `firds.FIELDS`). The
adapter picks no winner and reads no other source; a missing element or a
placeholder is no claim. Instrument attributes are keyed `isin:<ISIN>`,
admission attributes `isin:<ISIN>@<segment MIC>`. A claims file refuses a
meaning outside the vocabulary and a source field read with two meanings.

This is shadow mode: the snapshot is built exactly as before. The build also
writes `claims-<date>.sqlite3` beside the snapshot with four tables:

- `claims`;
- `fingerprints`: what FIRDS delivered (below);
- `reports`: the odd-case counts and the comparison summary, also in the
  manifest under `firds`;
- `diff`: one row per security or line where today's decision rests on, or is
  contradicted by, a FIRDS claim. Each row names what a claims-based build
  would write: `decided` (FIRDS names the value), `unknown` plus the question
  that stays open, `conflict`, `co_primary`, or `outside_firds` (FIRDS says
  nothing; another source must decide). Where evidence does not decide, the
  answer is unknown plus a question, never a guess stored as fact. Answers a
  judge gives to those questions are suggestions until each question type is
  calibrated on a gold set.

`just reference-audit` prints the FIRDS section: drift alarms against the
previous claims file, the odd cases with examples, field 8 per segment, and the
comparison by field (issuer, primary, currency, receipt underlying).

### FIRDS field semantics

The [FIRDS source record](../../docs/sources/firds.md) lists every field the
adapter reads: its official definition with citations, its claim meaning, its
measured behaviour and its odd cases with their counters.

### Drift fingerprint

`drift.py` records, per build, what a source delivered: every element path and
how many records carry it, the values of categorical fields (for FIRDS: CFI
category, segment MIC, notional currency, field 8, and field 8 per segment),
and named counts (placeholders, malformed identifiers, withdrawn currencies,
identifiers with two values of a single-valued field). The build
compares it with the previous claims file's and reports, with examples:

- a new or missing element, and a presence rate that moved by 5 points or more;
- a new categorical value, a value with 100 or more records that disappeared,
  and a value with 1,000 or more records whose count moved by more than half;
- a total record count that moved by more than 20%;
- a named count that became non-zero, or moved by more than half.

These are alarms to review and never block. A `break` is a change the adapter
cannot absorb: no records, or a field it reads that the source stopped sending.
A break stops the build before the snapshot is written (`--no-gates` writes it
anyway) and fails `just reference-audit`.

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
also list build counts to review from the manifest's audit: primaries set by
`us_exchange_no_home_line`, live securities written without a primary listing,
`issuer_split_lei_cik` and `cik_link_suspect` flags, and every `skipped_*`
count (identifiers or relations the schema rejected). The baseline is taken on a
default-scope build (every EEA venue and US lines); an XAMS-only build reports
checks it cannot pass without other venues as regressions. `--write-baseline`
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
week (a few rows where the count did not move; 460 rows on 74,796 German-venue
currency lines), stored as a share of the count so it shrinks with every lowered
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

## Configuration

| Setting | Purpose |
| --- | --- |
| `sec_identity` in `${XDG_CONFIG_HOME:-~/.config}/pythia/settings.json` | The SEC plugin's configured contact, required for the SEC download: SEC fair-access rules require a name and email in the User-Agent. It is sent only to SEC and never written to the outputs. |
| `--sec-file` | Use an already downloaded `company_tickers_exchange.json` instead. |
| `OPENFIGI_API_KEY` | OpenFIGI key. Otherwise `openfigi_api_key` from `${XDG_CONFIG_HOME:-~/.config}/pythia/secrets.json`. Get one: it is free. A keyed first build takes about 40 minutes (about 230k mapping jobs); keyless rate limits (10 jobs per 2.5 s) stretch that to about 16 hours. Answers are cached, so later builds only send new jobs. The key is sent only in the OpenFIGI request header. |

## Outputs

`.local/reference-builder/out/` (git-ignored, override with `--out`) receives
`reference-<YYYYMMDD>.sqlite3`, `claims-<YYYYMMDD>.sqlite3` (typed claims and
the FIRDS reports, above) and `manifest.json` (source URLs, retrieval times and
versions, row counts, audit counts, canary results, the FIRDS report and SHA-256
checksums).
`.local/reference-builder/downloads/` (override with `--cache`) caches source
files and API answers: OpenFIGI answers (in `openfigi-answers.sqlite3`) for 30
days, GLEIF records and the SEC and MIC files for one day. `--sec-file` builds
offline without the SEC fund file, and so without US fund ETFs.

## Rights

The snapshot's `release.sources` entry records each source's URL, version, retrieval
time and licence label. Only MIC codes that listings reference are included,
never the full ISO list. The snapshot stays on the device that built it;
redistributing OpenFIGI tickers and names, and ISIN-to-FIGI pairs, is
unconfirmed.
