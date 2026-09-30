"""A receipt's issuer is its underlying's (ESMA Q&A 1503; ADR 0037, amendment of 2026-09-30).

FIRDS fills a receipt's issuer field with the venue's or a programme operator's LEI where the issuer did not request
admission. So the issuer the user chose for the share a receipt represents applies to the receipt too, without asking
again. It applies only where the receipt's underlying is settled: the user answered it, or a source states it (a
`source_asserted` relation, never the builder's issuer rule, which derives it from the issuer) and no enabled plugin
contradicts it. `build_questions.answered` applies it as the user's issuer answer, marked `inherited_from` (the
underlying and the user's verdict) and raising no question for the release's differing issuer. The user's answer about
the receipt's own issuer wins, a dismissal ("none of these") included, and reopening the underlying's answer ends it.
A receipt's open issuer question is withdrawn when the user answers (`withdraw`) and, for an answer given earlier, on
the next touch (`unasked`). Standard library only.
"""
from __future__ import annotations

import json
import sqlite3
from typing import Any, Callable, Iterable

from .evidence import PACKAGE
from .resolution import QueueItem
from .schemes import SCHEME_LEVEL, Level, subject_kind
from .vocabulary import VerdictRelation

RECEIPT, ISSUER = str(VerdictRelation.DEPOSITARY_RECEIPT_OF), str(VerdictRelation.SAME_ISSUER)


def answer(ref: sqlite3.Connection, store, subject: dict[str, Any]) -> dict[str, Any] | None:
    """The issuer answer the subject's security inherits, in `build_questions.answered`'s shape, or None. The
    underlying is the user's receipt answer (`subject["underlying"]`), else the one share the package states."""
    receipt = subject["ids"].get(Level.SECURITY)
    if not receipt:
        return None
    underlying = subject.get("underlying")
    if underlying is None:
        stated = [row[0] for row in ref.execute(
            "SELECT to_id FROM relations WHERE type = ? AND from_id = ? AND authority = 'source_asserted'",
            (RECEIPT, receipt))]
        contested = any(entry["type"] == RECEIPT and entry.get("contested") for entry in subject["view"]["related"])
        underlying = stated[0] if len(stated) == 1 and not contested else None
    if underlying is None or underlying == receipt or subject_kind(underlying) != "security":
        return None
    if store.select("SELECT 1 FROM queue q JOIN verdicts v ON v.id = q.resolved_by WHERE json_extract(q.plugins, '$[0]') = ?"
                    " AND q.provider_ref IS NULL AND q.state = 'dismissed' AND q.reason = 'identifier' AND v.resolver = 'user'"
                    " AND json_extract(q.subject_ids, '$[0]') = ? LIMIT 1", (PACKAGE, receipt)):
        return None  # the user said none of the receipt's own candidates is its issuer
    found = store.select(
        "SELECT v.id, v.chosen_id FROM queue q JOIN verdicts v ON v.id = q.resolved_by WHERE json_extract(q.plugins, '$[0]') = ?"
        " AND q.provider_ref IS NULL AND q.state = 'resolved' AND v.resolver = 'user' AND v.relation = ?"
        " AND json_extract(q.subject_ids, '$[0]') IN (SELECT value FROM json_each(?)) ORDER BY v.created_at DESC LIMIT 1",
        (PACKAGE, ISSUER, json.dumps([underlying])))
    if not found or not found[0][1]:
        return None
    return {"question": receipt, "reason": "identifier", "scheme": None, "verdict": found[0][0], "chosen": found[0][1],
            "inherited": underlying}


def unasked(store, items: Iterable[QueueItem], now: str, load: Callable[[str], dict[str, Any] | None]) -> list[QueueItem]:
    """Those of these build questions the inherited issuer does not answer: who issued a security whose loaded page
    (`load`) has an inherited issuer. One already open is superseded (`supersede`)."""
    kept, inherited = [], []
    for item in items:
        issuer = item.reason == "identifier" and subject_kind(item.subject_ids[0]) == "security" \
            and SCHEME_LEVEL.get(item.scheme) is Level.ISSUER
        (inherited if issuer and inheriting(load(item.subject_ids[0])) else kept).append(item)
    supersede(store, [item.key for item in inherited], now)
    return kept


def withdraw(store, ref: sqlite3.Connection, answer: dict[str, Any], now: str, load: Callable[[str], dict[str, Any] | None]) -> None:
    """The user just answered a build question (`answer`: its relation and subject): the open issuer question of each
    receipt that now inherits an issuer from it is superseded. Called inside the answer's transaction."""
    if answer["relation"] == RECEIPT:
        receipts = [answer["subject"]]
    elif answer["relation"] == ISSUER and subject_kind(answer["subject"]) == "security":
        receipts = [row[0] for row in ref.execute(
            "SELECT from_id FROM relations WHERE type = ? AND to_id = ? AND authority = 'source_asserted'",
            (RECEIPT, answer["subject"]))]
    else:
        return
    if not receipts:
        return
    rows = store.select("SELECT key, subject_ids FROM queue WHERE state = 'open' AND provider_ref IS NULL AND reason = 'identifier'"
                        " AND json_extract(plugins, '$[0]') = ? AND json_extract(subject_ids, '$[0]') IN"
                        " (SELECT value FROM json_each(?))", (PACKAGE, json.dumps(receipts)))
    supersede(store, [key for key, subjects in rows if inheriting(load(json.loads(subjects)[0]))], now)


def inheriting(subject: dict[str, Any] | None) -> bool:
    return bool(subject and (subject["view"]["issuer"] or {}).get("inherited_from"))


def supersede(store, keys: list[str], now: str) -> None:
    """Supersede these open build questions. It returns on a later touch if the user undoes the underlying's answer.
    A write lock is taken only where one is open, so a read that finds none takes none."""
    marks = json.dumps(keys)
    if keys and store.select("SELECT 1 FROM queue WHERE state = 'open' AND provider_ref IS NULL AND json_extract(plugins, '$[0]') = ?"
                             " AND key IN (SELECT value FROM json_each(?)) LIMIT 1", (PACKAGE, marks)):
        with store.transaction():
            store.db.execute("UPDATE queue SET state = 'superseded', updated_at = ? WHERE state = 'open' AND provider_ref IS NULL"
                             " AND json_extract(plugins, '$[0]') = ? AND key IN (SELECT value FROM json_each(?))",
                             (now, PACKAGE, marks))
