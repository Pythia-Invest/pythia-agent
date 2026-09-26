# OpenFIGI reference connector

`pythia-openfigi` is a Hermes-native plugin with one operation, `resolve`
(`pythia_openfigi_resolve`). It maps identifiers through OpenFIGI's
`/v3/mapping` endpoint and returns the evidence to Pythia's core, which decides
identity. It supplies no prices, catalogue or search, and it is not called while
a user types: resolution is explicit, for example when a page needs a FIGI or an
offline reference build maps ISINs.

The tool takes one ISIN (`{"identifiers": {"isin": ...}}`, the `resolve` input
declared in `contract.json`) and answers with a `ClaimBatch` in core's wire form
(ADR 0038): one listing claim per OpenFIGI candidate with its FIGI, composite
FIGI, share-class FIGI, ticker and Bloomberg exchange code (`provider_venue`).
An unmatched ISIN is outcome `empty`. Internally the connector maps jobs
(`idType` + `idValue`, optional filters), which the offline reference build
reuses:

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
