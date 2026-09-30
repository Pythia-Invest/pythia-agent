# OpenFIGI reference connector

`pythia-openfigi` is a Hermes-native plugin with two operations over OpenFIGI's
`/v3/mapping` endpoint. Both return evidence; Pythia's core decides identity. It
supplies no prices, catalogue or search, and it is never called while a user
types. The offline reference build has its own OpenFIGI client. The
[source record](../../../../docs/sources/openfigi.md) holds the field meanings
and the evidence behind the exchange-code table.

- **`resolve`** (`pythia_openfigi_resolve`) is the lookup core dispatches, as
  its `contract.json` declares: `{"identifiers": {"isin": ...}}` in, an
  identity claim batch out ([ADR 0038](../../../../docs/decisions/0038-plugin-addressing-contract.md)).
- **`mapping`** (`pythia_openfigi_mapping`) serves the agent's
  `openfigi_identifiers` tool: several jobs, every candidate, nothing decided.

## Core's lookup

OpenFIGI introduces subjects on demand only: one ISIN per lookup, when the
investor or the agent asks for it. There is no catalogue, bulk mapping or
scheduled sync ([ADR 0044](../../../../docs/decisions/0044-product-direction.md),
note "OpenFIGI introduces subjects on demand only"). The contract declares
`introduces: {"listing": ["figi"]}`: a line the reference lacks becomes
`listing:figi:<FIGI>`.

The answer is one listing claim per FIGI line, never a pick:

- its FIGI, which is also its native reference (scope `figi`), its composite
  FIGI and its share-class FIGI, as OpenFIGI states them;
- the ISIN at security scope, role `self`: OpenFIGI maps that ISIN to the line.
  A line OpenFIGI files under another share class keeps its own share-class
  FIGI, so core's join sees the disagreement instead of a silent merge;
- the exchange code (`provider_venue`) and, only for an order book, the operating
  MIC through the contract's `venue_codes`. Any other line has no MIC, so no
  price source can address it, and carries `venue_note`, the reason in words;
- the name, `asset_class: equity` where the market sector is Equity, and the
  ticker as evidence. A ticker never keys a line, and one outside core's ticker
  grammar (`BRK/B`) is left out.

No line is dropped, whatever its code (the founder's ruling: dropping data is
almost never right). `vocabulary.json`, next to the contract, says what every
exchange code is, and `venue_codes` holds only its `exchange` codes (the two are
tested to agree). A line's code is one of:

- `exchange`: a public order book; it gets its operating MIC;
- `second_book`: a second code on an operating MIC whose main code has the line
  (Munich's gettex GZ beside GM);
- `us_unlisted_trading`: a US exchange line OpenFIGI gives every US security;
  the listing comes from SEC, so it is not mapped (PQ, OTC Markets, is);
- `trade_report`: an APA or off-exchange publication (XV, XX, E1, UV);
- `dark`: a dark or block venue (Liquidnet, Posit);
- `composite`: a country composite or EO, the OTC composite. A composite is a
  line like any other, with its FIGI and no MIC. AU is Australia's composite;
  the ASX line is AT (XASX);
- `unknown`: no MIC resolved it, or a string that is no code.

A code absent from the file is "not in the vocabulary". Core leaves a line with
no MIC `unmatched`, so it is parked but understood; read why with the "why was
this record not placed?" query of the [identity data](../../../../docs/architecture/identity-data.md)
guide. To add or reclassify a code, edit `vocabulary.json` and, for an
`exchange` code, `contract.json`; the source record has the method and the
judgement calls.

## The agent's jobs

Supported jobs (`idType` + `idValue`, optional filters):

- `ID_ISIN`, alone or with `micCode` or `exchCode` (for example ISIN + XAMS);
- `TICKER` with a venue, `micCode` or `exchCode` (a bare ticker spans every
  market and is rejected).

OpenFIGI matches `micCode` against the listing's segment MIC. A Nasdaq Global
Select line answers to XNGS (or exchange code UW), not to the operating MIC XNAS
that sources such as SEC report. The connector does not translate between them.

ISINs are checked for shape and check digit before any request, which
catches malformed input but does not prove issuance. Results keep job order.
Each job is `found` with every candidate (`figi`, `compositeFIGI`,
`shareClassFIGI`, `ticker`, `exchCode`, `name`, security types, market sector),
`not_found`, `error` with the provider's short message, or `unanswered` when a
request failed or a limit stopped the call. One ISIN normally maps to many venue listings, and the
connector never picks one. FIGIs identify instruments, not legal issuers.

## Configuration and limits

`configuration.json` declares the optional `openfigi_api_key` secret. To use a
key, set it in `secrets.json` in the Pythia config folder (`~/.config/pythia`,
mode `0600`), next to the existing fields:
`{"schema_version": 1, ..., "openfigi_api_key": "<your key>"}`. The key is read
only through core's `platform.configuration` and is sent only in the
`X-OPENFIGI-APIKEY` header of this process's requests and is never logged,
returned or passed to a subprocess. An invalid key falls back to keyless use with
a warning.

The limits follow OpenFIGI's rate-limit table (consulted 2026-09-25). Without a
key a request carries up to 10 jobs and at most 25 requests start per minute.
With a key a request carries up to 100 jobs and at most 25 requests start per 6
seconds. One call accepts up to 100 jobs and is split into requests of the
allowed size. When a later request fails or is throttled, earlier answers are
kept and the remaining jobs are reported as unanswered, with the retry delay when
there is one. The endpoint section of the
same page still says 5 keyless jobs, but a 6-job keyless request was accepted on
2026-09-25. A provider rejection (HTTP 413) is reported, not retried.
Successful answers are retained in memory for 24 hours; partial or failed ones
are not.

Source: [OpenFIGI API documentation](https://www.openfigi.com/api/documentation).
