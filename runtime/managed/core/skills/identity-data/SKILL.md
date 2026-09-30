---
name: identity-data
title: Where Pythia's data comes from
description: Trace where an identifier, link, price source, plugin contribution or user answer in Pythia's identity data comes from, by reading its two SQLite stores read-only.
version: 0.1.0
license: Apache-2.0
platforms: [linux, macos]
metadata:
  hermes:
    tags: [Investing, Data, Provenance]
    category: finance
---

# Where Pythia's data comes from

Use this when the investor asks why a subject shows something: which source
states an identifier or a link, why a price comes from one source, what a
plugin added, or which answers apply. Start with `pythia_instrument`: it gives
identifiers with their sources, flags, and which source serves each concept or
why not. Read the stores when it does not settle the question.

Two SQLite files hold the evidence, and each row names its source or plugin,
its record, when, and the rule or answer behind a decision:

- `$PYTHIA_DATA_ROOT/store/identity.sqlite3`: what plugins stated and this
  device decided.
- The installed reference package: `store/reference/installed.json` names a
  directory under `store/reference/packages/`, and its `package.json` names the
  database (open identifiers, listings, securities, issuers).

Open both read-only with your code or terminal tool, and never write to either:

```python
import json, os, sqlite3
from pathlib import Path
store = Path(os.environ["PYTHIA_DATA_ROOT"]) / "store"
db = sqlite3.connect(f"{(store / 'identity.sqlite3').as_uri()}?mode=ro", uri=True)
reference = store / "reference"
package = reference / "packages" / json.loads((reference / "installed.json").read_text())["current"]
database = package / json.loads((package / "package.json").read_text())["database"]["file"]
db.execute(f"ATTACH '{database.as_uri()}?mode=ro' AS ref")
```

`SELECT name, sql FROM sqlite_master WHERE type = 'table'` (and `ref.sqlite_master`)
explains each table and column in its comments. Where to look:

- Which source states an identifier: `ref.assertions` (`source`, `source_record`,
  `retrieved_at`), and `device_assertions` joined to `claims` on `plugin`,
  `native_scope`, `native_id`.
- Why a listing sits under a security, and a security under an issuer: the
  reference's `listings.security_id` and `securities.issuer_id` (the ID spells
  out the key), `subjects.parent_id` with its `claims`, and the `relations`
  tables of both files.
- Bindings: `bindings` (`plugin`, `rule_id` or `verdict_id`, `decided_at`).
  With no binding, a source's address is derived from the ticker, the venue and
  its `contract.json`, and nothing is stored.
- What a plugin added: `subjects.introduced_by`, `claims`, `device_assertions`,
  `relations` and `bindings`, by `plugin`, the name in its contract (`yahoo`,
  not the Hermes key).
- Answers: `queue` joined to `verdicts` on `resolved_by`; `resolver = 'user'`
  and `state = 'resolved'` is an override that applies, and an agent verdict is
  only a suggestion. Open questions have `state = 'open'`.

A row is evidence that a source said something, not proof that it is right. Say
which source, record and time you read, and what the stores do not record.
The worked queries are in `docs/architecture/identity-data.md` of the Pythia
checkout. If `PYTHIA_DATA_ROOT` is not set, ask the investor where their Pythia
data folder is.
