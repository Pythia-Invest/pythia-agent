-- Identity store v2 (ADR 0037): private, transactional, device-local.
-- Holds what the device decided on top of the reference store: subjects the
-- reference lacks, local assertions and relations, provider bindings with revisions, the
-- resolution queue (residuals and conflicts), resolver verdicts, overrides and
-- applied aliases.
-- Rules carried from the lab:
--   * missing evidence never erases a confirmed association (only positive
--     evidence of an end sets valid_to or changes status);
--   * a revision is written only when the normalized record changes
--     (bindings.record_digest guards binding_revisions).
-- Portable SQL throughout the backbone stores: ISO-8601 text for dates and
-- instants, JSON as TEXT validated by the store module, FTS5 only in the directory.

CREATE TABLE metadata (
  key TEXT PRIMARY KEY,           -- schema_version (2), generation, reference_release
  value TEXT NOT NULL
);

-- Subjects no reference build knows yet: IDs derived from their open identifiers,
-- or provisional IDs derived from the provider reference that introduced them.
-- Descriptive provider fields stay in that plugin's overlay store, so this file
-- (with user state) holds no provider data. Re-keyed through aliases later.
CREATE TABLE subjects (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL CHECK (level IN ('issuer', 'security', 'composite', 'listing')),
  parent_id TEXT,                  -- issuer of a security, security of a composite/listing
  created_by TEXT NOT NULL,        -- plugin id or 'agent'
  created_at TEXT NOT NULL,
  CHECK (id LIKE level || ':%')
);

-- Same shape as the reference assertions, for device-local evidence.
CREATE TABLE assertions (
  evidence_id TEXT PRIMARY KEY CHECK (evidence_id LIKE 'ev:%'),
  subject_id TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('issuer', 'security', 'composite', 'listing')),
  scheme TEXT NOT NULL,
  value TEXT NOT NULL,
  valid_from TEXT,
  valid_to TEXT,
  tier TEXT NOT NULL CHECK (tier IN ('T0', 'T1', 'T3', 'T4')),
  authority TEXT NOT NULL,
  source TEXT NOT NULL,
  source_record TEXT,
  source_version TEXT,
  plugin TEXT NOT NULL,
  adapter_version TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  CHECK (subject_id LIKE level || ':%'),
  CHECK ((scheme IN ('lei', 'cik') AND level = 'issuer')
      OR (scheme IN ('isin', 'cusip', 'share_class_figi') AND level = 'security')
      OR (scheme = 'composite_figi' AND level = 'composite')
      OR (scheme IN ('figi', 'ticker_mic', 'sedol', 'caip19') AND level = 'listing')),
  CHECK ((tier = 'T0' AND authority IN ('source_asserted', 'snapshot'))
      OR (tier = 'T1' AND authority = 'rule_confirmed')
      OR (tier = 'T3' AND authority IN ('model_confirmed', 'model_suggested'))
      OR (tier = 'T4' AND authority IN ('user_attested', 'curated'))),
  CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to)
);
CREATE INDEX assertions_key ON assertions (scheme, value);
CREATE INDEX assertions_subject ON assertions (subject_id);

CREATE TABLE relations (
  evidence_id TEXT PRIMARY KEY CHECK (evidence_id LIKE 'ev:%'),
  type TEXT NOT NULL CHECK (type IN ('depositary_receipt_of', 'share_class_of', 'parent_of', 'wraps', 'successor_of')),
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  ratio TEXT,
  parent_kind TEXT,
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
  join_rule TEXT CHECK (join_rule IS NULL OR join_rule IN ('isin_mic', 'isin', 'figi_cusip', 'ticker_mic', 'residual')),
  evidence_ids TEXT NOT NULL,
  valid_from TEXT,
  valid_to TEXT,
  verified_at TEXT,                -- last positive verification (e.g. a resolve-only quote check)
  record_digest TEXT NOT NULL,     -- sha256 of the normalized binding; a new revision only when it changes
  revision INTEGER NOT NULL CHECK (revision >= 1),
  active_override TEXT,
  UNIQUE (provider, native_id, native_scope, qualifiers),
  CHECK (subject_id LIKE level || ':%'),
  CHECK (status <> 'confirmed' OR authority IN ('source_asserted', 'snapshot', 'rule_confirmed', 'model_confirmed',
                                                 'user_attested', 'curated')),
  CHECK ((authority = 'rule_confirmed') = (rule_id IS NOT NULL))
);
CREATE INDEX bindings_subject ON bindings (subject_id, status);

CREATE TABLE binding_revisions (
  binding_id TEXT NOT NULL REFERENCES bindings(id),
  revision INTEGER NOT NULL,
  record_digest TEXT NOT NULL,
  record TEXT NOT NULL,
  reason TEXT NOT NULL,            -- ingest, rule_version, evidence_version, override, promotion, alias
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (binding_id, revision)
);

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
-- A model verdict is re-run only when model, prompt, reference release or input digest changes.
CREATE TABLE verdicts (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES queue(id),
  resolver TEXT NOT NULL CHECK (resolver IN ('rules', 'agent', 'plugin', 'user')),
  plugin TEXT NOT NULL,            -- 'pythia' for core rules, the agent and manual resolution
  authority TEXT NOT NULL CHECK (authority IN ('rule_confirmed', 'model_confirmed', 'model_suggested', 'user_attested')),
  relation TEXT NOT NULL CHECK (relation IN ('same_listing', 'same_security', 'same_issuer', 'depositary_receipt_of',
                                             'share_class_of', 'unrelated', 'none', 'ambiguous')),
  chosen_id TEXT,
  rejected_evidence_ids TEXT NOT NULL DEFAULT '[]',
  confidence REAL CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  threshold REAL,                  -- the calibrated threshold in force when decided
  model TEXT,
  prompt_version TEXT,
  reference_release TEXT,
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
CREATE UNIQUE INDEX verdicts_model_rerun ON verdicts (item_id, model, prompt_version, reference_release, input_digest)
  WHERE model IS NOT NULL;

-- Overrides (ADR 0012): the positive or negative effect of a confirmed verdict on
-- a binding. Evidence-referenced and revocable; retired when later proof arrives,
-- quarantined when later identifier evidence contradicts them.
CREATE TABLE overrides (
  id TEXT PRIMARY KEY,
  binding_id TEXT NOT NULL REFERENCES bindings(id),
  verdict_id TEXT REFERENCES verdicts(id),
  effect TEXT NOT NULL CHECK (effect IN ('positive', 'negative')),
  subject_id TEXT,
  evidence_ids TEXT NOT NULL,
  authority TEXT NOT NULL CHECK (authority IN ('rule_confirmed', 'model_confirmed', 'user_attested', 'curated')),
  state TEXT NOT NULL CHECK (state IN ('active', 'retired', 'quarantined')),
  created_at TEXT NOT NULL,
  CHECK ((effect = 'positive') = (subject_id IS NOT NULL))
);

-- Aliases applied on this device: the reference id_aliases plus local re-keys.
CREATE TABLE aliases (
  old_id TEXT PRIMARY KEY,
  new_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('rekey', 'merge', 'split')),
  release TEXT,
  applied_at TEXT NOT NULL,
  CHECK (old_id <> new_id)
);
