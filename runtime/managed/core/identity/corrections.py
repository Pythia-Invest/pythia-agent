"""The investor's corrections to the catalogue (ADR 0044, amendment "user catalogue corrections").

A correction is a local override the user makes on purpose, when a source is wrong and they keep using it: set or
remove an identifier of a subject (`identifier`), or pin the plugin that prices a subject (`price_source`). It is
applied on every read, above the reference, the plugins and the user's answers to questions (`build_questions.answered`,
`page.answers`, search's identifiers), and it changes no ingested row, so a sync cannot revive what it overrode.
`parent` and `detach` are reserved kinds that are not read yet.

The Desk writes one `active` with the user's turn (the table refuses an `active` row without one). The agent can only
propose: its row is `proposed`, applies to nothing, and the user confirms or declines it in Repairs. An undone,
declined or replaced row stays as history. Every write and undo bumps the store's generation, so search renews.
A re-key of a subject re-points its corrections (`repoint`); a collision keeps the newest.
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from typing import Any, Iterable, Mapping

from . import device
from .page import PRICED, named, served_by
from .schemes import INSTRUMENT_KINDS, SCHEME_LEVEL, IdentifierError, Level, Scheme, normalize_identifier, subject_kind
from .store import IdentityStore, now as stamp

KINDS = ("identifier", "parent", "detach", "price_source")
READ = ("identifier", "price_source")  # the kinds this core reads; a reserved one is refused with a message
AGENT = "agent"                        # `proposed_by` of the agent's proposals
NEAREST = (Level.LISTING, Level.COMPOSITE, Level.SECURITY)  # a pin on a line beats one on its security
SHOWN = ("id", "kind", "subject_id", "scheme", "value", "state", "proposed_by", "note", "decided_at")  # a subject view lists


class Refused(ValueError):
    """The correction cannot be taken; the message says why, in the investor's words."""


def validate(store: IdentityStore, ref: sqlite3.Connection | None, plugins: Iterable, *, kind: Any, subject_id: Any,
             scheme: Any = None, value: Any = None) -> dict[str, Any]:
    """The row a correction writes: its `kind`, current `subject_id`, `scheme` and `value`, normalized; `warning` says
    where an identifier is also held. Raises `Refused`."""
    if kind not in KINDS:
        raise Refused(f"A correction is one of: {', '.join(READ)}.")
    if kind not in READ:
        raise Refused(f"Corrections of kind '{kind}' are not available yet.")
    try:
        found = subject_kind(subject_id) if isinstance(subject_id, str) else None
    except ValueError:
        found = None
    if found is None:
        raise Refused("Name the subject to correct by its subject id.")
    current = device.current_id(ref, store, subject_id)
    if found not in INSTRUMENT_KINDS or not (
            ref is not None and device.in_reference(ref, current) or device.subject_row(store, current)):
        raise Refused("Unknown subject: only a listing, security or issuer Pythia holds can be corrected.")
    if kind == "price_source":
        return {"kind": kind, "subject_id": current, "scheme": None, "value": _pin(plugins, found, value)}
    try:
        name = Scheme(scheme)
    except ValueError:
        raise Refused(f"Unknown identifier scheme '{scheme}'.") from None
    level = SCHEME_LEVEL.get(name)  # the open schemes (a Sui object) key no instrument
    if level is None:
        raise Refused(f"A {name} identifies no instrument; only a listing, security or issuer identifier is corrected.")
    if name is Scheme.TICKER_MIC:
        raise Refused("A ticker is not corrected here.")
    if level != found:
        raise Refused(f"A {name} identifies a {level}; this subject is a {found}.")
    row: dict[str, Any] = {"kind": kind, "subject_id": current, "scheme": str(name), "value": None}
    if value is not None and not isinstance(value, str):
        raise Refused("A value is text; leave it empty to remove the identifier.")
    if value and value.strip():
        text = value.strip()  # typed by hand: a CAIP-19 is case-sensitive, every other scheme is upper case
        try:
            row["value"] = normalize_identifier(name, text if name is Scheme.CAIP19 else text.upper())
        except IdentifierError as error:
            raise Refused(str(error)) from None
        elsewhere = _held_elsewhere(store, ref, row)
        if elsewhere:
            row["warning"] = f"{row['scheme']} {row['value']} is also held by {', '.join(elsewhere)}."
    return row


