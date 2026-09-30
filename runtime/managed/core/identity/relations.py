"""Plugin relations beside the reference package's (ADR 0037, amendment "ingest"; ADR 0044 A1 and A2).

Core's ingest keeps a plugin's relations in identity.sqlite3's `relations`, each with its plugin. A relation whose
subject has one target of its type (`ONE_TARGET`: a receipt represents one share) contradicts the package's relation
of that type from the same subject to another. A confirm-level plugin's contradiction makes the package relation
contested: it is still shown, marked, but not applied, so a contested receipt is not folded into its share's listings
(`search.Directory`). A display-level plugin's relation is only shown, and a relation the package states too changes
nothing. Standard library only.
"""
from __future__ import annotations

import json
import sqlite3
from typing import Any, Callable, Iterable, Mapping

from .model import Relation, evidence_id
from .schemes import subject_kind
from .trust import CONFIRM
from .vocabulary import FOLD, ONE_TARGET, Authority

Edge = tuple[str, str, str]  # (type, from_id, to_id)


def keep(store, ref: sqlite3.Connection | None, plugin: str, claim, start: str, end: str) -> tuple[str, bool]:
    """Keep a plugin's relation claim between two subjects (`ingest`), inside the caller's transaction: its one current
    target of a one-target type replaces its earlier one. Returns the outcome (`conflicts` where it gives the subject
    another target than the package's, `rejected` where the subjects' kinds do not fit it) and whether a row changed."""
    try:
        relation = Relation(type=claim.type, from_id=start, to_id=end, authority=Authority.SOURCE_ASSERTED,
                            provenance=claim.provenance, validity=claim.validity, ratio=claim.ratio)
    except ValueError:
        return "rejected", False
    row = {"type": str(relation.type), "from_id": start, "to_id": end, "ratio": relation.ratio,
           "valid_from": relation.validity.valid_from, "valid_to": relation.validity.valid_to,
           "authority": str(relation.authority), "source": relation.provenance.source, "plugin": plugin,
           "retrieved_at": relation.provenance.retrieved_at, "source_record": relation.provenance.source_record,
           "source_version": relation.provenance.source_version, "adapter_version": relation.provenance.adapter_version}
    db = store.db
    before, one = db.total_changes, relation.type in ONE_TARGET
    if one:
        db.execute("DELETE FROM relations WHERE plugin = ? AND type = ? AND from_id = ? AND to_id <> ?",
                   (plugin, row["type"], start, end))
    db.execute(f"INSERT OR IGNORE INTO relations (evidence_id, {','.join(row)}) VALUES ({','.join('?' * (len(row) + 1))})",
               (relation_id(row), *row.values()))
    disputed = one and ref is not None and ref.execute("SELECT 1 FROM relations WHERE type = ? AND from_id = ? AND"
                                                       " to_id <> ?", (row["type"], start, end)).fetchone()
    return "conflicts" if disputed else "joined", db.total_changes != before


def contested(store, granted: Mapping[str, str], types: Iterable[str] = ONE_TARGET) -> frozenset[Edge]:
    """The one-target relations of `types` confirm-level plugins state (`granted`: each plugin's level,
    `device.levels`): each contests a package relation of its type from the same subject to another subject
    (`contests`)."""
    rows = store.select("SELECT type, from_id, to_id, plugin FROM relations WHERE type IN (SELECT value FROM json_each(?))",
                        (json.dumps(sorted(types)),))
    return frozenset((type, start, end) for type, start, end, plugin in rows if granted.get(plugin) == CONFIRM)


def contests(edge: Edge, claims: Iterable[Edge]) -> bool:
    """Whether a plugin relation in `claims` gives this package relation's subject another target of its type."""
    type, start, end = edge
    return any(claim[0] == type and claim[1] == start and claim[2] != end for claim in claims)


def device_rows(store, subject_ids: list[str]) -> list[tuple[str, str, str, str]]:
    """The plugin relations touching these subjects, as (type, from_id, to_id, plugin)."""
    marks = json.dumps(subject_ids)
    return [tuple(row) for row in store.select(
        "SELECT type, from_id, to_id, plugin FROM relations WHERE from_id IN (SELECT value FROM json_each(?)) OR to_id IN"
        " (SELECT value FROM json_each(?)) ORDER BY type, from_id, to_id, plugin", (marks, marks))]


def related(ref: sqlite3.Connection | None, store, subject_ids: list[str], granted: Mapping[str, str],
            name: Callable[[str], str | None]) -> list[dict[str, Any]]:
    """The subjects related to these, in either direction: the package's `related` relations, and its `fold` ones a
    confirm-level plugin contests (then shown, not folded), each contested one marked `contested`; then the plugins'
    relations the package does not state (a pool's protocol), each with its plugin as `source` and marked `contested`
    where a confirm-level one contradicts the package's."""
    claims = contested(store, granted)
    marks = json.dumps(subject_ids)
    package = [tuple(row) for row in ref.execute(
        "SELECT type, from_id, to_id FROM relations WHERE from_id IN (SELECT value FROM json_each(?)) OR to_id IN"
        " (SELECT value FROM json_each(?)) ORDER BY type, from_id, to_id", (marks, marks))] if ref is not None else []
    out: dict[tuple[str, str, str], dict] = {}

    def add(type: str, start: str, end: str, **extra: Any) -> None:
        outgoing = start in subject_ids
        out.setdefault((end if outgoing else start, type, "to" if outgoing else "from"), extra)
    for edge in package:
        disputed = contests(edge, claims)
        if edge[0] not in FOLD or disputed:  # an undisputed fold relation folds into the page's listings instead
            add(*edge, **({"contested": True} if disputed else {}))
    for type, start, end, plugin in device_rows(store, subject_ids):
        if (type, start, end) not in package:  # one the package states too changes nothing
            disputed = (type, start, end) in claims and any(edge[:2] == (type, start) for edge in package)
            add(type, start, end, source=plugin, **({"contested": True} if disputed else {}))
    return [{"id": other, "type": type, "direction": direction, "kind": subject_kind(other), "name": name(other),
             **extra} for (other, type, direction), extra in out.items()]


def relation_id(row: Mapping[str, Any]) -> str:
    """A plugin relation's evidence ID, from its stored fields (as `model.Relation` gives it without a source record),
    so the ID a re-key gives it follows its new ends."""
    return evidence_id({"kind": "relation", "type": row["type"], "from_id": row["from_id"], "to_id": row["to_id"],
                        "from": row["valid_from"], "source": row["source"], "record": None})
