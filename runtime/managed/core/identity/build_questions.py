"""The reference build's open questions (its package's `claims` file) and the user's answers to them (ADR 0044 A2).

A question is queued only when its instrument becomes relevant: the investor opens or watches it, or the agent
uses it (`queue_ops.surface`). Each is asked once, and a new release supersedes the open ones
(`queue.retire_build`). Not queued, and counted in the log once per package: `home_market`, since which listing
is an instrument's home is a choice (A5), even from an older package; a question with no candidate, whose only
answer is "None of these" while the page already says the fact is unknown; and a malformed one.

Core asks two more kinds when a subject is touched (`conflicts`), a subject only the device holds included: a fact
different sources contest (or one plugin states twice), and a user's answer the installed release contradicts.
They are tagged and answered like the build's: `reference` first, then the plugins whose statements they are about
(`label`), and `load_device` reads a device subject with the answers applied.

An answer takes the question's one relation. The agent's answer is a suggestion that leaves the question open.
The user's answer resolves it with a `user_attested` verdict, unless unanimous identifier evidence contradicts it
(`queue.submit`). That resolved row is the local override every read applies (`load_subject`): an
issuer answer gives the security that issuer, a receipt answer adds a `related` entry, and an answer to a contested
identifier gives the subject that value. A receipt has the issuer the user chose for its settled underlying, unless
they answered its own (`receipt_issuer`). It stays applied until the user reopens the question (`reopen`) or answers a
later conflict about the same fact (`replace_answer`). The user's direct corrections (`corrections`) are applied last,
above these answers.
"""
from __future__ import annotations

import json
import logging
import sqlite3
import uuid
from collections import Counter
from dataclasses import replace
from pathlib import Path
from typing import Any, Iterable, Mapping

from . import corrections, device, device_parents, receipt_issuer, reference_package
from . import evidence as weighing
from .claims import IdentifierValue
from .resolution import QueueItem
from .schemes import SCHEME_LEVEL, Level, subject_id, subject_kind, subject_level
from .subject import _assertion
from .subject import load_subject as load_reference_subject
from .vocabulary import Authority, VerdictRelation

logger = logging.getLogger(__name__)
BUILD = weighing.PACKAGE    # the `plugins` tag of the build's questions, which carry no provider record
LABEL = "Pythia reference"  # the source Repairs shows: it names the origin and grants no authority
EPOCH = "1970-01-01T00:00:00Z"  # an indexed question's placeholder `opened_at`; queueing sets the real one
# The build's question types (tooling/reference-builder `QUESTION_SHAPE`) by queue reason, and the one relation an
# answer takes: `issuer_identity` (who issued a security, or which company an issuer is), the name-only
# `issuer_identity_name_candidate`, `receipt_underlying` and `receipt_conflict`. An `identifier` question about a
# contested identifier takes its scheme's level, and a `binding` one (an answer a release contradicts) its answer's.
RELATIONS = {"identifier": VerdictRelation.SAME_ISSUER, "ambiguous": VerdictRelation.SAME_ISSUER,
             "no_key": VerdictRelation.DEPOSITARY_RECEIPT_OF, "relation": VerdictRelation.DEPOSITARY_RECEIPT_OF,
             "binding": VerdictRelation.DEPOSITARY_RECEIPT_OF}
SAME = {Level.LISTING: VerdictRelation.SAME_LISTING, Level.COMPOSITE: VerdictRelation.SAME_COMPOSITE,
        Level.SECURITY: VerdictRelation.SAME_SECURITY, Level.ISSUER: VerdictRelation.SAME_ISSUER}
_INDEX: dict[str, dict[str, list[QueueItem]]] = {}  # installed package -> subject -> its queueable questions
_UNREADABLE: set[str] = set()  # packages whose claims file could not be read, warned about once


def is_build(row: dict) -> bool:
    """A question core asks from evidence, not from a provider's record: the tag first, then the plugins whose
    statements it is about (SQL: `json_extract(plugins, '$[0]') = 'reference' AND provider_ref IS NULL`). No plugin
    can take the tag: `reference` is a reserved plugin name (`manifest`)."""
    return row["plugins"][:1] == [BUILD] and not row["provider_ref"]


def label(item: dict, labels: Mapping[str, str] = {}) -> str:
    """The source Repairs shows: the plugins whose statements a question core asked is about, else the build."""
    names = [labels.get(name, name) for name in item["plugins"][1:]]
    return " and ".join(names) if names else LABEL


