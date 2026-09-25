-- Directory (ADR 0037): derived, flat, searchable. Rebuilt into a temporary file
-- and renamed into place, so readers never wait on a writer. Search is one local
-- read of this file. Columns mirror identity.directory.DirectoryRow.

CREATE TABLE metadata (
  key TEXT PRIMARY KEY,           -- schema_version, built_at, reference_build, overlays (JSON plugin -> as_of)
  value TEXT NOT NULL
);

CREATE TABLE rows (
  row_id TEXT PRIMARY KEY,
  row_kind TEXT NOT NULL CHECK (row_kind IN ('listing', 'crypto_asset')),
  security_id TEXT NOT NULL,
  issuer_id TEXT,
  composite_id TEXT,
  group_key TEXT NOT NULL,
  mic TEXT,
  operating_mic TEXT,
  ticker_root TEXT NOT NULL,
  ticker_class TEXT,
  ticker_display TEXT NOT NULL,
  currency TEXT,
  price_scale TEXT NOT NULL DEFAULT '1',
  name TEXT NOT NULL,
  issuer_name TEXT,
  kind TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  country TEXT,
  venue_label TEXT,
  isin TEXT,
  lei TEXT,
  cik TEXT,
  figi TEXT,
  share_class_figi TEXT,
  composite_figi TEXT,
  primary_listing INTEGER NOT NULL CHECK (primary_listing IN (0, 1)),
  home_market INTEGER NOT NULL CHECK (home_market IN (0, 1)),
  depositary_of TEXT,
  status TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('reference', 'local', 'overlay')),
  provider_refs TEXT NOT NULL,
  sources TEXT NOT NULL,
  aliases TEXT NOT NULL,
  rank_size REAL,
  rank_signals TEXT NOT NULL,
  as_of TEXT NOT NULL,
  CHECK ((row_kind = 'listing') = (mic IS NOT NULL)),
  CHECK (row_kind <> 'listing' OR currency IS NOT NULL),
  CHECK (row_kind <> 'crypto_asset' OR row_id = security_id)
);
CREATE UNIQUE INDEX rows_listing_line ON rows (mic, ticker_root, coalesce(ticker_class, ''), currency)
  WHERE row_kind = 'listing' AND status = 'active';
CREATE INDEX rows_group ON rows (group_key);

-- Exact lookups: ISIN, FIGI, LEI, CIK, ticker and provider symbols (e.g. 'ASML.AS').
CREATE TABLE row_keys (
  key TEXT NOT NULL,              -- normalized upper-case value
  kind TEXT NOT NULL CHECK (kind IN ('identifier', 'ticker', 'provider_symbol')),
  row_id TEXT NOT NULL REFERENCES rows(row_id) ON DELETE CASCADE,
  PRIMARY KEY (key, kind, row_id)
);

-- Text search over names, aliases and tickers.
CREATE VIRTUAL TABLE rows_text USING fts5(
  row_id UNINDEXED,
  name,
  issuer_name,
  aliases,
  tickers,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3 4'
);
