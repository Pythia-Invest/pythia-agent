"""The builder's source corrections: one entry per fix of a source's own error, read from `source_corrections.json`.

An entry names the source, the record's key in the adapter's terms (`isin:<ISIN>`), the source's own field (`Issr`), the
`original` the source states, the `value` to use instead (`null` retracts the statement) and a `reason`. It applies only
while the source still states `original`; once the source fixes it, the raw value passes through and the entry is
counted stale, the signal to retire it (docs/architecture/plugins.md, "Correcting your own source").
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from typing import Any, NamedTuple

from .schema import identity

APPLIED, STALE = "applied", "stale"


class Entry(NamedTuple):
    source: str
    key: str
    field: str
    original: str
    value: str | None
    reason: str


class Table:
    """A build's entries, and what happened to each as the adapters read their sources."""

    def __init__(self, entries: Iterable[Mapping[str, Any]] = ()):
        self.entries: dict[tuple[str, str, str], Entry] = {}
        for raw in entries:
            entry = Entry(**raw)
            identity.SourceCorrection(entry.field, entry.original, entry.reason)  # core's length and presence rules
            where = (entry.source, entry.key, entry.field)
            if not (entry.value is None or (isinstance(entry.value, str) and entry.value)) or entry.value == entry.original \
                    or not entry.source or not entry.key or where in self.entries:
                raise ValueError(f"source correction {where}: a value that differs from the original (or null), "
                                 "and one entry per source record field")
            self.entries[where] = entry
        self.seen: dict[tuple[str, str, str], str] = {}

    @classmethod
    def read(cls, text: str) -> Table:
        return cls(json.loads(text)["entries"])

    def apply(self, source: str, key: str, field: str, stated: str | None) -> tuple[str | None, tuple[str, str] | None]:
        """The value to use for what `source` states in `field` of `key`, and its (original, reason) when corrected (a
        retraction gives no value). A source that no longer states the original passes through: the entry is stale."""
        entry = self.entries.get((source, key, field)) if self.entries else None
        if entry is None or stated is None:
            return stated, None
        if stated != entry.original:
            self.seen.setdefault((source, key, field), STALE)
            return stated, None
        self.seen[(source, key, field)] = APPLIED
        return entry.value, (entry.original, entry.reason)

    def report(self) -> dict[str, Any]:
        """Entries, applied, stale (the source now states another value) and absent (the record was not read); `retire`
        names the stale and absent ones for a maintainer to retire."""
        stale = [key for key, state in self.seen.items() if state == STALE]
        absent = set(self.entries) - set(self.seen)
        return {"entries": len(self.entries), "applied": sum(state == APPLIED for state in self.seen.values()),
                "stale": len(stale), "absent": len(absent), "retire": sorted(" ".join(key) for key in (*stale, *absent))}