def asked(item: dict) -> tuple[str, VerdictRelation] | None:
    """The question's text and the relation its answer takes, or None for a question core does not ask:
    `home_market`, a residual `ambiguous` about a security."""
    relation, issuer = RELATIONS.get(item["reason"]), subject_kind(item["subject_ids"][0]) == "issuer"
    if relation is None or (item["reason"] == "ambiguous" and not issuer):
        return None
    scheme = (item.get("scheme") or "").upper().replace("_", " ")
    values = ", ".join(f"{scheme} {value}".strip() for value in item.get("values") or ())
    own, candidates = own_identifier(item), item.get("candidate_ids") or ()
    registrant = item["subject_ids"][0].startswith("issuer:cik:") and scheme == "LEI"  # asked which LEI it holds
    named = own or (Level.SECURITY if device_parents.level(item) is Level.SECURITY else None)  # a line's ISIN: its security
    if named:
        relation = SAME[named]
    elif item["reason"] == "binding" and candidates and subject_kind(candidates[0]) == "issuer":
        relation = VerdictRelation.SAME_ISSUER
    fact = f"its {scheme}" if own else "which security this depositary receipt represents" \
        if relation is not VerdictRelation.SAME_ISSUER else "which company this is" if issuer else "who issued this security"
    if itself(item):
        return ("The installed reference data now gives this company its own LEI or CIK, which rules out the company "
                "you matched it to. Your match stays applied until you answer that it is its own company.", relation)
    text = {
        "identifier": _registrant_link(item, values) if registrant and values else
        (f"Which {scheme} is this? " if named and not issuer else
         "Which company is this? " if issuer else "Who issued this security? ")
        + (f"Its sources name {values}, which does not decide it." if values else "Its sources do not decide it."),
        "binding": f"Your answer and the installed reference data now disagree about {fact}"
                   + (f" ({values})" if values else "") + ". Which is it?",
        "ambiguous": "Is this SEC registrant the same company as the issuer its name matches? No identifier links them.",
        "no_key": "Which security does this depositary receipt represent? FIRDS names none the reference data holds.",
        "relation": f"FIRDS classes this security as a share, yet states {values or 'an underlying'} as its "
                    "underlying: which is it?",
    }[item["reason"]]
    return text, relation


def _registrant_link(item: dict, values: str) -> str:
    """The question of a CIK-only SEC registrant whose identifier links do not decide its LEI (the builder's `_decide`):
    several LEIs claim the CIK, or one LEI is claimed by several registrants whose names match. It names the
    registrant and what it is tied to, so two such questions about one LEI read differently."""
    cik = item["subject_ids"][0].split(":")[2]
    if len(item.get("values") or ()) > 1:
        return (f"Which company is this? CIK {cik} is tied to more than one LEI ({values}), "
                "and nothing decides which is its own.")
    return (f"Which company is this? CIK {cik} and at least one other SEC registrant are tied to {values}, "
            "and their names do not settle which of them it belongs to.")


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
            plugins=tuple(row["plugins"]), scheme=row["scheme"], values=row["values"]))
    return True


def itself(item: dict) -> bool:
    """A question whether a company the user matched to another is its own, raised because the installed release now
    gives it identifiers of its own (`conflicts`). Those identifiers refuse the user's earlier answer and "none" alike,
    so its only candidate is the company itself, and "none" is not offered (`queue.summary`)."""
    return item["reason"] == "binding" and list(item.get("candidate_ids") or ()) == list(item["subject_ids"][:1])


def own_identifier(item: dict) -> Level | None:
    """The level of a question about which value of the subject's own identifier holds, whose candidates are the
    subjects those values name (`conflicts`), else None."""
    scheme, subject = item.get("scheme"), item["subject_ids"][0]
    level = SCHEME_LEVEL.get(scheme) if item["reason"] in ("identifier", "binding") and scheme else None
    return level if level is not None and subject_kind(subject) == level else None


def claimed(ref: sqlite3.Connection, item: dict) -> list[IdentifierValue]:
    """What identifies the question's own subject where an answer joins it: a company's own identifiers for the
    question which company it is, which a chosen issuer's must not contradict; only the values its evidence agrees
    on, so never a contested one. Who issued a security asks about its issuer link, and a receipt
    answer relates two instruments: none, and neither does a contested identifier of a security or a listing."""
    found, question = asked(item), item["subject_ids"][0]
    subject = load_reference_subject(ref, question) \
        if found and found[1] is VerdictRelation.SAME_ISSUER and subject_kind(question) == "issuer" else None
    trusted = {str(value.scheme) for value in subject["evidence"]} if subject else set()
    return [IdentifierValue(scheme, value) for scheme, value in subject["values"].items()
            if scheme in trusted and SCHEME_LEVEL[scheme] is Level.ISSUER] if subject else []


