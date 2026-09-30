"""Evidence counts by its kind, never by its origin or a level (ADR 0044 A1, A2 and its amendment of 2026-09-30:
installing a plugin means trusting it; ADR 0037, amendment of 2026-09-30).

The reference package and every enabled plugin are equal contributors. Their statements prove or block an association
(`resolution.decide`). What a plugin that is disabled or removed stated stays on the device, shown with its source: it
keeps its subjects' labels and identifiers, and never proves, blocks or contests while the plugin is off. Where
different sources assert different values of a single-valued scheme, the fact is contested: every value is kept, none
is applied, and the user's answer decides it on this device (`conflicts`). One source's several values (OpenFIGI's
two German composite FIGIs) are not a contest.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Iterable

from .model import IdentifierAssertion
from .schemes import SINGLE_VALUED
from .vocabulary import Authority

PACKAGE = "reference"  # the reference package as a contributor: its evidence's plugin, and its questions' tag


def disagree(assertions: Iterable[IdentifierAssertion]) -> bool:
    """Different sources assert different values. One source that asserts several contests nothing."""
    items = list(assertions)
    return len({item.value for item in items}) > 1 and len({(item.provenance.plugin, item.provenance.source)
                                                            for item in items}) > 1


def weigh(assertions: Iterable[IdentifierAssertion], as_of: str | None = None) -> dict[str, Any]:
    """Assertions that all count (a reference package's; see `weigh_each`)."""
    return weigh_each(((item, True) for item in assertions), as_of)


def weigh_each(assertions: Iterable[tuple[IdentifierAssertion, bool]], as_of: str | None = None) -> dict[str, Any]:
    """Assertions, each with whether its contributor counts now (the package and the enabled plugins; a disabled or
    removed plugin's do not), in the order they are stored.

    `evidence` holds the ones that count (they prove and block), `shown` the others. `values` gives each scheme the
    value its current counting assertions agree on, else the one the shown ones agree on; where only one source asserts
    several, its first. `contested` maps a single-valued scheme whose current counting sources disagree (`disagree`)
    to those assertions: it has no value. Shown sources that disagree give none and contest nothing."""
    items = list(assertions)
    evidence = [item for item, counts in items if counts]
    shown = [item for item, counts in items if not counts]
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
    each contested scheme's values with their sources (labelled as the page names sources) and what a disabled plugin
    stated, with its source. `provenance` names where each identifier shown comes from: the first assertion stating it, or the
    user where their answer decided a contested value (`build_questions`). Its contributor is the plugin that stated
    it on the device (`contributed`, by evidence ID), else the reference package."""
    from .page import LABELS  # page composition reads subjects: imported when used
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
    stated = [*subject["evidence"], *subject["shown"]]
    view["provenance"] = {}
    for scheme, value in view["identifiers"].items():
        item = next((item for item in stated if item.scheme == scheme and item.value == value), None)
        if item is not None:
            view["provenance"][scheme] = {
                "source": item.provenance.source,
                "plugin": subject.get("contributed", {}).get(item.evidence_id, PACKAGE),
                "authority": str(Authority.USER_ATTESTED if scheme in subject.get("attested", ()) else item.authority)}
    view.pop("contested", None)
    view.pop("shown", None)
    def stating(found: list[IdentifierAssertion], value: str) -> list[str]:
        return sorted({LABELS.get(item.provenance.source, item.provenance.source)
                       for item in found if item.value == value})

    if subject["contested"]:
        view["contested"] = {scheme: [{"value": value, "sources": stating(found, value)}
                                      for value in sorted({item.value for item in found})]
                             for scheme, found in sorted(subject["contested"].items())}
    if subject["shown"]:
        view["shown"] = [{"scheme": str(item.scheme), "value": item.value, "source": item.provenance.source}
                         for item in subject["shown"]]
