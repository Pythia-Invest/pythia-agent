-- Reference store (ADR 0037). Local-first: the reference plugins run on the
-- device and the builder writes reference.sqlite3, replaced atomically on each
-- rebuild and read-only in between.
-- Subject IDs are deterministic, derived from open identifiers
-- (identity.schemes.subject_id), so every install and rebuild agrees on them.
-- A re-key (a better key became known) is recorded in id_aliases; a changed
-- natural key (new ISIN, LEI merger) is a successor_of relation.
-- Scheme/level pairs are fixed here so an ISIN can never identify a listing.
--
-- Reading it. Every table and column is explained by a comment inside its CREATE statement, which SQLite keeps:
-- `SELECT name, sql FROM sqlite_master WHERE type = 'table'` explains the file from the file itself, and
-- docs/architecture/identity-data.md has worked read-only queries. Who said an identifier or a relation is in
-- `assertions` and `relations` (`source`, `source_record`, `retrieved_at`, `authority`); `release.sources` says which
-- files each source was read from. The structural links (a listing's security, a security's issuer) are not rows of
-- their own: a listing's ID spells out its security's key (usually the ISIN), and an issuer's ID its LEI or CIK.

CREATE TABLE release (  -- the build that made this file
  key TEXT PRIMARY KEY,            -- schema_version, release (build id), built_at, built_by (device|release), notice, sources (JSON)
  value TEXT NOT NULL              -- `sources` is a JSON list, one entry per source file read: source, url, version, retrieved_at, sha256, licence. An `esma_firds:<file>` entry belongs to assertions.source `esma_firds`; gleif_lei_records to `gleif`, sec_company_tickers to `sec`, sec_fund_tickers to `sec_funds`, canonical_assets to `pythia`
);

CREATE TABLE issuers (  -- companies that issue securities, keyed by LEI (else CIK)
  id TEXT PRIMARY KEY CHECK (id LIKE 'issuer:%'),  -- issuer:lei:<LEI> or issuer:cik:<CIK>; its identifiers are in assertions
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 512),  -- display name, re-cased for display: GLEIF's legal name, else the SEC title or the FIRDS name; other names are in `names`
  country TEXT CHECK (country IS NULL OR (length(country) = 2 AND country = upper(country))),  -- ISO 3166 of the legal entity's jurisdiction, where a source states it
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'unknown'))  -- GLEIF's entity status
);

CREATE TABLE securities (  -- a share class, fund or crypto asset, keyed by its ISIN (else share-class FIGI or canonical CAIP-19)
  id TEXT PRIMARY KEY CHECK (id LIKE 'security:%'),  -- security:isin:<ISIN> and so on; its identifiers are in assertions
  issuer_id TEXT REFERENCES issuers(id),  -- the issuer, from FIRDS field 5's LEI, or a receipt's share, or an SEC or GLEIF identifier link; the basis is not stored per row. NULL is unknown (the build asks a question), never a guess
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 512),  -- display name, from the source that named the security
  asset_class TEXT NOT NULL CHECK (asset_class IN ('equity', 'crypto')),  -- equity covers shares, funds and receipts; crypto covers coins and tokens
  kind TEXT NOT NULL CHECK (kind IN ('ordinary', 'preferred', 'depositary_receipt', 'etf', 'fund', 'other', 'coin',
                                     'token')),  -- from the source's CFI code (FIRDS), its fund or ticker file (SEC) or the curated crypto table
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'unknown')),  -- whether a source says it still trades
  rank INTEGER CHECK (rank IS NULL OR rank >= 1),  -- notability order within its source, 1 = most notable:
                                                   -- FITRS turnover, SEC file order, curated coin order
  CHECK ((asset_class = 'crypto') = (kind IN ('coin', 'token')))
);

CREATE TABLE composites (  -- a country's consolidated line of a security (the US composite), not a venue
  id TEXT PRIMARY KEY CHECK (id LIKE 'composite:%'),  -- composite:isin:<ISIN>:<country>; its composite FIGI is in assertions
  security_id TEXT NOT NULL REFERENCES securities(id),  -- the security it is a line of; its ID spells out that security's key
  country TEXT NOT NULL CHECK (length(country) = 2 AND country = upper(country)),  -- ISO 3166 of the market
  UNIQUE (security_id, country)
);

