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

CREATE TABLE metadata (
  key TEXT PRIMARY KEY,           -- schema_version, generation, reference_release, rekeyed_release, vanished_subjects
  value TEXT NOT NULL
);

-- Subjects no reference build knows yet: IDs derived from their open identifiers,
-- or provisional IDs derived from the provider reference that introduced them.
-- Descriptive provider fields stay in the plugin-tagged claims table below.
-- Not re-pointed through id_aliases yet: nothing writes local subjects or relations.
CREATE TABLE subjects (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,              -- the ID's first segment (schemes.Kind)
  parent_id TEXT,                  -- instrument kinds only: issuer of a security, security of a composite/listing
  created_by TEXT NOT NULL,        -- plugin id or 'agent'
  created_at TEXT NOT NULL,
  CHECK (id LIKE kind || ':%')
);

CREATE TABLE relations (
  evidence_id TEXT PRIMARY KEY CHECK (evidence_id LIKE 'ev:%'),
  type TEXT NOT NULL,              -- vocabulary.RelationType; its kinds and ratio rules are vocabulary.RELATIONS
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  ratio TEXT,
  valid_from TEXT,
  valid_to TEXT,
  authority TEXT NOT NULL,
  source TEXT NOT NULL,
  plugin TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  CHECK (from_id <> to_id),
  CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to)
);

-- One current binding per provider reference. The market-data read pipeline
-- keeps addressing by provider_ref; the backbone supplies which subject it is.
-- Uniqueness excludes plugin: two clones of one provider cannot both bind the
-- same reference.
CREATE TABLE bindings (
  id TEXT PRIMARY KEY,
  plugin TEXT NOT NULL,            -- whose claim made it
  provider TEXT NOT NULL,
  native_id TEXT NOT NULL,
  native_scope TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  kind TEXT NOT NULL,              -- the subject's kind (schemes.Kind)
  status TEXT NOT NULL CHECK (status IN ('candidate', 'confirmed', 'conflicting', 'rejected')),
  authority TEXT NOT NULL,
  rule_id TEXT,                    -- versioned rule for T1, e.g. 'ticker_mic@1'
  evidence_ids TEXT NOT NULL,
  valid_from TEXT,
  valid_to TEXT,
  verified_at TEXT,                -- last positive verification (e.g. a resolve-only quote check)
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
-- drains it: built-in rules, the Hermes agent, a resolver plugin, or the user.
CREATE TABLE queue (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,               -- QueueItem.key: kind|reason|subjects|scheme|provider ref
  kind TEXT NOT NULL CHECK (kind IN ('residual', 'conflict')),
  reason TEXT NOT NULL,            -- one of its kind's reasons (resolution.REASONS), checked by QueueItem
  subject_ids TEXT NOT NULL,
  candidate_ids TEXT NOT NULL DEFAULT '[]',
  evidence_ids TEXT NOT NULL DEFAULT '[]',
  plugins TEXT NOT NULL,           -- JSON: the plugins whose claims are involved (two for a cross-plugin conflict)
  provider_ref TEXT,
  scheme TEXT,                     -- conflict: the contested scheme
  contested_values TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL CHECK (state IN ('open', 'resolved', 'superseded', 'dismissed')),
  opened_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_by TEXT                 -- the verdict that settled it
);
CREATE INDEX queue_open ON queue (state, opened_at);
CREATE UNIQUE INDEX queue_open_key ON queue (key) WHERE state = 'open';

-- Every verdict any resolver submitted, with the outcome the authority rule gave it.
CREATE TABLE verdicts (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES queue(id),
  resolver TEXT NOT NULL CHECK (resolver IN ('rules', 'agent', 'plugin', 'user')),
  plugin TEXT NOT NULL,            -- 'pythia' for core rules, the agent and manual resolution
  authority TEXT NOT NULL CHECK (authority IN ('rule_confirmed', 'model_confirmed', 'model_suggested', 'agent_confirmed',
                                             'user_attested')),
  relation TEXT NOT NULL CHECK (relation IN ('same_listing', 'same_composite', 'same_security', 'same_issuer', 'depositary_receipt_of',
                                             'unrelated', 'none', 'ambiguous')),
  chosen_id TEXT,
  confidence REAL CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  model TEXT,
  prompt_version TEXT,
  input_digest TEXT,
  rule_id TEXT,
  rationale TEXT,
  user_turn TEXT,                  -- the Desk user action behind a user_attested verdict; an agent cannot supply one
  outcome TEXT NOT NULL CHECK (outcome IN ('confirmed', 'suggested', 'blocked', 'ambiguous', 'no_match')),
  created_at TEXT NOT NULL,
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
CREATE TABLE claims (
  plugin TEXT NOT NULL,
  provider TEXT NOT NULL,
  native_scope TEXT NOT NULL,
  native_id TEXT NOT NULL,
  scope TEXT,                      -- bulk catalogue scope; NULL for a resolve-only pick
  level TEXT NOT NULL,             -- the record's native level (RecordClaim.level)
  name TEXT,
  claim TEXT NOT NULL,             -- the RecordClaim as emitted (claims.batch_to_json form)
  claim_digest TEXT NOT NULL,      -- unchanged digest => no re-join
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,         -- not seen in a complete scope != delisted; never unbinds by itself
  PRIMARY KEY (plugin, native_scope, native_id)
);

-- Negative resolve results: a plugin's resolve found nothing (or failed) for a subject.
-- The page shows the section unresolved until the entry expires, instead of calling again.
CREATE TABLE resolve_misses (
  subject_id TEXT NOT NULL,
  plugin TEXT NOT NULL,
  reason TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (subject_id, plugin)
);
