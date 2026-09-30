"""A source's own errors, corrected by the plugin or builder adapter that reads that source (ADR 0044, amendment
"plugins fix their own source's data").

One correction is `(field, original, reason)`. The corrected value is not repeated: it is the value the record or claim
already states in that field, so each fact is stated once with what the source said beside it. A correction applies only
while the source still states `original`. When the source fixes its error the raw value passes through and the
correction is counted as stale, the signal to retire it. The authority stays `source_asserted`: a corrected value is
still the source's record as its adapter reads it, and the original stays readable next to it.

A plugin states a correction of its own source only, never another's. A runtime plugin carries its corrections in a
record's `attributes.corrections` (`claims.SourceCorrection`, readable in the stored claim JSON). The reference
builder's adapters read `source_corrections.json` with `Table`, and the build writes the applied ones to the
reference's `source_corrections` table. `for_family` lists both for a subject's page.
"""
from __future__ import annotations

import json
import sqlite3
from typing import Any, Iterable, Mapping, NamedTuple

from .claims import CORRECTABLE, REASON_LENGTH
from .evidence import PACKAGE

APPLIED, STALE = "applied", "stale"


class Entry(NamedTuple):
    source: str    # the adapter's source, as in assertions.source (`esma_firds`)
    key: str       # the record the source states it on, in the adapter's own key (`isin:US2062772049`)
    field: str     # the source's own field, as its adapter reads it (`Issr`)
    original: str  # what the source states, raw
    value: str | None  # what the record states instead; None retracts the statement (the record should state nothing)
    reason: str    # what is wrong and the evidence


class Table:
    """A build's corrections, and what happened to each as the adapters read the source."""

    def __init__(self, entries: Iterable[Mapping[str, Any]] = ()):
        self.entries: dict[tuple[str, str, str], Entry] = {}
        for raw in entries:
            entry = Entry(**raw)
            if not all(isinstance(text, str) and text for text in (*entry[:4], entry.reason)) \
                    or not (entry.value is None or (isinstance(entry.value, str) and entry.value)) \
                    or len(entry.reason) > REASON_LENGTH or entry.original == entry.value or (entry.source, entry.key, entry.field) in self.entries:
                raise ValueError(f"source correction {entry.source} {entry.key} {entry.field}: every part is required, "
                                 f"the reason is at most {REASON_LENGTH} characters, the value differs from the original "
                                 "and each record field has one correction")
            self.entries[(entry.source, entry.key, entry.field)] = entry
        self.seen: dict[tuple[str, str, str], str] = {}

    @classmethod
    def read(cls, text: str) -> "Table":
        return cls(json.loads(text)["entries"])

    def apply(self, source: str, key: str, field: str, stated: str | None) -> tuple[str | None, tuple[str, str] | None]:
        """The value to use for what `source` states in `field` of `key`, and its (original, reason) when corrected (a
        retraction gives no value). A source that no longer states the original passes through: the entry is stale
        (`report`)."""
        entry = self.entries.get((source, key, field)) if self.entries else None
        if entry is None or stated is None:
            return stated, None
        if stated != entry.original:
            self.seen.setdefault((source, key, field), STALE)
            return stated, None
        self.seen[(source, key, field)] = APPLIED
        return entry.value, (entry.original, entry.reason)

    def report(self) -> dict[str, Any]:
        """Counts for the build report: entries, applied, stale (the source now states another value) and absent (the
        record was not read). `retire` names the stale and absent ones: a maintainer retires them."""
        stale = [key for key, state in self.seen.items() if state == STALE]
        absent = set(self.entries) - set(self.seen)
        return {"entries": len(self.entries), "applied": sum(state == APPLIED for state in self.seen.values()),
                "stale": len(stale), "absent": len(absent), "retire": sorted(" ".join(key) for key in (*stale, *absent))}


def for_family(ref: sqlite3.Connection | None, store, ids: Iterable[str]) -> list[dict[str, Any]]:
    """The corrections a source's adapter made to records about this family of subjects, each with what the source
    originally said: the reference build's (`source_corrections`, absent in a package built before it) and the
    plugins' (`attributes.corrections` of the stored claims)."""
    family = json.dumps([value for value in ids if value])
    found: list[dict[str, Any]] = []
    if ref is not None and ref.execute("SELECT 1 FROM sqlite_master WHERE name = 'source_corrections'").fetchone():
        found += [{"plugin": PACKAGE, **dict(zip(("subject_id", "source", "field", "original", "value", "reason"), row))}
                  for row in ref.execute("SELECT subject_id, source, field, original, value, reason FROM source_corrections"
                                         " WHERE subject_id IN (SELECT value FROM json_each(?)) ORDER BY 1, 3", (family,))]
    for row in store.select("SELECT plugin, provider, subject_id, claim FROM claims WHERE subject_id IN (SELECT value FROM"
                            " json_each(?)) AND json_array_length(json_extract(claim, '$.attributes.corrections')) > 0"
                            " ORDER BY subject_id, plugin, native_id", (family,)):
        claim = json.loads(row["claim"])
        for item in claim["attributes"]["corrections"]:
            found.append({"plugin": row["plugin"], "subject_id": row["subject_id"], "source": row["provider"],
                          "field": item["field"], "original": item["original"], "reason": item["reason"],
                          "value": _stated(claim, item["field"])})
    return found


def _stated(claim: Mapping[str, Any], field: str) -> str | None:
    """The value a stored record states in `field` (an attribute, else its `self` identifier)."""
    if field in CORRECTABLE:
        return claim["attributes"].get(field)
    return next((item["value"] for item in claim["identifiers"]
                 if item["scheme"] == field and item.get("role", "self") == "self"), None)
