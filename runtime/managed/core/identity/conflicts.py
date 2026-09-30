"""Conflict questions core raises about the installed reference when a subject is touched (ADR 0044 A2; ADR 0037,
amendment of 2026-09-30).

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

A plugin's evidence counts here as on the subject's page (`device.merge`): an enabled plugin whose record contradicts
a fact the package states, or another plugin states, contests it, so the conflict is asked about once, when the
subject becomes relevant (ADR 0037, amendment "ingest").

Each is asked once per question key, like the build's (`build_questions.import_build`).
"""
from __future__ import annotations

import sqlite3
from typing import Iterable

from . import build_questions
from .build_questions import BUILD, EPOCH
from .model import evidence_id
from .resolution import QueueItem
from .schemes import subject_id, subject_level


def raised(ref: sqlite3.Connection, store, subject_ids: Iterable[str], plugins: Iterable = ()) -> list[QueueItem]:
    """The conflict questions these subjects' pages raise, their listing's, security's and issuer's facts included,
    with the enabled `plugins`' evidence."""
    items: list[QueueItem] = []
    plugins = list(plugins)
    for touched in dict.fromkeys(subject_ids):
        try:
            subject = build_questions.load_subject(ref, touched, None, store, plugins)
        except ValueError:  # a malformed subject ID asks nothing
            continue
        items += about(subject) if subject else []
    return items


def about(subject: dict) -> list[QueueItem]:
    """One loaded subject's contested facts and the answers its release contradicts, as open questions."""
    items = []
    for scheme, found in sorted(subject["contested"].items()):
        owner, values = found[0].subject_id, sorted({item.value for item in found})
        named = [subject_id(subject_level(owner), {scheme: value}) for value in values]
        if None not in named and len(set(named)) == len(named):
            items.append(_question("identifier", (owner,), named, [item.evidence_id for item in found], scheme, values))
    for answer in subject["contradicted"]:
        itself = answer["release"] == answer["question"] and not build_questions.own_identifier(
            {"reason": answer["reason"], "scheme": answer["scheme"], "subject_ids": [answer["question"]]})
        items.append(_question("binding", (answer["question"], answer["release"]),
                               (answer["release"],) if itself else (answer["chosen"], answer["release"]),
                               [evidence_id({"kind": "verdict", "verdict": answer["verdict"]})], answer["scheme"],
                               answer["values"]))
    return items


def _question(reason: str, subjects, candidates, cited, scheme, values) -> QueueItem:
    return QueueItem(id="core", kind="conflict", reason=reason, subject_ids=tuple(dict.fromkeys(subjects)),
                     candidate_ids=tuple(candidates), evidence_ids=tuple(dict.fromkeys(cited)), state="open",
                     opened_at=EPOCH, plugins=(BUILD,), scheme=scheme, values=tuple(values))