def put(store: IdentityStore, row: Mapping[str, Any], *, now: str, user_turn: str | None, note: str | None) -> str:
    """Write a validated correction: `active` with the user's turn, else `proposed` by the agent. An active row
    replaces the earlier one for the same fact (kept as history, cited in `replaces`) and ends the proposals for it;
    a proposal replaces only an earlier proposal. Returns its ID."""
    active = user_turn is not None
    with store.transaction():
        earlier = _same(store, row, "active") if active else None
        new = uuid.uuid4().hex
        store.db.execute(
            "INSERT INTO corrections (id, kind, subject_id, scheme, value, state, proposed_by, note, created_at,"
            " decided_at, user_turn, replaces) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (new, row["kind"], row["subject_id"], row["scheme"], row["value"], "active" if active else "proposed",
             None if active else AGENT, note, now, now if active else None, user_turn, earlier))
        _end(store, row, "proposed", now, keep=new)
        if active:
            _end(store, row, "active", now, keep=new)
            device.bump(store)
    return new


def confirm(store: IdentityStore, correction_id: str, *, now: str, user_turn: str, note: str | None) -> bool:
    """The user makes an agent's proposal their own: it becomes `active`, replacing the earlier one for the same fact.
    False when it is not a proposal any longer."""
    with store.transaction():
        row = get(store, correction_id)
        if row is None or row["state"] != "proposed":
            return False
        earlier = _same(store, row, "active")
        store.db.execute("UPDATE corrections SET state = 'active', decided_at = ?, user_turn = ?, replaces = ?,"
                         " note = COALESCE(?, note) WHERE id = ?", (now, user_turn, earlier, note, correction_id))
        _end(store, row, "active", now, keep=correction_id)
        _end(store, row, "proposed", now, keep=correction_id)  # the others for this fact are moot
        device.bump(store)
    return True


def end(store: IdentityStore, correction_id: str, *, expect: str, now: str, user_turn: str) -> bool:
    """The user's undo of an `active` correction or refusal of a `proposed` one (`expect` says which): the row stays,
    `undone`. False when it is not in that state."""
    with store.transaction():
        row = get(store, correction_id)
        if row is None or row["state"] != expect:
            return False
        store.db.execute("UPDATE corrections SET state = 'undone', ended_at = ?, decided_at = COALESCE(decided_at, ?),"
                         " user_turn = COALESCE(user_turn, ?) WHERE id = ?", (now, now, user_turn, correction_id))
        if expect == "active":
            device.bump(store)
    return True


def get(store: IdentityStore, correction_id: str) -> dict[str, Any] | None:
    found = store.select("SELECT * FROM corrections WHERE id = ?", (correction_id,))
    return dict(found[0]) if found else None


def rows(store: IdentityStore, *, subject_ids: Iterable[str] | None = None, states: Iterable[str] = ("active",),
         kinds: Iterable[str] = READ) -> list[dict[str, Any]]:
    """Corrections in these states and kinds, about these subjects (all when None), newest first."""
    where, args = "state IN (SELECT value FROM json_each(?)) AND kind IN (SELECT value FROM json_each(?))", [
        json.dumps(list(states)), json.dumps(list(kinds))]
    if subject_ids is not None:
        where += " AND subject_id IN (SELECT value FROM json_each(?))"
        args.append(json.dumps(list(subject_ids)))
    return [dict(row) for row in store.select(f"SELECT * FROM corrections WHERE {where}"
                                              " ORDER BY created_at DESC, rowid DESC", args)]


def apply(store: IdentityStore, subject: dict[str, Any]) -> None:
    """Lay the active identifier corrections of the subject's family over its values, the last word on each: the value
    replaces whatever the sources or the user's answers gave (and ends a contest), a removal leaves none, and
    provenance reads `user_attested` with the correction's ID (`evidence.show`). The view lists the family's active
    corrections and the agent's proposals that wait."""
    found = rows(store, subject_ids=[value for value in subject["ids"].values() if value], states=("active", "proposed"))
    subject["view"]["corrections"] = [{name: row[name] for name in SHOWN} for row in found]
    for row in found:
        if row["state"] == "active" and row["kind"] == "identifier":
            scheme = row["scheme"]
            if row["value"] is None:
                subject["values"].pop(scheme, None)
            else:
                subject["values"][scheme] = row["value"]
            subject["contested"].pop(scheme, None)
            subject.setdefault("corrected", {})[scheme] = row["id"]


