-- Identity store (ADR 0037): private, transactional, device-local.
-- Holds what the device decided on top of the reference store: subjects the
-- reference lacks, local relations, provider bindings, the resolution queue
-- (residuals and conflicts), resolver verdicts, and the provider records plugins
-- claimed (one table, tagged by plugin). Missing evidence never erases
-- a confirmed binding: only positive evidence of an end sets valid_to or status.
-- Portable SQL throughout the backbone stores: ISO-8601 text for dates and
-- instants, JSON as TEXT validated by the store module, FTS5 only in the directory.
-- This file persists on the device and SQLite cannot alter a CHECK, so vocabularies
-- that grow (subject kinds, relation types) are validated by the store module
-- (store.py) and the typed records (vocabulary.py), never here: the DDL keeps
-- format checks only.
--
-- Reading it. Every table and column is explained by a comment inside its CREATE statement, which SQLite keeps:
-- `SELECT name, sql FROM sqlite_master WHERE type = 'table'` explains the store from the store itself, and
-- docs/architecture/identity-data.md has worked read-only queries. Every fact that can change what a subject shows
-- names who stated it (`plugin`, with `source` where it differs), the record (`native_scope` + `native_id`, or
-- `source_record`), when (`retrieved_at`, `decided_at`, `first_seen`/`last_seen`) and the rule or verdict behind a
-- decision (`rule_id`, `verdict_id`). The reference file (reference.sql) holds the open identifiers and subjects;
-- this store holds what the device added to them or decided about them.

CREATE TABLE metadata (  -- facts about the store itself
  key TEXT PRIMARY KEY,           -- schema_version, generation, reference_release, rekeyed_release, vanished_subjects, ingested:<plugin>
  value TEXT NOT NULL             -- plain text or JSON, by key: `generation` counts changes to device subjects, `reference_release` is the reference build the rules last settled against
);

-- Device subjects (schema 6): subjects a plugin introduced that no reference build holds, keyed by their open
-- identifiers or by the provider reference that introduced them (`provisional`). The row is the durable label:
-- its name, kind and attributes stay when the plugin is disabled or removed, so a saved ID keeps resolving.
-- Their identifiers are in device_assertions, the provider records in claims (`device`). Re-pointed with the
-- other subject rows through reference and device aliases (`lifecycle.rekey`).
CREATE TABLE subjects (  -- device subjects: what a plugin's record introduced and no reference build holds
  id TEXT PRIMARY KEY,             -- <kind>:<key scheme>:<key>; a better key later re-keys it (device_aliases)
  kind TEXT NOT NULL,              -- the ID's first segment (schemes.Kind)
  parent_id TEXT,                  -- instrument kinds only: issuer of a security, security of a composite/listing; the one its records name (see claims)
  name TEXT,                       -- the label
  attributes TEXT NOT NULL DEFAULT '{}',  -- JSON: the record's attributes (claims.RecordAttributes: kind, ticker, MICs, currency)
  status TEXT NOT NULL DEFAULT 'active',  -- vocabulary.SubjectStatus
  introduced_by TEXT NOT NULL,     -- the plugin whose record introduced it
  first_seen TEXT NOT NULL,        -- when a record first introduced it
  last_seen TEXT NOT NULL,         -- when a record last stated its label
  CHECK (id LIKE kind || ':%')
);

CREATE TABLE relations (  -- typed edges between two subjects that a plugin stated (a pool part_of its protocol); the reference file holds the build's own
  evidence_id TEXT PRIMARY KEY CHECK (evidence_id LIKE 'ev:%'),  -- hash of type, ends, validity start and source; follows a re-key of an end
  type TEXT NOT NULL,              -- vocabulary.RelationType; its kinds and ratio rules are vocabulary.RELATIONS
  from_id TEXT NOT NULL,           -- the subject the edge starts at (a receipt, a pool)
  to_id TEXT NOT NULL,             -- the subject it points to (the share, the protocol)
  ratio TEXT,                      -- shares per receipt, as text; NULL for other types
  valid_from TEXT,                 -- the dates (YYYY-MM-DD) the plugin says it holds; NULL is open-ended
  valid_to TEXT,                   -- the end of that window
  authority TEXT NOT NULL,         -- the kind of evidence: source_asserted, a plugin's own statement
  source TEXT NOT NULL,            -- the source the plugin says it read
  plugin TEXT NOT NULL,            -- who stated it
  retrieved_at TEXT NOT NULL,      -- when the plugin read it
  source_record TEXT,              -- the record or page that stated it, as the plugin names it (often a URL); NULL where none was given
  source_version TEXT,             -- the source's version, where the plugin states one
  adapter_version TEXT,            -- the plugin adapter version that emitted it; the last three are NULL for rows from before they were kept, until the plugin states the relation again
  CHECK (from_id <> to_id),
  CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to)
);

