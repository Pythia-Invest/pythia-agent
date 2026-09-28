"""Thin store module for the two backbone files (ADR 0037): open, create, read and write.

The reference SQLite file is read-only: the one in the installed reference
package under `<core data dir>/reference` (`reference_package`, ADR 0039).
`identity.sqlite3` lives in the core plugin's data directory and is created
private on first use. Portable SQL only; callers own nothing but the path.
"""
from __future__ import annotations

import functools
import hashlib
import json
import logging
import os
import shutil
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

from . import Store, reference_package, schema_sql
from .model import Binding, ProviderRef
from .schemes import registered_kind
from .vocabulary import PROVISIONAL
from .resolution import QueueItem, Verdict, VerdictOutcome

logger = logging.getLogger(__name__)
SCHEMA_VERSION = "4"            # identity.sqlite3 metadata.schema_version (3: agent_confirmed; 4: open subject kinds)
ADDED = "-- Added within schema 4"  # identity.sql: the idempotent statements every open applies
REFERENCE_SCHEMA_VERSION = str(reference_package.FORMAT_VERSION)  # the reference SQLite's release.schema_version


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def reference_path(data_dir: Path) -> Path | None:
    """The installed reference package's SQLite file, or None when the device has none this core can read."""
    return reference_package.current(data_dir)