def load_subject(ref: sqlite3.Connection, subject_id: str, listing_id: str | None, store,
                 plugins: Iterable = ()) -> dict[str, Any] | None:
    """The reference subject (`subject.load_subject`) with the device's evidence about it (`device.merge`), and the
    user's answers about its listing, security or issuer applied (`answered`)."""
    subject = load_reference_subject(ref, subject_id, listing_id)
    if subject is None:
        return None
    device.merge(ref, store, subject, plugins)
    return answered(ref, store, subject)


def load_device(ref: sqlite3.Connection | None, store, subject_id: str, plugins: Iterable = ()) -> dict[str, Any] | None:
    """A subject only the device holds (`device.load`, through its device aliases) with the user's answers about it
    applied, the same local override as a reference subject's, read under the parent the user chose for it."""
    subject_id = device.current_id(ref, store, subject_id)
    subject = device.load(ref, store, subject_id, plugins, device_parents.chosen(store, subject_id, BUILD))
    return answered(ref, store, subject, held=True) if subject else None


def answered(ref: sqlite3.Connection | None, store, subject: dict[str, Any], *, held: bool = False) -> dict[str, Any]:
    """Apply the user's resolved answers about the subject's family to it. An answer stays applied where the installed
    release states another value for the same fact; `contradicted` lists those for `conflicts` to ask
    about. With no reference, only an answer that gives a value applies: the others name reference subjects. `held`: a
    subject only the device holds, which `load_device` read under the parents the user chose."""
    subject["contradicted"] = []
    ids = [value for value in subject["ids"].values() if value]
    explicit = False  # the user answered who issued this security itself
    rows = store.select(
        "SELECT q.reason, q.subject_ids, q.scheme, q.contested_values, v.id, v.relation, v.chosen_id FROM queue q"
        " JOIN verdicts v ON v.id = q.resolved_by WHERE json_extract(q.plugins, '$[0]') = ? AND q.provider_ref IS NULL"
        " AND q.state = 'resolved' AND v.resolver = 'user' AND EXISTS"
        " (SELECT 1 FROM (SELECT value FROM json_each(q.subject_ids) UNION ALL SELECT value FROM"
        " json_each(q.candidate_ids)) WHERE value IN (SELECT value FROM json_each(?)))",
        (BUILD, json.dumps(ids)))
    for reason, questions, scheme, values, verdict, relation, chosen in sorted(
            rows, key=lambda row: subject_kind(json.loads(row[1])[0]) == "issuer"):  # a security's answer first
        question = json.loads(questions)[0]
        answer = {"question": question, "reason": reason, "scheme": scheme, "verdict": verdict, "chosen": chosen}
        if ref is not None and relation == VerdictRelation.SAME_ISSUER:
            explicit = explicit or question == subject["ids"].get(Level.SECURITY)
            _issuer(ref, subject, answer)
        elif ref is not None and relation == VerdictRelation.DEPOSITARY_RECEIPT_OF:
            _receipt(ref, subject, answer)
        shape = {"reason": reason, "scheme": scheme, "subject_ids": [question]}
        if own_identifier(shape):
            _value(subject, answer, json.loads(values))
        elif held and device_parents.level(shape):
            device_parents.apply(subject, answer, json.loads(values))
    if ref is not None and not explicit and (inherited := receipt_issuer.answer(ref, store, subject)):
        _issuer(ref, subject, inherited)
    corrections.apply(store, subject)  # the investor's own corrections have the last word (`corrections`)
    weighing.show(subject)
    return subject


def replace_answer(store, row: dict, relation: str, now: str) -> None:
    """The user's answer replaces their earlier one about the same fact (the question's subject and scheme, and the
    relation), which is superseded and kept as history. Called inside the answer's transaction."""
    store.db.execute(
        "UPDATE queue SET state = 'superseded', updated_at = ? WHERE id IN (SELECT q.id FROM queue q JOIN verdicts v"
        " ON v.id = q.resolved_by WHERE json_extract(q.plugins, '$[0]') = ? AND q.provider_ref IS NULL"
        " AND q.state = 'resolved' AND q.id <> ? AND json_extract(q.subject_ids, '$[0]') = ? AND q.scheme IS ?"
        " AND v.relation = ?)",
        (now, BUILD, row["id"], row["subject_ids"][0], row["scheme"], relation))


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


def _contradicted(subject: dict, answer: dict, release: str | None, values: tuple[str, ...] = ()) -> None:
    """Note an answer the installed release contradicts: it names the subject `release` for the same fact (with
    `values`, the answer's value and the release's)."""
    if release is not None and release != answer["chosen"]:
        subject["contradicted"].append({**answer, "release": release, "values": list(values)})


