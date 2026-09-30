"""Conflict questions core raises about a subject, the reference's or one only the device holds, when it is touched
(ADR 0044 A2; ADR 0037, amendments of 2026-09-30).

They are tagged and answered like the reference build's questions (`build_questions`), and the user's answer is a
local override:

- **A contested fact.** Assertions of one of the subject's single-valued identifiers by different sources disagree
  (`evidence.weigh`), so no value applies. The candidates are the subjects each value names under the subject-key
  rule, and the answer gives the subject that value. A value that names no subject (a composite FIGI) leaves the
  fact contested and shown, but unasked.
- **An answer the release contradicts.** The installed release names another issuer, underlying or identifier value
  than the user's answer, or gives a registrant the user matched to a company identifiers of its own
  (`build_questions.load_subject`). The answer stays applied until the user answers this question, whose candidates
  are the two, except that a registrant's own identifiers refuse both the company the user matched it to and "none":
  that question offers the registrant alone (`build_questions.itself`).

- **One plugin contradicting itself.** A record kept as a conflict whose plugin earlier stated another value of an
  identifier contests nothing (one source never contests itself), so `restated` asks about it: the candidates are the
  subjects its two values name.

A plugin's evidence counts here as on the subject's page (`device.merge`, or `device.load` for a subject only the
device holds): an enabled plugin whose record contradicts a fact the package, or another plugin, states contests it,
so the conflict is asked about once, when the subject becomes relevant (ADR 0037, amendments "ingest" and "questions
and overrides for plugin-introduced subjects"). The question is tagged with the plugins whose statements it is about,
which Repairs shows as its source.

Each is asked once per question key, like the build's (`build_questions.import_build`).
"""
from __future__ import annotations

import json
import sqlite3
from typing import Iterable

from . import build_questions, device
from .build_questions import BUILD, EPOCH
from .claims import RecordClaim
from .model import evidence_id
from .resolution import QueueItem
from .schemes import SCHEME_LEVEL, SINGLE_VALUED, subject_id, subject_kind, subject_level
from .vocabulary import IdentifierRole


def raised(ref: sqlite3.Connection, store, subject_ids: Iterable[str], plugins: Iterable = ()) -> list[QueueItem]:
    """The conflict questions these subjects' pages raise, their listing's, security's and issuer's facts included,
    with the enabled `plugins`' evidence."""
    items: list[QueueItem] = []
    plugins = list(plugins)
    for touched in dict.fromkeys(subject_ids):
        try:  # a saved ID through its device aliases: the package's subject, else one only the device holds
            touched = device.current_id(ref, store, touched)
            subject = build_questions.load_subject(ref, touched, None, store, plugins) \
                or build_questions.load_device(ref, store, touched, plugins)
        except ValueError:  # a malformed subject ID asks nothing
            continue
        items += [*about(subject), *restated(ref, store, subject)] if subject else []
    return items


def about(subject: dict) -> list[QueueItem]:
    """One loaded subject's contested facts and the answers its release contradicts, as open questions."""
    items = []
    for scheme, found in sorted(subject["contested"].items()):
        owner, values = found[0].subject_id, sorted({item.value for item in found})
        named = [subject_id(subject_level(owner), {scheme: value}) for value in values]
        if None not in named and len(set(named)) == len(named):
            by = subject.get("contributed", {})  # the plugins that stated them on the device, else the package did
            items.append(_question("identifier", (owner,), named, [item.evidence_id for item in found], scheme, values,
                                   sorted({by[item.evidence_id] for item in found if item.evidence_id in by})))
    for answer in subject["contradicted"]:
        itself = answer["release"] == answer["question"] and not build_questions.own_identifier(
            {"reason": answer["reason"], "scheme": answer["scheme"], "subject_ids": [answer["question"]]})
        items.append(_question("binding", (answer["question"], answer["release"]),
                               (answer["release"],) if itself else (answer["chosen"], answer["release"]),
                               [evidence_id({"kind": "verdict", "verdict": answer["verdict"]})], answer["scheme"],
                               answer["values"]))
    return items


def restated(ref: sqlite3.Connection | None, store, subject: dict) -> list[QueueItem]:
    """A catalogue record kept as a conflict because its plugin now states another value of an identifier than it did
    (a line whose ID spells an ISIN, its record now naming another). One plugin contradicting itself contests no fact
    (`evidence.disagree`), so the question is about the record's subject, here a device one, with the subjects the
    two values name as candidates: its own identifier's value, or its parent's (`device_parents`)."""
    family, items = [value for value in subject["ids"].values() if value], []
    for plugin, scope, native, text, at in store.select(
            "SELECT plugin, native_scope, native_id, claim, subject_id FROM claims WHERE state = 'conflict' AND scope IS"
            " NOT NULL AND subject_id IN (SELECT value FROM json_each(?))", (json.dumps(family),)):
        kind = subject_kind(at)
        if ref is not None and device.in_reference(ref, at):  # the package's subject: its contested facts, above
            continue
        for stated in RecordClaim(**json.loads(text)).identifiers:
            level = SCHEME_LEVEL[stated.scheme]
            if stated.role is not IdentifierRole.SELF or stated.scheme not in SINGLE_VALUED or (
                    kind != level and device.PARENT.get(kind) != level):
                continue
            before = store.select(
                "SELECT value, evidence_id FROM device_assertions WHERE plugin = ? AND native_scope = ? AND native_id = ?"
                " AND scheme = ? AND role = 'self' AND value <> ?", (plugin, scope, native, str(stated.scheme), stated.value))
            values = sorted({stated.value, *(row["value"] for row in before)})
            named = [subject_id(level, {stated.scheme: value}) for value in values]
            if before and None not in named and len(set(named)) == len(named):
                items.append(_question("identifier", (at,), named, [row["evidence_id"] for row in before],
                                       str(stated.scheme), values, [plugin]))
    return items


def _question(reason: str, subjects, candidates, cited, scheme, values, plugins=()) -> QueueItem:
    """An open question core asks: tagged `reference`, then the plugins whose statements it is about."""
    return QueueItem(id="core", kind="conflict", reason=reason, subject_ids=tuple(dict.fromkeys(subjects)),
                     candidate_ids=tuple(candidates), evidence_ids=tuple(dict.fromkeys(cited)), state="open",
                     opened_at=EPOCH, plugins=(BUILD, *plugins), scheme=scheme, values=tuple(values))
