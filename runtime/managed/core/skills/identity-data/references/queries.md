# Identity data queries

Read-only queries over Pythia's two identity stores, for tracing where an
identifier, link, price source, plugin contribution or answer comes from. Each
row names its source or plugin, its record, when, and the rule or answer behind
it. A row is evidence that a source said something, not proof that it is right.

## Open the stores

Open `identity.sqlite3` read-only and attach the installed reference package as
`ref`. Every query below assumes this connection. Run the snippet from the
terminal tool (for example `python3 -`): the terminal has `PYTHIA_DATA_ROOT`
set, and the code-execution sandbox does not pass it on. There, read it first
with `echo "$PYTHIA_DATA_ROOT"` and set `os.environ["PYTHIA_DATA_ROOT"]` before
the snippet. If the variable is empty or the folder is missing (a remote or
sandboxed terminal), say you cannot read the stores from here; do not guess a
path. Never open either file read-write.

```python
# example: open
import json, os, sqlite3
from pathlib import Path

store = Path(os.environ["PYTHIA_DATA_ROOT"]) / "store"
db = sqlite3.connect(f"{(store / 'identity.sqlite3').as_uri()}?mode=ro", uri=True)
db.row_factory = sqlite3.Row
reference = store / "reference"
package = reference / "packages" / json.loads((reference / "installed.json").read_text())["current"]
database = package / json.loads((package / "package.json").read_text())["database"]["file"]
db.execute(f"ATTACH '{database.as_uri()}?mode=ro' AS ref")
```

`SELECT name, sql FROM sqlite_master WHERE type = 'table'` (and
`ref.sqlite_master`) prints a comment for each table and column. A reference
package built before those comments were added has none.

The queries take named parameters (`:subject`, ...): `db.execute(sql, {"subject": "..."})`.
Subject IDs are `<kind>:<key scheme>:<key>` and come from `pythia_find`. A plugin
is named as in its `contract.json` (`yahoo`), not by its Hermes key (`pythia-yahoo`).

## The subject's family

The IDs above and below a subject (listing, security, composite, issuer) as a
JSON list, passed on as `:family`. It is the stored structure, before any answer
of the user's that moved a link.

```sql
-- example: family
SELECT json_group_array(id) AS family FROM (
  SELECT :subject AS id
  UNION SELECT security_id FROM ref.listings WHERE id = :subject
  UNION SELECT composite_id FROM ref.listings WHERE id = :subject AND composite_id IS NOT NULL
  UNION SELECT s.issuer_id FROM ref.listings l JOIN ref.securities s ON s.id = l.security_id
    WHERE l.id = :subject AND s.issuer_id IS NOT NULL
  UNION SELECT issuer_id FROM ref.securities WHERE id = :subject AND issuer_id IS NOT NULL
  UNION SELECT parent_id FROM subjects WHERE id = :subject AND parent_id IS NOT NULL
  UNION SELECT p.parent_id FROM subjects c JOIN subjects p ON p.id = c.parent_id
    WHERE c.id = :subject AND p.parent_id IS NOT NULL);
```

A saved ID that returns nothing may be an old one:

```sql
-- example: alias
SELECT 'reference' AS store, new_id, release AS since FROM ref.id_aliases WHERE old_id = :subject
UNION ALL SELECT 'device', new_id, at FROM device_aliases WHERE old_id = :subject;
```

## Where does this price come from, and why that source?

The choice is computed on every read: the first source in the investor's order
(`source_order` in `settings.json` in the Pythia config folder), then Pythia's
default order (free before paid), that is enabled (the profile's Hermes
`config.yaml`), configured, covers the asset class and market, and can address
the line. `pythia_instrument` returns the result, with every skipped source and
its reason. The stores hold what it reads.

```sql
-- example: listing
SELECT id, ticker, mic, operating_mic, currency, trading_currency, status, is_primary
FROM ref.listings WHERE id = :subject;
```

A confirmed binding addresses the line through one plugin's own reference;
`rule_id` is the rule and `verdict_id` the answer that made it:

```sql
-- example: bindings
SELECT subject_id, plugin, provider, native_scope, native_id, status, authority, rule_id, verdict_id,
       decided_at, verified_at
FROM bindings WHERE subject_id IN (SELECT value FROM json_each(:family))
ORDER BY subject_id, plugin;
```

With no binding the address is derived without a call from the ticker, the venue
and the plugin's `contract.json` (`addressing.mic_table` gives a venue's suffix),
and nothing is stored. A line whose `status` is `inactive` is never addressed by
ticker.

## Who says this identifier belongs to this subject?

Every statement of a value, in both stores:

