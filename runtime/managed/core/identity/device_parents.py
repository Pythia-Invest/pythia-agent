"""The parent a user chose for a device subject (ADR 0037, amendment "questions and overrides for plugin-introduced
subjects").

One plugin that states another value of its parent's identifier than it did (a line whose record now names another
ISIN) is asked which parent the line belongs to (`conflicts.restated`); the candidates are the subjects the two values
name. The user's answer is read, never written: `chosen` gives the parent for `device.load`, which reads the subject
under it, and `apply` shows the chosen value where that parent holds none.
"""
from __future__ import annotations

from typing import Mapping

from . import device
from .schemes import SCHEME_LEVEL, Level, subject_id, subject_kind


def level(item: Mapping) -> Level | None:
    """The level of a question about which value of its subject's parent's identifier holds, else None."""
    scheme, kind = item.get("scheme"), subject_kind(item["subject_ids"][0])
    above = SCHEME_LEVEL.get(scheme) if item["reason"] == "identifier" and scheme else None
    return above if above is not None and kind in device.PARENT and device.PARENT[Level(kind)] is above else None


def chosen(store, subject: str, tag: str) -> dict[str, str]:
    """The parent the user chose for a subject: their resolved answer (a question tagged `tag`) names it."""
    rows = store.select(
        "SELECT q.reason, q.scheme, v.chosen_id FROM queue q JOIN verdicts v ON v.id = q.resolved_by WHERE"
        " json_extract(q.plugins, '$[0]') = ? AND q.provider_ref IS NULL AND q.state = 'resolved' AND"
        " v.resolver = 'user' AND v.chosen_id IS NOT NULL AND json_extract(q.subject_ids, '$[0]') = ?", (tag, subject))
    return {subject: parent for reason, scheme, parent in rows
            if level({"reason": reason, "scheme": scheme, "subject_ids": [subject]})}


def apply(subject: dict, answer: dict, values: list[str]) -> None:
    """The chosen value shows as the parent's, and as the user's, where the parent holds none."""
    scheme = answer["scheme"]
    value = next((value for value in values if subject_id(SCHEME_LEVEL[scheme], {scheme: value}) == answer["chosen"]), None)
    if value is not None and answer["question"] in subject["ids"].values():
        subject["values"].setdefault(scheme, value)
        subject.setdefault("attested", set()).add(scheme)