def _issuer(ref: sqlite3.Connection, subject: dict, answer: dict) -> None:
    """The chosen issuer becomes the security's, in place of any the reference names, so profile and filings route
    to it. A name match joins two issuers: the registrant's page and the chosen issuer's carry both issuers'
    identifiers, the chosen one's first. Where the release gives the registrant an LEI or CIK of its own that the
    chosen issuer's differs from, the answer is contradicted: it stays applied, and the registrant is the other
    candidate."""
    ids, question, chosen = subject["ids"], answer["question"], answer["chosen"]
    if chosen == question:  # "this company is itself": an answer to its contested identifier (`_value`)
        return
    drop, own = frozenset(), {}
    if question == ids[Level.SECURITY]:
        if "inherited" not in answer:  # a receipt's own issuer differing from its underlying's is what inheriting fixes
            _contradicted(subject, answer, ids[Level.ISSUER])  # the issuer the release names for the security, if any
        other, drop = chosen, frozenset({Level.ISSUER})
    elif question == ids[Level.ISSUER]:
        other, own = chosen, {scheme: subject["values"].get(scheme) for scheme in ("lei", "cik")}
    elif ids[Level.ISSUER] == chosen and subject_kind(question) == "issuer":
        other = question
    else:
        return
    row = ref.execute("SELECT name FROM issuers WHERE id = ?", (chosen,)).fetchone()
    if row is None:  # the chosen issuer is no longer in the reference
        return
    ids[Level.ISSUER] = chosen
    joined = weighing.weigh(_assertion(item) for item in
                            ref.execute("SELECT * FROM assertions WHERE subject_id = ?", (other,)))
    if any(value and joined["values"].get(scheme) not in (None, value) for scheme, value in own.items()):
        _contradicted(subject, answer, question)
    for name in ("evidence", "shown"):
        subject[name] = [*(item for item in subject[name] if SCHEME_LEVEL[item.scheme] not in drop), *joined[name]]
    values = subject["values"]
    for scheme in ("lei", "cik"):
        values.pop(scheme, None)
        subject["contested"].pop(scheme, None)
    for item in sorted([*subject["evidence"], *subject["shown"]], key=lambda item: item.subject_id != chosen):
        if SCHEME_LEVEL[item.scheme] is Level.ISSUER:  # the user's answer: the chosen issuer's identifiers first
            values.setdefault(item.scheme, item.value)
    subject["view"]["issuer"] = {"id": chosen, "name": row["name"], "authority": str(Authority.USER_ATTESTED),
                                 **({"inherited_from": {"security": answer["inherited"], "verdict": answer["verdict"]}}
                                    if "inherited" in answer else {})}


def _value(subject: dict, answer: dict, values: list[str]) -> None:
    """An answer to a contested identifier: the subject takes the value the chosen candidate names, in place of the
    contested ones or the one the release states."""
    question, scheme = answer["question"], answer["scheme"]
    if question not in subject["ids"].values():
        return
    level = subject_level(question)
    value = next((value for value in values if subject_id(level, {scheme: value}) == answer["chosen"]), None)
    if value is None:
        return
    stated = {item.value for item in subject["evidence"] if str(item.scheme) == scheme}
    release = next(iter(stated)) if len(stated) == 1 else None  # the one value the evidence agrees on, if any
    if release not in (None, value):
        _contradicted(subject, answer, subject_id(level, {scheme: release}), (value, release))
    subject["values"][scheme] = value
    subject["contested"].pop(scheme, None)
    subject.setdefault("attested", set()).add(scheme)  # the user decided it (`evidence.show`'s provenance)


def _receipt(ref: sqlite3.Connection, subject: dict, answer: dict) -> None:
    """A `related` entry on the receipt's page ("to" its share) and on its share's ("from" the receipt)."""
    security, question, chosen = subject["ids"][Level.SECURITY], answer["question"], answer["chosen"]
    if security not in (question, chosen):
        return
    stated = [row[0] for row in ref.execute("SELECT to_id FROM relations WHERE type = ? AND from_id = ? ORDER BY to_id",
                                            (str(VerdictRelation.DEPOSITARY_RECEIPT_OF), question))]
    _contradicted(subject, answer, None if chosen in stated else next(iter(stated), None))
    other, direction = (chosen, "to") if security == question else (question, "from")
    if security == question:
        subject["underlying"] = chosen  # the user's answer settles which share it represents (`_inherit`)
    name = ref.execute("SELECT name FROM securities WHERE id = ?", (other,)).fetchone()
    subject["view"]["related"].append({"id": other, "type": str(VerdictRelation.DEPOSITARY_RECEIPT_OF),
                                       "direction": direction, "kind": subject_kind(other),
                                       "name": name[0] if name else None, "authority": str(Authority.USER_ATTESTED)})


def _row_id() -> str:
    return "ref-" + uuid.uuid4().hex[:28]
