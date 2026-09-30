"""Which open question holds a fact back from a subject's page (ADR 0044 A2, "Today": never silently hide a fact).

A page leaves a fact out while a question about it is open: the issuer of a share, a contested identifier, the parent
security of a device line, the share a receipt represents. Composing the page already loads the subject's open queue,
so `show` only names, for each such fact, the open question that holds it back; the Desk shows an inline "open data
conflict" line that links to that question in Settings → Repairs instead of a blank. Only facts absent from the page
are named: an answer the user gave applies at once and its question is no longer open.

Each entry: `fact`, the `question` (a queue item ID) and `options`, how many candidates it offers. A `fact` is an
identifier scheme (`isin`, `lei`, `cik`, ...) or one of `issuer`, `security`, `underlying` (the share a receipt
represents) and `kind` (whether it is a share or a receipt).
"""
from __future__ import annotations

from typing import Any, Iterator

from .build_questions import is_build
from .schemes import SCHEME_LEVEL, Level, subject_kind


def show(subject: dict[str, Any], queue: list[dict], sections: list[dict]) -> None:
    """Put the facts of a composed subject that an open question of core's holds back on its view, each with that
    question, and name the issuer's on each company section (profile, filings) that waits for the issuer."""
    ids, view = {value for value in subject["ids"].values() if value}, subject["view"]
    held: dict[str, dict[str, Any]] = {}
    for item in queue:  # a question core asks from evidence, about a subject on this page (not one it merely offers)
        if is_build(item) and item["subjects"] and item["subjects"][0] in ids:
            for fact in _facts(item, view):
                held.setdefault(fact, {"fact": fact, "question": item["id"], "options": len(item["candidates"])})
    view["withheld"] = [held[fact] for fact in sorted(held)]
    issuer = held.get("issuer")
    for section in sections:
        if issuer and section["status"] == "not_addressable" and section["via"] == Level.ISSUER:
            section["question"] = issuer["question"]


def _facts(item: dict, view: dict) -> Iterator[str]:
    kind, scheme = subject_kind(item["subjects"][0]), item["scheme"]
    if item["reason"] == "no_key":  # a receipt whose share the data does not hold
        yield "underlying"
    elif item["reason"] == "relation":  # a share FIRDS also says is a receipt
        yield "kind"
    elif item["reason"] == "identifier":
        level = SCHEME_LEVEL.get(scheme)
        if scheme and (level == kind or scheme in view.get("contested", ())):
            yield scheme  # the page shows the contested values, or none, where the identifier would be
        above = None if level == kind else level or (Level.ISSUER if kind != Level.ISSUER else None)
        if above is Level.ISSUER and not view["issuer"]:
            yield "issuer"
        elif above is Level.SECURITY and not view["security"]:
            yield "security"
