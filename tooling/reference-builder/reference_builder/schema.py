"""Reference snapshot tables: the only module that knows the on-disk layout.

The layout follows the identity backbone's four levels (issuer, security,
listing; composites are carried as `composite_figi` on listings) plus identifier
assertions with provenance. When the core contract DDL changes, adapt this
module; the assembly stages stay untouched.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterator

from .model import Snapshot

SCHEMA_VERSION = 1

DDL = """
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE sources(source TEXT PRIMARY KEY, url TEXT NOT NULL, version TEXT, retrieved_at TEXT NOT NULL,
  sha256 TEXT, licence TEXT NOT NULL);
CREATE TABLE venues(mic TEXT PRIMARY KEY, operating_mic TEXT NOT NULL, level TEXT, name TEXT, country TEXT,
  category TEXT, status TEXT);
CREATE TABLE issuers(issuer_id TEXT PRIMARY KEY, lei TEXT UNIQUE, cik TEXT UNIQUE, name TEXT NOT NULL,
  legal_name TEXT, name_rule TEXT, jurisdiction TEXT, country TEXT, entity_status TEXT, registration_status TEXT,
  source TEXT NOT NULL);
CREATE TABLE issuer_names(issuer_id TEXT NOT NULL REFERENCES issuers, name TEXT NOT NULL, name_type TEXT NOT NULL,
  language TEXT, source TEXT NOT NULL, PRIMARY KEY(issuer_id, name_type, name));
CREATE TABLE securities(security_id TEXT PRIMARY KEY, isin TEXT UNIQUE, share_class_figi TEXT,
  issuer_id TEXT REFERENCES issuers, kind TEXT NOT NULL, cfi TEXT, fisn TEXT, name TEXT, notional_currency TEXT,
  primary_mic TEXT, primary_rule TEXT, activity TEXT NOT NULL, turnover_eur REAL, turnover_method TEXT,
  source TEXT NOT NULL);
CREATE TABLE listings(listing_id TEXT PRIMARY KEY, security_id TEXT REFERENCES securities,
  issuer_id TEXT REFERENCES issuers, mic TEXT, operating_mic TEXT, country TEXT, ticker TEXT, ticker_root TEXT,
  ticker_class TEXT, currency TEXT, figi TEXT, composite_figi TEXT, share_class_figi TEXT, row_class TEXT NOT NULL,
  security_type TEXT, name TEXT, is_primary INTEGER NOT NULL, status TEXT NOT NULL, status_reasons TEXT,
  valid_from TEXT, valid_to TEXT, source TEXT NOT NULL, ticker_source TEXT);
CREATE TABLE identifiers(evidence_id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, level TEXT NOT NULL,
  scheme TEXT NOT NULL, value TEXT NOT NULL, valid_from TEXT, valid_to TEXT, source TEXT NOT NULL,
  authority TEXT NOT NULL, rule_id TEXT);
CREATE TABLE relationships(from_id TEXT NOT NULL, relation TEXT NOT NULL, to_id TEXT NOT NULL,
  source TEXT NOT NULL, rule_id TEXT, PRIMARY KEY(from_id, relation, to_id));
