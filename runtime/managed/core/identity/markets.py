"""Curated market subjects (rule `native_markets@1`, ADR 0043): `markets.json`.

A venue market (a perp, a continuous front-month future), an index level, a
currency pair or a rate series is its own subject with a Pythia-curated key; no
open identifier names it. The table is Pythia's maintained list of these
subjects: it names a market's underlying (`derivative_on`, a related subject,
never folded) where one exists, and `group` and `description` are display text
for the markets overview. It names no provider: each plugin that serves a
subject declares its own reference for it in its contract (`addressing.subjects`,
`declared.py`). Standard library only; the file is read on first use.
"""
from __future__ import annotations

import json
from functools import cache
from pathlib import Path
from typing import Any, Mapping

from .schemes import Kind, registered_kind, subject_kind

MARKETS_RULE = "native_markets@1"
CURATED_KINDS = frozenset({Kind.MARKET, Kind.INDEX, Kind.FX, Kind.SERIES})


@cache
def curated() -> dict[str, Mapping[str, Any]]:
    """The shipped table, read once per process."""
    return parse(json.loads((Path(__file__).parent / "markets.json").read_text(encoding="utf-8")))


def parse(document: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    """The curated market table by subject ID; raises ValueError on a malformed entry."""
    if document.get("rule_id") != MARKETS_RULE:
        raise ValueError("markets: unknown rule")
    table = {}
    for entry in document["markets"]:
        underlying = entry.get("derivative_on")
        if registered_kind(entry["id"]) not in CURATED_KINDS or entry["id"].split(":", 2)[1] != "pythia" or (
                underlying is not None and subject_kind(underlying["id"]) not in set(Kind)) or (
                underlying is not None and registered_kind(entry["id"]) is not Kind.MARKET) or entry["id"] in table:
            raise ValueError(f"markets: {entry['id']} is malformed")
        table[entry["id"]] = entry
    return table


def load_market(table: Mapping[str, Mapping[str, Any]], subject_id: str) -> dict[str, Any] | None:
    """A curated market, shaped like `load_subject`'s answer so sections compose alike, or None if unknown."""
    entry = table.get(subject_id)
    if entry is None:
        return None
    kind, underlying = Kind(subject_kind(subject_id)), entry.get("derivative_on")
    return {
        "id": subject_id, "level": kind, "ids": {kind: subject_id}, "values": {}, "evidence": [],
        "asset_class": entry.get("asset_class"), "kind": None, "listing": None,
        "view": {"subject": {"id": subject_id, "level": str(kind), "name": entry["name"], "kind": None,
                             "description": entry.get("description")},
                 "identifiers": {}, "issuer": None, "security": None, "listings": [],
                 "related": [{"id": underlying["id"], "type": "derivative_on", "direction": "to",
                              "kind": subject_kind(underlying["id"]), "name": underlying["name"]}] if underlying else []},
    }


def markets_on(table: Mapping[str, Mapping[str, Any]], subject_ids: list[str]) -> list[dict[str, Any]]:
    """Curated markets that are derivatives on these subjects, as `related` rows of the underlying's page."""
    return [{"id": entry["id"], "type": "derivative_on", "direction": "from", "kind": str(Kind.MARKET),
             "name": entry["name"]} for entry in table.values()
            if entry.get("derivative_on") and entry["derivative_on"]["id"] in subject_ids]
