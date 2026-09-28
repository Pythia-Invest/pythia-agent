---
name: xbrl-filings
description: Read public ESEF and other indexed XBRL annual report links and reported financial facts by company LEI.
version: 0.1.0
license: Apache-2.0
platforms: [linux, macos]
metadata:
  hermes:
    tags: [Investing, Filings, Fundamentals]
    category: finance
    requires_toolsets: [pythia-desk]
---

# Public XBRL reports

filings.xbrl.org addresses a company by its LEI; Pythia fills it in from any
subject of the company. The repository is incomplete, so a company it does not
index may still publish reports.

`pythia_filings` lists report links (viewer, report, package and xBRL-JSON) and
`report_id` values from this source when it serves the company.
`pythia xbrl-filings fundamentals` reads supported reported IFRS facts. When
several reports share the latest period it returns the candidates instead of
choosing; inspect them and retry with an explicit `report_id`. Repository
ordering does not prove which report amended another.

For specific report concepts, use `pythia xbrl-filings facts` with an explicit
report ID and its namespace-qualified concept names. Preserve dimensions,
periods, currencies and precision when comparing observations. Missing facts
are not zero; company extensions are not automatically standard concepts.

Repository added dates are not filing dates. Machine-readable availability is
incomplete; an error never silently substitutes an older report. Report links
remain usable when a selected fact is unsupported.
