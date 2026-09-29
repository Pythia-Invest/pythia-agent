"""Evidence counts by its kind and its contributor's trust level, never by its origin (ADR 0044 A1, A2, A4; ADR 0037,
amendment of 2026-09-30).

A reference package's rows count at the package's trust level (`trust.package_level`, carried by the connection
`store.open_reference` returns); a plugin's claims count at its plugin's (`installed()`, `Manifest.unaudited`). Only
confirm-level evidence proves or blocks an association (`resolution.decide`). Display-level evidence is shown with its
source and never proves, blocks or confirms. Where different confirm-level sources assert different values of a
single-valued scheme, the fact is contested: every value is kept, none is applied, and the user's answer decides it on
this device (`conflicts`). One source's several values (OpenFIGI's two German composite FIGIs) are not a contest.
"""
from __future__ import annotations

import sqlite3
from datetime import date
from typing import Any, Iterable

from .model import IdentifierAssertion
from .schemes import SINGLE_VALUED
from .trust import CONFIRM, DISPLAY


def level(ref: sqlite3.Connection) -> str:
    """The trust level of the reference `ref` reads: display unless its package is granted confirm."""
    return getattr(ref, "level", DISPLAY)


def disagree(assertions: Iterable[IdentifierAssertion]) -> bool:
    """Different sources assert different values. One source that asserts several contests nothing."""
    items = list(assertions)
    return len({item.value for item in items}) > 1 and len({(item.provenance.plugin, item.provenance.source)
                                                            for item in items}) > 1


def weigh(assertions: Iterable[IdentifierAssertion], granted: str, as_of: str | None = None) -> dict[str, Any]:
    """One contributor's assertions at the trust level `granted` to it, in the order they are stored.

    `evidence` holds the confirm-level ones (they prove and block), `shown` the display-level ones. `values` gives
    each scheme the value its current confirm-level assertions agree on, else the one its display-level ones agree
    on; where only one source asserts several, its first. `contested` maps a single-valued scheme whose current
    confirm-level sources disagree (`disagree`) to those assertions: it has no value. Display-level sources that
    disagree give none and contest nothing."""
    items = list(assertions)
    evidence, shown = (items, []) if granted == CONFIRM else ([], items)
    today = as_of or date.today().isoformat()
    values: dict[str, str] = {}
    contested: dict[str, list[IdentifierAssertion]] = {}
    for group in (evidence, shown):
        schemes: dict[str, list[IdentifierAssertion]] = {}
        for item in group:
            schemes.setdefault(str(item.scheme), []).append(item)
        for scheme, found in schemes.items():
            if scheme in values or scheme in contested:
                continue
            current = [item for item in found if item.validity.contains(today)]
            if scheme not in SINGLE_VALUED or not disagree(current):  # a ticker is an attribute: several never contest
                values[scheme] = (current or found)[0].value
            elif group is evidence:
                contested[scheme] = current
    return {"evidence": evidence, "shown": shown, "values": values, "contested": contested}


def show(subject: dict[str, Any]) -> None:
    """The view's identifier fields from the subject's values: a contested scheme shows none, and the view lists
    each contested scheme's values and display-level evidence with its source."""
    values, view = subject["values"], subject["view"]
    listing = subject["listing"]
    identifiers = {"isin": values.get("isin"), "lei": values.get("lei"), "cik": values.get("cik"),
                   "figi": values.get("figi"), "caip19": values.get("caip19"),
                   "ticker": listing["ticker"] if listing else None, "mic": listing["operating_mic"] if listing else None,
                   "currency": listing["trading_currency"] if listing else None}
    view["identifiers"] = {key: value for key, value in identifiers.items() if value}
    if view.get("issuer"):
        view["issuer"].update(lei=values.get("lei"), cik=values.get("cik"))
    if view.get("security"):
        view["security"]["isin"] = values.get("isin")
    view.pop("contested", None)
    view.pop("shown", None)
    if subject["contested"]:
        view["contested"] = {scheme: sorted({item.value for item in found})
                             for scheme, found in sorted(subject["contested"].items())}
    if subject["shown"]:
        view["shown"] = [{"scheme": str(item.scheme), "value": item.value, "source": item.provenance.source}
                         for item in subject["shown"]]
