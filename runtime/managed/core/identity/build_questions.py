"""The reference build's open questions (its package's `claims` file) and the user's answers to them (ADR 0044 A2).

A question is queued only when its instrument becomes relevant: the investor opens or watches it, or the agent
uses it (`queue_ops.surface`). Each is asked once, and a new release supersedes the open ones
(`queue.retire_build`). Not queued, and counted in the log once per package: `home_market`, since which listing
is an instrument's home is a choice (A5), even from an older package; a question with no candidate, whose only
answer is "None of these" while the page already says the fact is unknown; and a malformed one.

An answer takes the question's one relation. The agent's answer is a suggestion that leaves the question open.
The user's answer resolves it with a `user_attested` verdict, unless identifier evidence contradicts it
(`queue.submit`). That resolved row is the local override every read applies (`load_subject`): an issuer answer
gives the security that issuer, and a receipt answer adds a `related` entry. It stays applied until the user
reopens the question (`reopen`).
"""
from __future__ import annotations

import json
import logging
import sqlite3
import uuid
from collections import Counter
from dataclasses import replace
from pathlib import Path
from typing import Any, Iterable

from . import reference_package
from .claims import IdentifierValue
from .resolution import QueueItem
from .schemes import SCHEME_LEVEL, Level, subject_kind
from .subject import _assertion
from .subject import load_subject as load_reference_subject
from .vocabulary import Authority, VerdictRelation

logger = logging.getLogger(__name__)
BUILD = "reference"         # the `plugins` tag of the build's questions, which carry no provider record
LABEL = "Pythia reference"  # the source Repairs shows: it names the origin and grants no authority
EPOCH = "1970-01-01T00:00:00Z"  # an indexed question's placeholder `opened_at`; queueing sets the real one
# The build's question types (tooling/reference-builder `QUESTION_SHAPE`) by queue reason, and the one relation an
# answer takes: `issuer_identity` (who issued a security, or which company an issuer is), the name-only
# `issuer_identity_name_candidate`, `receipt_underlying` and `receipt_conflict`.
RELATIONS = {"identifier": VerdictRelation.SAME_ISSUER, "ambiguous": VerdictRelation.SAME_ISSUER,
             "no_key": VerdictRelation.DEPOSITARY_RECEIPT_OF, "relation": VerdictRelation.DEPOSITARY_RECEIPT_OF}
_INDEX: dict[str, dict[str, list[QueueItem]]] = {}  # installed package -> subject -> its queueable questions
_UNREADABLE: set[str] = set()  # packages whose claims file could not be read, warned about once


def is_build(row: dict) -> bool:
    """A reference build question: the tag, and no provider record (SQL: `plugins = '["reference"]' AND
    provider_ref IS NULL`). No plugin can take the tag: `reference` is a reserved plugin name (`manifest`)."""
    return row["plugins"] == [BUILD] and not row["provider_ref"]


def asked(item: dict) -> tuple[str, VerdictRelation] | None:
    """The question's text and the relation its answer takes, or None for a question core does not ask:
    `home_market`, a residual `ambiguous` about a security."""
    relation, issuer = RELATIONS.get(item["reason"]), subject_kind(item["subject_ids"][0]) == "issuer"
    if relation is None or (item["reason"] == "ambiguous" and not issuer):
        return None
    scheme = (item.get("scheme") or "").upper()
    values = ", ".join(f"{scheme} {value}".strip() for value in item.get("values") or ())
    text = {
        "identifier": ("Which company is this? " if issuer else "Who issued this security? ")
        + (f"Its sources name {values}, which does not decide it." if values else "Its sources do not decide it."),
        "ambiguous": "Is this SEC registrant the same company as the issuer its name matches? No identifier links them.",
        "no_key": "Which security does this depositary receipt represent? FIRDS names none the reference data holds.",
        "relation": f"FIRDS classes this security as a share, yet states {values or 'an underlying'} as its "
                    "underlying: which is it?",
    }[item["reason"]]
    return text, relation


def about(path: Path, subject_ids: Iterable[str]) -> list[QueueItem]:
    """The installed package's queueable questions about these subjects. Its claims file is read once; a read that
    fails is not kept, so the next touch reads it again, and is warned about once."""
    index = _INDEX.get(str(path))
    if index is None:
        items = reference_package.questions(path)
        if items is None:
            if str(path) not in _UNREADABLE:
                _UNREADABLE.add(str(path))
                logger.warning("the reference build's questions in %s could not be read", Path(path).parent.name)
            return []
        index = _index(items)
        _INDEX.clear()
        _INDEX[str(path)] = index
    return [item for subject in dict.fromkeys(subject_ids) for item in index.get(subject, ())]


