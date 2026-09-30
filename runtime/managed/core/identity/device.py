"""Subjects that live on the device (ADR 0037, amendment "device subjects"; ADR 0044 A1 and A3).

A plugin may introduce a subject no reference build holds: a DeFi pool or protocol, a listing the build lacks. Its
row in identity.sqlite3's `subjects` is the durable label (name, kind, attributes and the plugin that introduced it);
its identifiers are `device_assertions`; a better key re-keys it upward through `device_aliases`, which
`lifecycle.rekey` follows after the reference's. A write joins the caller's transaction, else runs in its own; the
writer bumps the store's `generation` once it is done (`bump`), so a cached read of device subjects renews.

Reads cover reference and device alike. `current_id` follows the reference's aliases, then the device's.
`load_subject` reads the reference and falls back to the device store (`load`), in the reference's shape plus
`contributors`, so a device subject's page composes with no reference package installed. A device assertion counts
at its plugin's trust level while the plugin is enabled (`levels`); a disabled or removed plugin's assertions count
at display, shown with their source and never proving or blocking, and its subjects keep resolving by ID.

Binding (ADR 0042, amendment of 2026-09-30): only a confirm-level plugin binds, onto reference or device subjects.
A display-level plugin binds only a subject it introduced itself (`bind_introduced`, rule `introduced@1`); its answer
that would bind any other stays an `unaudited` residual (`page.apply_resolve`). Core's ingest of plugin records
writes through these functions; tests may too.
"""
from __future__ import annotations

import json
import sqlite3
from typing import Any, Iterable, Mapping

from . import evidence as weighing
from . import relations
from . import subject as reference
from .claims import RecordAttributes
from .model import Binding, IdentifierAssertion, ProviderRef, evidence_id
from .schemes import INSTRUMENT_KINDS, NAMESPACE, Kind, Level, normalize_identifier, registered_kind, subject_kind
from .store import IdentityStore, now
from .trust import CONFIRM, DISPLAY
from .vocabulary import Authority, IdentifierRole, SubjectStatus

INTRODUCED_RULE = "introduced@1"  # a plugin's own record binds the subject it introduced, at any trust level
GENERATION = "generation"         # identity.sqlite3 metadata: counts changes to device subjects
CLAIM_STATES = frozenset({"joined", "introduced", "conflict", "unmatched", "not_seen"})  # claims.state
PARENT = {Level.LISTING: Level.SECURITY, Level.COMPOSITE: Level.SECURITY, Level.SECURITY: Level.ISSUER}
_REFERENCE_PARENT = {Level.LISTING: "SELECT security_id FROM listings WHERE id = ?",
                     Level.COMPOSITE: "SELECT security_id FROM composites WHERE id = ?",
                     Level.SECURITY: "SELECT issuer_id FROM securities WHERE id = ?"}
_TABLES = {"listing": "listings", "composite": "composites", "security": "securities", "issuer": "issuers"}


# ---- the store: subjects, assertions, aliases, placed claims and the generation ----------------------------------

def put_subject(store: IdentityStore, subject_id: str, *, plugin: str, name: str | None = None,
                parent_id: str | None = None, attributes: Mapping[str, Any] | None = None, status: str = "active",
                seen: str | None = None) -> None:
    """Write a device subject's label. One already there keeps the plugin that introduced it and its first sighting;
    its parent, name (unless none is given), attributes and status become these."""
    kind = registered_kind(subject_id)
    if parent_id is not None and registered_kind(parent_id) != PARENT.get(kind):
        raise ValueError(f"device subject: a {kind} has no {subject_kind(parent_id)} parent")
    if not NAMESPACE.match(plugin) or not (name is None or isinstance(name, str) and 0 < len(name) <= 512):
        raise ValueError("device subject: a plugin name and a label of at most 512 characters")
    try:
        RecordAttributes(**(attributes or {}))  # the record's own descriptive fields, checked alike
    except TypeError as error:
        raise ValueError(f"device subject: {error}") from None
    stamp = seen or now()
    with store.transaction():
        store.db.execute(
            "INSERT INTO subjects (id, kind, parent_id, name, attributes, status, introduced_by, first_seen, last_seen)"
            " VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT (id) DO UPDATE SET parent_id = excluded.parent_id,"
            " name = COALESCE(excluded.name, subjects.name), attributes = excluded.attributes,"
            " status = excluded.status, last_seen = excluded.last_seen",
            (subject_id, str(kind), parent_id, name, json.dumps(dict(attributes or {}), sort_keys=True),
             str(SubjectStatus(status)), plugin, stamp, stamp))


