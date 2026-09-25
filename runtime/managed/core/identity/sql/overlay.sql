-- Overlay store, one file per provider plugin: overlay-<plugin>.sqlite3 (ADR 0037, 0038).
-- All provider data lives here (and in the derived directory), separate from the
-- identity store and user state. A bulk plugin keeps its catalogue records; a
-- resolve-only plugin keeps only the records the user picked. Hidden when the
-- plugin is disabled; deleted when its credential is removed. Overlay claims are
-- subordinate to open reference evidence.

CREATE TABLE metadata (
  key TEXT PRIMARY KEY,           -- schema_version, plugin, provider
  value TEXT NOT NULL
);

CREATE TABLE scopes (
  scope TEXT PRIMARY KEY,
  adapter_version TEXT NOT NULL,
  source_version TEXT,
  access_key TEXT NOT NULL,        -- fingerprint of the credential/entitlement the rows came under
  retrieved_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,        -- stale after this; still searchable, marked stale
  complete INTEGER NOT NULL CHECK (complete IN (0, 1)),
  row_count INTEGER NOT NULL CHECK (row_count >= 0)
);

-- One claimed record (a RecordClaim) per provider reference.
CREATE TABLE records (
  native_id TEXT NOT NULL,
  native_scope TEXT NOT NULL,
  scope TEXT NOT NULL REFERENCES scopes(scope),
  level TEXT NOT NULL CHECK (level IN ('issuer', 'security', 'composite', 'listing')),
  name TEXT,
  ticker_root TEXT,
  ticker_class TEXT,
  mic TEXT,
  operating_mic TEXT,
  provider_venue TEXT,
  currency TEXT,
  price_scale TEXT,
  asset_class TEXT,
  kind TEXT,
  status TEXT,
  claim TEXT NOT NULL,   -- the full RecordClaim as emitted
  claim_digest TEXT NOT NULL,      -- unchanged digest => no re-join, no revision
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,         -- not seen in a complete scope != delisted; never unbinds by itself
  PRIMARY KEY (native_scope, native_id)
);
CREATE INDEX records_ticker ON records (mic, ticker_root);

-- The identifiers each record co-asserts, typed for the ingest join.
CREATE TABLE record_identifiers (
  native_scope TEXT NOT NULL,
  native_id TEXT NOT NULL,
  scheme TEXT NOT NULL CHECK (scheme IN ('lei', 'cik', 'isin', 'share_class_figi', 'composite_figi', 'figi',
                                         'ticker_mic', 'caip19')),
  value TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'self' CHECK (role IN ('self', 'underlying')),
  PRIMARY KEY (native_scope, native_id, scheme, value, role),
  FOREIGN KEY (native_scope, native_id) REFERENCES records(native_scope, native_id) ON DELETE CASCADE
);
CREATE INDEX record_identifiers_key ON record_identifiers (scheme, value);

-- Core-owned join outcome. Plugins never write this table.
CREATE TABLE join_outcomes (
  native_scope TEXT NOT NULL,
  native_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  rule_id TEXT,                    -- the versioned join rule that placed it, e.g. 'isin_mic@1'
  outcome TEXT NOT NULL CHECK (outcome IN ('bound', 'created', 'residual', 'conflict')),
  claim_digest TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  PRIMARY KEY (native_scope, native_id),
  FOREIGN KEY (native_scope, native_id) REFERENCES records(native_scope, native_id) ON DELETE CASCADE
);