def pinned(store: IdentityStore, ids: Mapping[Any, str | None], plugins: Iterable) -> str | None:
    """The key of the installed plugin the investor pinned as the price source of this subject, else of the nearest
    line above it (`NEAREST`); None when none is, or the plugin is no longer installed."""
    by_subject = {row["subject_id"]: row["value"] for row in rows(
        store, subject_ids=[value for value in ids.values() if value], kinds=("price_source",))}
    name = next((by_subject[ids[level]] for level in NEAREST if ids.get(level) in by_subject), None)
    return next((info.key for info in plugins if info.manifest.plugin == name), None) if name else None


def identifier_values(store: IdentityStore) -> dict[str, dict[str, str | None]]:
    """Every active identifier correction by subject and scheme (a removal is None), for search's directory."""
    out: dict[str, dict[str, str | None]] = {}
    for row in rows(store, kinds=("identifier",)):
        out.setdefault(row["subject_id"], {})[row["scheme"]] = row["value"]
    return out


def repoint(store: IdentityStore, moved: Mapping[str, str]) -> None:
    """Follow a re-key (`lifecycle.rekey`, inside its transaction): corrections name the subject's current ID. Two
    that now state one fact keep the newest, and the other is ended."""
    db, before = store.db, store.db.total_changes
    db.executemany("UPDATE corrections SET subject_id = ? WHERE subject_id = ?", [(new, old) for old, new in moved.items()])
    for state in ("active", "proposed"):
        for old in [row for row in rows(store, states=(state,)) if _same(store, row, state) != row["id"]]:
            db.execute("UPDATE corrections SET state = 'undone', ended_at = ? WHERE id = ?", (stamp(), old["id"]))
    if db.total_changes != before:
        device.bump(store)


# ---- internals ---------------------------------------------------------------------------------------------------

_SAME = "kind = ? AND subject_id = ? AND scheme IS ? AND state = ?"


def _same(store: IdentityStore, row: Mapping[str, Any], state: str) -> str | None:
    """The newest correction in `state` about the same fact as `row` (its kind, subject and scheme)."""
    found = store.select(f"SELECT id FROM corrections WHERE {_SAME} ORDER BY decided_at DESC, created_at DESC, rowid DESC"
                         " LIMIT 1", (row["kind"], row["subject_id"], row["scheme"], state))
    return found[0][0] if found else None


def _end(store: IdentityStore, row: Mapping[str, Any], state: str, now: str, *, keep: str) -> None:
    """Undo every correction in `state` about the same fact as `row`, except `keep`."""
    store.db.execute(f"UPDATE corrections SET state = 'undone', ended_at = ? WHERE {_SAME} AND id <> ?",
                     (now, row["kind"], row["subject_id"], row["scheme"], state, keep))


def _pin(plugins: Iterable, found: str, name: Any) -> str:
    """The contract plugin name a pin stores, for an installed plugin the investor named by key, provider, label or
    alias that serves prices."""
    if found == Level.ISSUER:
        raise Refused("A company has no price: use a line or a security.")
    infos = list(plugins)
    key = named(name if isinstance(name, str) else None, infos)
    info = next((item for item in infos if item.key == key), None)
    if info is None:
        raise Refused("Name an installed source to use for prices.")
    if not any(served_by(info.manifest, section) for section in PRICED):
        raise Refused(f"{info.label} does not serve prices.")
    return info.manifest.plugin


def _held_elsewhere(store: IdentityStore, ref: sqlite3.Connection | None, row: Mapping[str, Any]) -> list[str]:
    """The other subjects that hold this identifier, from the reference or a plugin: a warning, never a refusal."""
    args = (row["scheme"], row["value"], row["subject_id"])
    found = {item[0] for item in store.select(
        "SELECT subject_id FROM device_assertions WHERE scheme = ? AND value = ? AND subject_id <> ?", args)}
    if ref is not None:
        found |= {item[0] for item in ref.execute(
            "SELECT subject_id FROM assertions WHERE scheme = ? AND value = ? AND subject_id <> ?", args)}
    return sorted(found)[:3]
