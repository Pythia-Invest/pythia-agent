# filings.xbrl.org connector

Native `pythia-xbrl-filings` is an issuer-level content connector for public
XBRL reports, chiefly European ESEF annual financial reports. Content is
addressed by the issuer's LEI. It needs no API key, uses the shared protected
operation adapter and market-data's connector library, and creates no routes,
registry or subprocess. The package includes the `pythia-xbrl-filings:xbrl-filings`
skill.

It has no search operation. Finding a company is a local directory read owned by
Pythia's core; company names and ticker strings never establish equivalence.

## Operations

| Operation | Input | Result |
| --- | --- | --- |
| `resolve` | `identifiers.lei`; optional `refresh` | a `ClaimBatch` in core's wire form (ADR 0038): one issuer claim with the entity name, its LEI and the native reference (`xbrl-filings`/`lei`); outcome `empty` when the LEI is not indexed |
| `filings` | `native_ref`, optional `limit` | indexed reports with viewer, report, package and xBRL-JSON links, and the state of the latest period; read by the Desk's filings section through its declared read-only operation `pythia-xbrl-filings`/`filings` (`filed_at` and `language` are null: the repository indexes neither) |
| `fundamentals` | `native_ref`, optional `report_id` | eight standard IFRS facts from one report |
| `facts` | `native_ref`, `report_id`, `concepts` | selected numeric xBRL-JSON concepts from one report |

The repository covers ESEF, UKSEF and some other reporting systems. It is
incomplete, particularly where source authorities do not make reports
accessible, so an empty resolve does not mean the company publishes no reports. The
connector does not crawl or index all reports; only selected reports are
downloaded.

## Report choice is explicit

Several reports can share the latest reporting period, for example language or
format variants, or a corrected filing. Numbered paths and ingestion order never
establish amendment order, so the connector never picks one silently:

- `filings.latest` gives the latest `period_end`, its `report_ids` and a
  `status` of `unique` or `ambiguous`.
- `fundamentals` without a `report_id` returns the `ambiguous_report` error with
  the candidate reports (ID, period, form, country, link, machine readability).
  The caller chooses one and retries with its `report_id`.
- A report with validation errors or without xBRL-JSON returns
  `unavailable_report`; no older report is substituted. Its links remain usable.

## Meaning of the results

- Filing reporting dates come from source metadata. Its naive `date_added` string
  remains `source_detail.values.added_raw`; it is neither a filing date nor an
  invented timezone-aware instant. Unknown filing dates remain absent.
- `accession` is the repository's report SHA-256 identity, not a checksum of the
  downloaded xBRL-JSON representation. `report_id` is its selectable API ID.
  Form and country come from the repository identifier (`fxo_id`).
- Source validation warning and formula-inconsistency counts remain inspectable
  and qualify the returned facts; they are not silently treated as clean data.
- The summary supports eight standard IFRS concepts. It selects undimensioned
  observations for that report's period, requires actual annual durations for
  income/cash-flow facts and preserves instant balance-sheet dates. Extensions
  are not guessed into standard concepts. Missing facts are not zero.
- Values remain exact decimal strings, with source precision, LEI, report ID,
  taxonomy URI, units and period. Midnight exclusive OIM endpoints normalize to
  the previous date; the raw period remains inspectable. Non-date periods are
  explicitly unsupported instead of truncated.
- Native selected-concept reads retain dimension keys as expanded namespace
  names and lexical values with their applicable namespace mapping. Text, nil and
  unsupported values are qualified. No taxonomy downloads, formula evaluation,
  ratios, TTM, currency conversion or accounting-basis conversion run.

## Bounded execution

Filings and fundamentals share a cached 50-report metadata request; pagination is
constructed under the requested LEI because upstream pagination links can lose
that scope. Every returned filing is checked against the requested entity, and
explicit report reads validate its entity relationship: another issuer's
`report_id` is `missing_observation` for this issuer. Reports are capped at
16 MB and 100,000 facts, with at most eight selected concepts and 200 returned
observations. URLs stay on the fixed HTTPS origin and under the expected LEI path;
redirects are rejected.

Reads use the shared worker cache and in-flight coordination, a two-request,
sixty-per-minute local connection budget, cancellation and one 25-second
deadline shared by an operation's reads. Domain validation runs before cache publication, so malformed HTTP 200
responses are not retained. Report cache identity includes the source report hash
and requested projection, so projected facts are kept for a day. The local budget is conservative policy, not a
published provider quota. Throttling, access denial, unavailable reports and
malformed responses remain distinct. Native access is checked before and after
each read. `refresh` bypasses the retained entity check.

## Qualification

On 2026-09-25, the copied plugin under the pinned native runtime, called through
the protected operation executor, resolved ASML Holding N.V. (LEI
`724500Y6DUVHQD6OXN27`), listed its indexed ESEF reports with the FY2025 annual
report as the unique latest period and all four link kinds, and read six of the
eight summary IFRS facts in EUR from it; the other two concepts are not reported
under those standard names. Shell plc's FY2025 period returned two variants (GB
and NL) as `latest.status: ambiguous`, and `fundamentals` returned
`ambiguous_report` listing both instead of choosing. This qualifies those
examples, not universal report or taxonomy coverage.

Synthetic tests cover entity and URL scope, links, report ambiguity with
candidates, unavailability, dimensions, precision, exclusive period endpoints,
taxonomy spoofing, duplicate conflicts, metadata reuse, refresh and retry
qualifications.

Sources: [API](https://filings.xbrl.org/docs/api),
[repository semantics and limitations](https://filings.xbrl.org/docs/about),
[xBRL-JSON specification](https://www.xbrl.org/Specification/xbrl-json/REC-2021-10-13/xbrl-json-REC-2021-10-13.html).