```sql
-- example: statements
SELECT 'reference' AS store, subject_id, scheme, value, authority, source, source_record, retrieved_at
FROM ref.assertions WHERE scheme = :scheme AND value = :value
UNION ALL
SELECT 'device', d.subject_id, d.scheme, d.value, 'source_asserted', d.plugin,
       json_extract(c.claim, '$.provenance.source_record'), d.retrieved_at
FROM device_assertions d
LEFT JOIN claims c ON c.plugin = d.plugin AND c.native_scope = d.native_scope AND c.native_id = d.native_id
WHERE d.scheme = :scheme AND d.value = :value;
```

Every identifier of the family, by source:

```sql
-- example: family-identifiers
SELECT subject_id, scheme, value, authority, source, source_record, retrieved_at
FROM ref.assertions WHERE subject_id IN (SELECT value FROM json_each(:family))
UNION ALL
SELECT d.subject_id, d.scheme, d.value, 'source_asserted', d.plugin,
       json_extract(c.claim, '$.provenance.source_record'), d.retrieved_at
FROM device_assertions d
LEFT JOIN claims c ON c.plugin = d.plugin AND c.native_scope = d.native_scope AND c.native_id = d.native_id
WHERE d.subject_id IN (SELECT value FROM json_each(:family))
ORDER BY 1, 2, 5;
```

A contested fact is a single-valued scheme whose current values differ between
sources; core applies none of them and asks the user. Only values inside their
validity dates count and `ticker_mic` never contests. Each source's set of values
is compared: one source's own several values (OpenFIGI's two composite FIGIs for
some composites) are not a contest, and neither are sources stating the same set.

```sql
-- example: contested
WITH stated AS (
  SELECT DISTINCT subject_id, scheme, value, source
  FROM (SELECT subject_id, scheme, value, source, valid_from, valid_to FROM ref.assertions
        UNION ALL SELECT subject_id, scheme, value, plugin, NULL, NULL FROM device_assertions WHERE role = 'self')
  WHERE subject_id IN (SELECT value FROM json_each(:family)) AND scheme <> 'ticker_mic'
    AND (valid_from IS NULL OR valid_from <= date('now')) AND (valid_to IS NULL OR valid_to >= date('now'))),
sets AS (  -- each source's values, in order
  SELECT subject_id, scheme, source, group_concat(value) AS stated_values
  FROM (SELECT * FROM stated ORDER BY value) GROUP BY subject_id, scheme, source)
SELECT subject_id, scheme, (SELECT group_concat(DISTINCT value) FROM stated s
                            WHERE s.subject_id = sets.subject_id AND s.scheme = sets.scheme) AS vals,
       group_concat(source) AS sources
FROM sets GROUP BY subject_id, scheme HAVING COUNT(DISTINCT stated_values) > 1;
```

## Why is this listing under that security, and that security under that issuer?

The reference's links are columns: a listing's ID spells out its security's key
(usually the ISIN), an issuer's ID its LEI or CIK, and the identifier rows above
are the evidence. A device subject's parent is the one its plugin's records name.

```sql
-- example: links
SELECT 'reference' AS store, id AS subject, security_id AS parent, composite_id AS also
FROM ref.listings WHERE id = :subject
UNION ALL SELECT 'reference', id, issuer_id, NULL FROM ref.securities WHERE id = :subject
UNION ALL SELECT 'device', id, parent_id, introduced_by FROM subjects WHERE id = :subject;
```

The records that placed the family's device subjects, with the identifiers each
states:

```sql
-- example: placing-records
SELECT subject_id, plugin, native_scope, native_id, state, first_seen, last_seen,
       json_extract(claim, '$.provenance.source_record') AS source_record,
       json_extract(claim, '$.identifiers') AS identifiers
FROM claims WHERE subject_id IN (SELECT value FROM json_each(:family));
```

The typed edges around the family (receipt of a share, pool part of a protocol):

```sql
-- example: relations
SELECT 'reference' AS store, type, from_id, to_id, authority, source, source_record, retrieved_at
FROM ref.relations
WHERE from_id IN (SELECT value FROM json_each(:family)) OR to_id IN (SELECT value FROM json_each(:family))
UNION ALL
SELECT 'device', type, from_id, to_id, authority, plugin, source_record, retrieved_at
FROM relations
WHERE from_id IN (SELECT value FROM json_each(:family)) OR to_id IN (SELECT value FROM json_each(:family));
```

## Why was this record not placed?

A plugin's record that core could not place on any subject is kept as `unmatched`.
Where the plugin says why, its words are in the claim as emitted (OpenFIGI says
"venue code XV is a trade report (Cboe Europe BOTC), not an order book"). This
lists one plugin's unplaced records for an identifier, such as an ISIN; an empty
`why_not_placed` means the plugin gave no reason, and the record stays
unmatched for the join's own reason (two lines on one exchange, or no exchange):

