"""A subject from the reference file: its listing, security and issuer, identifiers and related subjects.

Read-only and local; page composition (`page`) and search build on it.
"""
from __future__ import annotations

import sqlite3
from typing import Any, Mapping

from . import evidence as weighing
from .model import IdentifierAssertion
from .schemes import INSTRUMENT_KINDS, Level, subject_kind, subject_level
from .vocabulary import RELATIONS, Grouping


def current_id(ref: sqlite3.Connection, subject_id: str, declared: Mapping[str, str] = {}) -> str:
    """The ID this reference gives a subject: `id_aliases` followed to its end, each step also through `declared`, the
    provisional IDs confirm-level contracts alias to the subjects they address (`declared.aliases`). A cycle is a
    defect: its IDs stay as they are."""
    def step(old: str) -> str | None:
        row = ref.execute("SELECT new_id FROM id_aliases WHERE old_id = ?", (old,)).fetchone()
        return row[0] if row else declared.get(old)

    seen = [subject_id]
    while (new := step(seen[-1])) is not None:
        if new in seen:
            return subject_id
        seen.append(new)
    return seen[-1]


def load_subject(ref: sqlite3.Connection, subject_id: str, listing_id: str | None = None) -> dict[str, Any] | None:
    """The subject with its listing, security and issuer (whichever exist), or None if unknown. The reference
    holds instruments only: a subject of another kind is unknown here. A security or issuer subject is priced
    through `listing_id` when that is one of its security's lines, else through its primary (else first) line.

    An ID the reference no longer holds (an older key rule, a re-key, another build path)
    resolves through `id_aliases` (ADR 0037); the result carries the current ID.

    Its assertions count at the package's trust level (`evidence.weigh`): `evidence` proves and blocks only at
    confirm, `shown` is display-level, and a contested scheme has no value.
    """
    if subject_kind(subject_id) not in INSTRUMENT_KINDS:
        return None
    subject_id = current_id(ref, subject_id)
    level = subject_level(subject_id)
    one = lambda sql, *args: ref.execute(sql, args).fetchone()  # noqa: E731
    listing = security = issuer = None
    if level is Level.LISTING:
        listing = one("SELECT * FROM listings WHERE id = ?", subject_id)
        security = listing and one("SELECT * FROM securities WHERE id = ?", listing["security_id"])
    elif level is Level.SECURITY:
        security = one("SELECT * FROM securities WHERE id = ?", subject_id)
    elif level is Level.ISSUER:
        issuer = one("SELECT * FROM issuers WHERE id = ?", subject_id)
        security = issuer and one("SELECT * FROM securities WHERE issuer_id = ? ORDER BY kind <> 'ordinary', status <> 'active',"
                                  " rank IS NULL, rank LIMIT 1", subject_id)
    if (listing or security or issuer) is None:
        return None
    if security is not None and listing is None and listing_id:
        listing = one("SELECT * FROM listings WHERE id = ? AND security_id = ?", listing_id, security["id"])
    if security is not None and listing is None:
        listing = one("SELECT * FROM listings WHERE security_id = ? ORDER BY is_primary DESC, status <> 'active', id LIMIT 1",
                      security["id"])
    if security is not None and issuer is None and security["issuer_id"]:
        issuer = one("SELECT * FROM issuers WHERE id = ?", security["issuer_id"])
    ids = {Level.LISTING: listing and listing["id"], Level.SECURITY: security and security["id"],
           Level.ISSUER: issuer and issuer["id"], Level.COMPOSITE: listing and listing["composite_id"]}
    subjects = [value for value in ids.values() if value]
    rows = ref.execute(f"SELECT * FROM assertions WHERE subject_id IN ({','.join('?' * len(subjects))}) ORDER BY rowid",
                       subjects).fetchall()  # stored order: one source's several values keep their first
    trust = weighing.level(ref)
    weighed = weighing.weigh((_assertion(row) for row in rows), trust)
    if listing is not None and listing["status"] == "inactive":  # a delisted line's ticker may name another company
        weighed["values"].pop("ticker_mic", None)
    venues = {row["mic"]: row["name"] for row in ref.execute("SELECT mic, name FROM venues")}
    siblings = ref.execute("SELECT * FROM listings WHERE security_id = ? AND status <> 'inactive'"
                           " ORDER BY is_primary DESC, operating_mic, id", (security["id"],)).fetchall() if security else []
    name = (issuer["name"] if issuer and (security is None or security["asset_class"] != "crypto") else None) or (
        security["name"] if security else subject_id)
    subject = {
        "id": subject_id, "level": level, "ids": ids, **weighed, "trust": trust,
        "asset_class": security["asset_class"] if security else None,
        "kind": security["kind"] if security else None,
        "security": security, "listing": listing,
        "view": {
            "subject": {"id": subject_id, "level": str(level), "name": name, "kind": security["kind"] if security else None,
                        "listing": listing["id"] if listing else None},
            "identifiers": {},
            "issuer": {"id": issuer["id"], "name": issuer["name"]} if issuer else None,
            "security": {"id": security["id"], "name": security["name"]} if security else None,
            "listings": [{"id": row["id"], "ticker": row["ticker"], "mic": row["operating_mic"] or row["mic"],
                          "venue": venues.get(row["mic"] or ""), "currency": row["trading_currency"], "primary": bool(row["is_primary"])}
                         for row in siblings],
            "related": related(ref, subjects),
        },
    }
    weighing.show(subject)
    return subject