def subject_row(store: IdentityStore, subject_id: str) -> dict[str, Any] | None:
    """A device subject's label, its attributes decoded, or None."""
    rows = store.select("SELECT * FROM subjects WHERE id = ?", (subject_id,))
    return {**dict(rows[0]), "attributes": json.loads(rows[0]["attributes"])} if rows else None


def put_assertion(store: IdentityStore, subject_id: str, scheme: str, value: str, *, plugin: str, ref: ProviderRef,
                  role: str = "self", retrieved_at: str | None = None) -> str:
    """Record an identifier the plugin's record `ref` states for a device subject; returns its evidence ID. A `self`
    value identifies its subject at the scheme's own level (a listing record's ISIN is its security's)."""
    row = {"subject_id": subject_id, "scheme": str(scheme), "value": normalize_identifier(scheme, value),
           "role": str(IdentifierRole(role)), "plugin": plugin, "native_scope": ref.native_scope,
           "native_id": ref.native_id, "retrieved_at": retrieved_at or now()}
    row["evidence_id"] = _evidence(row)
    with store.transaction():
        store.db.execute(
            f"INSERT INTO device_assertions ({','.join(row)}) VALUES ({','.join('?' * len(row))})"
            " ON CONFLICT (evidence_id) DO UPDATE SET retrieved_at = excluded.retrieved_at", tuple(row.values()))
    return row["evidence_id"]


def drop_assertions(store: IdentityStore, plugin: str, ref: ProviderRef, subject_id: str) -> None:
    """Drop what a record stated, except the identifier its subject's own ID spells out: no omission drops that."""
    store.db.execute("DELETE FROM device_assertions WHERE plugin = ? AND native_scope = ? AND native_id = ? AND"
                     " instr(?, ':' || value) = 0", (plugin, ref.native_scope, ref.native_id, subject_id))


def assertions(store: IdentityStore, subject_ids: Iterable[str]) -> list[dict[str, Any]]:
    """The device assertions about these subjects, by evidence ID."""
    return [dict(row) for row in store.select(
        "SELECT * FROM device_assertions WHERE subject_id IN (SELECT value FROM json_each(?)) ORDER BY evidence_id",
        (json.dumps(list(subject_ids)),))]


def put_alias(store: IdentityStore, old_id: str, new_id: str, at: str | None = None) -> None:
    """A device subject's better key: `old_id` now reads as `new_id`. `lifecycle.rekey` re-points the rows."""
    if old_id == new_id or registered_kind(old_id) != registered_kind(new_id):
        raise ValueError("device alias: a re-key keeps the subject's kind and changes its ID")
    with store.transaction():
        store.db.execute("INSERT INTO device_aliases (old_id, new_id, at) VALUES (?,?,?)"
                         " ON CONFLICT (old_id) DO UPDATE SET new_id = excluded.new_id, at = excluded.at",
                         (old_id, new_id, at or now()))


def alias(store: IdentityStore, subject_id: str) -> str | None:
    rows = store.select("SELECT new_id FROM device_aliases WHERE old_id = ?", (subject_id,))
    return rows[0][0] if rows else None


def place_claim(store: IdentityStore, plugin: str, ref: ProviderRef, subject_id: str | None, state: str) -> bool:
    """Record where core placed a plugin's stored record: the subject it joined or introduced, and how. False when
    the plugin has no such record."""
    if state not in CLAIM_STATES:
        raise ValueError(f"claim state: one of {sorted(CLAIM_STATES)}")
    with store.transaction():
        store.db.execute("UPDATE claims SET subject_id = ?, state = ? WHERE plugin = ? AND native_scope = ?"
                         " AND native_id = ?", (subject_id, state, plugin, ref.native_scope, ref.native_id))
        return store.db.execute("SELECT changes()").fetchone()[0] == 1


