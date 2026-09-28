"""Typed claims: what each source says, in the one meaning its documentation gives the field.

An adapter turns source records into claims and nothing else: it never picks a
winner, never reads another source, and records "no answer" (an empty element, a
placeholder) as the absence of a claim. `field` is the slot a claim is evidence
for (issuer, currency, primary…); `meaning` is what the source actually states,
so a notional currency can never fill the trading-currency slot unnoticed.

Sources are onboarded one at a time; each adds its meanings here when it is.
Claims live in a working file beside the snapshot (`claims-<date>.sqlite3`),
with the source fingerprints and the shadow comparison against the build's
decisions. The snapshot's own tables are unchanged.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable
from pathlib import Path

# The fixed meaning vocabulary. One source field has exactly one meaning.
MEANINGS = {
    # ESMA FIRDS (RTS 23 Annex Table 3 field numbers)
    "instrument_full_name": "field 2: the instrument's full name as reported",
    "cfi": "field 3: ISO 10962 classification",
    "issuer_or_venue_operator_lei": "field 5: LEI of the issuer or of the trading venue operator",
    "admitted_to_trading": "field 6: the instrument is admitted to or traded on this segment MIC",
    "fisn": "field 7: ISO 18774 short name",
    "issuer_requested_admission": "field 8: the issuer requested or approved this admission (true) or not (false)",
    "issuer_approval_date": "field 9: date the issuer approved the admission",
    "admission_request_date": "field 10: date of the request for admission",
    "first_trade_date": "field 11: date of admission or of the first trade",
    "termination_date": "field 12: where available, the date trading or admission ends",
    "notional_currency": "field 13: currency of the notional, an instrument-level attribute",
    "underlying_isin": "field 26: for a depositary receipt, the ISIN of the instrument it represents",
    "most_liquid_eu_market": "relevant trading venue: the most relevant market in terms of liquidity (RTS 22 Art. 16)",
}
COLUMNS = ("subject_key", "field", "value", "source", "source_field", "meaning", "as_of", "record_digest")
DDL = """
CREATE TABLE claims (subject_key TEXT NOT NULL, field TEXT NOT NULL, value TEXT NOT NULL, source TEXT NOT NULL,
    source_field TEXT NOT NULL, meaning TEXT NOT NULL, as_of TEXT, record_digest TEXT,
    PRIMARY KEY (subject_key, meaning, value, source)) WITHOUT ROWID;
CREATE TABLE fingerprints (source TEXT PRIMARY KEY, fingerprint TEXT NOT NULL);
CREATE TABLE reports (name TEXT PRIMARY KEY, report TEXT NOT NULL);
CREATE TABLE diff (field TEXT NOT NULL, category TEXT NOT NULL, outcome TEXT NOT NULL, question TEXT,
    subject_key TEXT NOT NULL, today TEXT, claims TEXT, note TEXT);
"""


class ClaimStore:
    """The build's claims file, written under a `.part` name and published by `close()`."""

    def __init__(self, path: Path):
        self.path = path
        self.part = path.with_name(path.name + ".part")
        path.parent.mkdir(parents=True, exist_ok=True)
        self.part.unlink(missing_ok=True)
        self.db = sqlite3.connect(self.part)
        self.db.executescript("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;" + DDL)  # published whole by close()
        self._meaning: dict[tuple[str, str], str] = {}

    def add(self, claims: Iterable[tuple]) -> int:
        """Insert claims; an identical claim from several records is kept once, with the first record's digest."""
        before = self.count()
        with self.db:
            self.db.executemany("INSERT OR IGNORE INTO claims VALUES (?, ?, ?, ?, ?, ?, ?, ?)", self._checked(claims))
        return self.count() - before

    def _checked(self, claims: Iterable[tuple]) -> Iterable[tuple]:
        for claim in claims:
            source, source_field, meaning = claim[3], claim[4], claim[5]
            if meaning not in MEANINGS:
                raise ValueError(f"{source} {source_field}: meaning {meaning!r} is not in the claim vocabulary")
            known = self._meaning.setdefault((source, source_field), meaning)
            if known != meaning:
                raise ValueError(f"{source} {source_field} read with two meanings: {known} and {meaning}")
            yield claim

    def count(self) -> int:
        return self.db.execute("SELECT count(*) FROM claims").fetchone()[0]

    def rows(self, meaning: str, source: str | None = None) -> list[tuple[str, str]]:
        """(subject_key, value) pairs of one meaning."""
        sql, args = "SELECT subject_key, value FROM claims WHERE meaning = ?", [meaning]
        if source:
            sql, args = sql + " AND source = ?", args + [source]
        return self.db.execute(sql, args).fetchall()

    def put(self, table: str, name: str, value: dict) -> None:
        column = "fingerprint" if table == "fingerprints" else "report"
        key = "source" if table == "fingerprints" else "name"
        with self.db:
            self.db.execute(f"INSERT OR REPLACE INTO {table} ({key}, {column}) VALUES (?, ?)", (name, json.dumps(value)))

    def diff(self, rows: Iterable[tuple]) -> None:
        with self.db:
            self.db.executemany("INSERT INTO diff VALUES (?, ?, ?, ?, ?, ?, ?, ?)", rows)

    def close(self, keep: bool = True) -> None:
        self.db.commit()
        self.db.close()
        if keep:
            self.part.replace(self.path)
        else:
            self.part.unlink(missing_ok=True)


def claims_file(reference: Path) -> Path:
    """The claims file of a snapshot: `claims-<date>.sqlite3` beside `reference-<date>.sqlite3`."""
    return reference.with_name(reference.name.replace("reference-", "claims-", 1))


def previous_claims(path: Path) -> Path | None:
    """The next older claims file beside `path` (files are named by build date)."""
    older = [p for p in sorted(path.parent.glob("claims-*.sqlite3")) if p.name < path.name]
    return older[-1] if older else None


def stored(path: Path | None, table: str, name: str) -> dict | None:
    """A fingerprint or report from a finished claims file, or None when there is none."""
    if path is None or not path.exists():
        return None
    column, key = ("fingerprint", "source") if table == "fingerprints" else ("report", "name")
    try:
        with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as db:
            row = db.execute(f"SELECT {column} FROM {table} WHERE {key} = ?", (name,)).fetchone()
    except sqlite3.DatabaseError:  # not a claims file (a snapshot not named reference-<date>, or a damaged file)
        return None
    return json.loads(row[0]) if row else None
