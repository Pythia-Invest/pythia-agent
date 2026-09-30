# Identity data: where a fact comes from

Pythia keeps what it knows about investments in two SQLite files. Both are
ordinary data you can read with any SQLite client, and every fact that can
change what a subject shows carries who stated it, which record, when, and the
rule or answer behind a decision. This page says where the files are, what each
table holds, and how to answer the questions people actually ask ("why is this
price from that source?", "who says this ISIN belongs here?") with read-only
queries. [ADR 0037](../decisions/0037-identity-backbone.md) records the model.
Tests run every query below against a fixture device, so an example cannot go
stale silently.

## Where the data is

| File | Holds | Written by |
| --- | --- | --- |
| `<data>/store/identity.sqlite3` | What this device added to the reference or decided about it: plugin records and identifiers, subjects plugins introduced, plugin relations, bindings, questions, the user's answers and the user's corrections | Core, while Pythia runs |
| The installed reference package's database, `<data>/store/reference/packages/<build>-<checksum>/reference-<date>.sqlite3` | The open identifiers and subjects a build read from public sources | The reference builder; core installs it and never writes it |

`<data>` is the `PYTHIA_DATA_ROOT` the lifecycle gives Hermes (`just dev-paths`
prints a development stack's). `reference/installed.json` names the current
package, and that package's `package.json` names its database file.

Three things that also change what a subject shows live outside the stores:

- `source_order` in `settings.json` in the Pythia config folder: the investor's
  preferred sources, first choice first.
- Which plugins are enabled, in the profile's Hermes `config.yaml`
  (`plugins.enabled`, `plugins.disabled`; `hermes plugins list` shows them).
- Each plugin's `contract.json`: what it covers, how core addresses it
  (`addressing`: native scopes, `mic_table`, `subjects`) and what it introduces.

## Reading the stores

Open `identity.sqlite3` read-only and attach the reference as `ref`. Every query
below assumes this connection.

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

The `sqlite3` shell does the same: `sqlite3 -readonly <identity.sqlite3>`, then
`ATTACH 'file:<reference database>?mode=ro' AS ref;`. Nothing here writes. Do
not open either file read-write: core holds the identity store open, and the
reference is replaced whole on each install.

Each table and column is explained by a comment inside its `CREATE` statement,
which SQLite keeps: `SELECT name, sql FROM sqlite_master WHERE type = 'table'`
(and `ref.sqlite_master`) prints them. A reference package built before those
comments were added has none; the tables below cover it.

Subject IDs are `<kind>:<key scheme>:<key>` (`listing:isin:<ISIN>:<MIC>:<currency>`,
`security:isin:<ISIN>`, `issuer:lei:<LEI>`), so an ID says how it was keyed. A
saved ID can be older than the data: `id_aliases` (reference) and
`device_aliases` (identity) say what it is now.

### The reference file

| Table | Holds |
| --- | --- |
| `release` | The build: its ID, date and `sources`, one entry per source file read, with URL, version, retrieval time, checksum and licence |
| `issuers` | Companies, keyed by LEI (else CIK) |
| `securities` | Share classes, funds, crypto assets; `issuer_id` is the company |
| `composites` | A country's consolidated line of a security |
| `listings` | Venue lines and crypto deployments: ticker, MIC, currencies, status; `security_id` is the security |
| `assertions` | Who says which identifier belongs to which subject: value, `source`, `authority`, `source_record`, `retrieved_at` |
| `relations` | Typed edges (a receipt and its share, a wrapped coin and its asset) with the same provenance columns |
| `names` | Former names and brands, for search only |
| `id_aliases` | An earlier subject ID and the one it is now |
| `venues` | ISO 10383 venues |
| `chains` | Blockchains crypto deployments name |
| `source_corrections` | Where the build stated a value instead of what its source states, because the source is wrong: the original and the reason (a package built before it has no such table) |

Search's index is built from these tables once per reference file, with the
device's subjects laid over it. A security or listing whose `status` is
`inactive` is in the index, and one whose own status is `inactive` (a delisted line,
as the price guards read it) is marked `delisted`; an active line under an inactive
security is live and unmarked, and stays out of the page's lines. It is found by
name, ticker and identifier, ranked below live lines (a company with a live line
before one with only delisted lines, and within a company its live lines first),
and hidden only when a search asks for `include_delisted: false`. The page's
listing selector and the line a security page prices through leave out delisted
lines and lines under an inactive security, as before. A security none of whose lines has a ticker is in the index
as one row through its primary line (else the first by id), marked `no_ticker`,
found by name and identifier and ranked below lines that have a ticker; it too
stays out of the page's listings. A line with no ticker of a security that has
one is not a row.

### The identity store

| Table | Holds |
| --- | --- |
| `metadata` | Facts about the store itself (schema version, the release last settled against) |
| `claims` | Each provider record a plugin emitted, as emitted, and where core placed it (`state`, `subject_id`) |
| `device_assertions` | The identifiers those records state for a subject |
| `subjects` | Subjects a plugin introduced that the reference lacks: label, kind, `parent_id`, `introduced_by` (who arrived first; the name comes from the enabled plugin first in `source_order`, else by plugin id, while `status` and `attributes` come from the introducer's own record) |
| `device_aliases` | A device subject's earlier ID and its better key |
| `relations` | Typed edges a plugin stated (a pool `part_of` its protocol) |
| `pending_relations` | Relation claims waiting for an end no subject names yet (a market that points at a token another plugin has not introduced); placed into `relations` when one does, and gone once placed |
| `bindings` | Which subject a plugin's own reference (a symbol, a FIGI, a pool ID) belongs to; only confirmed rows route reads |
| `queue` | Questions the data leaves open: a record core could not place, or contradicting evidence |
| `verdicts` | Every answer to a question, the user's included; a user's resolved answer is the local override |
| `corrections` | The investor's own fixes (an identifier set or removed, a pinned price source) and the agent's proposals waiting for them; the state says which apply |
| `resolve_misses` | A plugin's lookup found nothing: why a section stays unresolved, until the row expires |
| `read_checks` | What a price source stated about itself when read, against the reference |

## What each fact carries

| Fact | Table | Who | Record | When | Rule or answer |
| --- | --- | --- | --- | --- | --- |
| An identifier of a reference subject | `ref.assertions` | `source` | `source_record` names the link or rule for a derived value; a plain read has none | `retrieved_at` is the build's read; file dates are in `ref.release` | `authority`; the rule is in `source_record` |
| A relation in the build | `ref.relations` | `source` | `source_record` | `retrieved_at` | `authority`; the rule is in `source_record` |
| An identifier a plugin stated | `device_assertions` | `plugin` | `native_scope` and `native_id`, which key its `claims` row | `retrieved_at` | always a plugin's own statement |
| A plugin's record and its placement | `claims` | `plugin` | `native_scope` and `native_id`; the `claim` JSON holds the record's own provenance, `source_record` and `adapter_version` included | `first_seen`, `last_seen` | `state`: joined, introduced, conflict, unmatched or not_seen; for an unmatched record the plugin's own reason, where it gives one, is `attributes.venue_note` in the `claim` JSON. Search reads the record's `attributes.aliases` from it beside `name`: other names for the subject the record is placed on, findable while its plugin is enabled and the record is not a conflict |
| A plugin relation | `relations` | `plugin`, `source` | `source_record`, `source_version`, `adapter_version` | `retrieved_at` | `authority` |
| A plugin relation still waiting for an end | `pending_relations` | `plugin` | the `claim` JSON, with the plugin's own provenance, `source_record` included | `retrieved_at` in the `claim` JSON | `waits_for`: the end no subject names yet |
| A subject a plugin introduced, and its parent | `subjects` | `introduced_by` | its `claims` rows (`subject_id`) | `first_seen`, `last_seen` | the claim's `state` |
| A binding | `bindings` | `plugin` | `provider`, `native_scope`, `native_id`: the `claims` key | `decided_at` (the current decision), `verified_at` (last write or agreeing read check) | `rule_id` or `verdict_id`, and `authority` |
| A question | `queue` | `plugins` (`reference` first where the build or core's own conflict check asked, then the plugins whose statements it is about) | `provider_ref`, `evidence_ids` | `opened_at`, `updated_at` | `reason` |
| An answer | `verdicts` | `resolver`, `plugin`, `model` | `item_id`, `chosen_id` | `created_at` | `rule_id`, `user_turn`, `authority`, `outcome` |
| A source correction | `claims` (`attributes.source_corrections` in the `claim` JSON); `ref.source_corrections` | the `plugin`, or the build's `source` | `subject_id`, `field` (the source's own field for the build's) | as the record's own provenance; `retrieved_at` of the build | `original` and `reason`; always `source_asserted` |
| A user catalogue correction | `corrections` | the investor (`user_turn`), or the agent that proposed it (`proposed_by`) | `subject_id`, `scheme`, `value` | `created_at`, `decided_at`, `ended_at` | `state`; `replaces` names the one it took the place of |

`authority` is the kind of evidence, never where it came from: `source_asserted`
(a source's own record), `rule_confirmed` (a named rule), `user_attested` (the
user) and the agent's `agent_confirmed`, which only suggests.

## Questions

The queries take named parameters (`:subject` and so on); give them with
`db.execute(sql, {"subject": "…"})`. Subject IDs come from `pythia_find`, a Desk
URL or a saved setting.

### The subject's family

Most questions are about a listing and the security and issuer above it. This
returns the IDs as a JSON list, passed on as `:family` below. It reads the
reference for a reference subject and `subjects.parent_id` for a device subject:
the stored structure, before any answer of the user's that moved a link (see
[the answers](#which-answers-and-overrides-apply)).

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

### Where does this price come from, and why that source?

A source serves a line when it is enabled and configured, covers the asset class
and market, and can address the line; the first such source in the investor's
order, then Pythia's default order for the concept (free before paid), serves,
and the rest are listed as skipped with the reason
([ADR 0040](../decisions/0040-data-concepts-and-agent-tools.md)). The decision
itself is computed: the `sources` list of `pythia_instrument` names, for each
concept, the source that serves, its `reference`, and every skipped source with
its reason (not covering, not addressable, disabled, needs configuration,
conflict, suspended). The stores hold what the decision reads.

What the line is:

```sql
-- example: listing
SELECT id, ticker, mic, operating_mic, currency, trading_currency, status, is_primary
FROM ref.listings WHERE id = :subject;
```

A confirmed binding addresses the line through one plugin's own reference, and
says who made it and how (`rule_id` is the rule, `verdict_id` the answer):

```sql
-- example: bindings
SELECT subject_id, plugin, provider, native_scope, native_id, status, authority, rule_id, verdict_id,
       decided_at, verified_at
FROM bindings WHERE subject_id IN (SELECT value FROM json_each(:family))
ORDER BY subject_id, plugin;
```

With no binding the address is derived without a call, from the ticker and venue
above: a plugin whose `contract.json` lists the operating MIC in
`addressing.mic_table` adds that suffix to the ticker (a listing `7203` on
operating MIC `XJPX` is `7203.T` for a plugin that maps `XJPX` to `.T`), and a
plugin that does not list the venue skips the line as not addressable. A line
whose `status` is `inactive` is never addressed by ticker, since the ticker may
name another company now; a confirmed ticker binding on it is kept and
suspended. Search still finds it (next section), so a delisted instrument can be
opened and read, but its page gets no live price through that ticker. The order and the plugins' state are in the files named
[above](#where-the-data-is).

### Who says this identifier belongs to this subject?

Every statement of a value, in both stores, with its source, record and time:

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

Every identifier of the family, by source (a plugin's record is the URL or page
it gave, where it gave one):

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

A contested fact is one single-valued scheme whose current values differ
between sources. Core applies none of the values and asks the user once the
subject is opened ([ADR 0044](../decisions/0044-product-direction.md), A2). The
query applies the same tests: only values inside their validity dates count,
each source's set of values is compared, and `ticker_mic` is an attribute that
never contests. One source's own several values are not a contest, and neither
is several sources stating the identical set: OpenFIGI states two composite
FIGIs for some composites (10,288 in the 2026-09-28 build), and a plugin that
states the same two beside the package contests nothing. Sets that differ at
all do contest, a subset included, because every scheme but `ticker_mic` is
single-valued.

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

### Why is this listing under that security, and that security under that issuer?

The reference's links are columns, not rows of their own. A listing's ID spells
out its security's key, and an issuer's ID its LEI or CIK; the evidence is the
identifier rows above (the security's ISIN from `esma_firds`, the issuer's LEI
from `gleif` or FIRDS) and, for a depositary receipt, a relation. A device
subject's parent is the one its plugin's records name.

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

The typed edges around the family (a receipt of a share, a pool part of a
protocol, a coin and the market that holds it):

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

A relation whose end no subject names yet is not among those edges: it waits, as the plugin
stated it, until a record names that end (`pending_relations`; ADR 0037, amendment "ingest results do not depend on
which plugin syncs first"). To see what an edge is waiting for:

```sql
-- example: waiting-relations
SELECT plugin, waits_for, json_extract(claim, '$.type') AS type,
       json_extract(claim, '$.provenance.source_record') AS source_record
FROM pending_relations WHERE plugin = :plugin ORDER BY waits_for;
```

### Why was this record not placed?

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

### What did a plugin add or change?

`:plugin` is the `plugin` of its `contract.json` (`pythia-openfigi`), which the
device store holds. The package names its sources by the contract's `provider`
(`openfigi`).

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
its subject and bindings stay.

The reference's sources are plugins of a build, and the same question about one
(`:source` is `esma_firds`, `gleif`, `openfigi`, `sec`, `sec_funds` or `pythia`)
counts what it contributed; `ref.release` has the files:

```sql
-- example: source-added
SELECT 'assertions' AS what, scheme AS kind, authority, count(*) AS rows
FROM ref.assertions WHERE source = :source GROUP BY scheme, authority
UNION ALL SELECT 'relations', type, authority, count(*) FROM ref.relations WHERE source = :source GROUP BY type, authority;
```

### Which facts about this subject come from one plugin?

Asked about a subject and a source ("which facts about Toyota come from
OpenFIGI?"), always read both stores: the reference package holds what the
build's source stated, and the device store holds what the plugin stated
since, including the lines it introduced and the identifiers it states on
the package's own subjects. One store alone misses half the answer. The two
stores name the source differently: `:plugin` is the `plugin` of its
`contract.json` (`pythia-openfigi`), which every device row holds, and
`:source` is the contract's `provider` (`openfigi`), which the package's rows
hold. `:family` is the subject's family (above); the query widens it to
everything below it (an issuer's securities, a security's listings, a
device subject's children), since a plugin often introduced a line. A plugin
that states every listing of a large issuer returns many rows: pass a
listing's family to narrow it.

```sql
-- example: plugin-facts
WITH RECURSIVE tree(id) AS (
  SELECT value FROM json_each(:family)
  UNION SELECT s.id FROM ref.securities s, tree WHERE s.issuer_id = tree.id
  UNION SELECT l.id FROM ref.listings l, tree WHERE l.security_id = tree.id
  UNION SELECT c.id FROM subjects c, tree WHERE c.parent_id = tree.id)
SELECT 'reference' AS store, 'identifier' AS what, subject_id AS subject, scheme || ' ' || value AS fact,
       source_record, retrieved_at AS at
FROM ref.assertions WHERE source = :source AND subject_id IN (SELECT id FROM tree)
UNION ALL SELECT 'reference', 'relation ' || type, from_id, to_id, source_record, retrieved_at
FROM ref.relations WHERE source = :source AND (from_id IN (SELECT id FROM tree) OR to_id IN (SELECT id FROM tree))
UNION ALL SELECT 'device', 'subject introduced', id, name, NULL, first_seen
FROM subjects WHERE introduced_by = :plugin AND id IN (SELECT id FROM tree)
UNION ALL SELECT 'device', 'identifier', d.subject_id, d.scheme || ' ' || d.value,
       json_extract(c.claim, '$.provenance.source_record'), d.retrieved_at
FROM device_assertions d
LEFT JOIN claims c ON c.plugin = d.plugin AND c.native_scope = d.native_scope AND c.native_id = d.native_id
WHERE d.plugin = :plugin AND d.subject_id IN (SELECT id FROM tree)
UNION ALL SELECT 'device', 'record ' || coalesce(state, 'unplaced'), subject_id, native_scope || ':' || native_id,
       json_extract(claim, '$.provenance.source_record'), last_seen
FROM claims WHERE plugin = :plugin AND subject_id IN (SELECT id FROM tree)
UNION ALL SELECT 'device', 'relation ' || type, from_id, to_id, source_record, retrieved_at
FROM relations WHERE plugin = :plugin AND (from_id IN (SELECT id FROM tree) OR to_id IN (SELECT id FROM tree))
ORDER BY 1, 3, 2, 4;
```

### Which answers and overrides apply?

The user's answers are the local overrides: a resolved answer applies, and every
read applies it until the user reopens the question. The same question, answered
"none of these", is dismissed:

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

A receipt has the issuer the user chose for the share it represents
(ESMA Q&A 1503: a receipt's issuer is its underlying's), unless the user
answered the receipt's own issuer ("none of these" included). The receipt's page shows it, and its
`issuer` carries `inherited_from` (the share and the user's verdict). It applies
only where a source states the underlying (`relations` with `authority =
'source_asserted'`; not one the builder derived from the issuer) or the user
answered it, and no enabled plugin contradicts it. The share's answer is the row
above, so include the share in `:family` to see it; undoing it undoes the
inheritance.

The agent's answers are suggestions and stay in `verdicts` (`resolver = 'agent'`,
`outcome = 'suggested'`) until the user confirms. A binding the user made
carries `authority = 'user_attested'` and its `verdict_id`.

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

### Which corrections apply?

A correction is a fix the investor made on purpose when a source is wrong and
they keep using it: an identifier set or removed (`kind = 'identifier'`, a NULL
`value` is a removal), or a plugin pinned as the price source of a line or a
security (`kind = 'price_source'`, `value` is the plugin's contract name). Only
rows whose `state` is `active` apply: they win over the reference, every plugin
and the answers above, on every read, and change no row of the stores the
sources wrote, so a sync does not revive what one overrode. A `proposed` row is
the agent's suggestion and applies to nothing until the investor confirms it in
Repairs; an `undone` row was undone, declined or replaced (`replaces` on the
newer row names it) and stays as history. The kinds `parent` and `detach` are
reserved and not read yet.

A correction marks a plugin or source issue worth investigating. Each one stays
visible in the raw data so it can be reviewed and retired once the plugin is
fixed.

```sql
-- example: corrections
SELECT id, kind, subject_id, scheme, value, state, proposed_by, note, decided_at, ended_at, replaces
FROM corrections
WHERE subject_id IN (SELECT value FROM json_each(:family))
ORDER BY created_at;
```

A correction follows its subject when a release or a better key re-keys it, so
`:family` holds the current ID. The identifier shown on the subject's page cites
the correction: `pythia_instrument`'s `provenance` has `plugin = 'user'` and the
correction's `id`.

### Which values did a plugin correct, and what did its source originally say?

A source is sometimes wrong in a way its own plugin or builder adapter can
show: a depositary receipt carrying another company's LEI, a name with a typo. The
plugin or adapter then states the corrected value in the record and keeps what
the source said and why that is wrong (`SourceCorrection`: `field`, `original`,
`reason`). The authority stays `source_asserted`: the value is still that source's
record as its adapter reads it, and the original stays readable beside it. A
plugin's corrections are in its record's `attributes.source_corrections` in the `claim`
JSON of `claims`; the reference build's are in `ref.source_corrections`, which a
package built before it lacks (then the query fails with "no such table": leave
its second half out). `value` is what the record states now (empty for a retraction, where the source's statement is
wrong and no right value exists), and `original` is
what the source stated, exactly as the source wrote it, so it can be reported. A
correction applies only while the source still states the original; when the
source fixes its error the raw value passes through and the build counts the
entry as stale in its manifest, the signal to retire it. The page's `source_corrected` list shows the same
rows.

```sql
-- example: source-corrections
SELECT 'device' AS store, c.plugin AS who, c.subject_id, json_extract(f.value, '$.field') AS field,
       json_extract(f.value, '$.original') AS original,
       coalesce(json_extract(c.claim, '$.attributes.' || json_extract(f.value, '$.field')),
                (SELECT json_extract(i.value, '$.value') FROM json_each(c.claim, '$.identifiers') i
                 WHERE json_extract(i.value, '$.scheme') = json_extract(f.value, '$.field')
                   AND coalesce(json_extract(i.value, '$.role'), 'self') = 'self')) AS value,
       json_extract(f.value, '$.reason') AS reason
FROM claims c, json_each(c.claim, '$.attributes.source_corrections') f
WHERE c.subject_id IN (SELECT value FROM json_each(:family))
UNION ALL
SELECT 'reference', source, subject_id, field, original, value, reason
FROM ref.source_corrections WHERE subject_id IN (SELECT value FROM json_each(:family));
```

## How open questions get resolved (decided, not built)

Today an open question stays open until the investor answers it, and the page
shows an open data conflict linked to its repair where the held-back fact would
be. The direction for resolving the rest is decided in
[ADR 0044](../decisions/0044-product-direction.md#amendment-2026-09-30-who-fixes-what-is-wrong-and-how-the-device-agent-judges-the-rest) and none of it is built yet, so every
query above still describes what the stores hold:

- **The plugin that owns the data fixes it.** A misread is a plugin bug, a known
  error in a source becomes a labelled source correction inside that source's plugin
  with the original value kept visible and the error reported to the source, and
  a missing fact is fixed by the plugin stating more. One plugin never patches
  another's data.
- **The device agent judges what is left, one question type at a time,** each
  with a prompt, a gold set and a calibrated threshold. A verdict at or above the
  threshold will apply for read-only use (search, pages, research), labelled and
  undoable in one click, and cite its evidence. Below the threshold, or for
  anything that touches real money, it stays a suggestion the investor confirms.
  The verdict ledger will record the facts each decision used.
- **Repeated decisions become plugin rules,** and opt-in reports carrying
  identifiers and reasoning, never positions, go to the plugin's maintainer.

## What is not stored

Some explanations are computed or implicit, and the stores do not record them:

- **Which source serves now.** The choice is recomputed from the order, the
  plugins' state and coverage on every read, so it is not a row. A derived
  address is likewise computed from the ticker, the venue and the contract.
  `pythia_instrument` gives the result; the files named above give its inputs.
- **Why a reference link holds.** `listings.security_id`, `securities.issuer_id`
  and `composites.security_id` carry no source. A build that names an issuer
  from one source's LEI and another's receipt looks the same in the column, and
  a security's kind, status and a listing's primary flag and trading currency
  are not attributed per field. The identifier rows and the build's questions
  (`issuer_identity`, `receipt_underlying`) are the evidence. Recording the
  basis of each link is a reference-format change, which no package has made.
- **Which provider record a reference identifier came from.** `source_record`
  is set for a named link or rule, not for a value read as it stands; the
  provider's own publishing dates are in `ref.release`, per source file, and
  `retrieved_at` is the build's read, not the provider's.
- **Rows from before a column existed.** Plugin relations made before
  `source_record`, `source_version` and `adapter_version` were kept have NULL
  there until their plugin states the relation again (a sync fills them), and
  bindings made before `decided_at` keep NULL: the time is not recoverable.
  Those columns are added to an existing store the next time core opens it
  (they are additive, so an older Pythia still reads the store).

## Keeping this true

`runtime/test/python/test_identity_data.py` builds a device (a reference
package, plugins, a binding, a contested identifier, a user's answer and
corrections), runs the snippet and each example above against it, and checks
that the tables named here are the tables the stores have. A schema change that adds a table or
column needs its row here and its comment in `identity/sql/`.

The agent reads the same queries from `references/queries.md` of its
`pythia:identity-data` skill, which core ships (this page is not part of the
installed product). The test checks that the two files hold identical snippet
and queries and runs the agent's copy, so change both together. The skill tells
the agent that "which facts about this subject come from that plugin" is one
question over both stores (`plugin-facts`): the package and the device.