def generation(store: IdentityStore) -> int:
    return int(store.metadata(GENERATION) or 0)


def bump(store: IdentityStore) -> int:
    """Device subjects changed: a new generation, which a cached read keys on. Returns it."""
    with store.transaction():
        store.db.execute("INSERT INTO metadata (key, value) VALUES (?, '1')"
                         " ON CONFLICT (key) DO UPDATE SET value = CAST(value AS INTEGER) + 1", (GENERATION,))
        return generation(store)


def bind_introduced(store: IdentityStore, plugin: str, ref: ProviderRef, subject_id: str) -> bool:
    """Bind a plugin's own record to the device subject it introduced (rule `introduced@1`), whatever the plugin's
    trust level. False, binding nothing, for a subject it did not introduce, a reference bound elsewhere or one whose
    binding the user rejected."""
    row, bound = subject_row(store, subject_id), store.binding_for(ref)
    if row is None or row["introduced_by"] != plugin or (bound is not None and bound["status"] == "rejected"):
        return False
    cited = evidence_id({"kind": "introduced", "plugin": plugin, "ref": ref.wire()})  # the same after a re-key
    return store.put_binding(Binding(provider_ref=ref, subject_id=subject_id, status="confirmed",
                                     authority=Authority.RULE_CONFIRMED, evidence_ids=(cited,), plugin=plugin,
                                     rule_id=INTRODUCED_RULE))


# ---- reads over reference and device -----------------------------------------------------------------------------

def levels(plugins: Iterable) -> dict[str, str]:
    """Each installed plugin's trust level for its device assertions: its own while enabled, else display."""
    return {info.manifest.plugin: DISPLAY if info.manifest.unaudited or not info.enabled else CONFIRM
            for info in plugins}


def current_id(ref: sqlite3.Connection | None, store: IdentityStore, subject_id: str,
               declared: Mapping[str, str] = {}) -> str:
    """The ID a subject has now: each step follows the reference's `id_aliases`, else `declared` (the provisional IDs
    confirm-level contracts alias, `declared.aliases`; reads and the re-key pass them), else the device's aliases,
    never for an ID the reference holds. A cycle is a defect: its IDs stay as they are."""
    seen = [subject_id]
    while (new := _alias(ref, store, seen[-1], declared)) is not None:
        if new in seen:
            return subject_id
        seen.append(new)
    return seen[-1]


def load_subject(ref: sqlite3.Connection | None, store: IdentityStore, subject_id: str, plugins: Iterable = (),
                 listing_id: str | None = None) -> dict[str, Any] | None:
    """The subject from the reference (`subject.load_subject`) with what the device holds about it (`merge`), else
    from the device store (`load`)."""
    subject_id = current_id(ref, store, subject_id)
    found = reference.load_subject(ref, subject_id, listing_id) if ref is not None else None
    return merge(ref, store, found, plugins) if found else load(ref, store, subject_id, plugins)


def merge(ref: sqlite3.Connection, store: IdentityStore, subject: dict[str, Any], plugins: Iterable = ()) -> dict:
    """A reference subject with what the device holds about it and its family (ADR 0037, amendment "ingest"): the
    plugins' `self` identifiers weighed beside the package's, each at its plugin's level (`levels`), so a confirm-level
    plugin's other value contests the fact and a display-level one is shown; their relations (`relations.related`);
    and the plugins behind them with what each states (`contributors`, only when there are any). Updates `subject`."""
    plugins = list(plugins)
    family, granted = [value for value in subject["ids"].values() if value], levels(plugins)
    rows = [item for item in assertions(store, family) if item["role"] == IdentifierRole.SELF]
    if rows:
        package = weighing.level(ref)
        weighed = weighing.weigh_each([*((item, package) for item in [*subject["evidence"], *subject["shown"]]),
                                       *((_assertion(item), granted.get(item["plugin"], DISPLAY)) for item in rows)])
        if subject["listing"] is not None and subject["listing"]["status"] == "inactive":
            weighed["values"].pop("ticker_mic", None)  # a delisted line's ticker may name another company
        subject.update(weighed, contributed=_contributed(rows))
    subject["view"]["related"] = relations.related(ref, store, family, granted, lambda item: _name(ref, store, item))
    contributors = _contributors(store, family, None, plugins)
    if contributors:
        subject["contributors"] = subject["view"]["contributors"] = contributors
    weighing.show(subject)
    return subject


