# SEC reference connector

`pythia-sec` is a Hermes-native plugin that reads SEC's public EDGAR data. It
contributes reference evidence and issuer content; Pythia's core owns identity
decisions. It has no search and no catalogue: discovery is a local read of
Pythia's directory, and the reference builder ingests SEC's ticker file itself.

| Operation | Tool | Source | Returns |
| --- | --- | --- | --- |
| `resolve` | `pythia_sec_resolve` | ticker file or `submissions/CIK##########.json` | `identifiers.cik`, or `identifiers.ticker_mic` (`TICKER@MIC`, operating MIC): a `ClaimBatch` in core's wire form (ADR 0038), one issuer claim (name, CIK, native reference) per matching filer. Several filers for one ticker are all claimed with an `ambiguous` warning. |
| `filings` | `pythia_sec_filings` | submissions | Recent filings with form, filing date, report period and document link, including 20-F, 40-F and 6-K. Exported read-only over HTTP as `pythia-sec`/`sec-filings` for the Desk's filings section. |
| `fundamentals` | `pythia_sec_fundamentals` | `api/xbrl/companyfacts` | Latest annual US GAAP or IFRS (`ifrs-full`, used by foreign private issuers) facts with exact periods, units and filing provenance. |
| `facts` | `pythia_sec_facts` | companyfacts | Native facts for explicit concepts of one taxonomy. |

A 20-F filer does not imply IFRS. Some foreign private issuers tag US GAAP in
their own currency (for example EUR), others use `ifrs-full`. Both taxonomies are
read and kept apart.

SEC labels only name exchange groups, so the MIC is the operating MIC: `Nasdaq`
maps to XNAS, `NYSE` to XNYS (including NYSE American and Arca), `CBOE` to XCBO
and `OTC` to OTCM. A CIK identifies a filer, not a security. Several ticker lines
(share classes, preferreds, warrants) can share one CIK, and none of them proves
security equivalence. Tickers keep SEC's own spelling, with `-` as the class
separator (for example `BRK-B`).

## Configuration

SEC requires every automated request to declare a contact in its User-Agent: a
name followed by an email address. `configuration.json` declares it as the
required `sec_identity` field (kind `identity`). Set it in `settings.json` in the
Pythia config folder (`~/.config/pythia`, mode `0600`):

```json
{"schema_version": 1, "sec_identity": "Your Name you@example.org"}
```

The plugin reads the value only through core's `platform.configuration` and never
logs or returns it. Until a usable contact is set, every SEC tool returns core's
standard `needs_configuration` result naming the field and file, without
contacting SEC. A value without an email address gets the same result, because
SEC rejects such requests with HTTP 403, and so does a value with characters
outside printable ASCII, which cannot be sent as a header.

## Limits and caching

Requests go only to fixed SEC URLs. They are paced below SEC's fair-access limit
of ten per second (at most five per second, 120 per minute, two concurrent), and
redirects are refused. Responses are requested gzip-compressed, which keeps large
companyfacts files within the read timeout; a decoded body above 24 MB is refused. Successful reads are retained in memory: the ticker file
for 24 hours, submissions for 5 minutes and companyfacts for 1 hour. Failures are
not retained. `refresh: true` bypasses the retained copy.

Sources: [EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
and [SEC fair access](https://www.sec.gov/os/accessing-edgar-data).
