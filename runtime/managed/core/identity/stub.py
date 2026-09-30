"""A saved instrument this Pythia cannot describe now (ADR 0037, amendment "search over reference and device").

With no reference package this Pythia reads (none installed, one removed, or one of another format), a saved reference
to a reference subject (a watchlist entry, a card, a link in a chat) opens as a stub: its own ID, the label and
identifiers the device's plugins state about it, and why there is no more. It is never another subject and never
unknown. Installing a package again brings its page back under the same ID.
"""
from __future__ import annotations

from typing import Any, Iterable

from . import device, evidence as weighing
from .schemes import subject_kind
from .store import IdentityStore
from .vocabulary import IdentifierRole

SHOWN = ("isin", "lei", "cik", "figi", "caip19")  # the identifiers a page's header shows


def view(store: IdentityStore, subject_id: str, plugins: Iterable, issue: str) -> dict[str, Any]:
    """The stub's page: named by the latest record a plugin placed on it, else by its ID, with `issue` as its line of
    context. Its identifiers are the values the device's `self` statements agree on; a contested one shows none."""
    active = device.enabled(plugins)
    named = store.select("SELECT name FROM claims WHERE subject_id = ? AND name IS NOT NULL AND state <> 'conflict'"
                         " ORDER BY last_seen DESC LIMIT 1", (subject_id,))
    values = weighing.weigh_each((device._assertion(row), row["plugin"] in active)
                                 for row in device.assertions(store, [subject_id])
                                 if row["role"] == IdentifierRole.SELF)["values"]
    return {"subject": {"id": subject_id, "level": subject_kind(subject_id), "name": named[0][0] if named else subject_id,
                        "kind": None, "listing": None, "description": issue},
            "identifiers": {scheme: values[scheme] for scheme in SHOWN if scheme in values},
            "listings": [], "related": [], "other_securities": [], "sections": [], "queue": [], "flags": []}
