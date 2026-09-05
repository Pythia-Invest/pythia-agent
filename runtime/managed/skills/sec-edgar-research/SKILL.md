---
name: sec-edgar-research
title: SEC annual filing research
description: Read the latest non-amended 10-K metadata and bounded company facts through EdgarTools.
version: 0.1.0
license: Apache-2.0
platforms: [linux, macos]
metadata:
  hermes:
    tags: [Investing, SEC, Filings, Fundamentals]
    category: finance
    requires_toolsets: [pythia-sec]
---

# SEC annual filing research

Use `pythia_sec_company` when the investor needs the latest annual SEC filing
metadata or a bounded set of filing-linked facts for a ticker or CIK.

- Treat the filing and facts siblings independently. Preserve `partial` and
  error results instead of discarding the sibling that succeeded.
- A `missing_configuration` result means the device still needs an SEC identity.
- The tool returns metadata and facts only. It does not fetch or quote a filing
  body, and it does not qualify other EdgarTools operations.
- Keep accession numbers and filing dates with facts used in an investment
  conclusion so the conclusion remains auditable.
