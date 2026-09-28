"""Core's curated market catalogue (rule `market_catalogue@1`, `market_catalogue.json`).

Index levels, continuous front-month futures, currency pairs and yields sit
outside the instrument hierarchy (ADR 0037 amendment), and no open identifier
names them, so each takes a Pythia key (`index:pythia:sp500`). Like the native
coin table, the catalogue gives each provider's symbol for a subject: a curated
address, never identifier evidence. Core reads it from its own package, so it
needs no reference build. Pure standard library.
"""
from __future__ import annotations

import json
from functools import cache
from pathlib import Path
from typing import Any

from .model import ProviderRef
from .schemes import registered_kind
from .vocabulary import SECURITY_CLASSES, AssetClass

RULE = "market_catalogue@1"
FILE = Path(__file__).with_name("market_catalogue.json")
# Provider -> the native scope its symbols are addressed in.
SCOPES = {"yahoo": "symbol", "eodhd": "catalogue"}
FIELDS = {"id", "name", "description", "asset_class", *SCOPES}


@cache
def entries() -> dict[str, dict[str, Any]]:
    """The catalogue by subject ID; raises ValueError for a malformed file."""
    document = json.loads(FILE.read_text(encoding="utf-8"))
    if document.get("rule_id") != RULE:
        raise ValueError("market catalogue: unexpected rule")
    found: dict[str, dict[str, Any]] = {}
    for item in document["subjects"]:
        if not isinstance(item, dict) or set(item) - FIELDS or not {"id", "name", "asset_class"} <= set(item):
            raise ValueError(f"market catalogue: malformed entry {item!r}")
        if item["id"].split(":", 2)[1] != "pythia" or item["id"] in found:
            raise ValueError(f"market catalogue: {item['id']} needs a unique Pythia key")
        registered_kind(item["id"])
        if AssetClass(item["asset_class"]) in SECURITY_CLASSES:
            raise ValueError(f"market catalogue: {item['id']} is an instrument, not a market subject")
        found[item["id"]] = item
    return found


def load(subject_id: str) -> dict[str, Any] | None:
    """A catalogue subject in the shape page composition reads, or None if the catalogue does not hold it.

    It has no instrument levels (`ids` is empty); `bindings` holds its curated provider references."""
    item = entries().get(subject_id)
    if item is None:
        return None
    kind = subject_id.split(":", 1)[0]
    bindings = {provider: ProviderRef(provider, item[provider], scope) for provider, scope in SCOPES.items()
                if item.get(provider)}
    return {
        "id": subject_id, "level": kind, "ids": {}, "values": {}, "evidence": [], "asset_class": item["asset_class"],
        "kind": None, "listing": None, "bindings": bindings,
        "view": {"subject": {"id": subject_id, "level": kind, "name": item["name"], "kind": None, "listing": None,
                             "description": item.get("description")},
                 "identifiers": {}, "issuer": None, "security": None, "listings": [], "related": []},
    }
