"""Private SQLite records for canonical reference intent and association history."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import sqlite3
import stat
import uuid


def identifier(kind):
    return f"{kind}:{uuid.uuid4().hex}"


def dumps(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def native_key(native):
    return dumps(native)


def require_private(path, *, directory=False, absent=False):
    try:
        info = path.lstat()
    except FileNotFoundError:
        if absent:
            return
        raise
    expected = stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)
    if not expected or info.st_mode & 0o077 or info.st_uid != os.getuid():
        raise PermissionError("Identity state must be private, owned and not symlinked")


DDL = """
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
INSERT OR IGNORE INTO metadata VALUES ('generation', 0);
CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, native_key TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS subjects (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, native_ref TEXT NOT NULL, evidence_ids TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mappings (
 id TEXT PRIMARY KEY, native_key TEXT NOT NULL, scope TEXT NOT NULL, intent_subject TEXT NOT NULL,
 target TEXT NOT NULL, evidence_ids TEXT NOT NULL, rule_id TEXT, rule_version TEXT,
 evidence_versions TEXT NOT NULL, status TEXT NOT NULL, reason TEXT NOT NULL,
 revision INTEGER NOT NULL, active_override TEXT,
 UNIQUE(native_key, scope));
CREATE TABLE IF NOT EXISTS revisions (
 mapping_id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL,
 PRIMARY KEY(mapping_id, revision));
CREATE TABLE IF NOT EXISTS overrides (
 id TEXT PRIMARY KEY, mapping_id TEXT NOT NULL, target TEXT NOT NULL, effect TEXT NOT NULL,
 evidence_ids TEXT NOT NULL, state TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS catalogue_labels (
 native_key TEXT NOT NULL, scope TEXT NOT NULL, data TEXT NOT NULL, search_text TEXT NOT NULL,
 PRIMARY KEY(native_key, scope));
"""


class IdentityDatabase:
    def __init__(self, data_dir):
        # The caller supplies native PluginState.data_dir, never a global profile.
        directory = Path(data_dir)
        require_private(directory, directory=True, absent=True)
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        require_private(directory, directory=True)
        self.path = directory / "identity.sqlite3"
        require_private(self.path, absent=True)
        descriptor = os.open(self.path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
        os.close(descriptor)
        require_private(self.path)
        with self.connection() as db:
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version not in (0, 1):
                raise ValueError("Unsupported identity database version")
            db.executescript(DDL)
            db.execute("PRAGMA user_version=1")

    @contextmanager
    def connection(self):
        require_private(self.path.parent, directory=True)
        require_private(self.path)
        db = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA synchronous=FULL")
        try:
            yield db
        finally:
            db.close()

    @contextmanager
    def transaction(self):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                yield db
                db.commit()
            except BaseException:
                db.rollback()
                raise


def evidence_rows(db, ids):
    rows = []
    for identity in ids:
        row = db.execute("SELECT data FROM evidence WHERE id=?", (identity,)).fetchone()
        if row is None:
            raise ValueError("Unknown evidence reference")
        rows.append(json.loads(row[0]))
    return rows


def subject_row(db, subject_id):
    row = db.execute("SELECT * FROM subjects WHERE id=?", (subject_id,)).fetchone()
    if row is None:
        raise ValueError("Unknown subject reference")
    return row


def generation(db):
    return db.execute("SELECT value FROM metadata WHERE key='generation'").fetchone()[0]


def snapshot(row):
    return {"schema_version": 1, "id": row["id"], "provider_ref": json.loads(row["native_key"]),
            "target": {"kind": row["scope"], "id": row["target"]}, "status": row["status"],
            "evidence_ids": json.loads(row["evidence_ids"]),
            "rule_version": f"{row['rule_id'] or 'unqualified'}:{row['rule_version'] or '0'}",
            "revision": row["revision"], "active_override": row["active_override"]}


def record_revision(db, mapping_id):
    row = db.execute("SELECT * FROM mappings WHERE id=?", (mapping_id,)).fetchone()
    value = snapshot(row)
    if value["active_override"]:
        override = db.execute("SELECT * FROM overrides WHERE id=?", (value["active_override"],)).fetchone()
        value["active_override"] = {"id": override["id"], "effect": override["effect"], "evidence_ids": json.loads(override["evidence_ids"])}
    from .wire import validate
    value = validate("mapping", value)
    db.execute("INSERT INTO revisions VALUES (?, ?, ?)", (mapping_id, row["revision"], dumps(value)))
    db.execute("UPDATE metadata SET value=value+1 WHERE key='generation'")
    return value
