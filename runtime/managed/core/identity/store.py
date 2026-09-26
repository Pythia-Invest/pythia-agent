"""Thin store module for the two backbone files (ADR 0037): open, create, read and write.

`reference-<date>.sqlite3` is read-only: the newest file in the reference
directory (`PYTHIA_REFERENCE_DIR`, else `<core data dir>/reference`).
`identity.sqlite3` lives in the core plugin's data directory and is created
private on first use. Portable SQL only; callers own nothing but the path.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

from . import Store, schema_sql
from .model import Binding, ProviderRef
from .resolution import QueueItem, Verdict, VerdictOutcome

REFERENCE_DIR_ENV = "PYTHIA_REFERENCE_DIR"
SCHEMA_VERSION = "2"            # identity.sqlite3 metadata.schema_version
REFERENCE_SCHEMA_VERSION = "2"  # reference-*.sqlite3 release.schema_version, written by the builder


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def reference_path(data_dir: Path) -> Path | None:
    """The newest reference build this core can read, or None when the device has none yet.

    A build with another schema, or one that does not open, is skipped for the previous one.
    """
    configured = os.environ.get(REFERENCE_DIR_ENV)
    directory = Path(configured) if configured and Path(configured).is_absolute() else Path(data_dir) / "reference"
    builds = sorted(directory.glob("reference-*.sqlite3"), reverse=True) if directory.is_dir() else []
    return next((path for path in builds if _compatible(path)), None)


def _compatible(path: Path) -> bool:
    try:
        connection = open_reference(path)
        try:
            row = connection.execute("SELECT value FROM release WHERE key = 'schema_version'").fetchone()
        finally:
            connection.close()
    except sqlite3.Error:
        return False
    return row is not None and row[0] == REFERENCE_SCHEMA_VERSION


def open_reference(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(f"{Path(path).resolve().as_uri()}?mode=ro", uri=True, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    return connection


class IdentityStore:
    """identity.sqlite3: bindings, the resolution queue and plugin-tagged claims."""

    def __init__(self, data_dir: Path):
        directory = Path(data_dir)
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = directory / "identity.sqlite3"
        if self.path.exists() and not self._readable():
            # Never delete device state: keep the unreadable file aside and start a fresh store.
            self.path.replace(self.path.with_name(f"identity.unreadable-{uuid.uuid4().hex[:8]}.sqlite3"))
        if not self.path.exists():
            staging = self.path.with_name(f"identity.{uuid.uuid4().hex}.part")
            setup = sqlite3.connect(staging)
            try:
                setup.executescript(schema_sql(Store.IDENTITY))
                setup.execute("INSERT INTO metadata (key, value) VALUES ('schema_version', ?)", (SCHEMA_VERSION,))
                setup.commit()
            finally:
                setup.close()
            os.chmod(staging, 0o600)
            staging.replace(self.path)
        self.db = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self._writing = threading.RLock()  # one connection serves every thread: one transaction at a time

    def _readable(self) -> bool:
        try:
            connection = sqlite3.connect(f"{self.path.resolve().as_uri()}?mode=ro", uri=True)
            try:
                row = connection.execute("SELECT value FROM metadata WHERE key = 'schema_version'").fetchone()
            finally:
                connection.close()
        except sqlite3.Error:
            return False
        return row is not None and row[0] == SCHEMA_VERSION

    def bindings(self, subject_ids: Iterable[str], statuses: Iterable[str] = ("confirmed",)) -> list[sqlite3.Row]:
        subjects, states = list(subject_ids), list(statuses)
        if not subjects:
            return []
        return self.db.execute(
            f"SELECT * FROM bindings WHERE subject_id IN ({','.join('?' * len(subjects))})"
            f" AND status IN ({','.join('?' * len(states))}) ORDER BY plugin, provider",
            (*subjects, *states)).fetchall()

    @contextmanager
    def transaction(self):
        """One atomic write: a verdict, its effect and the item it settles land together or not at all."""
        with self._writing:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                yield
            except BaseException:
                self.db.execute("ROLLBACK")
                raise
            self.db.execute("COMMIT")

    def metadata(self, key: str) -> str | None:
        row = self.db.execute("SELECT value FROM metadata WHERE key = ?", (key,)).fetchone()
        return row[0] if row else None

    def set_metadata(self, key: str, value: str) -> None:
        self.db.execute("INSERT INTO metadata (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value=excluded.value",
                        (key, value))

    def put_binding(self, binding: Binding, verdict_id: str | None = None) -> bool:
        """One current binding per provider reference. A newer decision for the same subject replaces it;
        a reference bound to another subject is never re-pointed (returns False: that is a conflict)."""
        ref = binding.provider_ref
        self.db.execute(
            "INSERT INTO bindings (id, plugin, provider, native_id, native_scope, subject_id, level, status, authority,"
            " rule_id, evidence_ids, valid_from, valid_to, verified_at, verdict_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
            " ON CONFLICT (provider, native_scope, native_id) DO UPDATE SET plugin=excluded.plugin,"
            " subject_id=excluded.subject_id, level=excluded.level, status=excluded.status,"
            " authority=excluded.authority, rule_id=excluded.rule_id, evidence_ids=excluded.evidence_ids,"
            " verified_at=excluded.verified_at, verdict_id=excluded.verdict_id WHERE bindings.subject_id = excluded.subject_id",
            (uuid.uuid4().hex, binding.plugin, ref.provider, ref.native_id, ref.native_scope, binding.subject_id,
             binding.level, binding.status, binding.authority, binding.rule_id, json.dumps(list(binding.evidence_ids)),
             binding.validity.valid_from, binding.validity.valid_to, now(), verdict_id))
        return self.db.execute("SELECT changes()").fetchone()[0] == 1

    def binding_for(self, ref: ProviderRef) -> sqlite3.Row | None:
        return self.db.execute("SELECT * FROM bindings WHERE provider=? AND native_scope=? AND native_id=?",
                               (ref.provider, ref.native_scope, ref.native_id)).fetchone()

    def put_queue_item(self, item: QueueItem) -> None:
        """At most one open item per question (the dedupe key); re-asking refreshes it."""
        ref = item.provider_ref.wire() if item.provider_ref else None
        self.db.execute(
            "INSERT INTO queue (id, key, kind, reason, subject_ids, candidate_ids, evidence_ids, plugins, provider_ref,"
            " scheme, contested_values, state, opened_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
            " ON CONFLICT (key) WHERE state = 'open' DO UPDATE SET updated_at=excluded.updated_at",
            (item.id, item.key, item.kind, item.reason, json.dumps(item.subject_ids), json.dumps(item.candidate_ids),
             json.dumps(item.evidence_ids), json.dumps(item.plugins), json.dumps(ref) if ref else None, item.scheme,
             json.dumps(item.values), item.state, item.opened_at, now()))

    def open_queue(self, subject_ids: Iterable[str]) -> list[dict]:
        wanted = set(subject_ids)
        rows = self.db.execute("SELECT id, kind, reason, plugins, subject_ids, candidate_ids FROM queue WHERE state='open'").fetchall()
        return [{"id": row["id"], "plugin": json.loads(row["plugins"])[0], "kind": row["kind"], "reason": row["reason"]}
                for row in rows if wanted & set(json.loads(row["subject_ids"]) + json.loads(row["candidate_ids"]))]

    def queue_items(self, *, subject_ids: Iterable[str] | None = None, plugins: Iterable[str] | None = None,
                    kind: str | None = None, state: str = "open") -> list[dict]:
        """Queue items in one state, newest first; subjects match an item's subjects or candidates."""
        subjects, names = (set(subject_ids) if subject_ids is not None else None), (set(plugins) if plugins is not None else None)
        rows = self.db.execute("SELECT * FROM queue WHERE state = ? ORDER BY opened_at DESC, id", (state,)).fetchall()
        items = [_item(row) for row in rows]
        return [item for item in items if (kind is None or item["kind"] == kind)
                and (names is None or names & set(item["plugins"]))
                and (subjects is None or subjects & set(item["subject_ids"] + item["candidate_ids"]))]

    def queue_item(self, item_id: str) -> dict | None:
        row = self.db.execute("SELECT * FROM queue WHERE id = ?", (item_id,)).fetchone()
        return _item(row) if row else None

    def settle(self, item_id: str, state: str, verdict_id: str | None) -> bool:
        """Close an open item; False when it was no longer open."""
        self.db.execute("UPDATE queue SET state = ?, resolved_by = ?, updated_at = ? WHERE id = ? AND state = 'open'",
                        (state, verdict_id, now(), item_id))
        return self.db.execute("SELECT changes()").fetchone()[0] == 1

    def dismissed(self, key: str) -> bool:
        """A resolver already answered this question with "not a match": re-asking it does not reopen it."""
        return self.db.execute("SELECT 1 FROM queue WHERE key = ? AND state = 'dismissed' LIMIT 1", (key,)).fetchone() is not None

    def put_verdict(self, verdict: Verdict, outcome: VerdictOutcome, plugin: str = "pythia") -> str:
        """Record a verdict with the outcome the authority rule gave it; every submission is kept."""
        verdict_id = uuid.uuid4().hex
        self.db.execute(
            "INSERT INTO verdicts (id, item_id, resolver, plugin, authority, relation, chosen_id, confidence, model,"
            " prompt_version, input_digest, rule_id, rationale, user_turn, outcome, created_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (verdict_id, verdict.item_id, verdict.resolver, plugin, verdict.authority, verdict.relation, verdict.chosen_id,
             verdict.confidence, verdict.model, verdict.prompt_version, verdict.input_digest, verdict.rule_id,
             verdict.rationale, verdict.user_turn, outcome, now()))
        return verdict_id

    def history(self, item: dict) -> list[dict]:
        """Every verdict on this question, including on earlier items that asked it, oldest first."""
        rows = self.db.execute(
            "SELECT v.*, q.state AS item_state FROM verdicts v JOIN queue q ON q.id = v.item_id WHERE q.key = ?"
            " ORDER BY v.created_at, v.rowid", (item["key"],)).fetchall()
        return [{key: row[key] for key in row.keys()} for row in rows]

    def claim(self, plugin: str, ref: ProviderRef) -> dict | None:
        """The provider record a plugin claimed for a reference, as emitted."""
        row = self.db.execute("SELECT claim FROM claims WHERE plugin = ? AND native_scope = ? AND native_id = ?",
                              (plugin, ref.native_scope, ref.native_id)).fetchone()
        return json.loads(row[0]) if row else None

    def put_miss(self, subject_id: str, plugin: str, reason: str, seconds: int) -> None:
        expires = (datetime.now(timezone.utc) + timedelta(seconds=seconds)).replace(microsecond=0)
        self.db.execute("INSERT INTO resolve_misses (subject_id, plugin, reason, expires_at) VALUES (?,?,?,?)"
                        " ON CONFLICT (subject_id, plugin) DO UPDATE SET reason=excluded.reason, expires_at=excluded.expires_at",
                        (subject_id, plugin, reason, expires.isoformat().replace("+00:00", "Z")))

    def misses(self, subject_id: str) -> dict[str, str]:
        """plugin -> reason for unexpired negative resolve results."""
        rows = self.db.execute("SELECT plugin, reason FROM resolve_misses WHERE subject_id = ? AND expires_at > ?",
                               (subject_id, now())).fetchall()
        return {row["plugin"]: row["reason"] for row in rows}

    def put_claim(self, plugin: str, provider: str, claim_json: dict) -> None:
        ref = claim_json.get("native_ref") or {}
        if not ref:
            return
        text = json.dumps(claim_json, sort_keys=True, separators=(",", ":"))
        stamp = now()
        self.db.execute(
            "INSERT INTO claims (plugin, provider, native_scope, native_id, scope, level, name, claim, claim_digest,"
            " first_seen, last_seen) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (plugin, native_scope, native_id)"
            " DO UPDATE SET claim=excluded.claim, claim_digest=excluded.claim_digest, name=excluded.name,"
            " last_seen=excluded.last_seen",
            (plugin, provider, ref["native_scope"], ref["native_id"], None, claim_json["level"],
             (claim_json.get("attributes") or {}).get("name"), text, "sha256:" + hashlib.sha256(text.encode()).hexdigest(), stamp, stamp))


def _item(row: sqlite3.Row) -> dict:
    decoded = {name: json.loads(row[name]) for name in ("subject_ids", "candidate_ids", "evidence_ids", "plugins")}
    return {"id": row["id"], "key": row["key"], "kind": row["kind"], "reason": row["reason"], **decoded,
            "provider_ref": json.loads(row["provider_ref"]) if row["provider_ref"] else None, "scheme": row["scheme"],
            "values": json.loads(row["contested_values"]), "state": row["state"], "opened_at": row["opened_at"],
            "updated_at": row["updated_at"], "resolved_by": row["resolved_by"]}
