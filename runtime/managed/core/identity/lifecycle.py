"""Lifecycle A (ADR 0037): the device's identity state follows a new reference release's subject IDs.

A release never rewrites a saved ID: it records each re-key in `id_aliases`, and a device subject's better key is a
`device_aliases` row (`device`). On first use of a release, `rekey` re-points every row of identity.sqlite3 that
names a subject (bindings, queue items, verdicts, resolve misses, read checks, and the device subjects with their
parents, assertions, relations and placed claims) through those chains, once, in one transaction recorded against
the release ID; after writing device aliases, core runs it `again` (with no release installed, for device aliases
alone). Each step also follows the provisional IDs confirm-level contracts alias to the subjects they address
(`declared.aliases`), so a row saved under a coin plugin's provisional ID follows its curated asset although the
package names no provider. A new release that holds a device subject under another ID (a line a plugin introduced,
now in the build) aliases it there first (`covered`). An assertion a row cites moved with its subject, so the row
cites it by the evidence ID the release or the device gives it. A subject neither the release nor the device holds,
nor either aliases, is flagged; its rows are kept.
"""
from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from dataclasses import replace
from typing import Callable, Mapping

from . import device
from . import evidence as weighing
from .model import ProviderRef
from .subject import _assertion, load_subject
from .resolution import question_key
from .schemes import Level, subject_kind
from .store import IdentityStore
from .trust import CONFIRM

REKEYED = "rekeyed_release"     # identity.sqlite3 metadata: the release local rows were last re-pointed through
VANISHED = "vanished_subjects"  # JSON list: reference subjects local rows name that the release neither holds nor aliases
TABLES = {Level.LISTING: "listings", Level.COMPOSITE: "composites", Level.SECURITY: "securities", Level.ISSUER: "issuers"}


def release_id(ref: sqlite3.Connection, fallback: str) -> str:
    """The build ID the release records (the builder writes its file stem), else `fallback`."""
    row = ref.execute("SELECT value FROM release WHERE key = 'release'").fetchone()
    return row[0] if row and row[0] else fallback


def vanished(store: IdentityStore) -> list[str]:
    return json.loads(store.metadata(VANISHED) or "[]")


def rekey(store: IdentityStore, ref: sqlite3.Connection | None, release: str, *, again: bool = False,
          declared: Callable[[], Mapping[str, str]] = dict) -> dict | None:
    """Re-point local rows to the IDs this release and the device's aliases give their subjects; None when it was
    already applied, unless `again` (rows written meanwhile under an older release's IDs, or new device aliases).
    `declared` gives the installed contracts' aliases (`declared.aliases`), read only when a row names a provisional
    ID."""
    db = store.db
    with store.transaction():
        if store.metadata(REKEYED) == release and not again:
            return None
        if store.metadata(REKEYED) != release:  # a release that now holds a device subject: its saved IDs follow
            for old, new in covered(ref, store).items():
                device.put_alias(store, old, new)
        bindings = [dict(row, evidence_ids=json.loads(row["evidence_ids"]))
                    for row in db.execute("SELECT id, subject_id, evidence_ids FROM bindings")]
        queue = [dict(row, **{name: json.loads(row[name]) for name in ("subject_ids", "candidate_ids", "evidence_ids")})
                 for row in db.execute("SELECT * FROM queue")]
        # Subjects a reference release named when the row was written; a residual's subject is the device's own.
        cited = {row["subject_id"] for row in bindings} | device.named(store)  # device parents may be the release's
        cited.update(value for (value,) in db.execute("SELECT chosen_id FROM verdicts WHERE chosen_id IS NOT NULL"))
        for item in queue:
            cited.update(item["candidate_ids"], item["subject_ids"] if item["kind"] == "conflict" else ())
        named = cited | {value for item in queue for value in item["subject_ids"]} | {
            value for (value,) in db.execute("SELECT subject_id FROM resolve_misses UNION SELECT subject_id FROM read_checks")}
        aliases = declared() if any(":provisional:" in value for value in named) else {}
        moved = {old: new for old in named if (new := device.current_id(ref, store, old, aliases)) != old}
        point = lambda ids: list(dict.fromkeys(moved.get(value, value) for value in ids))  # noqa: E731

        evidence = _moved_evidence(ref, [(row["subject_id"], row["evidence_ids"]) for row in bindings] + [
            (subject, item["evidence_ids"]) for item in queue for subject in item["subject_ids"] + item["candidate_ids"]],
            moved) if ref is not None else {}
        evidence.update(device.repoint(store, moved))
        retag = lambda ids: [evidence.get(value, value) for value in ids]  # noqa: E731
        changed = 0
        for row in bindings:
            subject, ids = moved.get(row["subject_id"], row["subject_id"]), retag(row["evidence_ids"])
            if (subject, ids) != (row["subject_id"], row["evidence_ids"]):
                db.execute("UPDATE bindings SET subject_id = ?, kind = ?, evidence_ids = ? WHERE id = ?",
                           (subject, subject_kind(subject), json.dumps(ids), row["id"]))
                changed += 1
        for item in queue:
            subjects, candidates, ids = point(item["subject_ids"]), point(item["candidate_ids"]), retag(item["evidence_ids"])
            if (subjects, candidates, ids) == (item["subject_ids"], item["candidate_ids"], item["evidence_ids"]):
                continue
            native = ProviderRef(**json.loads(item["provider_ref"])) if item["provider_ref"] else None
            values = (question_key(item["kind"], item["reason"], subjects, item["scheme"], native), json.dumps(subjects),
                      json.dumps(candidates), json.dumps(ids), item["id"])
            try:
                db.execute("UPDATE queue SET key = ?, subject_ids = ?, candidate_ids = ?, evidence_ids = ? WHERE id = ?",
                           values)
            except sqlite3.IntegrityError:  # two open questions became one: the one already open stays open
                db.execute("UPDATE queue SET key = ?, subject_ids = ?, candidate_ids = ?, evidence_ids = ?,"
                           " state = 'superseded' WHERE id = ?", values)
            changed += 1
        pairs = [(new, old) for old, new in moved.items()]
        db.executemany("UPDATE verdicts SET chosen_id = ? WHERE chosen_id = ?", pairs)
        db.executemany("UPDATE OR REPLACE resolve_misses SET subject_id = ? WHERE subject_id = ?", pairs)
        db.executemany("UPDATE OR REPLACE read_checks SET subject_id = ? WHERE subject_id = ?", pairs)
        gone = sorted({current for current in (moved.get(subject, subject) for subject in cited)
                       if not _held(ref, store, current)})
        store.set_metadata(VANISHED, json.dumps(gone))
        store.set_metadata(REKEYED, release)
    return {"release": release, "moved": len(moved), "rows": changed, "vanished": len(gone)}


