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
| US tickers | `sec.py` | SEC `company_tickers_exchange.json` |
| US exchanges and ETFs | `us_listed.py` | Nasdaq Trader symbol directory (`nasdaqlisted.txt`, `otherlisted.txt`) |
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
`rank` (FITRS turnover order, SEC file order, curated coin order) for search; a
security with both a turnover and a SEC rank keeps the more notable one.
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
- **Scope.** Every venue in FIRDS, which covers the EU and EEA trading venues:
  regulated markets, MTFs (growth markets, German open markets, pan-European
  lit, dark and request-for-quote venues), systematic internalisers and OTFs.
  `--mics` restricts a build to some operating MICs.
- **One line per venue operator.** A venue's segments (lit, off-book,
  midpoint, auction, a second retail book) are one listing, as core keys a
  listing by operating MIC and currency: the operator's own MIC wins, then a
  regulated-market segment, then a lit segment.
- **ETFs.** FIRDS `CE` instruments become `etf` securities. ETCs and ETNs are
  debt instruments in FIRDS and are not covered yet.
- **US ETFs.** The SEC company file leaves most exchange-traded funds out, and
  the SEC fund file (`company_tickers_mf.json`) carries only CIK, series, class
  and symbol: no fund name and no exchange. The symbol directory's ETF lines
  that the SEC file lacks become issuer-less `etf` securities (a fund trust's
  CIK covers every series, so it is no issuer) on their listing exchange; an
  ETF that FIRDS also lists joins that security by share-class FIGI. The
  directory also places SEC tickers on their exchange: the SEC's "NYSE" label
  covers NYSE American and NYSE Arca too.
- **Primary venue.** Start from the FIRDS relevant venue. For a non-EEA ISIN
  with a real home-exchange line in OpenFIGI, use the home exchange (Shell and
  Unilever move to XLON). A US ISIN's primary is its first US exchange line
  from the SEC or the symbol directory: OpenFIGI shows US lines on every US
  exchange, so it cannot name the home one. Move Frankfurt floor to Xetra when
  a live Xetra line exists. Known debatable results in the XAMS build: DSM-Firmenich moves to
  XSWX; Coca-Cola Europacific Partners and Accsys Technologies (AIM plus
  Euronext Amsterdam) move to XLON. OpenFIGI does not tell AIM from the LSE
  main market, so the rule cannot separate these cases without turnover
  evidence from both venues.
- **OpenFIGI multi-row answers.** Prefer the venue's main exchange code, reject
  currency-suffixed MTF tickers, then prefer the shortest ticker.
- **Names.** Use the GLEIF legal name when it is Latin script. Otherwise use the
  typed alternative-language name, then the transliterated legal name. Never use
  a previous name.
- **CIK to LEI.** Link by identifier agreement first: a FIRDS US ISIN mapped to
  the SEC ticker, a shared share-class FIGI, or GLEIF's SEC EDGAR registration.
  Fall back to a unique normalised name match on both sides. Conflicts become
  flags, never merges.
- **Noise.** Auxiliary segments (midpoint, auction) collapse onto the lit
  segment. SEC warrants, units, rights, preferreds and funds are labelled by
  `row_class`, not merged into the share line.
- **Canaries.** ASML on XAMS (ticker, FIGI, LEI, CIK, primary), SAP on Xetra,
  LVMH on Euronext Paris and Nokia on Nasdaq Helsinki (ticker, FIGI, LEI,
  primary), ASML's Nasdaq line under the same issuer, Apple on Nasdaq and the
  Direxion Daily TSLA Bull 2X ETF must resolve when the scope covers their
  venue, or no snapshot is written (`--no-gates` writes it anyway for
  inspection).

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
MIC and symbol-directory files for one day.

## Rights

The snapshot's `release.sources` entry records each source's URL, version, retrieval
time and licence label. Only MIC codes that listings reference are included,
never the full ISO list. The snapshot stays on the device that built it;
redistributing OpenFIGI tickers and names, and ISIN-to-FIGI pairs, is
unconfirmed.