-- One current binding per provider reference. The market-data read pipeline
-- keeps addressing by provider_ref; the backbone supplies which subject it is.
-- Uniqueness excludes plugin: two clones of one provider cannot both bind the
-- same reference.
CREATE TABLE bindings (  -- which subject a plugin's own reference (a symbol, a FIGI, a pool id) belongs to; only confirmed rows route reads
  id TEXT PRIMARY KEY,             -- a random row id; (provider, native_scope, native_id) is what is unique
  plugin TEXT NOT NULL,            -- whose claim made it
  provider TEXT NOT NULL,          -- the provider's name (provider_ref.provider)
  native_id TEXT NOT NULL,         -- the provider's own id: a symbol, a FIGI, a pool id
  native_scope TEXT NOT NULL,      -- which kind of native id it is; the plugin's contract declares the scopes. The claims row of the same plugin, scope and id is the record
  subject_id TEXT NOT NULL,        -- the subject it is bound to
  kind TEXT NOT NULL,              -- the subject's kind (schemes.Kind)
  status TEXT NOT NULL CHECK (status IN ('candidate', 'confirmed', 'conflicting', 'rejected')),  -- confirmed routes reads; conflicting is contested; rejected is one the user refused; candidate waits
  authority TEXT NOT NULL,         -- the kind of evidence behind it (vocabulary.Authority)
  rule_id TEXT,                    -- versioned rule of a rule_confirmed one: resolve_answer@1 (a resolve answer matched the identifiers), introduced@1 (the plugin's own record introduced the subject)
  evidence_ids TEXT NOT NULL,      -- JSON list: the identifier evidence it rests on (assertions.evidence_id, device_assertions.evidence_id); a verdict or an introduction cites a synthetic ev: ID
  valid_from TEXT,                 -- usually NULL
  valid_to TEXT,                   -- usually NULL
  verified_at TEXT,                -- when core last wrote it or a read check last agreed with it, whichever is later
  decided_at TEXT,                 -- when core decided its current subject and status; later checks leave it; NULL for rows from before it was kept
  verdict_id TEXT REFERENCES verdicts(id),  -- the verdict that confirmed or rejected it (ADR 0012 override)
  UNIQUE (provider, native_scope, native_id),  -- wire qualifiers select reads; they never key identity
  CHECK (subject_id LIKE kind || ':%'),
  CHECK (status <> 'confirmed' OR authority IN ('source_asserted', 'snapshot', 'rule_confirmed', 'model_confirmed',
                                                 'agent_confirmed', 'user_attested', 'curated')),
  CHECK ((authority = 'rule_confirmed') = (rule_id IS NOT NULL))
);
CREATE INDEX bindings_subject ON bindings (subject_id, status);

-- The resolution queue: one core-owned list of residuals (records the join could
-- not place) and conflicts (contradicting evidence). Any resolver the user chose
-- drains it: built-in rules, the Hermes device agent (ADR 0044 J2), or the user.
CREATE TABLE queue (  -- identity questions: what the data leaves undecided or contested; a user's resolved answer is the local override
  id TEXT PRIMARY KEY,             -- a random row id
  key TEXT NOT NULL,               -- QueueItem.key: kind|reason|subjects|scheme|provider ref
  kind TEXT NOT NULL CHECK (kind IN ('residual', 'conflict')),  -- residual: a record could not be placed; conflict: evidence contradicts other evidence
  reason TEXT NOT NULL,            -- one of its kind's reasons (resolution.REASONS), checked by QueueItem
  subject_ids TEXT NOT NULL,       -- JSON list: the subjects it is about; the first is the one the question names
  candidate_ids TEXT NOT NULL DEFAULT '[]',  -- JSON list: the subjects an answer may choose
  evidence_ids TEXT NOT NULL DEFAULT '[]',   -- JSON list: the evidence it cites (assertions.evidence_id, device_assertions.evidence_id)
  plugins TEXT NOT NULL,           -- JSON: the plugins whose claims are involved (two for a cross-plugin conflict); a question core asks about the reference or what plugins state is tagged "reference" first, then those plugins
  provider_ref TEXT,               -- JSON {provider, native_scope, native_id}: the plugin record it is about; NULL for a question about reference data alone
  scheme TEXT,                     -- conflict: the contested scheme
  contested_values TEXT NOT NULL DEFAULT '[]',  -- JSON list: its contested values
  state TEXT NOT NULL CHECK (state IN ('open', 'resolved', 'superseded', 'dismissed')),  -- open; resolved (an answer applies); dismissed (answered "none of these"); superseded (a release or a later answer replaced it)
  opened_at TEXT NOT NULL,         -- when it was first queued on this device
  updated_at TEXT NOT NULL,        -- when it last changed state or was asked again
  resolved_by TEXT                 -- the verdict that settled it
);
CREATE INDEX queue_open ON queue (state, opened_at);
CREATE UNIQUE INDEX queue_open_key ON queue (key) WHERE state = 'open';

-- Every verdict any resolver submitted, with the outcome the authority rule gave it.
CREATE TABLE verdicts (  -- each answer a resolver gave a queue question, with the outcome the authority rule gave it; none is deleted
  id TEXT PRIMARY KEY,             -- a random row id, cited by queue.resolved_by and bindings.verdict_id
  item_id TEXT NOT NULL REFERENCES queue(id),  -- the question answered
  resolver TEXT NOT NULL CHECK (resolver IN ('rules', 'agent', 'plugin', 'user')),  -- who answered; 'user' is the investor in Desk
  plugin TEXT NOT NULL,            -- 'pythia' for core rules, the agent and manual resolution
  authority TEXT NOT NULL CHECK (authority IN ('rule_confirmed', 'model_confirmed', 'model_suggested', 'agent_confirmed',
                                             'user_attested')),  -- the kind of evidence the answer is: user_attested for the investor's, agent_confirmed for the agent's suggestion
  relation TEXT NOT NULL CHECK (relation IN ('same_listing', 'same_composite', 'same_security', 'same_issuer', 'depositary_receipt_of',
                                             'unrelated', 'none', 'ambiguous')),  -- the answer itself (vocabulary.VerdictRelation)
  chosen_id TEXT,                  -- the candidate it chose; NULL for none and ambiguous
  confidence REAL CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),  -- a model verdict's calibrated confidence
  model TEXT,                      -- the model behind an agent or plugin verdict
  prompt_version TEXT,             -- the prompt version of an agent or plugin verdict
  input_digest TEXT,               -- hash of the question view the resolver read
  rule_id TEXT,                    -- a rules verdict's versioned rule
  rationale TEXT,                  -- the resolver's reason, as given
  user_turn TEXT,                  -- the Desk user action behind a user_attested verdict; an agent cannot supply one
  outcome TEXT NOT NULL CHECK (outcome IN ('confirmed', 'suggested', 'blocked', 'ambiguous', 'no_match')),  -- what the authority rule made of it; suggested waits for the user
  created_at TEXT NOT NULL,        -- when it was recorded
  CHECK ((resolver = 'rules' AND authority = 'rule_confirmed' AND rule_id IS NOT NULL)
      OR (resolver = 'agent' AND authority = 'agent_confirmed' AND model IS NOT NULL AND prompt_version IS NOT NULL
          AND input_digest IS NOT NULL)
      OR (resolver = 'plugin' AND authority IN ('model_confirmed', 'model_suggested'))
      OR (resolver = 'user' AND authority = 'user_attested' AND user_turn IS NOT NULL)),
  CHECK (authority NOT IN ('model_confirmed', 'model_suggested')
      OR (confidence IS NOT NULL AND model IS NOT NULL AND prompt_version IS NOT NULL AND input_digest IS NOT NULL)),
  CHECK ((chosen_id IS NULL) = (relation IN ('none', 'ambiguous')))
);
CREATE INDEX verdicts_item ON verdicts (item_id);

