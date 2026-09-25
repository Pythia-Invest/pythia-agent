-- Identity store v2 (ADR 0037): private, transactional, device-local.
-- Holds what the device decided on top of the reference store: subjects the
-- reference lacks, local relations, provider bindings, the resolution queue
-- (residuals and conflicts) and resolver verdicts. Missing evidence never erases
-- a confirmed binding: only positive evidence of an end sets valid_to or status.
-- Portable SQL throughout the backbone stores: ISO-8601 text for dates and
-- instants, JSON as TEXT validated by the store module, FTS5 only in the directory.

CREATE TABLE metadata (
  key TEXT PRIMARY KEY,           -- schema_version (2), generation, reference_release
  value TEXT NOT NULL
);

-- Subjects no reference build knows yet: IDs derived from their open identifiers,
-- or provisional IDs derived from the provider reference that introduced them.
-- Descriptive provider fields stay in that plugin's overlay store, so this file
-- (with user state) holds no provider data. Re-keyed through the reference id_aliases.
CREATE TABLE subjects (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL CHECK (level IN ('issuer', 'security', 'composite', 'listing')),
  parent_id TEXT,                  -- issuer of a security, security of a composite/listing
  created_by TEXT NOT NULL,        -- plugin id or 'agent'
  created_at TEXT NOT NULL,
  CHECK (id LIKE level || ':%')
);

CREATE TABLE relations (
  evidence_id TEXT PRIMARY KEY CHECK (evidence_id LIKE 'ev:%'),
  type TEXT NOT NULL CHECK (type IN ('depositary_receipt_of', 'wraps', 'successor_of')),
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  ratio TEXT,
  valid_from TEXT,
  valid_to TEXT,
  tier TEXT NOT NULL CHECK (tier IN ('T0', 'T1', 'T3', 'T4')),
  authority TEXT NOT NULL,
  source TEXT NOT NULL,
  plugin TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  CHECK (from_id <> to_id)
);

-- One current binding per provider reference. The market-data read pipeline
-- keeps addressing by provider_ref; the backbone supplies which subject it is.
CREATE TABLE bindings (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  native_id TEXT NOT NULL,
  native_scope TEXT NOT NULL,
  qualifiers TEXT NOT NULL DEFAULT '{}',
  subject_id TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('issuer', 'security', 'composite', 'listing')),
  status TEXT NOT NULL CHECK (status IN ('candidate', 'confirmed', 'conflicting', 'rejected')),
  tier TEXT CHECK (tier IS NULL OR tier IN ('T0', 'T1', 'T3', 'T4')),
  authority TEXT NOT NULL,
  rule_id TEXT,                    -- versioned rule for T1, e.g. 'ticker_mic@1'
  evidence_ids TEXT NOT NULL,
  valid_from TEXT,
  valid_to TEXT,
  verified_at TEXT,                -- last positive verification (e.g. a resolve-only quote check)
  verdict_id TEXT REFERENCES verdicts(id),  -- the verdict that confirmed or rejected it (ADR 0012 override)
  UNIQUE (provider, native_id, native_scope, qualifiers),
  CHECK (subject_id LIKE level || ':%'),
  CHECK (status <> 'confirmed' OR authority IN ('source_asserted', 'snapshot', 'rule_confirmed', 'model_confirmed',
                                                 'user_attested', 'curated')),
  CHECK ((authority = 'rule_confirmed') = (rule_id IS NOT NULL))
);
CREATE INDEX bindings_subject ON bindings (subject_id, status);

-- The resolution queue: one core-owned list of residuals (records the join could
-- not place) and conflicts (contradicting evidence). Any resolver the user chose
-- drains it: built-in rules, the Hermes agent, a resolver plugin, or the user.
CREATE TABLE queue (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('residual', 'conflict')),
  reason TEXT NOT NULL,
  subject_ids TEXT NOT NULL,
  candidate_ids TEXT NOT NULL DEFAULT '[]',
  evidence_ids TEXT NOT NULL DEFAULT '[]',
  plugin TEXT,                     -- whose claim opened the item
  provider_ref TEXT,
  scheme TEXT,                     -- conflict: the contested scheme
  contested_values TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL CHECK (state IN ('open', 'resolved', 'superseded', 'dismissed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  opened_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_by TEXT,                -- the verdict that settled it
  CHECK ((kind = 'residual' AND reason IN ('no_key', 'underlying_identifier', 'ambiguous'))
      OR (kind = 'conflict' AND reason IN ('identifier', 'binding', 'relation', 'guard')))
);
CREATE INDEX queue_open ON queue (state, opened_at);

-- Every verdict any resolver submitted, with the outcome the authority rule gave it.
CREATE TABLE verdicts (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES queue(id),
  resolver TEXT NOT NULL CHECK (resolver IN ('rules', 'agent', 'plugin', 'user')),
  plugin TEXT NOT NULL,            -- 'pythia' for core rules, the agent and manual resolution
  authority TEXT NOT NULL CHECK (authority IN ('rule_confirmed', 'model_confirmed', 'model_suggested', 'user_attested')),
  relation TEXT NOT NULL CHECK (relation IN ('same_listing', 'same_security', 'same_issuer', 'depositary_receipt_of',
                                             'unrelated', 'none', 'ambiguous')),
  chosen_id TEXT,
  rejected_evidence_ids TEXT NOT NULL DEFAULT '[]',
  confidence REAL CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  model TEXT,
  prompt_version TEXT,
  input_digest TEXT,
  rule_id TEXT,
  rationale TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('confirmed', 'suggested', 'blocked', 'no_match')),
  created_at TEXT NOT NULL,
  CHECK ((resolver = 'rules' AND authority = 'rule_confirmed' AND rule_id IS NOT NULL)
      OR (resolver IN ('agent', 'plugin') AND authority IN ('model_confirmed', 'model_suggested'))
      OR (resolver = 'user' AND authority = 'user_attested')),
  CHECK (authority NOT IN ('model_confirmed', 'model_suggested')
      OR (confidence IS NOT NULL AND model IS NOT NULL AND prompt_version IS NOT NULL AND input_digest IS NOT NULL)),
  CHECK ((chosen_id IS NULL) = (relation IN ('none', 'ambiguous')))
);
CREATE INDEX verdicts_item ON verdicts (item_id);
