# SEC reference connector

`pythia-sec` is a Hermes-native plugin that reads SEC's public EDGAR data. It
contributes reference evidence and issuer content; Pythia's core owns identity
decisions. It has no search and no catalogue: discovery is a local read of
Pythia's directory, and the reference builder ingests SEC's ticker file itself.

| Operation | Tool | Source | Returns |
| --- | --- | --- | --- |
| `resolve` | `pythia_sec_resolve` | ticker file or `submissions/CIK##########.json` | `identifiers.cik`, or `identifiers.ticker_mic` (`TICKER@MIC`, operating MIC): a `ClaimBatch` in core's wire form (ADR 0038), one issuer claim (name, CIK, native reference) per matching filer. Several filers for one ticker are all claimed with an `ambiguous` warning; a MIC SEC does not list (anything but XNAS, XNYS, XCBO, OTCM) is `empty` without a request. |
| `filings` | `pythia_sec_filings` | submissions | Recent filings with form, filing date, acceptance time, report period, document link and description, including 20-F, 40-F and 6-K. Insider and major-holder ownership filings (Forms 3, 4, 5, 144, Schedule 13G) are left out unless `forms` names them. The Desk's filings section reads it through its declared read-only operation `pythia-sec`/`filings`. |
| `fundamentals` | `pythia_sec_fundamentals` | `api/xbrl/companyfacts` and submissions | Latest annual US GAAP or IFRS (`ifrs-full`, used by foreign private issuers) facts with exact periods, units and filing provenance, and their `freshness`. |
| `facts` | `pythia_sec_facts` | companyfacts | Native facts for explicit concepts of one taxonomy. |

## Filing fields

Each filing keeps these submissions fields (see the
[EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)):

| Field | SEC field | Meaning |
| --- | --- | --- |
| `filed_at` | `filingDate` | The official filing date. A filing accepted after 17:30 ET usually carries the next business day. |
| `accepted_at` | `acceptanceDateTime` | When EDGAR accepted the filing, in true UTC. SEC marks the value as UTC, but until its nightly rebuild the value is Eastern time. So a filing dated on or after the Eastern day of the read is read as America/New_York (measured against the current feed, 2026-09-28). |
| `items` | `items` | Form 8-K item numbers, such as `2.02` for results. Other forms put dates or form names in this field, so it is read only for 8-K and 8-K/A. |
| `description` | `primaryDocDescription` | The filer's description of the primary document, often only the form name. |
| `inline_xbrl` | `isInlineXBRL` | Whether the primary document is Inline XBRL. |
| `submission_bytes` | `size` | The whole submission in bytes, every document included, not the primary document. |

**Drift.** An unknown 8-K item, a missing column or a malformed value is
counted under the result's `drift` and returned as a `drift` warning. A form
outside the known vocabulary is also counted there, but only logged. The filing
is listed under SEC's own name, and funds and ETFs file many such forms. Every
kind is logged as a `source_drift` event. A malformed field is left empty. A
column whose length differs from the others breaks the whole read.

**Freshness.** SEC builds companyfacts from filings after they are accepted. In
2026 it went months without adding the statements of several foreign issuers'
20-Fs (Toyota, TSMC and Sony among them) and gave no error. So `fundamentals`
checks the newest 10-K, 10-Q, 20-F or 40-F that `submissions` marks as XBRL.
Its accession must appear on at least one `us-gaap` or `ifrs-full` fact.
Otherwise `freshness.status` is `stale`, the first limitation names the missing
filing and a `stale` warning is returned. A retained companyfacts copy read
before that filing was accepted is read again once first, so the alarm reports
SEC's lag, not the cache's. The facts themselves are still
returned. When the filing list cannot be read, the status is `unknown`, with a
`freshness_unknown` warning.

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