-- Provider records plugins claimed (RecordClaim), tagged by plugin. A resolve-only
-- plugin keeps only the records the user opened; a bulk catalogue keeps its pages
-- under a scope. Provider data never leaves the device; a disabled plugin's rows
-- are hidden and its rows are deleted when its credential is removed
-- (DELETE ... WHERE plugin = ?). Claims are subordinate to open reference evidence.
CREATE TABLE claims (  -- the provider records plugins emitted, as emitted, and where core placed each: the evidence behind device subjects and bindings
  plugin TEXT NOT NULL,            -- who emitted the record
  provider TEXT NOT NULL,          -- its provider name
  native_scope TEXT NOT NULL,      -- which kind of native id native_id is (the plugin's contract declares the scopes)
  native_id TEXT NOT NULL,         -- the provider's own id for the record; a record without one is kept under a sha256 digest in scope '#record'
  scope TEXT,                      -- bulk catalogue scope; NULL for a resolve-only pick
  level TEXT NOT NULL,             -- the record's native level (RecordClaim.level)
  name TEXT,                       -- the record's own name
  claim TEXT NOT NULL,             -- the RecordClaim as emitted (claims.batch_to_json form): identifiers with roles, attributes and provenance (source, source_record, adapter_version, retrieved_at)
  claim_digest TEXT NOT NULL,      -- unchanged digest => no re-join
  first_seen TEXT NOT NULL,        -- when core first stored it
  last_seen TEXT NOT NULL,         -- last stored; for `not_seen`, when a complete scope lacked it (not delisted; never unbinds)
  subject_id TEXT,                 -- the subject the record joined or introduced; NULL until core ingests it
  state TEXT,                      -- how it was placed (device.CLAIM_STATES): joined an existing subject by identifier agreement, introduced one, conflict (kept beside the others, nothing re-parented), unmatched, not_seen; NULL until core ingests it
  PRIMARY KEY (plugin, native_scope, native_id)
);

-- Negative resolve results: a plugin's resolve found nothing (or failed) for a subject.
-- The page shows the section unresolved until the entry expires, instead of calling again.
CREATE TABLE resolve_misses (  -- a plugin's lookup found nothing for a subject: its section stays unresolved until expiry
  subject_id TEXT NOT NULL,        -- the subject looked up
  plugin TEXT NOT NULL,            -- the plugin that was asked
  reason TEXT NOT NULL,            -- why nothing was found, as the page shows it
  expires_at TEXT NOT NULL,        -- when it may be asked again: a day after a no match, ten minutes after a timeout
  PRIMARY KEY (subject_id, plugin)
);

-- Added within schema 6 (additive and idempotent: every open applies what follows this line, a migration before
-- it copies rows).
-- Read checks (ADR 0037, rule read_check@1): what a source stated about itself when read for a subject (a claim
-- about that subject), against the reference. A page label and evidence for the reference's rework, never a
-- binding. Re-pointed through id_aliases with the other subject rows.
CREATE TABLE IF NOT EXISTS read_checks (  -- what a price source stated about itself when read for a subject, against the reference
  subject_id TEXT NOT NULL,        -- the subject read
  provider TEXT NOT NULL,          -- the source's provider, and with the next two the reference it was read through
  native_scope TEXT NOT NULL,      -- the kind of native id
  native_id TEXT NOT NULL,         -- the provider's id (a symbol, a FIGI)
  plugin TEXT NOT NULL,            -- the plugin that read it
  stated TEXT NOT NULL,            -- JSON: what the read stated, e.g. {"currency": "EUR", "venue": "MUN", "operating_mic": "XMUN"}
  differs TEXT NOT NULL,           -- JSON list: the stated attributes the reference gives otherwise ("venue", "currency")
  note TEXT,                       -- why the last read did not verify ("venue differs"); NULL if it did
  checked_at TEXT NOT NULL,        -- when the last read was checked
  verified_at TEXT,                -- the last read that agreed on all it stated
  PRIMARY KEY (subject_id, provider, native_scope, native_id)
);

-- A plugin's identifiers for device subjects (`device`): the join index by (scheme, value) and the evidence a
-- device subject's page weighs as the package's. Only `self` values identify their subject (at the
-- scheme's own level); `underlying` and `unqualified` ones are kept for the join. A plugin's statements count as
-- `source_asserted`. The evidence ID hashes the assertion with its subject, so a re-key gives it a new one.
CREATE TABLE IF NOT EXISTS device_assertions (  -- identifiers a plugin's record states for a subject
  evidence_id TEXT PRIMARY KEY CHECK (evidence_id LIKE 'ev:%'),  -- hash of the assertion with its subject
  subject_id TEXT NOT NULL,        -- the subject it identifies, at the scheme's own level
  scheme TEXT NOT NULL,            -- schemes.Scheme: isin, lei, figi, ...
  value TEXT NOT NULL,             -- the normalized identifier
  role TEXT NOT NULL,              -- vocabulary.IdentifierRole
  plugin TEXT NOT NULL,            -- who stated it
  native_scope TEXT NOT NULL,      -- the plugin's record that states it: claims has it under (plugin, native_scope, native_id)
  native_id TEXT NOT NULL,         -- the record's id
  retrieved_at TEXT NOT NULL       -- when the plugin read the record (its provenance)
);
CREATE INDEX IF NOT EXISTS device_assertions_value ON device_assertions (scheme, value);
CREATE INDEX IF NOT EXISTS device_assertions_subject ON device_assertions (subject_id);

-- A device subject's earlier IDs: a better key re-keys it upward, never down. Followed after the reference's
-- id_aliases (`device.current_id`); `lifecycle.rekey` re-points the rows that name the old ID.
-- Lookups core's ingest makes on every record (ADR 0037, amendment "ingest"): a record's earlier statements, a
-- subject's relations and children, and the records placed on a subject. Indexes only: no schema change.
CREATE INDEX IF NOT EXISTS device_assertions_record ON device_assertions (plugin, native_scope, native_id);
CREATE INDEX IF NOT EXISTS relations_from ON relations (from_id, type);
CREATE INDEX IF NOT EXISTS relations_to ON relations (to_id);
CREATE INDEX IF NOT EXISTS subjects_parent ON subjects (parent_id);
CREATE INDEX IF NOT EXISTS claims_subject ON claims (subject_id);

CREATE TABLE IF NOT EXISTS device_aliases (  -- a device subject's earlier ID and the one it reads as now
  old_id TEXT PRIMARY KEY,         -- the ID a saved reference may still hold
  new_id TEXT NOT NULL,            -- the better key it became
  at TEXT NOT NULL,                -- when core recorded the re-key
  CHECK (old_id <> new_id)
);

-- The investor's own corrections to the catalogue (ADR 0044, amendment "user catalogue corrections"): a local override
-- applied on every read above the reference, the plugins and the user's answers to questions. No ingested row is
-- changed, so a sync cannot revive what one overrode. Only the Desk makes one `active`; the agent can only propose.
-- A row is never deleted: an undone, declined or replaced one stays as history. `kind` is validated by
-- identity/corrections.py (identifier and price_source are read; parent and detach are reserved).
CREATE TABLE IF NOT EXISTS corrections (  -- the investor's fixes to the catalogue, and the agent's proposals waiting for them
  id TEXT PRIMARY KEY,             -- a random row id
  kind TEXT NOT NULL,              -- identifier: set or remove one scheme of a subject; price_source: pin a plugin as its price source; parent, detach: reserved
  subject_id TEXT NOT NULL,        -- the subject it is about, at the level the scheme identifies (a pin: a listing or a security, covering its lines); follows a re-key
  scheme TEXT,                     -- identifier: which scheme (schemes.Scheme); NULL for the other kinds
  value TEXT,                      -- identifier: the new value, NULL to remove it; price_source: the plugin's contract name; parent: the security a listing moves to
  plugin TEXT,                     -- detach only: the plugin whose record is ignored; with the next two, the `claims` key of that record
  native_scope TEXT,               -- detach only
  native_id TEXT,                  -- detach only
  state TEXT NOT NULL CHECK (state IN ('proposed', 'active', 'undone')),  -- proposed: the agent's, applies to nothing; active: applies; undone: undone, declined or replaced
  proposed_by TEXT,                -- 'agent' for a proposal; NULL for one the investor made in Desk
  note TEXT,                       -- why, as the investor or the agent gave it
  created_at TEXT NOT NULL,        -- when it was written
  decided_at TEXT,                 -- when the investor made, confirmed or declined it
  ended_at TEXT,                   -- when it was undone, declined or replaced
  user_turn TEXT,                  -- the Desk action behind it; an agent cannot supply one, so it cannot make a row active
  replaces TEXT REFERENCES corrections(id),  -- the active correction of the same fact this one took the place of
  CHECK (state <> 'active' OR user_turn IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS corrections_subject ON corrections (subject_id, state);

-- The `unaudited` residual is gone (ADR 0044, amendment of 2026-09-30: installing a plugin means trusting it). One an
-- earlier Pythia queued stays in the history under a reason this core reads, and is no longer open.
UPDATE queue SET reason = 'no_key', state = CASE WHEN state = 'open' THEN 'superseded' ELSE state END
  WHERE reason = 'unaudited';

-- Relation claims whose end no subject answers yet (`pending`): a link-only plugin that synced before the plugins that
-- introduce its tokens. Kept as the plugin emitted them and placed, into `relations`, when a later batch introduces or
-- joins a subject the end names, so the edges do not depend on which plugin syncs first. A claim waits under one row
-- per unplaced end.
CREATE TABLE IF NOT EXISTS pending_relations (  -- relation claims waiting for an end to name a subject
  plugin TEXT NOT NULL,            -- who stated it
  relation TEXT NOT NULL,          -- digest of its type, ends, validity start and source: the claim apart from when it was read
  waits_for TEXT NOT NULL,         -- an end no subject answers yet: 'scheme:value' for an identifier, 'ref:<plugin>:<scope>:<id>' for the plugin's own record
  claim TEXT NOT NULL,             -- the RelationClaim as emitted (claims.batch_to_json form), its latest statement
  PRIMARY KEY (plugin, relation, waits_for)
);
CREATE INDEX IF NOT EXISTS pending_relations_waits ON pending_relations (waits_for);
