# GLEIF legal-entity connector

Native `pythia-gleif` is an issuer-level reference connector. It resolves an LEI
or ISIN to GLEIF legal-entity references and reads the legal-entity profile by
LEI. It needs no key and uses the shared protected operation adapter and
market-data's connector library. The package includes the `pythia-gleif:gleif`
skill.

It has no search operation. Finding an investment is a local directory read owned
by Pythia's core; this plugin only answers explicit identifier questions and
supplies content for an issuer the core has already addressed.

## Operations

| Operation | Input | Result |
| --- | --- | --- |
| `resolve` | `identifiers` with exactly one of `lei` or `isin`; optional `refresh` | a `ClaimBatch` in core's wire form (ADR 0038): for an LEI, one issuer claim with the native reference (`gleif`/`lei`); for an ISIN, one security claim per mapped issuer; outcome `empty` when GLEIF has no record |
| `profile` | `native_ref` (`gleif`/`lei`) | legal profile: identifiers, typed names, registration fields, successors and accounting parents or head office, plus the page profile fields (`name`, `legal_name`, `jurisdiction`, `legal_address`, `headquarters`, `status`, `category`, `parent`, `source`) |

`profile` is also the Desk's profile section, read over HTTP through its declared
read-only operation `pythia-gleif`/`profile`. `contract.json` declares the plugin's addressing
(issuers by LEI), its profile content and `resolve` for Pythia's core.

An ISIN uses GLEIF's top-level `filter[isin]` issuer mapping and keeps that
filtered request as provenance. The nested `/{lei}/isins` resource does not apply
that filter and is not used. Several issuer records for one ISIN become several
claims and are never picked. Core addresses GLEIF by LEI and does not send it
ISINs; the ISIN path serves explicit agent lookups. GLEIF's ISIN
coverage is incomplete, and the mapping is issuer evidence, not proof that
instruments or price series are equivalent. A depositary receipt's ISIN can map
to the depositary bank rather than the underlying issuer.

Claimed identifiers are only those the record asserts: the LEI, the requested ISIN
for an ISIN lookup, and a CIK only when the registration authority is `RA000665`
(SEC EDGAR) and the registration number is numeric. Another registry's number is
never read as a CIK. The connector does not match names across providers and has
no CIK-to-LEI lookup; missing cross-identifiers remain unresolved.

## Profile

The profile keeps GLEIF's legal name and its `otherNames` and
`transliteratedOtherNames` with their native type (for example
`PREVIOUS_LEGAL_NAME`, `ALTERNATIVE_LANGUAGE_LEGAL_NAME`,
`AUTO_ASCII_TRANSLITERATED_LEGAL_NAME`) and language. Names are labels, not
identity proof. It also keeps legal jurisdiction, legal form, addresses, local
registration, entity creation and expiration, entity status, LEI registration
status, corroboration and source update dates. A declared Level 1 successor is
reported as a distinct `SUCCEEDED_BY` relationship; the retired record is never
replaced by its successor.

Two further bounded reads supply direct and ultimate accounting-consolidation
parents or their reporting exceptions; a branch's declared head office needs one
further read, verified as `IS_INTERNATIONAL_BRANCH_OF` and never merged.
Relationship links from the record declare availability only; the connector
constructs each URL under the requested LEI and rejects any other link. Inactive
or ended relationships are kept as fields rather than asserted as current links.
Parent registrations can be lapsed while the relationship is active; both
statuses stay visible. This is not a complete ownership graph.

## Bounded execution

An ISIN lookup returns at most ten issuer records, with a `resolve_limited`
warning when GLEIF reports more. A profile uses at most four calls. A 12-second
operation deadline, 2 MB response bound, shared connection budget (two concurrent
calls, sixty per minute), cancellation and coalescing keep work bounded. Validated
record reads are cached for a day and shared by `resolve` and `profile`; `refresh`
bypasses them. Domain validation runs before cache admission, so a malformed
response can recover on the next read. Parent failures keep the legal profile with
issues and retry guidance. Native access is checked before and after each read. No
per-plugin listener, credential store or background index exists.

## Qualification

On 2026-09-25, the copied plugin under the pinned native runtime, called through
the protected operation executor, resolved ISIN NL0010273215 to exactly one issuer,
ASML Holding N.V. (LEI `724500Y6DUVHQD6OXN27`), and read its profile with both
direct and ultimate accounting-parent reporting exceptions and no current parent
relationship. Synthetic tests cover the resolve
states, identifier checksums, CIK admission, typed names, successors, parents,
branches, dates, cache validation and retry qualifications. This qualifies those
examples, not universal GLEIF coverage.

Primary references:

- [GLEIF API](https://www.gleif.org/en/lei-data/gleif-api) and
  [endpoint documentation](https://documenter.getpostman.com/view/7679680/SVYrrxuU).
- [ISIN-to-LEI mappings](https://www.gleif.org/en/lei-data/lei-mapping/download-isin-to-lei-relationship-files).
- [Registration authority codes](https://www.gleif.org/en/lei-data/code-lists/gleif-registration-authorities-list).
- [Level 2 accounting relationships](https://www.gleif.org/en/lei-data/access-and-use-lei-data/level-2-data-who-owns-whom).
- [GLEIF data terms](https://www.gleif.org/en/meta/lei-data-terms-of-use).