RELATED = tuple(type for type, rule in RELATIONS.items() if rule.grouping is Grouping.RELATED)


def related(ref: sqlite3.Connection, subject_ids: list[str]) -> list[dict[str, Any]]:
    """Subjects linked to these by a `related` relation (a wrapped token, a fund's index, a successor), in either
    direction: each its own subject, for display beside the page, never merged into it. `fold` relations are not
    listed: they fold into the page's listings instead."""
    if not subject_ids:
        return []
    marks, types = ",".join("?" * len(subject_ids)), ",".join("?" * len(RELATED))
    rows = ref.execute(
        f"SELECT type, from_id, to_id FROM relations WHERE type IN ({types}) AND (from_id IN ({marks}) OR to_id IN ({marks}))"
        " ORDER BY type, from_id, to_id", (*RELATED, *subject_ids, *subject_ids)).fetchall()
    out: dict[tuple[str, str, str], None] = {}
    for type, start, end in rows:
        outgoing = start in subject_ids
        out.setdefault((end if outgoing else start, type, "to" if outgoing else "from"))
    names = dict(ref.execute(f"SELECT id, name FROM securities WHERE id IN ({','.join('?' * len(out))})"
                             " UNION ALL SELECT id, name FROM issuers WHERE id IN"
                             f" ({','.join('?' * len(out))})", [key[0] for key in out] * 2)) if out else {}
    return [{"id": other, "type": type, "direction": direction, "kind": subject_kind(other), "name": names.get(other)}
            for other, type, direction in out]


def name_of(ref: sqlite3.Connection, subject_id: str) -> str | None:
    """The reference's name for a security or issuer, and for a listing the name its page shows: its security's."""
    found = ref.execute(
        "SELECT name FROM securities WHERE id = :id UNION ALL SELECT name FROM issuers WHERE id = :id UNION ALL"
        " SELECT s.name FROM listings l JOIN securities s ON s.id = l.security_id WHERE l.id = :id",
        {"id": subject_id}).fetchone()
    return found[0] if found else None


def _assertion(row: sqlite3.Row) -> IdentifierAssertion:
    """A stored assertion; its authority is the kind of evidence it is (reference.sql admits kinds only)."""
    return IdentifierAssertion(
        subject_id=row["subject_id"], scheme=row["scheme"], value=row["value"], authority=row["authority"],
        provenance={"plugin": row["plugin"], "source": row["source"], "adapter_version": row["adapter_version"],
                    "retrieved_at": row["retrieved_at"], "source_record": row["source_record"]},
        validity={"valid_from": row["valid_from"], "valid_to": row["valid_to"]})
