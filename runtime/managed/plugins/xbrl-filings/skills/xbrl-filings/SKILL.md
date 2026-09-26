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
    requires_toolsets: [pythia-xbrl-filings]
---

# Public XBRL reports

These tools address a company by its LEI; they do not search by name or
ticker. `pythia_xbrl_filings_resolve` checks whether filings.xbrl.org indexes an
LEI. The repository is incomplete, so an unindexed LEI does not mean the company
publishes no reports.

`pythia_xbrl_filings_filings` returns report links (viewer, report, package and
xBRL-JSON) and `report_id` values. Its `latest` block says whether the latest
period has one report or several variants. `pythia_xbrl_filings_fundamentals`
reads supported reported IFRS facts. When several reports share the latest
period it returns the candidates instead of choosing; inspect them and retry
with an explicit `report_id`. Repository ordering does not prove which report
amended another.

For specific report concepts, use `pythia_xbrl_filings_facts` with an explicit
report ID and its namespace-qualified concept names. Preserve dimensions,
periods, currencies and precision when comparing observations. Missing facts
are not zero; company extensions are not automatically standard concepts.

Repository added dates are not filing dates. Machine-readable availability is
incomplete; an error never silently substitutes an older report. Report links
remain usable when a selected fact is unsupported.
