"""The reference build's open questions (its package's `claims` file) and the user's answers to them (ADR 0044 A2).

A question is queued only when its instrument becomes relevant: the investor opens or watches it, or the agent
uses it (`queue_ops.surface`). Each is asked once, and a new release supersedes the open ones
(`queue.retire_build`). Which listing is an instrument's home is a choice, not an identity question (A5), so
`home_market` (an `ambiguous` residual about a security) is never queued, even from an older package.

An answer takes the question's one relation. The agent's answer is a suggestion that leaves the question open.
The user's answer resolves it with a `user_attested` verdict, unless identifier evidence contradicts it
(`queue.submit`). That resolved row is the local override every read applies (`load_subject`): an issuer answer
gives the security that issuer, and a receipt answer adds a `related` entry. It stays applied until the user
reopens the question (`reopen`).
"""
from __future__ import annotations

import sqlite3
import uuid
from dataclasses import replace
from typing import Any, Iterable

from .claims import IdentifierValue
from .resolution import QueueItem
from .schemes import SCHEME_LEVEL, Level, subject_kind
from .subject import _assertion
from .subject import load_subject as load_reference_subject
from .vocabulary import Authority, VerdictRelation

BUILD = "reference"         # the `plugins` tag of the build's questions, which carry no provider record
LABEL = "Pythia reference"  # the source Repairs shows: it names the origin and grants no authority
# The build's question types (tooling/reference-builder `QUESTION_SHAPE`) by queue reason, and the one relation an
# answer takes: `issuer_identity` (who issued a security, or which company an issuer is), the name-only
# `issuer_identity_name_candidate`, `receipt_underlying` and `receipt_conflict`.
RELATIONS = {"identifier": VerdictRelation.SAME_ISSUER, "ambiguous": VerdictRelation.SAME_ISSUER,
             "no_key": VerdictRelation.DEPOSITARY_RECEIPT_OF, "relation": VerdictRelation.DEPOSITARY_RECEIPT_OF}


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


def import_build(store, items: Iterable[dict], now: str) -> int:
    """Queue these build questions, each once: one already open, answered or dismissed is not asked again; only a
    question a release superseded may return. Returns how many were added."""
    added = 0
    with store.transaction():
        for raw in items:
            try:
                item = QueueItem(id="", kind=raw["kind"], reason=raw["reason"], subject_ids=raw["subject_ids"],
                                 candidate_ids=raw.get("candidate_ids") or (), evidence_ids=raw.get("evidence_ids") or (),
                                 state="open", opened_at=now, plugins=(BUILD,), scheme=raw.get("scheme"),
                                 values=raw.get("values") or ())
            except (KeyError, TypeError, ValueError):  # one malformed question never stops the rest
                continue
            if asked({**raw, "subject_ids": item.subject_ids}) is None:
                continue
            if store.db.execute("SELECT 1 FROM queue WHERE key = ? AND state <> 'superseded'", (item.key,)).fetchone():
                continue
            store.put_queue_item(replace(item, id=_row_id()))
            added += 1
    return added


def reopen(store, item_id: str, now: str) -> bool:
    """Undo the user's answer: the answered question is superseded, its verdict kept as history, and asked again,
    so its override no longer applies. False when it is not an answered build question."""
    with store.transaction():
        row = store.queue_item(item_id)
        if row is None or row["state"] not in ("resolved", "dismissed") or row["plugins"] != [BUILD] \
                or row["provider_ref"] or asked(row) is None:
            return False
        store.db.execute("UPDATE queue SET state = 'superseded', updated_at = ? WHERE id = ?", (now, item_id))
        store.put_queue_item(QueueItem(id=_row_id(), kind=row["kind"], reason=row["reason"],
                                       subject_ids=row["subject_ids"], candidate_ids=row["candidate_ids"],
                                       evidence_ids=row["evidence_ids"], state="open", opened_at=now,
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
    rows = store.queue_items(subject_ids=[value for value in subject["ids"].values() if value], plugins=(BUILD,),
                             which="settled")
    for row in sorted(rows, key=lambda row: subject_kind(row["subject_ids"][0]) == "issuer"):  # the security's first
        answer = row["settled"]
        if row["state"] != "resolved" or not answer or answer["by"] != "user":
            continue
        if answer["relation"] == VerdictRelation.SAME_ISSUER:
            _issuer(ref, subject, row["subject_ids"][0], answer["chosen_id"])
        elif answer["relation"] == VerdictRelation.DEPOSITARY_RECEIPT_OF:
            _receipt(ref, subject, row["subject_ids"][0], answer["chosen_id"])
    return subject


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
