"""A device for the consequential-failure tests (roadmap stage 0): one reference build of real, hand-checked
identifiers (`asml.json` and `failures.json`), the device's identity store, and the steps core's operations take.

A helper for test_identity_failures.py, not a test module. The stage 0 slices that add plugin evidence, device
subjects and plugin lifecycle extend it with their own entry points.
"""
from __future__ import annotations

import sqlite3
from contextlib import closing
from dataclasses import replace
from pathlib import Path

from test_identity_contracts import PROVENANCE, identity, load, load_reference
from pythia_identity_fixture import lifecycle, page, store, subject as subjects  # noqa: E402

NOW, AS_OF = "2026-09-26T10:00:00Z", "2026-09-26"
# The columns that name a subject in each reference table: what a release re-keys.
COLUMNS = {"issuers": ["id"], "securities": ["id", "issuer_id"], "composites": ["id", "security_id"],
           "listings": ["id", "security_id", "composite_id"], "relations": ["from_id", "to_id"], "names": ["subject_id"]}


def release(source: Path, directory: Path, name: str, *, renames=(), aliases=(), drop=()) -> Path:
    """A later build of the reference at `source`: `renames` re-key subjects (their assertions get the evidence IDs
    the new subject gives them), `aliases` are its id_aliases rows, `drop` subjects it no longer holds."""
    path = directory / f"{name}.sqlite3"
    path.write_bytes(source.read_bytes())
    with closing(sqlite3.connect(path)) as db, db:
        db.row_factory = sqlite3.Row
        db.executemany("INSERT INTO release (key, value) VALUES (?, ?)",
                       [("schema_version", store.REFERENCE_SCHEMA_VERSION), ("release", name)])
        for old, new in renames:
            for table, columns in COLUMNS.items():
                for column in columns:
                    db.execute(f"UPDATE {table} SET {column} = ? WHERE {column} = ?", (new, old))
            for row in db.execute("SELECT * FROM assertions WHERE subject_id = ?", (old,)).fetchall():
                moved = replace(subjects._assertion(row), subject_id=new)
                db.execute("UPDATE assertions SET subject_id = ?, evidence_id = ? WHERE evidence_id = ?",
                           (new, moved.evidence_id, row["evidence_id"]))
        for subject in drop:
            db.execute(f"DELETE FROM {lifecycle.TABLES[identity.subject_level(subject)]} WHERE id = ?", (subject,))
            db.execute("DELETE FROM assertions WHERE subject_id = ?", (subject,))
        db.executemany("INSERT INTO id_aliases (old_id, new_id, release) VALUES (?, ?, ?)",
                       [(old, new, name) for old, new in aliases])
    return path


def vendor(*schemes: str, name: str = "vendor", mic_table: dict[str, str] | None = None) -> page.PluginInfo:
    """A signed-off quote source at listing level: its resolve looks records up by `schemes`, and `mic_table` lets
    core address a line from its ticker without a call."""
    contract = {"contract_version": 1, "plugin": name, "provider": name,
                "addressing": {"native": [{"native_scope": "symbol", "level": "listing"}], "mic_table": mic_table or {}},
                "concepts": {"market_data": {"level": "listing", "via": "listing", "operations": {"quote": "latest"}}},
                **({"resolve": {"operation": "resolve", "input_schemes": list(schemes), "echoes": []}} if schemes else {}),
                "rights": {"licence": "personal", "cache": "none", "hostable": False},
                "signoff": {"status": "grandfathered"}}
    return page.PluginInfo(key=f"pythia-{name}", manifest=identity.validate_manifest(contract))


def record(info: page.PluginInfo, native_id: str, *identifiers: tuple[str, ...], kind: str | None = None) -> dict:
    """One record as the plugin emits it, at the level of its (first) native scope; `identifiers` are
    (scheme, value) or (scheme, value, role)."""
    scope = info.manifest.native[0]
    return {"level": str(scope.level), "attributes": {"kind": kind} if kind else {},
            "provenance": {**PROVENANCE, "plugin": info.manifest.plugin, "source": info.manifest.provider},
            "identifiers": [dict(zip(("scheme", "value", "role"), item)) for item in identifiers],
            "native_ref": {"provider": info.manifest.provider, "native_id": native_id, "native_scope": scope.native_scope}}


class World:
    """The device: the reference build at `path`, its identity store, and what core does with them."""

    def __init__(self, tmp: Path, fixtures: tuple[str, ...] = ("asml.json", "failures.json")):
        self.tmp = tmp
        self.path = tmp / "reference-20260926.sqlite3"
        with closing(sqlite3.connect(self.path)) as db, db:
            db.executescript(identity.schema_sql("reference"))
            for name in fixtures:
                load_reference(db, load(name))
        self.ref = store.open_reference(self.path)
        self.identity = store.IdentityStore(tmp / "core")

    def close(self) -> None:
        self.ref.close()
        self.identity.db.close()

    def subject(self, subject_id: str) -> dict:
        return page.load_subject(self.ref, subject_id)

    def lookups(self, subject: dict) -> dict:
        """The store lookups page composition reads for a subject, at each of its levels."""
        ids = [value for value in subject["ids"].values() if value]
        stored = {(row["subject_id"], row["provider"]): row for row in self.identity.bindings(ids, ("confirmed", "conflicting"))}
        return {"stored": lambda target, provider: stored.get((target, provider)), "coins": lambda *_: None,
                "queue": self.identity.open_queue(ids)}

    def compose(self, subject_id: str, plugins: list[page.PluginInfo]) -> dict[str, dict]:
        """The page's sections by name."""
        subject = self.subject(subject_id)
        return {section["section"]: section for section in page.compose(subject, plugins, **self.lookups(subject))}

    def resolve(self, info: page.PluginInfo, subject_id: str, *records: dict):
        """What identity-resolve does with one plugin's answer: keep its claims, then store the binding or the queue
        item the authority rule decides at the records' level. Returns (binding, queue item)."""
        subject = self.subject(subject_id)
        batch = identity.batch_from_json({"plugin": info.manifest.plugin, "provider": info.manifest.provider,
                                          "adapter_version": PROVENANCE["adapter_version"], "origin": "resolve",
                                          "claims": list(records)})
        identity.check_batch(batch, info.manifest)
        for claim in identity.batch_to_json(batch)["claims"]:
            self.identity.put_claim(batch.plugin, batch.provider, claim)
        binding, item, _ = page.apply_resolve(batch, info, identity.Level(records[0]["level"]), subject,
                                              page.resolve_input(info, subject), now=NOW, as_of=AS_OF,
                                              bound_to=self.identity.bound_subject)
        if binding is not None:
            self.identity.put_binding(binding)
        if item is not None:
            self.identity.put_queue_item(item)
        return binding, item

    def release(self, name: str, **changes) -> Path:
        directory = self.tmp / "builds"
        directory.mkdir(exist_ok=True)
        return release(self.path, directory, name, **changes)

    def rekey(self, path: Path) -> dict | None:
        """Lifecycle A: the device's rows follow the release at `path`."""
        with closing(store.open_reference(path)) as ref:
            return lifecycle.rekey(self.identity, ref, lifecycle.release_id(ref, path.stem))