```sql
-- example: unplaced-records
SELECT native_id, state, json_extract(claim, '$.attributes.provider_venue') AS venue_code,
       json_extract(claim, '$.attributes.venue_note') AS why_not_placed, last_seen
FROM claims
WHERE plugin = :plugin AND state = 'unmatched'
  AND EXISTS (SELECT 1 FROM json_each(claim, '$.identifiers') WHERE json_extract(value, '$.value') = :value);
```

## What did a plugin add or change?

```sql
-- example: plugin-added
SELECT 'subject introduced' AS what, id AS subject, name AS detail, first_seen AS at
FROM subjects WHERE introduced_by = :plugin
UNION ALL SELECT 'record ' || coalesce(state, 'unplaced'), subject_id, native_scope || ':' || native_id, last_seen
FROM claims WHERE plugin = :plugin
UNION ALL SELECT 'identifier', subject_id, scheme || ' ' || value, retrieved_at
FROM device_assertions WHERE plugin = :plugin
UNION ALL SELECT 'relation ' || type, from_id, to_id, retrieved_at FROM relations WHERE plugin = :plugin
UNION ALL SELECT 'binding ' || status, subject_id, native_scope || ':' || native_id, coalesce(decided_at, verified_at)
FROM bindings WHERE plugin = :plugin
ORDER BY 1, 4;
```

A record a complete catalogue no longer offers becomes `not_seen` with the date;
its subject and bindings stay. The same question about a reference source
(`:source` is `esma_firds`, `gleif`, `openfigi`, `sec`, `sec_funds` or `pythia`):

```sql
-- example: source-added
SELECT 'assertions' AS what, scheme AS kind, authority, count(*) AS rows
FROM ref.assertions WHERE source = :source GROUP BY scheme, authority
UNION ALL SELECT 'relations', type, authority, count(*) FROM ref.relations WHERE source = :source GROUP BY type, authority;
```

## Which answers and overrides apply?

The user's resolved answers are the local overrides that every read applies until
the user reopens the question; "none of these" is dismissed. The agent's answers
are suggestions (`resolver = 'agent'`, `outcome = 'suggested'`). A binding the
user made has `authority = 'user_attested'` and a `verdict_id`. A receipt shows
the issuer the user chose for its stated underlying share, marked `inherited_from`;
that answer is the share's row here.

```sql
-- example: user-answers
SELECT q.id, q.state, q.reason, q.scheme, q.subject_ids, q.candidate_ids,
       v.relation, v.chosen_id, v.user_turn, v.created_at AS answered_at
FROM queue q JOIN verdicts v ON v.id = q.resolved_by
WHERE v.resolver = 'user' AND q.state IN ('resolved', 'dismissed')
  AND EXISTS (SELECT 1 FROM (SELECT value FROM json_each(q.subject_ids) UNION ALL
                             SELECT value FROM json_each(q.candidate_ids))
              WHERE value IN (SELECT value FROM json_each(:family)))
ORDER BY v.created_at;
```

Questions still open about the family:

```sql
-- example: open-questions
SELECT q.id, q.kind, q.reason, q.scheme, q.subject_ids, q.candidate_ids, q.plugins, q.opened_at
FROM queue q
WHERE q.state = 'open'
  AND EXISTS (SELECT 1 FROM (SELECT value FROM json_each(q.subject_ids) UNION ALL
                             SELECT value FROM json_each(q.candidate_ids))
              WHERE value IN (SELECT value FROM json_each(:family)))
ORDER BY q.opened_at;
```

## Which corrections apply?

The investor's own fixes (`kind = 'identifier'`, a NULL `value` removes one, or
`'price_source'`, `value` a plugin's contract name) apply only while `state` is
`active`: they win over the reference, every plugin and the answers above, and
change no row the sources wrote. `proposed` is an agent's suggestion that applies
to nothing until the investor confirms it in Repairs; `undone` was undone,
declined or replaced (`replaces`). Look under the subject's current ID.

```sql
-- example: corrections
SELECT id, kind, subject_id, scheme, value, state, proposed_by, note, decided_at, ended_at, replaces
FROM corrections
WHERE subject_id IN (SELECT value FROM json_each(:family))
ORDER BY created_at;
```

## What the stores do not record

- Which source serves now, and a derived address: computed on every read from
  the order, the plugins' state and coverage and the contract.
- Why a reference link holds: `listings.security_id`, `securities.issuer_id` and
  `composites.security_id` carry no source, and neither do a security's kind or
  status or a listing's primary flag and trading currency.
- Which provider record a reference identifier came from: `source_record` names
  a link or rule where there is one, and `retrieved_at` is the build's read, not
  the provider's date.
- Plugin relations made before `source_record`, `source_version` and
  `adapter_version` existed have NULL there until their plugin states them again;
  bindings made before `decided_at` existed keep NULL.
