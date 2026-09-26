-- Reference store (ADR 0037). Local-first: the reference plugins run on the
-- device and the builder writes reference.sqlite3, replaced atomically on each
-- rebuild and read-only in between.
-- Subject IDs are deterministic, derived from open identifiers
-- (identity.schemes.subject_id), so every install and rebuild agrees on them.
-- A re-key (a better key became known) is recorded in id_aliases; a changed
-- natural key (new ISIN, LEI merger) is a successor_of relation.
-- Scheme/level pairs are fixed here so an ISIN can never identify a listing.

CREATE TABLE release (
  key TEXT PRIMARY KEY,            -- schema_version, release (build id), built_at, built_by (device|release), notice, sources (JSON)
  value TEXT NOT NULL
);

CREATE TABLE issuers (
  id TEXT PRIMARY KEY CHECK (id LIKE 'issuer:%'),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 512),
  country TEXT CHECK (country IS NULL OR (length(country) = 2 AND country = upper(country))),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'unknown'))
);

CREATE TABLE securities (
  id TEXT PRIMARY KEY CHECK (id LIKE 'security:%'),
  issuer_id TEXT REFERENCES issuers(id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 512),
  asset_class TEXT NOT NULL CHECK (asset_class IN ('equity', 'crypto')),
  kind TEXT NOT NULL CHECK (kind IN ('ordinary', 'preferred', 'depositary_receipt', 'etf', 'fund', 'other', 'coin',
                                     'token')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'unknown')),
  rank INTEGER CHECK (rank IS NULL OR rank >= 1),  -- notability order within its source, 1 = most notable:
                                                   -- FITRS turnover, SEC file order, curated coin order
  CHECK ((asset_class = 'crypto') = (kind IN ('coin', 'token')))
);

CREATE TABLE composites (
  id TEXT PRIMARY KEY CHECK (id LIKE 'composite:%'),
  security_id TEXT NOT NULL REFERENCES securities(id),
  country TEXT NOT NULL CHECK (length(country) = 2 AND country = upper(country)),
  UNIQUE (security_id, country)
);

-- A venue listing (ticker@MIC, currency) or a crypto deployment (CAIP-2 chain).
CREATE TABLE listings (
  id TEXT PRIMARY KEY CHECK (id LIKE 'listing:%'),
  security_id TEXT NOT NULL REFERENCES securities(id),
  composite_id TEXT REFERENCES composites(id),
  mic TEXT CHECK (mic IS NULL OR length(mic) = 4),
  operating_mic TEXT CHECK (operating_mic IS NULL OR length(operating_mic) = 4),
  ticker TEXT,
  currency TEXT CHECK (currency IS NULL OR length(currency) = 3),
  chain TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'unknown')),
  CHECK ((mic IS NULL) <> (chain IS NULL)),
  CHECK (mic IS NULL OR currency IS NOT NULL),  -- ticker may be unknown (FIRDS lines carry none)
  CHECK (chain IS NULL OR composite_id IS NULL)
);
CREATE UNIQUE INDEX listings_active_line ON listings (mic, ticker, currency)
  WHERE status = 'active' AND mic IS NOT NULL AND ticker IS NOT NULL;
CREATE INDEX listings_security ON listings (security_id);

-- Identifier assertions: one row per (subject, scheme, value, source record, validity start).
CREATE TABLE assertions (
  evidence_id TEXT PRIMARY KEY CHECK (evidence_id LIKE 'ev:%'),
  subject_id TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('issuer', 'security', 'composite', 'listing')),
  scheme TEXT NOT NULL,
  value TEXT NOT NULL,
  valid_from TEXT,
  valid_to TEXT,
  authority TEXT NOT NULL CHECK (authority IN ('source_asserted', 'snapshot', 'rule_confirmed', 'model_confirmed',
                                                'model_suggested', 'user_attested', 'curated')),
  source TEXT NOT NULL,
  source_record TEXT,
  source_version TEXT,
  plugin TEXT NOT NULL,
  adapter_version TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  CHECK (subject_id LIKE level || ':%'),
  CHECK ((scheme IN ('lei', 'cik') AND level = 'issuer')
      OR (scheme IN ('isin', 'share_class_figi') AND level = 'security')
      OR (scheme = 'composite_figi' AND level = 'composite')
      OR (scheme IN ('figi', 'ticker_mic', 'caip19') AND level = 'listing')),
  CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to)
);
CREATE INDEX assertions_key ON assertions (scheme, value);
CREATE INDEX assertions_subject ON assertions (subject_id);

-- Typed edges between distinct subjects. Relations never merge subjects.
CREATE TABLE relations (
  evidence_id TEXT PRIMARY KEY CHECK (evidence_id LIKE 'ev:%'),
  type TEXT NOT NULL CHECK (type IN ('depositary_receipt_of', 'wraps', 'successor_of')),
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  ratio TEXT,
  valid_from TEXT,
  valid_to TEXT,
  authority TEXT NOT NULL,
  source TEXT NOT NULL,
  source_record TEXT,
  source_version TEXT,
  plugin TEXT NOT NULL,
  adapter_version TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  CHECK (from_id <> to_id),
  CHECK (type = 'successor_of' OR (from_id LIKE 'security:%' AND to_id LIKE 'security:%')),
  CHECK (ratio IS NULL OR type = 'depositary_receipt_of'),
  CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to)
);
CREATE INDEX relations_from ON relations (from_id, type);
CREATE INDEX relations_to ON relations (to_id, type);

-- Other names a subject is searched by (former names, brands, symbols).
CREATE TABLE names (
  subject_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 512),
  source TEXT NOT NULL,
  valid_to TEXT,
  PRIMARY KEY (subject_id, name)
);

-- Saved subject IDs resolve through this chain; they are never rewritten.
CREATE TABLE id_aliases (
  old_id TEXT PRIMARY KEY,
  new_id TEXT NOT NULL,
  release TEXT NOT NULL,
  CHECK (old_id <> new_id)
);

-- Pythia-authored or open vocabularies the joins and rows need.
CREATE TABLE venues (
  mic TEXT PRIMARY KEY CHECK (length(mic) = 4),
  operating_mic TEXT NOT NULL CHECK (length(operating_mic) = 4),
  name TEXT NOT NULL,              -- short display label (curated for common venues), else the ISO 10383 name
  country TEXT CHECK (country IS NULL OR length(country) = 2)
);

CREATE TABLE chains (
  caip2 TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

-- Curated crypto tables (Pythia-authored data, versioned like a rule).
-- Provider chain ids -> CAIP-2, so token deployments join on CAIP-2 + contract.
CREATE TABLE provider_chains (
  provider TEXT NOT NULL,
  chain TEXT NOT NULL,              -- the provider's own chain or platform id
  caip2 TEXT NOT NULL REFERENCES chains(caip2),
  PRIMARY KEY (provider, chain)
);

-- Canonical native coins (CAIP-19 slip44 on their home chain) and each provider's
-- coin id for them. Native coins carry no contract, so this is how they join.
CREATE TABLE native_coins (
  caip19 TEXT NOT NULL,
  provider TEXT NOT NULL,
  native_scope TEXT NOT NULL,
  native_id TEXT NOT NULL,
  PRIMARY KEY (provider, native_scope, native_id)
);
