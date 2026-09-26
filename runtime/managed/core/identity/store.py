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
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from . import Store, schema_sql
from .model import Binding, ProviderRef
from .resolution import QueueItem

REFERENCE_DIR_ENV = "PYTHIA_REFERENCE_DIR"
SCHEMA_VERSION = "1"


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def reference_path(data_dir: Path) -> Path | None:
    """The newest reference build, or None when the device has none yet."""
    configured = os.environ.get(REFERENCE_DIR_ENV)
    directory = Path(configured) if configured and Path(configured).is_absolute() else Path(data_dir) / "reference"
    builds = sorted(directory.glob("reference-*.sqlite3")) if directory.is_dir() else []
    return builds[-1] if builds else None


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

    def bindings(self, subject_ids: Iterable[str], statuses: Iterable[str] = ("confirmed",)) -> list[sqlite3.Row]:
        subjects, states = list(subject_ids), list(statuses)
        if not subjects:
            return []
        return self.db.execute(
            f"SELECT * FROM bindings WHERE subject_id IN ({','.join('?' * len(subjects))})"
            f" AND status IN ({','.join('?' * len(states))}) ORDER BY plugin, provider",
            (*subjects, *states)).fetchall()

    def put_binding(self, binding: Binding) -> None:
        """One current binding per provider reference; a newer decision replaces it."""
        ref = binding.provider_ref
        self.db.execute(
            "INSERT INTO bindings (id, plugin, provider, native_id, native_scope, subject_id, level, status, authority,"
            " rule_id, evidence_ids, valid_from, valid_to, verified_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
            " ON CONFLICT (provider, native_scope, native_id) DO UPDATE SET plugin=excluded.plugin,"
            " subject_id=excluded.subject_id, level=excluded.level, status=excluded.status,"
            " authority=excluded.authority, rule_id=excluded.rule_id, evidence_ids=excluded.evidence_ids,"
            " verified_at=excluded.verified_at",
            (uuid.uuid4().hex, binding.plugin, ref.provider, ref.native_id, ref.native_scope, binding.subject_id,
             binding.level, binding.status, binding.authority, binding.rule_id, json.dumps(list(binding.evidence_ids)),
             binding.validity.valid_from, binding.validity.valid_to, now()))

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
        rows = self.db.execute("SELECT id, reason, plugins, subject_ids FROM queue WHERE state='open'").fetchall()
        return [{"id": row["id"], "plugin": json.loads(row["plugins"])[0], "reason": row["reason"]}
                for row in rows if wanted & set(json.loads(row["subject_ids"]))]

    def put_claim(self, plugin: str, provider: str, claim_json: dict, *, scope: str | None = None) -> None:
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
            (plugin, provider, ref["native_scope"], ref["native_id"], scope, claim_json["level"],
             (claim_json.get("attributes") or {}).get("name"), text, "sha256:" + hashlib.sha256(text.encode()).hexdigest(), stamp, stamp))
