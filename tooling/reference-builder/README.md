# Reference snapshot builder

Builds the open reference snapshot: issuers, securities and venue listings with
their identifiers, from public sources only. It runs locally on the user's device;
Pythia publishes no snapshot (ADR 0039).

Python 3.11+ standard library only. The snapshot is one SQLite file.

```sh
just reference-snapshot                      # default scope: Euronext Amsterdam + SEC
just reference-snapshot --mics XAMS,XPAR --no-sec
python3 tooling/reference-builder/run.py --help
```

## Sources and stages

| Stage | Module | Source |
| --- | --- | --- |
| Download with cache and checksums | `fetch.py` | every file below; FIRDS files are checked against ESMA's published MD5 |
| Venues | `mic.py` | ISO 10383 MIC CSV |
| Equity admissions | `firds.py` | ESMA FIRDS weekly `FULINS_E` files, optional daily `DLTINS` deltas (`--deltas`) |
| Activity and turnover | `firds.py` | ESMA FITRS `FULECR` equity transparency results |
| Issuers | `gleif.py` | GLEIF `lei-records` API, batched by LEI |
| US tickers | `sec.py` | SEC `company_tickers_exchange.json` |
| Tickers and FIGIs | `openfigi.py` | OpenFIGI `/v3/mapping` |
| Rules | `rules.py`, `assemble.py`, `linking.py` | see below |
| Snapshot and manifest | `schema.py`, `writer.py`, `manifest.py` | |

`schema.py` is the only module that knows the table layout. The file is core's
reference store (`runtime/managed/core/identity/sql/reference.sql`) with subject
IDs from core's `subject_id()`; identifier assertions carry authority
`snapshot`. It also carries core's curated native-coin seed
(`runtime/managed/core/identity/native_coins.json`: chains, provider chain ids
and each provider's coin id for BTC, ETH, SOL and a few other native coins), so
search finds those coins without a provider. Securities carry a notability
`rank` (FITRS turnover order, SEC file order, curated coin order) for search.
Lines core cannot key are left out and counted in the manifest audit
(`schema`): SEC tickers whose exchange the SEC file leaves empty (no venue) and
OpenFIGI-only home lines (no trading currency). Rows the writer ignores
(duplicate IDs of collapsed lines, or a constraint violation) are counted per
table under `writer_ignored`.

## Rules applied

- **Activity.** FIRDS rarely sets termination dates. A line is `inactive` when
  it is terminated, is a corporate-action line without an OpenFIGI line, or its
  issuer's LEI is retired. It is `suspect` (demoted, kept) when it is a traded
  corporate-action line, or has neither an OpenFIGI line nor a FITRS result.
- **Primary venue.** Start from the FIRDS relevant venue. For a non-EEA ISIN
  with a real home-exchange line in OpenFIGI, use the home exchange (Shell and
  Unilever move to XLON). Move Frankfurt floor to Xetra when a live Xetra line
  exists. Known debatable results in the XAMS build: DSM-Firmenich moves to
  XSWX; Coca-Cola Europacific Partners and Accsys Technologies (AIM plus
  Euronext Amsterdam) move to XLON. OpenFIGI does not tell AIM from the LSE
  main market, so the rule cannot separate these cases without turnover
  evidence from both venues.
- **OpenFIGI multi-row answers.** Prefer the venue's main exchange code, reject
  currency-suffixed MTF tickers, then prefer the shortest ticker.
- **Names.** Use the GLEIF legal name when it is Latin script. Otherwise use the
  typed alternative-language name, then the transliterated legal name. Never use
  a previous name. SEC titles drop their state and ADR markers (`/DE/`,
  ` DE`, `/ADR`), and display names re-case all-capitals names (`rules.display_case`): legal forms
  keep their usual spelling (N.V., PLC, AG, Inc), and the issuer's tickers,
  words without a vowel and short uncommon words stay capitals (ASML, KPN,
  ING). Mixed-case names are kept as written.
- **CIK to LEI.** Link by identifier agreement first: a FIRDS US ISIN mapped to
  the SEC ticker, a shared share-class FIGI, or GLEIF's SEC EDGAR registration.
  Fall back to a unique normalised name match on both sides. Conflicts become
  flags, never merges.
- **Receipts.** A FIRDS depositary receipt that names its underlying ISIN is
  `depositary_receipt_of` it. SEC ADRs and New York registry shares name none
  (neither does OpenFIGI), so rule `receipt_issuer_share@1` links a receipt to
  its issuer's one active ordinary share, preferring the FIRDS share when the
  issuer also has a SEC-only line. An issuer with a preferred share or several
  candidate shares gets no edge. No source states share classes, so the builder
  writes no `share_class_of`. Core's search folds a receipt into its share only
  through this relation.
- **Noise.** Auxiliary segments (midpoint, auction) collapse onto the lit
  segment. SEC warrants, units, rights, preferreds and funds are labelled by
  `row_class`, not merged into the share line.
- **Canaries.** ASML on XAMS (ticker, FIGI, LEI, CIK, primary), its Nasdaq line
  under the same issuer, and Apple on Nasdaq must resolve, or no snapshot is
  written (`--no-gates` writes it anyway for inspection).

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
FIGI), `primary`, `relation`, `fold` (core's search directory), `symbols`
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
the scores under `truth_audit` in the manifest; it never blocks a build.

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
| `OPENFIGI_API_KEY` | OpenFIGI key. Otherwise `openfigi_api_key` from `${XDG_CONFIG_HOME:-~/.config}/pythia/secrets.json`. Without a key the build still works under keyless rate limits: about 45 minutes for the SEC tickers instead of about 1 minute. The key is sent only in the OpenFIGI request header. |

## Outputs

`.local/reference-builder/out/` (git-ignored, override with `--out`) receives
`reference-<YYYYMMDD>.sqlite3` and `manifest.json` (source URLs, retrieval
times and versions, row counts, audit counts, canary results and SHA-256
checksums).
`.local/reference-builder/downloads/` (override with `--cache`) caches source
files and API answers: OpenFIGI answers for 30 days, GLEIF records and the SEC
and MIC files for one day.

## Rights

The snapshot's `release.sources` entry records each source's URL, version, retrieval
time and licence label. Only MIC codes that listings reference are included,
never the full ISO list. The snapshot stays on the device that built it;
redistributing OpenFIGI tickers and names, and ISIN-to-FIGI pairs, is
unconfirmed.