def import_build(store, items: Iterable[QueueItem], now: str) -> int:
    """Queue these build questions, each once: one already open or answered is not asked again, nor one dismissed
    with the same candidates. Only a question a release superseded, or whose candidates changed since it was
    dismissed, returns. A touch of a subject already asked about takes no write lock. Returns how many were added."""
    fresh = _unasked(store, items)
    if not fresh:
        return 0
    with store.transaction():
        fresh = _unasked(store, fresh)  # another thread may have queued them meanwhile
        for item in fresh:
            store.put_queue_item(replace(item, id=_row_id(), opened_at=now))
    return len(fresh)


def reopen(store, item_id: str, now: str, path: Path | None) -> bool:
    """Undo the user's answer: the answered question is superseded, its verdict kept as history, and asked again as
    the installed release asks it (else as it was), so its override no longer applies. False when it is not an
    answered build question."""
    row = store.queue_item(item_id)
    if row is None or row["state"] not in ("resolved", "dismissed") or not is_build(row) or asked(row) is None:
        return False
    latest = next((item for item in about(path, row["subject_ids"]) if item.key == row["key"]), None) if path else None
    with store.transaction():
        if store.db.execute("UPDATE queue SET state = 'superseded', updated_at = ? WHERE id = ? AND state = ?",
                            (now, item_id, row["state"])).rowcount != 1:
            return False  # answered or reopened again meanwhile
        store.put_queue_item(replace(latest, id=_row_id(), opened_at=now) if latest else QueueItem(
            id=_row_id(), kind=row["kind"], reason=row["reason"], subject_ids=row["subject_ids"],
            candidate_ids=row["candidate_ids"], evidence_ids=row["evidence_ids"], state="open", opened_at=now,
            plugins=(BUILD,), scheme=row["scheme"], values=row["values"]))
    return True


def claimed(ref: sqlite3.Connection, item: dict) -> list[IdentifierValue]:
    """What identifies the question's own subject where an answer joins it: its issuer's identifiers for an issuer
    question, which a chosen issuer's must not contradict. A receipt answer relates two instruments: none."""
    found = asked(item)
    subject = load_reference_subject(ref, item["subject_ids"][0]) \
        if found and found[1] is VerdictRelation.SAME_ISSUER else None
    return [IdentifierValue(value.scheme, value.value) for value in subject["evidence"]
            if SCHEME_LEVEL[value.scheme] is Level.ISSUER] if subject else []


def load_subject(ref: sqlite3.Connection, subject_id: str, listing_id: str | None, store) -> dict[str, Any] | None:
    """The reference subject (`subject.load_subject`) with the user's answers about its listing, security or issuer
    applied."""
    subject = load_reference_subject(ref, subject_id, listing_id)
    if subject is None:
        return None
    ids = [value for value in subject["ids"].values() if value]
    rows = store.select(
        "SELECT q.subject_ids, v.relation, v.chosen_id FROM queue q JOIN verdicts v ON v.id = q.resolved_by"
        " WHERE q.plugins = ? AND q.provider_ref IS NULL AND q.state = 'resolved' AND v.resolver = 'user' AND EXISTS"
        " (SELECT 1 FROM (SELECT value FROM json_each(q.subject_ids) UNION ALL SELECT value FROM"
        " json_each(q.candidate_ids)) WHERE value IN (SELECT value FROM json_each(?)))",
        (json.dumps([BUILD]), json.dumps(ids)))
    answers = sorted(((json.loads(row[0])[0], row[1], row[2]) for row in rows),
                     key=lambda answer: subject_kind(answer[0]) == "issuer")  # a security's answer first
    for question, relation, chosen in answers:
        if relation == VerdictRelation.SAME_ISSUER:
            _issuer(ref, subject, question, chosen)
        elif relation == VerdictRelation.DEPOSITARY_RECEIPT_OF:
            _receipt(ref, subject, question, chosen)
    return subject