def open_reference(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(f"{Path(path).resolve().as_uri()}?mode=ro", uri=True, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    return connection


def _locked(method):
    """Every use of the one shared connection holds the store lock, so a write from another thread never joins
    (and is never rolled back with) an open transaction."""
    @functools.wraps(method)
    def call(self, *args, **kwargs):
        with self._writing:
            return method(self, *args, **kwargs)
    return call


class IdentityStore:
    """identity.sqlite3: bindings, the resolution queue and plugin-tagged claims."""

    def __init__(self, data_dir: Path):
        directory = Path(data_dir)
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = directory / "identity.sqlite3"
        self.set_aside: str | None = None  # the file name an incompatible store was kept under, this process
        version = self._version() if self.path.exists() else SCHEMA_VERSION
        if version == "3":
            try:
                self._migrate_v3()
                version = SCHEMA_VERSION
            except sqlite3.Error:
                # Another process may have migrated it meanwhile; otherwise it is kept aside below like any other.
                logger.warning("identity store schema 3 could not be migrated", exc_info=True)
                version = self._version()
        if version != SCHEMA_VERSION:
            # Never delete device state: keep the old file (and its journal) aside and start a fresh store.
            kept = self.path.with_name(f"identity.{'v' + version if version else 'unreadable'}-{uuid.uuid4().hex[:8]}.sqlite3")
            for suffix in ("-journal", "-wal", "-shm"):
                sibling = self.path.with_name(self.path.name + suffix)
                if sibling.exists():
                    sibling.replace(kept.with_name(kept.name + suffix))
            self.path.replace(kept)
            self.set_aside = kept.name
            logger.warning("identity store schema %s is not %s: kept as %s; bindings, answers and claims start empty",
                           version or "unreadable", SCHEMA_VERSION, kept.name)
        if not self.path.exists():
            self._create(lambda setup: None)
        self.db = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(schema_sql(Store.IDENTITY).partition(ADDED)[2].partition("\n")[2])  # added in version
        self._writing = threading.RLock()  # one connection serves every thread: one user of it at a time

    def _create(self, fill) -> None:
        """Write a fresh store beside the file, let `fill` copy rows into it, then put it in place atomically."""
        staging = self.path.with_name(f"identity.{uuid.uuid4().hex}.part")
        setup = sqlite3.connect(staging)
        try:
            versioned, _marker, added = schema_sql(Store.IDENTITY).partition(ADDED)
            setup.executescript(versioned)
            fill(setup)
            setup.executescript(added.partition("\n")[2])
            setup.execute("INSERT INTO metadata (key, value) VALUES ('schema_version', ?)"
                          " ON CONFLICT (key) DO UPDATE SET value = excluded.value", (SCHEMA_VERSION,))
            setup.commit()
        except BaseException:
            setup.close()
            staging.unlink(missing_ok=True)  # only this call's own staging file
            raise
        setup.close()
        os.chmod(staging, 0o600)
        staging.replace(self.path)

    def _migrate_v3(self) -> None:
        """v3 -> v4 keeps every row: v4 only drops the level and relation-type CHECKs and names the subject's kind
        `kind` (SQLite cannot alter a CHECK, so the tables are copied into a fresh store that replaces the file).
        The v3 file is kept as `identity.before-v4-<id>.sqlite3`. Processes share no lock: a second process that
        starts during the migration fails its own copy and re-reads the migrated version."""
        def fill(setup: sqlite3.Connection) -> None:
            setup.execute("ATTACH DATABASE ? AS old", (str(self.path),))
            for (table,) in setup.execute("SELECT name FROM main.sqlite_master WHERE type = 'table'").fetchall():
                columns = [row[1] for row in setup.execute(f"PRAGMA main.table_info({table})")]
                source = [_V3_COLUMNS.get((table, name), name) for name in columns]
                setup.execute(f"INSERT INTO main.{table} ({','.join(columns)})"
                              f" SELECT {','.join(source)} FROM old.{table}")
            setup.commit()
            setup.execute("DETACH DATABASE old")
        kept = self.path.with_name(f"identity.before-v4-{uuid.uuid4().hex[:8]}.sqlite3")
        shutil.copy2(self.path, kept)
        os.chmod(kept, 0o600)
        self._create(fill)
        logger.info("identity store migrated from schema 3 to %s", SCHEMA_VERSION)

    def _version(self) -> str | None:
        """The stored schema version, or None when the file is not a readable identity store."""
        try:
            connection = sqlite3.connect(f"{self.path.resolve().as_uri()}?mode=ro", uri=True)
            try:
                row = connection.execute("SELECT value FROM metadata WHERE key = 'schema_version'").fetchone()
            finally:
                connection.close()
        except sqlite3.Error:
            return None
        return str(row[0]) if row is not None else None

    @_locked
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

    @_locked
    def metadata(self, key: str) -> str | None:
        row = self.db.execute("SELECT value FROM metadata WHERE key = ?", (key,)).fetchone()
        return row[0] if row else None

    @_locked
    def set_metadata(self, key: str, value: str) -> None:
        self.db.execute("INSERT INTO metadata (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value=excluded.value",
                        (key, value))

    @_locked
    def put_binding(self, binding: Binding, verdict_id: str | None = None) -> bool:
        """One current binding per provider reference. A newer decision for the same subject replaces it. A
        reference bound to another subject is re-pointed only from a rejected or provisional (agent) binding by a
        stronger answer, which supersedes the agent's item; otherwise it returns False: that is a conflict."""
        ref = binding.provider_ref
        registered_kind(binding.subject_id)  # the store keeps registered kinds and key schemes only
        before = self.binding_for(ref)
        self.db.execute(
            "INSERT INTO bindings (id, plugin, provider, native_id, native_scope, subject_id, kind, status, authority,"
            " rule_id, evidence_ids, valid_from, valid_to, verified_at, verdict_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
            " ON CONFLICT (provider, native_scope, native_id) DO UPDATE SET plugin=excluded.plugin,"
            " subject_id=excluded.subject_id, kind=excluded.kind, status=excluded.status,"
            " authority=excluded.authority, rule_id=excluded.rule_id, evidence_ids=excluded.evidence_ids,"
            " verified_at=excluded.verified_at, verdict_id=excluded.verdict_id WHERE bindings.subject_id = excluded.subject_id"
            " OR bindings.status = 'rejected'"
            " OR (bindings.authority = 'agent_confirmed' AND excluded.authority <> 'agent_confirmed')",
            (uuid.uuid4().hex, binding.plugin, ref.provider, ref.native_id, ref.native_scope, binding.subject_id,
             binding.kind, binding.status, binding.authority, binding.rule_id, json.dumps(list(binding.evidence_ids)),
             binding.validity.valid_from, binding.validity.valid_to, now(), verdict_id))
        changed = self.db.execute("SELECT changes()").fetchone()[0] == 1
        if changed and before is not None and before["verdict_id"] and before["subject_id"] != binding.subject_id:
            self.db.execute("UPDATE queue SET state = 'superseded', updated_at = ? WHERE resolved_by = ?"
                            " AND state = 'resolved'", (now(), before["verdict_id"]))
        return changed

    @_locked
    def put_read_check(self, subject_id: str, ref: ProviderRef, plugin: str, stated: dict, differs: list[str],
                       note: str | None) -> None:
        """Record one read check (ADR 0037): no `note` means the read verified, which also stamps the subject's
        confirmed binding. A check never changes a binding otherwise."""
        stamp, key = now(), (ref.provider, ref.native_scope, ref.native_id)
        self.db.execute(
            "INSERT INTO read_checks (subject_id, provider, native_scope, native_id, plugin, stated, differs, note,"
            " checked_at, verified_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT (subject_id, provider, native_scope,"
            " native_id) DO UPDATE SET plugin = excluded.plugin, stated = excluded.stated, differs = excluded.differs,"
            " note = excluded.note, checked_at = excluded.checked_at,"
            " verified_at = COALESCE(excluded.verified_at, read_checks.verified_at)",
            (subject_id, *key, plugin, json.dumps(stated, sort_keys=True), json.dumps(differs), note, stamp,
             None if note else stamp))
        if note is None:
            self.db.execute("UPDATE bindings SET verified_at = ? WHERE provider = ? AND native_scope = ? AND native_id = ?"
                            " AND subject_id = ? AND status = 'confirmed'", (stamp, *key, subject_id))

    @_locked
    def read_checks(self, subject_ids: Iterable[str]) -> dict[tuple[str, str, str, str], sqlite3.Row]:
        """The subjects' last read checks by (subject, provider, native scope, native id)."""
        subjects = list(subject_ids)
        rows = self.db.execute(f"SELECT * FROM read_checks WHERE subject_id IN ({','.join('?' * len(subjects))})",
                               subjects).fetchall() if subjects else []
        return {(row["subject_id"], row["provider"], row["native_scope"], row["native_id"]): row for row in rows}

    @_locked
    def bound_subject(self, ref: ProviderRef) -> str | None:
        """The subject a reference is firmly bound to; a provisional (agent) binding yields to stronger evidence."""
        row = self.binding_for(ref)
        return row["subject_id"] if row is not None and row["status"] == "confirmed" \
            and row["authority"] not in PROVISIONAL else None

    @_locked
    def reject_binding(self, ref: ProviderRef, subject_id: str, verdict_id: str) -> None:
        """A user's "not this instrument" withdraws the provisional binding it overrides."""
        self.db.execute("UPDATE bindings SET status = 'rejected', verdict_id = ? WHERE provider = ? AND native_scope = ?"
                        " AND native_id = ? AND subject_id = ?", (verdict_id, ref.provider, ref.native_scope,
                                                                  ref.native_id, subject_id))

    @_locked
    def binding_for(self, ref: ProviderRef) -> sqlite3.Row | None:
        return self.db.execute("SELECT * FROM bindings WHERE provider=? AND native_scope=? AND native_id=?",
                               (ref.provider, ref.native_scope, ref.native_id)).fetchone()

    @_locked
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

    @_locked
    def open_queue(self, subject_ids: Iterable[str]) -> list[dict]:
        """The page's short form of a subject's open items."""
        return [{"id": item["id"], "plugin": item["plugins"][0], "kind": item["kind"], "reason": item["reason"]}
                for item in self.queue_items(subject_ids=subject_ids)]

    @_locked
    def queue_items(self, *, subject_ids: Iterable[str] | None = None, plugins: Iterable[str] | None = None,
                    kind: str | None = None, which: str = "open") -> list[dict]:
        """Items newest first: `open`; `answered`, the ones only the agent answered, which route provisionally
        until the user confirms or overrides them; or `settled` by rules or the user. Subjects match an item's
        subjects or candidates."""
        subjects, names = (set(subject_ids) if subject_ids is not None else None), (set(plugins) if plugins is not None else None)
        where = {"open": "q.state = 'open'",
                 "answered": "q.state IN ('resolved', 'dismissed') AND v.resolver = 'agent'",
                 "settled": "q.state IN ('resolved', 'dismissed') AND (v.resolver IS NULL OR v.resolver <> 'agent')"}[which]
        rows = self.db.execute(f"{_ITEMS} WHERE {where} ORDER BY q.opened_at DESC, q.id").fetchall()
        items = [_item(row) for row in rows]
        return [item for item in items if (kind is None or item["kind"] == kind)
                and (names is None or names & set(item["plugins"]))
                and (subjects is None or subjects & set(item["subject_ids"] + item["candidate_ids"]))]

    @_locked
    def queue_item(self, item_id: str) -> dict | None:
        row = self.db.execute(f"{_ITEMS} WHERE q.id = ?", (item_id,)).fetchone()
        return _item(row) if row else None

    @_locked
    def settle(self, item_id: str, state: str, verdict_id: str | None, current: str = "open") -> bool:
        """Settle an item in its `current` state; False when it was no longer in it."""
        self.db.execute("UPDATE queue SET state = ?, resolved_by = ?, updated_at = ? WHERE id = ? AND state = ?",
                        (state, verdict_id, now(), item_id, current))
        return self.db.execute("SELECT changes()").fetchone()[0] == 1

    @_locked
    def dismissed(self, key: str, evidence_ids: Iterable[str]) -> bool:
        """A resolver answered this question "not a match" on the same identifier evidence: re-asking it does not
        reopen it. New evidence does."""
        rows = self.db.execute("SELECT evidence_ids FROM queue WHERE key = ? AND state = 'dismissed'", (key,)).fetchall()
        return any(set(json.loads(row[0])) == set(evidence_ids) for row in rows)

    @_locked
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

    @_locked
    def history(self, item: dict) -> list[dict]:
        """Every verdict on this question, including on earlier items that asked it, oldest first."""
        rows = self.db.execute(
            "SELECT v.*, q.state AS item_state FROM verdicts v JOIN queue q ON q.id = v.item_id WHERE q.key = ?"
            " ORDER BY v.created_at, v.rowid", (item["key"],)).fetchall()
        return [{key: row[key] for key in row.keys()} for row in rows]

    @_locked
    def claim(self, plugin: str, ref: ProviderRef) -> dict | None:
        """The provider record a plugin claimed for a reference, as emitted."""
        row = self.db.execute("SELECT claim FROM claims WHERE plugin = ? AND native_scope = ? AND native_id = ?",
                              (plugin, ref.native_scope, ref.native_id)).fetchone()
        return json.loads(row[0]) if row else None

    @_locked
    def put_miss(self, subject_id: str, plugin: str, reason: str, seconds: int) -> None:
        expires = (datetime.now(timezone.utc) + timedelta(seconds=seconds)).replace(microsecond=0)
        self.db.execute("INSERT INTO resolve_misses (subject_id, plugin, reason, expires_at) VALUES (?,?,?,?)"
                        " ON CONFLICT (subject_id, plugin) DO UPDATE SET reason=excluded.reason, expires_at=excluded.expires_at",
                        (subject_id, plugin, reason, expires.isoformat().replace("+00:00", "Z")))

    @_locked
    def misses(self, subject_id: str) -> dict[str, str]:
        """plugin -> reason for unexpired negative resolve results."""
        rows = self.db.execute("SELECT plugin, reason FROM resolve_misses WHERE subject_id = ? AND expires_at > ?",
                               (subject_id, now())).fetchall()
        return {row["plugin"]: row["reason"] for row in rows}

    @_locked
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


# v4 column -> the v3 expression that fills it.
_V3_COLUMNS = {("subjects", "kind"): "level", ("bindings", "kind"): "level"}


_ITEMS = ("SELECT q.*, v.resolver AS settled_by, v.relation AS settled_relation, v.chosen_id AS settled_choice"
          " FROM queue q LEFT JOIN verdicts v ON v.id = q.resolved_by")


def _item(row: sqlite3.Row) -> dict:
    decoded = {name: json.loads(row[name]) for name in ("subject_ids", "candidate_ids", "evidence_ids", "plugins")}
    return {"id": row["id"], "key": row["key"], "kind": row["kind"], "reason": row["reason"], **decoded,
            "provider_ref": json.loads(row["provider_ref"]) if row["provider_ref"] else None, "scheme": row["scheme"],
            "values": json.loads(row["contested_values"]), "state": row["state"], "opened_at": row["opened_at"],
            "updated_at": row["updated_at"], "resolved_by": row["resolved_by"],
            "settled": {"by": row["settled_by"], "relation": row["settled_relation"], "chosen_id": row["settled_choice"]}
            if row["settled_by"] else None}
