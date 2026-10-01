"""A source's own errors, corrected by the plugin or builder adapter that reads that source (ADR 0044, amendment "a
source adapter corrects its own source").

One correction is `(field, original, reason)`. The corrected value is not repeated: it is the value the record or claim
already states in that field, so each fact is stated once with what the source said beside it. The authority stays
`source_asserted`: a corrected value is still the source's record as its adapter reads it, and the original stays
readable next to it. A plugin states a correction of its own source only, never another's.

A runtime plugin carries its corrections in a record's `attributes.source_corrections` (`claims.SourceCorrection`,
readable in the stored claim JSON) and applies them only while its source still states the original: core cannot see
the source, so the stale rule is the plugin's. The reference builder's adapters keep theirs in `source_corrections.json`
(its own `Table`, which counts stale entries), and the build writes them to the reference's `source_corrections`
table. `for_family` lists both for a subject's page.
"""
from __future__ import annotations

import json
import sqlite3
from typing import Any, Iterable, Mapping

from .claims import CORRECTABLE
from .evidence import PACKAGE


def for_family(ref: sqlite3.Connection | None, store, ids: Iterable[str]) -> list[dict[str, Any]]:
    """The corrections a source's adapter made to records about this family of subjects, each with what the source
    originally said: the reference build's (`source_corrections`, absent in a package built before it) and the
    plugins' (`attributes.source_corrections` of the stored claims)."""
    family = json.dumps([value for value in ids if value])
    found: list[dict[str, Any]] = []
    if ref is not None and ref.execute("SELECT 1 FROM sqlite_master WHERE name = 'source_corrections'").fetchone():
        found += [{"plugin": PACKAGE, **dict(zip(("subject_id", "source", "field", "original", "value", "reason"), row))}
                  for row in ref.execute("SELECT subject_id, source, field, original, value, reason FROM source_corrections"
                                         " WHERE subject_id IN (SELECT value FROM json_each(?)) ORDER BY 1, 3", (family,))]
    for row in store.select("SELECT plugin, provider, subject_id, claim FROM claims WHERE subject_id IN (SELECT value FROM"
                            " json_each(?)) AND json_array_length(json_extract(claim, '$.attributes.source_corrections')) > 0"
                            " ORDER BY subject_id, plugin, native_id", (family,)):
        claim = json.loads(row["claim"])
        for item in claim["attributes"]["source_corrections"]:
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