def load(ref: sqlite3.Connection | None, store: IdentityStore, subject_id: str, plugins: Iterable = (),
         parents: Mapping[str, str] = {}) -> dict[str, Any] | None:
    """A device subject in `subject.load_subject`'s shape, or None when the device store has none.

    An instrument's parents are its own device rows, else the reference's (a listing a plugin introduced under a
    security the build holds), or the ones the user chose (`parents`, `build_questions`); a security is priced through
    its first device listing. Its identifiers are the `self` assertions on it and its parents, the device's at each
    plugin's level (`levels`), the reference's at the package's. `contributors` names the plugins that introduced it or
    state anything about it, each `enabled`, `disabled` or `removed`, and `introduced_by` the one that introduced it."""
    subject_id = current_id(ref, store, subject_id)
    row = subject_row(store, subject_id)
    if row is None:
        return None
    plugins = list(plugins)
    granted, kind, attributes = levels(plugins), registered_kind(subject_id), row["attributes"]
    ids: dict = {kind: subject_id}
    listing = None
    if kind in INSTRUMENT_KINDS:
        ids = {level: None for level in Level} | _family(ref, store, subject_id, parents)
        child = store.select("SELECT id FROM subjects WHERE parent_id = ? AND kind = 'listing'"
                             " ORDER BY status <> 'active', id LIMIT 1", (subject_id,)) if kind is Kind.SECURITY else []
        ids[Level.LISTING] = ids[Level.LISTING] or (child[0][0] if child else None)
        found = subject_row(store, ids[Level.LISTING]) if ids[Level.LISTING] else None
        listing = _listing(found) if found else None
    family = [value for value in ids.values() if value]
    stated = [item for item in assertions(store, family) if item["role"] == IdentifierRole.SELF]
    weighed = [(_assertion(item), granted.get(item["plugin"], DISPLAY)) for item in stated]
    held = [value for value in family if subject_row(store, value) is None]  # parents the reference holds
    if ref is not None and held:
        weighed += [(reference._assertion(item), weighing.level(ref)) for item in ref.execute(
            "SELECT * FROM assertions WHERE subject_id IN (SELECT value FROM json_each(?))", (json.dumps(held),))]
    contributors = _contributors(store, [subject_id], row["introduced_by"], plugins)
    issuer, security = ids.get(Level.ISSUER), ids.get(Level.SECURITY)
    subject = {
        "id": subject_id, "level": Level(kind) if kind in INSTRUMENT_KINDS else kind, "ids": ids,
        **weighing.weigh_each(weighed), "contributed": _contributed(stated),
        "asset_class": attributes.get("asset_class"), "kind": attributes.get("kind"), "listing": listing,
        "introduced_by": row["introduced_by"], "contributors": contributors,
        "view": {
            "subject": {"id": subject_id, "level": str(kind), "name": row["name"] or subject_id,
                        "kind": attributes.get("kind"), "listing": listing["id"] if listing else None},
            "identifiers": {},
            "issuer": {"id": issuer, "name": _name(ref, store, issuer) or issuer} if issuer else None,
            "security": {"id": security, "name": _name(ref, store, security) or security} if security else None,
            "listings": [{"id": listing["id"], "ticker": listing["ticker"], "mic": listing["operating_mic"],
                          "venue": None, "currency": listing["trading_currency"], "primary": False}] if listing else [],
            "related": relations.related(ref, store, family, granted, lambda item: _name(ref, store, item)),
            "contributors": contributors,
        },
    }
    weighing.show(subject)
    return subject


# ---- lifecycle ---------------------------------------------------------------------------------------------------

