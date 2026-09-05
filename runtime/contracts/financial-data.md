# Financial-data contracts

The first slice has two independent, optional capabilities. Ordinary startup
and CI use neither credential and make no provider request. A failed sibling
operation is retained beside a successful result; it never erases that result.
Only the fields below cross the Pythia plugin boundary.

## SEC through EdgarTools 5.56.0

Input is a ticker or CIK plus the SEC identity string. The server-side runner
passes the identity through `EDGAR_IDENTITY`; it is not a secret, but it is
never accepted from browser state on each request or added to an argument.
Pythia also sets `EDGARTOOLS_STRICT_ERRORS=true` so transport failures have the
library's typed boundary.

The bounded filing lookup is:

```python
company = Company(ticker_or_cik)
filing = company.get_filings(
    form="10-K", amendments=False, trigger_full_load=False
).latest(1)
```

It consumes `cik`, `company`, `form`, `filing_date`, `accession_number`,
`report_date`, `primary_document`, `is_xbrl`, and `is_inline_xbrl`. A missing
latest filing is `null`; optional fields remain `null` rather than triggering a
second fetch. The facts sibling is `company.get_facts()`. It consumes a bounded
PIT-filtered set of `concept`, `label`, `numeric_value`, `unit`,
`period_start`, `period_end`, `fiscal_year`, `fiscal_period`, `filing_date`,
`form_type`, and `accession`; dates/fiscal metadata may be absent. No document
body, complete company object, or full upstream schema crosses the boundary.
After ticker-to-CIK resolution, the bounded upstream requests are
`GET https://data.sec.gov/submissions/CIK<10-digit-CIK>.json` and
`GET https://data.sec.gov/api/xbrl/companyfacts/CIK<10-digit-CIK>.json`.

The library uses SEC's required identity as User-Agent. Its default timeout is
10 seconds to connect and 30 seconds for read/write/pool. Quick GET performs up
to five attempts with exponential delay; HTTP 429 instead raises
`TooManyRequestsError` with `retry_after`/estimated wait. Missing identity
raises `IdentityNotSetError`. With strict errors, other transport/status
failures retain the library exception and status code.

These synchronous operations do not accept a per-call cancellation signal.
Pythia therefore runs the bounded Python request in an owned subprocess:
deadline or cancellation terminates that subprocess and returns `timeout` or
`cancelled`; it does not leave a background SEC request. Filing and facts are
invoked independently and serialize as `{status,data,error}` siblings.

Authoritative evidence: the 5.56.0-tagged
[Company implementation](https://github.com/dgunning/edgartools/blob/v5.56.0/edgar/entity/core.py),
[filing types](https://github.com/dgunning/edgartools/blob/v5.56.0/edgar/_filings.py),
[fact types](https://github.com/dgunning/edgartools/blob/v5.56.0/edgar/entity/models.py), and
[HTTP implementation](https://github.com/dgunning/edgartools/blob/v5.56.0/edgar/httprequests.py), including the
[URL builders](https://github.com/dgunning/edgartools/blob/v5.56.0/edgar/urls.py).
The PyPI artifact is not asserted to derive from that Git commit; see
`runtime/versions.json`.

## EODHD SDK 1.1.0

Pythia constructs `new EODHDClient({ apiToken, timeout, maxRetries })` on the
server. The token comes from the canonical secret store and is passed in
memory; it is never in an argument, response, fixture, or log. Although the SDK
can read `EODHD_API_TOKEN`, Pythia passes `apiToken` explicitly so precedence is
unambiguous.

The one qualified market read is:

```ts
client.eod(ticker, {
  from: optionalDate,
  to: optionalDate,
  period: "d",
  order: "a"
})
```

It performs `GET /api/eod/{encoded ticker}` with `fmt=json` and the selected
query fields. Pythia consumes only each row's `date`, `open`, `high`, `low`,
`close`, `adjusted_close`, and `volume`; missing optional query inputs are
omitted. Results are capped and no unqualified fundamentals endpoint is used.

The SDK defaults to a 30-second timeout and two retries (three attempts). It
retries 408, 429, 500, 502, 503, and 504 using backoff and `Retry-After`.
Typed failures consumed by Pythia are:

- `EODHDAuthError`, status 401/403, code `auth_error`;
- `EODHDRateLimitError`, status 429, code `rate_limit`, optional `retryAfter`;
- `EODHDTimeoutError`, status 0, code `timeout`;
- network error, status 0, code `network_error`;
- parse, client, or server errors with their SDK code/status/message.

The method has no caller `AbortSignal`. Abandoning its Promise does not cancel
the underlying retry loop; a request ends only at its per-attempt timeout.
Pythia must preserve that fact in status and use an owned worker/subprocess
boundary if hard cancellation is required. It must not claim that UI
disconnection aborts native SDK work.

An installed-tarball mock-fetch probe verified method, encoded request,
timeout signal, output, 403, 429, and timeout shapes without a token or network
call. Source evidence is the npm-provenance commit's
[client](https://github.com/EodHistoricalData/EODHD-APIs-Node-Financial-Library/blob/9e3970daef47e95110e40a12ac30a31421fdd81c/src/client.ts),
[EOD method](https://github.com/EodHistoricalData/EODHD-APIs-Node-Financial-Library/blob/9e3970daef47e95110e40a12ac30a31421fdd81c/src/api/eod.ts),
[HTTP/retry code](https://github.com/EodHistoricalData/EODHD-APIs-Node-Financial-Library/blob/9e3970daef47e95110e40a12ac30a31421fdd81c/src/http.ts), and
[errors](https://github.com/EodHistoricalData/EODHD-APIs-Node-Financial-Library/blob/9e3970daef47e95110e40a12ac30a31421fdd81c/src/errors.ts).

## Fixtures and publication rights

Automated fixtures must be small synthetic objects authored from the cited
public types and error tests, with provenance comments naming package version,
source URL, and the fields modeled. Neither SEC responses nor EODHD data are
assumed redistributable. They may be recorded locally only for an approved
qualification run and never committed. Upstream fixture bytes may be copied
only after their containing repository license and the individual fixture's
origin permit redistribution; synthetic fixtures are the default.