-- A venue listing (ticker@MIC, currency) or a crypto deployment (CAIP-2 chain).
CREATE TABLE listings (  -- a venue listing (ticker@MIC, currency) or a crypto deployment: the line a price is read for
  id TEXT PRIMARY KEY CHECK (id LIKE 'listing:%'),  -- listing:isin:<ISIN>:<operating MIC>:<currency> and so on; its FIGI and ticker_mic are in assertions
  security_id TEXT NOT NULL REFERENCES securities(id),  -- the security it is a line of; its ID spells out that security's key (usually the ISIN)
  composite_id TEXT REFERENCES composites(id),  -- the country composite it belongs to, where a composite FIGI is known
  mic TEXT CHECK (mic IS NULL OR length(mic) = 4),  -- the segment MIC the security was admitted on (ISO 10383)
  operating_mic TEXT CHECK (operating_mic IS NULL OR length(operating_mic) = 4),  -- the exchange's operating MIC; what price sources address
  ticker TEXT,                     -- the venue ticker, where a source states one (FIRDS lines carry none); a ticker can be reused: see status
  -- The key currency (identity.schemes: ISIN + operating MIC + currency): FIRDS' notional currency on a FIRDS line.
  currency TEXT CHECK (currency IS NULL OR length(currency) = 3),
  -- The currency the line trades in where its venue decides it (Xetra: EUR, Nasdaq: USD); NULL when no source states
  -- it. Labels, search rows and read checks use this one, never `currency`.
  trading_currency TEXT CHECK (trading_currency IS NULL OR length(trading_currency) = 3),
  chain TEXT,                      -- CAIP-2 chain of a crypto deployment; NULL for a venue listing
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  -- The builder's line on FIRDS' most liquid EU market for a security whose primary it could not decide: the line
  -- priced then, never shown as primary.
  most_liquid INTEGER NOT NULL DEFAULT 0 CHECK (most_liquid IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'unknown')),  -- inactive: the line no longer trades, so its ticker is never used for a price
  CHECK ((mic IS NULL) <> (chain IS NULL)),
  CHECK (mic IS NULL OR currency IS NOT NULL),  -- ticker may be unknown (FIRDS lines carry none)
  CHECK (chain IS NULL OR composite_id IS NULL)
);
CREATE UNIQUE INDEX listings_active_line ON listings (mic, ticker, currency)
  WHERE status = 'active' AND mic IS NOT NULL AND ticker IS NOT NULL;
CREATE INDEX listings_security ON listings (security_id);

-- Identifier assertions: one row per (subject, scheme, value, source record, validity start).
CREATE TABLE assertions (  -- who says what identifier belongs to which subject: one row per (subject, scheme, value, source record, validity start)
  evidence_id TEXT PRIMARY KEY CHECK (evidence_id LIKE 'ev:%'),  -- content hash of the row's subject, scheme, value, validity start, source and source_record; questions and bindings cite it
  subject_id TEXT NOT NULL,        -- the subject the value identifies
  level TEXT NOT NULL CHECK (level IN ('issuer', 'security', 'composite', 'listing')),  -- the subject's level, fixed by the scheme
  scheme TEXT NOT NULL,            -- schemes.Scheme: lei, cik, isin, share_class_figi, composite_figi, figi, ticker_mic, caip19
  value TEXT NOT NULL,             -- the normalized identifier
  valid_from TEXT,                 -- the dates (YYYY-MM-DD) the source says it holds; NULL is open-ended
  valid_to TEXT,
  -- The kind of evidence, never its origin (vocabulary.Authority; ADR 0044 A2).
  authority TEXT NOT NULL CHECK (authority IN ('source_asserted', 'rule_confirmed', 'model_confirmed', 'model_suggested',
                                                'user_attested')),  -- source_asserted: a source's own record says so; rule_confirmed: a builder rule derived it, named in source_record
  source TEXT NOT NULL,            -- where it was read: esma_firds, gleif, openfigi, sec, sec_funds or pythia (the curated crypto table); release.sources lists the files
  source_record TEXT,              -- NULL for a value read as it stands; else the named link or versioned rule that stated or derived it (isin_exch_us, share_class_figi, gleif_edgar_registration, canonical_assets@1)
  source_version TEXT,             -- the source's version, where the builder states one; usually NULL: see release.sources
  plugin TEXT NOT NULL,            -- the contributor: the same as source for a build
  adapter_version TEXT NOT NULL,   -- the builder's version that wrote the row
  retrieved_at TEXT NOT NULL,      -- when the build read the source (the build's time, not the provider's publishing date: see release.sources)
  CHECK (subject_id LIKE level || ':%'),
  CHECK ((scheme IN ('lei', 'cik') AND level = 'issuer')
      OR (scheme IN ('isin', 'share_class_figi') AND level = 'security')
      OR (scheme = 'composite_figi' AND level = 'composite')
      OR (scheme IN ('figi', 'ticker_mic', 'caip19') AND level = 'listing')),
  CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to)
);
CREATE INDEX assertions_key ON assertions (scheme, value);
CREATE INDEX assertions_subject ON assertions (subject_id);