def named(store: IdentityStore) -> set[str]:
    """Every subject ID the device tables name."""
    return {value for (value,) in store.select(
        "SELECT id FROM subjects UNION SELECT parent_id FROM subjects UNION SELECT subject_id FROM device_assertions"
        " UNION SELECT from_id FROM relations UNION SELECT to_id FROM relations UNION SELECT subject_id FROM claims")
        if value}


def repoint(store: IdentityStore, moved: Mapping[str, str]) -> dict[str, str]:
    """Re-point the device tables through `moved` (an old ID to the current one), inside the caller's transaction: a
    subject's row (merged into the current one's where both exist), its children's parent, its assertions (each
    under the evidence ID its new subject gives it), relations (likewise) and placed claims. Returns each moved
    assertion's old evidence ID with its new one, and bumps the generation when a row changed."""
    db, evidence = store.db, {}
    before = db.total_changes
    for old, new in moved.items():
        for row in [dict(item) for item in db.execute("SELECT * FROM device_assertions WHERE subject_id = ?", (old,))]:
            try:
                fresh = _evidence({**row, "subject_id": new})
            except ValueError:  # an alias across levels: never the same assertion
                continue
            db.execute("UPDATE OR REPLACE device_assertions SET subject_id = ?, evidence_id = ? WHERE evidence_id = ?",
                       (new, fresh, row["evidence_id"]))
            evidence[row["evidence_id"]] = fresh
        db.execute("UPDATE OR IGNORE subjects SET id = ? WHERE id = ?", (new, old))
        db.execute("DELETE FROM subjects WHERE id = ? AND EXISTS (SELECT 1 FROM subjects WHERE id = ?)", (old, new))
    pairs = [(new, old) for old, new in moved.items()]
    db.executemany("UPDATE subjects SET parent_id = ? WHERE parent_id = ?", pairs)
    marks = json.dumps(list(moved))
    for row in [dict(item) for item in db.execute("SELECT * FROM relations WHERE from_id IN (SELECT value FROM"
                                                  " json_each(?)) OR to_id IN (SELECT value FROM json_each(?))",
                                                  (marks, marks))]:
        ends = {"from_id": moved.get(row["from_id"], row["from_id"]), "to_id": moved.get(row["to_id"], row["to_id"])}
        if ends["from_id"] != ends["to_id"]:  # never onto itself
            db.execute("UPDATE OR IGNORE relations SET from_id = ?, to_id = ?, evidence_id = ? WHERE evidence_id = ?",
                       (ends["from_id"], ends["to_id"], relations.relation_id({**row, **ends}), row["evidence_id"]))
    db.executemany("UPDATE claims SET subject_id = ? WHERE subject_id = ?", pairs)
    if db.total_changes != before:
        bump(store)
    return evidence


# ---- internals ---------------------------------------------------------------------------------------------------

def _alias(ref: sqlite3.Connection | None, store: IdentityStore, subject_id: str,
           declared: Mapping[str, str]) -> str | None:
    """One step: the reference's alias, else a declared one, else the device's unless the reference holds the ID."""
    row = ref.execute("SELECT new_id FROM id_aliases WHERE old_id = ?", (subject_id,)).fetchone() \
        if ref is not None else None
    if row or subject_id in declared:
        return row[0] if row else declared[subject_id]
    return None if ref is not None and in_reference(ref, subject_id) else alias(store, subject_id)


def in_reference(ref: sqlite3.Connection, subject_id: str) -> bool:
    """Whether the reference holds this subject (it holds instruments only)."""
    table = _TABLES.get(subject_kind(subject_id))
    return table is not None and ref.execute(f"SELECT 1 FROM {table} WHERE id = ?", (subject_id,)).fetchone() is not None


def _assertion(row: Mapping[str, Any]) -> IdentifierAssertion:
    """A stored `self` device assertion as the evidence it is: the plugin's own statement (`source_asserted`)."""
    return IdentifierAssertion(
        subject_id=row["subject_id"], scheme=row["scheme"], value=row["value"], authority=Authority.SOURCE_ASSERTED,
        provenance={"plugin": row["plugin"], "source": row["plugin"], "adapter_version": "1",
                    "retrieved_at": row["retrieved_at"], "source_record": f"{row['native_scope']}:{row['native_id']}"})


