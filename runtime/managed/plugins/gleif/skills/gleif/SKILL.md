---
name: gleif
description: Use GLEIF for exact LEI and ISIN issuer evidence, legal-entity profiles and accounting-consolidation parent relationships.
---

# Legal entities with GLEIF

Use `resolve` with an exact LEI or ISIN to read the identity claims GLEIF's
records make (the LEI, a mapped ISIN, an EDGAR CIK). An ISIN mapping is issuer evidence with incomplete coverage, not a
security master: it can return several entities, which stay ambiguous until
other evidence decides, or none. A depositary receipt's ISIN can map to the
depositary bank. Names never prove that two investments share an issuer, and
Pythia's core owns association decisions.

An LEI identifies a legal entity, not a tradable security or listing. Use
`profile` for legal names and their types, registration metadata, declared
successors, accounting parents and a branch's head office. A head-office or
successor link relates distinct entities; it does not authorize replacing one
entity's data with another's. Entity status and LEI registration status mean
different things: a lapsed LEI does not mean the company has ceased operating.
Parent reporting exceptions do not prove that there is no owner, and
consolidation relationships do not enumerate all economic ownership. Preserve
statuses, corroboration, sources and reporting exceptions.

The plugin uses GLEIF's public API without credentials. Reads are bounded and
cached; use `refresh` on `resolve` when rechecking identity evidence.
