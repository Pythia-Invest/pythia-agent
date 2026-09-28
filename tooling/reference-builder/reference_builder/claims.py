"""Typed claims and the per-build source record.

An adapter turns source records into `Claim`s and nothing else: it never picks a
winner, never reads another source, and records "no answer" (an empty element, a
placeholder) as the absence of a claim. A claim's meaning comes from core's
vocabulary (`SourceMeaning`), so each source field lands in the one meaning its
specification gives it.

Claims live in memory during the build. What persists is small: per source, a
`<source>-<date>.json` beside the snapshot with the drift fingerprint, the audit
report and whether the build was good. The next build compares its fingerprint
with the newest older good one; a build whose source broke (written with
`--no-gates`) never becomes that baseline.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import NamedTuple

from .schema import identity

Meaning = identity.SourceMeaning


class Claim(NamedTuple):
    subject_key: str  # a global identifier: isin:<ISIN>, or isin:<ISIN>@<segment MIC> for an admission
    value: str
    source: str
    source_field: str  # the element path in the source record
    meaning: Meaning
    as_of: str | None  # the source file's publication date
    record_digest: str | None  # of the source record's bytes


def record_path(out_dir: Path, source: str, stamp: str) -> Path:
    return out_dir / f"{source}-{stamp}.json"


def for_reference(reference: Path, source: str) -> Path:
    """The source record beside a `reference-<date>.sqlite3` snapshot."""
    return reference.with_name(f"{source}-{reference.stem.removeprefix('reference-')}.json")


def write(path: Path, record: dict) -> None:
    staging = path.with_name(f".{path.name}.part")
    staging.write_text(json.dumps(record) + "\n", encoding="utf-8")
    os.replace(staging, path)


def read(path: Path | None) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path else None
    except (OSError, ValueError):
        return None


def previous_good(path: Path) -> tuple[Path, dict] | None:
    """The newest older record of the same source whose build was good: the drift baseline."""
    source = path.name.rsplit("-", 1)[0]
    for older in sorted(path.parent.glob(f"{source}-*.json"), reverse=True):
        found = read(older) if older.name < path.name else None
        if found and found.get("good") and found.get("fingerprint", {}).get("records"):
            return older, found
    return None