CREATE TABLE flags(subject_id TEXT NOT NULL, flag TEXT NOT NULL, detail TEXT, PRIMARY KEY(subject_id, flag));
CREATE INDEX listings_security ON listings(security_id);
CREATE INDEX listings_issuer ON listings(issuer_id);
CREATE INDEX listings_ticker ON listings(ticker, mic);
CREATE INDEX securities_issuer ON securities(issuer_id);
CREATE INDEX identifiers_value ON identifiers(scheme, value);
CREATE INDEX identifiers_subject ON identifiers(subject_id);
"""


def _evidence_id(subject: str, scheme: str, value: str, valid_from: str | None, source: str) -> str:
    """Content hash, so an unchanged assertion keeps its id across releases."""
    raw = "\x1f".join([subject, scheme, value, valid_from or "", source])
    return "snap:" + hashlib.sha256(raw.encode()).hexdigest()[:32]


def _assertions(snap: Snapshot) -> Iterator[tuple]:
    def row(subject, level, scheme, value, source, authority="source_asserted", rule=None, start=None, end=None):
        return (_evidence_id(subject, scheme, value, start, source), subject, level, scheme, value, start, end, source, authority, rule)

    for issuer in snap.issuers.values():
        if issuer.lei:
            yield row(issuer.issuer_id, "issuer", "lei", issuer.lei, "gleif" if issuer.source == "gleif" else "esma_firds")
        if issuer.cik:
            rule = issuer.cik_rule
            yield row(issuer.issuer_id, "issuer", "cik", issuer.cik, "sec", "rule" if rule else "source_asserted", rule)
    for security in snap.securities.values():
        if security.isin:
            yield row(security.security_id, "security", "isin", security.isin, "esma_firds")
        if security.share_class_figi:
            yield row(security.security_id, "security", "share_class_figi", security.share_class_figi, "openfigi")
    for listing in snap.listings.values():
        span = {"start": listing.valid_from, "end": listing.valid_to}
        if listing.figi:
            yield row(listing.listing_id, "listing", "figi", listing.figi, "openfigi", **span)
        if listing.composite_figi:
            yield row(listing.listing_id, "listing", "composite_figi", listing.composite_figi, "openfigi", **span)
        if listing.ticker and listing.mic:
            yield row(listing.listing_id, "listing", "ticker_mic", f"{listing.ticker}@{listing.mic}", listing.ticker_source or listing.source, **span)


def rows(snap: Snapshot, meta: dict[str, str], sources: list[dict]) -> dict[str, list[tuple]]:
    """Table name → rows, in insertion order matching the DDL columns."""
    return {
        "meta": sorted(meta.items()),
        "sources": [(s["source"], s["url"], s.get("version"), s["retrieved_at"], s.get("sha256"), s["licence"]) for s in sources],
        "venues": [(v.mic, v.operating_mic, v.level, v.name, v.country, v.category, v.status) for v in snap.venues.values()],
        "issuers": [
            (i.issuer_id, i.lei, i.cik, i.name, i.legal_name, i.name_rule, i.jurisdiction, i.country, i.entity_status,
             i.registration_status, i.source)
            for i in sorted(snap.issuers.values(), key=lambda i: i.issuer_id)
        ],
        "issuer_names": sorted({(i.issuer_id, n, kind, lang, src) for i in snap.issuers.values() for n, kind, lang, src in i.names}),
        "securities": [
            (s.security_id, s.isin, s.share_class_figi, s.issuer_id, s.kind, s.cfi, s.fisn, s.name, s.currency, s.primary_mic,
             s.primary_rule, s.activity, s.turnover_eur, s.turnover_method, s.source)
            for s in sorted(snap.securities.values(), key=lambda s: s.security_id)
        ],
        "listings": [
            (l.listing_id, l.security_id, l.issuer_id, l.mic, l.operating_mic, l.country, l.ticker, l.ticker_root, l.ticker_class,
             l.currency, l.figi, l.composite_figi, l.share_class_figi, l.row_class, l.security_type, l.name, int(l.is_primary),
             l.status, json.dumps(sorted(set(l.status_reasons))) if l.status_reasons else None, l.valid_from, l.valid_to,
             l.source, l.ticker_source)
            for l in sorted(snap.listings.values(), key=lambda l: l.listing_id)
        ],
        "identifiers": sorted(set(_assertions(snap))),
        "relationships": sorted({(r.from_id, r.relation, r.to_id, r.source, r.rule_id) for r in snap.relationships}),
        "flags": sorted({(f.subject_id, f.flag, f.detail) for f in snap.flags}, key=lambda f: (f[0], f[1])),
    }
