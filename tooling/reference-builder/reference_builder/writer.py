"""Write the snapshot SQLite file atomically."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from . import schema
from .fetch import sha256_file
from .model import Snapshot


def write(snap: Snapshot, path: Path, meta: dict[str, str], sources: list[dict]) -> dict[str, int]:
    """Create `path` from scratch and return row counts per table."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".part")
    tmp.unlink(missing_ok=True)
    counts: dict[str, int] = {}
    connection = sqlite3.connect(tmp)
    try:
        connection.executescript(schema.DDL)
        connection.execute(f"PRAGMA user_version = {schema.SCHEMA_VERSION}")
        for table, values in schema.rows(snap, meta, sources).items():
            verb = "INSERT OR IGNORE" if table in schema.FIRST_WINS else "INSERT"
            for row in values:
                names = ",".join(row)
                connection.execute(f"{verb} INTO {table} ({names}) VALUES ({','.join('?' * len(row))})", tuple(row.values()))
            counts[table] = connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        connection.commit()
        connection.execute("VACUUM")
    finally:
        connection.close()
    tmp.replace(path)
    return counts


def describe(path: Path) -> dict:
    return {"file": path.name, "bytes": path.stat().st_size, "sha256": sha256_file(path)}