-- Typed edges between distinct subjects. Relations never merge subjects. The type's
-- kinds, ratio rule and grouping (fold or related) are vocabulary.RELATIONS, so a
-- new relation type needs no schema change.
CREATE TABLE relations (  -- typed edges between two subjects (a receipt and its share, a wrapped coin and its asset); none merges subjects
  evidence_id TEXT PRIMARY KEY CHECK (evidence_id LIKE 'ev:%'),  -- content hash of the edge and its source record
  type TEXT NOT NULL,              -- vocabulary.RelationType
  from_id TEXT NOT NULL,           -- the subject the edge starts at (the receipt)
  to_id TEXT NOT NULL,             -- the subject it points to (the share)
  ratio TEXT,                      -- shares per receipt, as text; NULL for other types
  valid_from TEXT,                 -- the dates (YYYY-MM-DD) the source says it holds; NULL is open-ended
  valid_to TEXT,                   -- the end of that window
  authority TEXT NOT NULL CHECK (authority IN ('source_asserted', 'rule_confirmed', 'model_confirmed', 'model_suggested',
                                                'user_attested')),  -- source_asserted: a source states it; rule_confirmed: a builder rule derived it
  source TEXT NOT NULL,            -- where it was read, as in assertions.source
  source_record TEXT,              -- the named link or versioned rule: firds_underlying_isin (FIRDS field 26), receipt_issuer_share@1, canonical_assets@1
  source_version TEXT,             -- the source's version, where the builder states one
  plugin TEXT NOT NULL,            -- the contributor: the same as source for a build
  adapter_version TEXT NOT NULL,   -- the builder's version that wrote the row
  retrieved_at TEXT NOT NULL,      -- when the build read the source
  CHECK (from_id <> to_id),
  CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to)
);
CREATE INDEX relations_from ON relations (from_id, type);
CREATE INDEX relations_to ON relations (to_id, type);

-- Where the build corrected its own source's error (docs/sources/<source>.md lists each). An additive table: a package
-- built before it has none, and core reads it only when it exists.
CREATE TABLE source_corrections (  -- a value the build states instead of what its source states, because the source is wrong: the original stays here
  subject_id TEXT NOT NULL,        -- the subject the corrected value is about
  source TEXT NOT NULL,            -- the source that states the original, as in assertions.source (esma_firds)
  field TEXT NOT NULL,             -- the source's own field as the adapter reads it (for esma_firds an element path: Issr)
  original TEXT NOT NULL,          -- what the source states, exactly
  value TEXT,                      -- what the build states instead: the rows about the subject carry it (an issuer LEI is the one securities.issuer_id points to). NULL: a retraction, the build states nothing in this field
  reason TEXT NOT NULL CHECK (length(reason) <= 400),  -- what is wrong and the evidence
  PRIMARY KEY (subject_id, source, field)
);

-- Other names a subject is searched by (former names, brands, symbols).
CREATE TABLE names (  -- search names beside a subject's display name; never identifiers
  subject_id TEXT NOT NULL,        -- the subject it names
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 512),  -- the former name, brand or symbol
  source TEXT NOT NULL,            -- where the build read it, as in assertions.source
  valid_to TEXT,                   -- when the name stopped being used, where a source says
  PRIMARY KEY (subject_id, name)
);

-- Saved subject IDs resolve through this chain; a release never rewrites them. The device
-- re-points its own identity.sqlite3 rows through it once per release (identity/lifecycle.py).
CREATE TABLE id_aliases (  -- an earlier subject ID and the one this build gives it
  old_id TEXT PRIMARY KEY,         -- an ID an earlier build, another key rule or another install may hold
  new_id TEXT NOT NULL,            -- the ID this build gives the same subject
  release TEXT NOT NULL,           -- the build that recorded the alias
  CHECK (old_id <> new_id)
);

-- Pythia-authored or open vocabularies the joins and rows need.
CREATE TABLE venues (  -- trading venues from ISO 10383, with short labels for common ones
  mic TEXT PRIMARY KEY CHECK (length(mic) = 4),  -- the segment MIC
  operating_mic TEXT NOT NULL CHECK (length(operating_mic) = 4),  -- its operator's MIC
  name TEXT NOT NULL,              -- short display label (curated for common venues), else the ISO 10383 name
  country TEXT CHECK (country IS NULL OR length(country) = 2),  -- ISO 3166 of the venue
  category TEXT CHECK (category IS NULL OR length(category) = 4)  -- ISO 10383 market category: RMKT regulated
                                   -- market, MLTF multilateral facility, ... (absent in builds before it was added)
);

CREATE TABLE chains (  -- blockchains the crypto deployments name
  caip2 TEXT PRIMARY KEY,          -- the CAIP-2 chain ID (eip155:1)
  name TEXT NOT NULL               -- its display name
);