def _index(items: list[dict]) -> dict[str, list[QueueItem]]:
    """The claims file's queueable questions by subject; the rest are counted in one log line."""
    index: dict[str, list[QueueItem]] = {}
    skipped: Counter[str] = Counter()
    for raw in items:
        try:
            item = QueueItem(id="build", kind=raw["kind"], reason=raw["reason"], subject_ids=raw["subject_ids"],
                             candidate_ids=raw.get("candidate_ids") or (), evidence_ids=raw.get("evidence_ids") or (),
                             state="open", opened_at=EPOCH, plugins=(BUILD,), scheme=raw.get("scheme"),
                             values=raw.get("values") or ())
        except (KeyError, TypeError, ValueError):
            skipped["malformed"] += 1
            continue
        why = "not asked" if asked({**raw, "subject_ids": item.subject_ids}) is None else \
            "without candidates" if not item.candidate_ids else None
        if why:
            skipped[why] += 1
            continue
        # An issuer question is relevant to its candidates' pages too: a CIK-only registrant is on no page.
        filed = item.subject_ids + (item.candidate_ids if subject_kind(item.subject_ids[0]) == "issuer" else ())
        for subject in dict.fromkeys(filed):
            index.setdefault(subject, []).append(item)
    if skipped:
        logger.log(logging.WARNING if skipped["malformed"] else logging.INFO,
                   "reference build questions not queued: %s",
                   ", ".join(f"{count} {why}" for why, count in sorted(skipped.items())))
    return index


def _unasked(store, items: Iterable[QueueItem]) -> list[QueueItem]:
    """Those not open, answered, or dismissed with the same candidates, one per question key."""
    wanted = {item.key: item for item in items}
    if not wanted:
        return []
    rows = store.select("SELECT key, state, candidate_ids FROM queue WHERE state <> 'superseded' AND key IN"
                        " (SELECT value FROM json_each(?))", (json.dumps(list(wanted)),))
    for key, state, candidates in rows:
        if key in wanted and (state != "dismissed" or set(json.loads(candidates)) == set(wanted[key].candidate_ids)):
            del wanted[key]
    return list(wanted.values())


def _issuer(ref: sqlite3.Connection, subject: dict, question: str, chosen: str) -> None:
    """The chosen issuer becomes the security's, in place of any the reference names, so profile and filings route
    to it. A name match joins two issuers: the registrant's page and the chosen issuer's carry both issuers'
    identifiers, the chosen one's first."""
    ids, evidence = subject["ids"], subject["evidence"]
    if question == ids[Level.SECURITY]:
        other, evidence = chosen, [item for item in evidence if SCHEME_LEVEL[item.scheme] is not Level.ISSUER]
    elif question == ids[Level.ISSUER]:
        other = chosen
    elif ids[Level.ISSUER] == chosen and subject_kind(question) == "issuer":
        other = question
    else:
        return
    row = ref.execute("SELECT name FROM issuers WHERE id = ?", (chosen,)).fetchone()
    if row is None:  # the chosen issuer is no longer in the reference
        return
    ids[Level.ISSUER] = chosen
    subject["evidence"] = [*evidence, *(_assertion(item) for item in
                                        ref.execute("SELECT * FROM assertions WHERE subject_id = ?", (other,)))]
    values = subject["values"]
    for scheme in ("lei", "cik"):
        values.pop(scheme, None)
    for item in sorted(subject["evidence"], key=lambda item: item.subject_id != chosen):
        values.setdefault(item.scheme, item.value)
    view = subject["view"]
    view["issuer"] = {"id": chosen, "name": row["name"], "lei": values.get("lei"), "cik": values.get("cik"),
                      "authority": str(Authority.USER_ATTESTED)}
    for scheme in ("lei", "cik"):
        view["identifiers"].pop(scheme, None)
        view["identifiers"].update({scheme: values[scheme]} if values.get(scheme) else {})


def _receipt(ref: sqlite3.Connection, subject: dict, question: str, chosen: str) -> None:
    """A `related` entry on the receipt's page ("to" its share) and on its share's ("from" the receipt)."""
    security = subject["ids"][Level.SECURITY]
    if security not in (question, chosen):
        return
    other, direction = (chosen, "to") if security == question else (question, "from")
    name = ref.execute("SELECT name FROM securities WHERE id = ?", (other,)).fetchone()
    subject["view"]["related"].append({"id": other, "type": str(VerdictRelation.DEPOSITARY_RECEIPT_OF),
                                       "direction": direction, "kind": subject_kind(other),
                                       "name": name[0] if name else None, "authority": str(Authority.USER_ATTESTED)})


def _row_id() -> str:
    return "ref-" + uuid.uuid4().hex[:28]
