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
Lines without a venue or trading currency (OpenFIGI-only home lines) are left
out and counted in the manifest audit (`schema`).

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
  a previous name.
- **CIK to LEI.** Link by identifier agreement first: a FIRDS US ISIN mapped to
  the SEC ticker, a shared share-class FIGI, or GLEIF's SEC EDGAR registration.
  Fall back to a unique normalised name match on both sides. Conflicts become
  flags, never merges.
- **Noise.** Auxiliary segments (midpoint, auction) collapse onto the lit
  segment. SEC warrants, units, rights, preferreds and funds are labelled by
  `row_class`, not merged into the share line.
- **Canaries.** ASML on XAMS (ticker, FIGI, LEI, CIK, primary), its Nasdaq line
  under the same issuer, and Apple on Nasdaq must resolve, or no snapshot is
  written (`--no-gates` writes it anyway for inspection).

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
