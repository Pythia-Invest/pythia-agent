"""Relation claims whose end no subject answers yet (ADR 0037, amendment "ingest"; ADR 0044 A1).

A plugin that only links (a lending market's reserves to the tokens other plugins introduce) may sync before those
plugins have. Its relation then has an end that names nothing, and the relation must not be lost: core keeps the claim
here, indexed by the end it waits for (`waits_for`), and places it when a later batch introduces or joins a subject
that end names. The result is the same whichever plugin syncs first. A claim that places, or that its plugin states
again and places, leaves this table; one still unplaced is replaced by the plugin's latest statement of it.
Standard library only.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Iterable, Mapping

from . import relations


def end_name(plugin: str, end: Mapping[str, Any]) -> str:
    """What a relation end waits for: a global identifier as `scheme:value`, a plugin's own record as its reference."""
    if "native_scope" in end:
        return f"ref:{plugin}:{end['native_scope']}:{end['native_id']}"
    return f"{end['scheme']}:{end['value']}"


def record_names(plugin: str, identifiers: Iterable[tuple[str, str]], native: Mapping[str, Any] | None) -> set[str]:
    """The ends a placed record answers: the identifiers it states and its own reference."""
    names = {f"{scheme}:{value}" for scheme, value in identifiers}
    return names | ({end_name(plugin, native)} if native else set())


def place(store, ref, joins, manifest, claim, raw: Mapping[str, Any]) -> tuple[str, bool]:
    """Keep a plugin's relation claim between the subjects its ends name (`relations.keep`), and drop it from the
    waiting; where an end names none (or several) it waits for that end. Returns the outcome (`unmatched` for a
    waiting claim) and whether a row changed."""
    start, end = (joins.end(claim.from_key, manifest), joins.end(claim.to_key, manifest))
    if start and end and start != end:
        drop(store, manifest.plugin, raw)
        return relations.keep(store, ref, manifest.plugin, claim, start, end)
    hold(store, manifest.plugin, raw, [end_name(manifest.plugin, raw[side]) for side, found in
                                       (("from_key", start), ("to_key", end)) if not found])
    return "unmatched", False


def hold(store, plugin: str, raw: Mapping[str, Any], waits_for: Iterable[str]) -> None:
    """Keep a relation claim, as its plugin emitted it, until an end in `waits_for` names a subject."""
    text, digest = json.dumps(raw, sort_keys=True, separators=(",", ":")), _digest(raw)
    store.db.executemany(
        "INSERT INTO pending_relations (plugin, relation, waits_for, claim) VALUES (?,?,?,?) ON CONFLICT (plugin, relation,"
        " waits_for) DO UPDATE SET claim = excluded.claim WHERE claim <> excluded.claim",
        [(plugin, digest, name, text) for name in waits_for])


def drop(store, plugin: str, raw: Mapping[str, Any]) -> None:
    """The relation placed (or its plugin's record of it no longer applies): nothing waits any more."""
    store.db.execute("DELETE FROM pending_relations WHERE plugin = ? AND relation = ?", (plugin, _digest(raw)))


def due(store, names: Iterable[str]) -> list[tuple[str, dict[str, Any]]]:
    """The pending claims, as (plugin, claim), waiting for any of `names`: one query on the index, never a scan."""
    rows = store.select("SELECT DISTINCT plugin, relation, claim FROM pending_relations WHERE waits_for IN (SELECT value"
                        " FROM json_each(?)) ORDER BY plugin, relation", (json.dumps(sorted(names)),))
    return [(plugin, json.loads(claim)) for plugin, _relation, claim in rows]


def _digest(raw: Mapping[str, Any]) -> str:
    """A relation's identity apart from when it was read: type, ends, validity start and source (as `relation_id`)."""
    identity = [raw["type"], raw["from_key"], raw["to_key"], (raw.get("validity") or {}).get("valid_from"),
                raw["provenance"]["source"]]
    return "sha256:" + hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