def _evidence(row: Mapping[str, Any]) -> str:
    """A device assertion's evidence ID: a `self` one's is the typed assertion's (which checks its level)."""
    if row["role"] == IdentifierRole.SELF:
        return _assertion(row).evidence_id
    registered_kind(row["subject_id"])
    return evidence_id({"kind": "assertion", "subject": row["subject_id"], "scheme": row["scheme"],
                        "value": row["value"], "role": row["role"], "source": row["plugin"],
                        "record": f"{row['native_scope']}:{row['native_id']}"})


def _family(ref: sqlite3.Connection | None, store: IdentityStore, subject_id: str, parents: Mapping) -> dict[Level, str]:
    """An instrument and its parents up to its issuer: each from its device row, else from the reference."""
    ids: dict[Level, str] = {}
    current = subject_id
    while current is not None and Level(subject_kind(current)) not in ids:
        level = Level(subject_kind(current))
        ids[level] = current
        row = subject_row(store, current)
        found = (parents.get(current, row["parent_id"]),) if row else ref.execute(
            _REFERENCE_PARENT[level], (current,)).fetchone() if ref is not None and level in _REFERENCE_PARENT else None
        current = found[0] if found else None
    return ids


def _listing(row: Mapping[str, Any]) -> dict[str, Any]:
    """A device listing as page composition reads a reference one: its ticker, venue and trading currency."""
    attributes = row["attributes"]
    operating = attributes.get("operating_mic") or attributes.get("mic")
    return {"id": row["id"], "security_id": row["parent_id"], "composite_id": None, "ticker": attributes.get("ticker"),
            "mic": attributes.get("mic") or operating, "operating_mic": operating,
            "trading_currency": attributes.get("currency"), "status": row["status"], "is_primary": 0}


def _name(ref: sqlite3.Connection | None, store: IdentityStore, subject_id: str) -> str | None:
    row = subject_row(store, subject_id)
    if row is not None:
        return row["name"]
    table = {"security": "securities", "issuer": "issuers"}.get(subject_kind(subject_id))  # the tables with names
    found = ref.execute(f"SELECT name FROM {table} WHERE id = ?", (subject_id,)).fetchone() \
        if ref is not None and table else None
    return found[0] if found else None


def _contributed(rows: Iterable[Mapping[str, Any]]) -> dict[str, str]:
    """Each device assertion's evidence ID with the plugin that stated it, for the view's `provenance`."""
    return {row["evidence_id"]: row["plugin"] for row in rows}


def _contributors(store: IdentityStore, subject_ids: list[str], introducer: str | None,
                  plugins: list) -> list[dict[str, Any]]:
    """The plugins behind these subjects, the one that introduced them first (`introduced`), each with its status now,
    the identifiers it states about them (`stated`) and, once a complete catalogue scope of it no longer carries any of
    its records on them, since when (`not_offered_since`)."""
    infos, marks = {info.manifest.plugin: info for info in plugins}, json.dumps(subject_ids)
    stated: dict[str, list[dict[str, str]]] = {}
    for plugin, scheme, value in store.select(
            "SELECT plugin, scheme, value FROM device_assertions WHERE role = 'self' AND subject_id IN (SELECT value"
            " FROM json_each(?)) ORDER BY plugin, scheme, value", (marks,)):
        stated.setdefault(plugin, []).append({"scheme": scheme, "value": value})
    placed = {plugin: since if gone else None for plugin, gone, since in store.select(
        "SELECT plugin, MIN(state = 'not_seen'), MAX(last_seen) FROM claims WHERE subject_id IN (SELECT value FROM"
        " json_each(?)) GROUP BY plugin", (marks,))}
    return [{"plugin": name, "label": infos[name].label if name in infos else name,
             "status": "removed" if name not in infos else "enabled" if infos[name].enabled else "disabled",
             "stated": stated.get(name, []), "introduced": name == introducer, "not_offered_since": placed.get(name)}
            for name in dict.fromkeys([*([introducer] if introducer else []), *sorted({*stated, *placed})])]