# A device subject's key scheme -> the identifier scheme it is keyed by (a compound or provisional key has none).
KEYED_BY = {("listing", "figi"): "figi", ("listing", "caip19"): "caip19", ("security", "isin"): "isin",
            ("security", "cgs_isin"): "isin", ("security", "figi"): "share_class_figi", ("issuer", "lei"): "lei",
            ("issuer", "cik"): "cik"}


def covered(ref: sqlite3.Connection | None, store: IdentityStore) -> dict[str, str]:
    """Device subjects a confirm-level release now holds under another ID: the one reference subject of the kind that
    asserts the identifier a device subject is keyed by (a line a plugin introduced by its FIGI, now in the build),
    by device subject (ADR 0037, amendment "ingest"). A display-level release re-points no saved ID."""
    if ref is None or weighing.level(ref) != CONFIRM:
        return {}
    found = {}
    for (subject,) in store.select("SELECT id FROM subjects WHERE kind IN ('listing', 'security', 'issuer')"):
        kind, tag, value = subject.split(":", 2)
        scheme = KEYED_BY.get((kind, tag))
        if scheme is None or device.alias(store, subject) or device.in_reference(ref, subject):
            continue
        held = {row[0] for row in ref.execute("SELECT subject_id FROM assertions WHERE scheme = ? AND value = ?",
                                              (scheme, value)) if subject_kind(row[0]) == kind}
        if len(held) == 1:
            found[subject] = held.pop()
    return found


def _held(ref: sqlite3.Connection | None, store: IdentityStore, subject_id: str) -> bool:
    """Whether the release (it holds instruments only) or the device store holds this subject; without a release,
    whether it could."""
    return subject_kind(subject_id) not in TABLES or ref is None or device.subject_row(store, subject_id) is not None \
        or device.in_reference(ref, subject_id)


def _moved_evidence(ref: sqlite3.Connection, rows: list[tuple[str, list[str]]], moved: dict[str, str]) -> dict[str, str]:
    """Cited evidence ID -> the ID this release gives the same assertion, for evidence the release no longer holds.

    An assertion's evidence ID hashes its subject ID, so a re-keyed subject's assertions get new IDs. The ones a
    row cites were read from its subject's page (`load_subject`: the listing, security, composite and issuer), so
    each is found by re-hashing that family's assertions under the IDs aliased to them (the builder writes
    single-hop aliases)."""
    cited = {value for _subject, ids in rows for value in ids}
    held = {value for (value,) in ref.execute("SELECT evidence_id FROM assertions WHERE evidence_id IN"
                                              " (SELECT value FROM json_each(?))", (json.dumps(sorted(cited)),))}
    stale = cited - held
    if not stale:
        return {}
    back: dict[str, list[str]] = defaultdict(list)
    for old, new in ref.execute("SELECT old_id, new_id FROM id_aliases"):
        back[new].append(old)
    family: set[str] = set()
    for subject in {moved.get(subject, subject) for subject, ids in rows if stale.intersection(ids)}:
        try:
            found = load_subject(ref, subject)
        except ValueError:  # a kind outside the instrument hierarchy
            found = None
        family.update(value for value in (found["ids"].values() if found else ()) if value)
    out: dict[str, str] = {}
    for member in family:
        olds = back.get(member)
        if not olds:
            continue
        for row in ref.execute("SELECT * FROM assertions WHERE subject_id = ?", (member,)):
            assertion = _assertion(row)
            for old in olds:
                try:
                    before = replace(assertion, subject_id=old).evidence_id
                except ValueError:  # an alias across levels: never the same assertion
                    continue
                if before in stale:
                    out[before] = row["evidence_id"]
    return out
