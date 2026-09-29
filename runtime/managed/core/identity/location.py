"""Pythia's own store directory, and the one-time move of an earlier store into it (ADR 0034, 2026-09-29 amendment).

identity.sqlite3 and the installed reference package live in `<PYTHIA_DATA_ROOT>/store`; the lifecycle passes the
root to Hermes. Earlier versions kept both in the core plugin's Hermes data directory. The first use in a process
moves them there once, under a lock, and never over anything: the identity store as a verified copy, after which
the old file is renamed, never deleted; the reference by rename, or by a verified install across file systems
(`reference_package.adopt`). Without the root, or while an earlier identity store cannot be moved, identity is
unavailable for the process and writes nothing anywhere else.
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
import uuid
from contextlib import closing
from pathlib import Path

from . import reference_package

logger = logging.getLogger(__name__)
ROOT = "PYTHIA_DATA_ROOT"  # the per-stack data root the lifecycle passes to Hermes
IDENTITY, MOVED = "identity.sqlite3", "identity.moved.sqlite3"
_opened: dict[tuple[str, str], Path | str] = {}  # (old directory, root) -> the store directory, or why there is none
_opening = threading.Lock()


class Unavailable(OSError):
    """Pythia's store cannot be used in this process; the message says why. An OSError, so every identity read
    answers with its usual "unavailable"."""


def store_dir(legacy: Path) -> Path:
    """`<PYTHIA_DATA_ROOT>/store`, created private, with what an earlier Pythia kept in `legacy` moved into it on the
    first call in this process. Raises Unavailable, for the rest of the process, when the root is unset or relative,
    or when an earlier identity store could not be moved."""
    key = (str(legacy), os.environ.get(ROOT) or "")
    with _opening:
        if key not in _opened:
            try:
                _opened[key] = _open(Path(legacy), key[1])
            except OSError as error:
                _opened[key] = str(error)
                logger.error("identity is unavailable: %s", error)
        found = _opened[key]
    if isinstance(found, str):
        raise Unavailable(found)
    return found


def both_present(store: Path) -> str | None:
    """Says so while an earlier store is still in place beside this one: an identity store that was not renamed (a
    move stopped after publishing, or older code run again) or a reference that was not moved. None otherwise."""
    with _opening:
        earlier = [Path(legacy) for (legacy, _root), found in _opened.items() if found == store]
    found = [f"{path} ({_bytes(path)} bytes)" for legacy in earlier for path in (legacy / IDENTITY, legacy / "reference")
             if path.exists()]
    return (f"An earlier copy of Pythia's store is still present: {'; '.join(found)}. Pythia uses only {store}; "
            "nothing in the earlier copy is merged, and it can be deleted by hand.") if found else None


def _bytes(path: Path) -> int:
    return path.stat().st_size if path.is_file() else sum(item.stat().st_size for item in path.rglob("*") if item.is_file())


def _open(legacy: Path, root: str) -> Path:
    if not os.path.isabs(root):
        raise Unavailable(f"{ROOT} is not set to an absolute path, so Pythia has no directory for its store")
    directory = Path(root) / "store"
    directory.mkdir(mode=0o700, exist_ok=True)  # inside the root the lifecycle created, never in its place
    adopt_legacy(legacy, directory)
    return directory


def adopt_legacy(legacy: Path, store: Path) -> list[str]:
    """Move what an earlier Pythia kept in `legacy` into `store`, once; returns what happened, one line per item.
    Raises Unavailable when an earlier identity store exists but could not be moved: identity then stays closed
    rather than start an empty store while the investor's answers are elsewhere."""
    source, target, notes = Path(legacy) / IDENTITY, Path(store) / IDENTITY, []
    with reference_package.locked(Path(store) / reference_package.MOVE_LOCK):
        if source.is_file() and not target.exists():
            notes.append(_move_identity(source, target))
        elif source.is_file():
            notes.append(f"kept {source} ({_bytes(source)} bytes): {target} already exists")
    moved = reference_package.adopt(Path(legacy), Path(store))
    notes += [moved] if moved else []
    for note in notes:
        logger.info("Pythia store: %s", note)
    return notes


def _move_identity(source: Path, target: Path) -> str:
    """Copy a consistent snapshot beside `target`, verify it, publish it only where no store exists, then rename the
    old file. On any failure nothing is published and the old file stays as it was."""
    part = target.with_name(f"identity.{uuid.uuid4().hex}.part")
    try:
        try:  # read-write, as any writer opens it: a hot journal is rolled back first
            with closing(sqlite3.connect(f"{source.resolve().as_uri()}?mode=rw", uri=True)) as old, \
                    closing(sqlite3.connect(part)) as new:
                old.backup(new)
                checked = new.execute("PRAGMA integrity_check").fetchone()[0]
                version = new.execute("SELECT value FROM metadata WHERE key = 'schema_version'").fetchone()
        except sqlite3.Error as error:
            raise Unavailable(f"the identity store {source} could not be read ({error}); it was left in place") from None
        if checked != "ok" or version is None:
            raise Unavailable(f"the identity store {source} did not verify (integrity: {checked}; schema version: "
                              f"{version and version[0]}); it was left in place")
        os.chmod(part, 0o600)
        os.link(part, target)  # exclusive: never over a store that exists
    finally:
        part.unlink(missing_ok=True)
    kept = source.with_name(MOVED)
    kept = kept if not kept.exists() else source.with_name(f"identity.moved-{uuid.uuid4().hex[:8]}.sqlite3")
    try:
        source.rename(kept)
        (source.parent / "MOVED.json").write_text(json.dumps({"moved_to": str(target), "kept_as": kept.name}) + "\n",
                                                  encoding="utf-8")
    except OSError as error:  # the store is in place; the old file keeps its name
        return f"copied {source} to {target}; the old file could not be renamed ({error})"
    return f"moved {source} to {target}; the old file is kept as {kept.name}"
