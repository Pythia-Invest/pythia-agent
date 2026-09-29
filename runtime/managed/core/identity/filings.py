"""Core's filing item and the combined filings list (ADR 0040): one source per filing authority, merged by date.

Core's filing item: `id` (accession or report hash), `kind` (a `FilingKind`), `form`, `title`, `filed_at` and
`period_end` (ISO dates or null), `filed_time` (the exact UTC time of filing, where the source has it), `date` with
its `date_basis`, `event_codes` (8-K items), `basis` (the accounting basis where the source states it, else null),
`language`, `format`, `parties`, `url`, `authority`, `report_period`, `report_key`, and the source that listed it
(`source`, `provider`, `plugin`). `date` orders the list: the filing date where the source has one, else the day the
source indexed the report (`indexed`: filings.xbrl.org has no filing date), else the period end. A periodic report
is identified by `report_key` (issuer, kind, period end, authority): items sharing it are versions of one report.
Its `report_period` (issuer, kind, period end) is shared by its parallel reports under other authorities (ASML's
SEC 20-F and its ESEF report). Neither merges items. A source that fails is listed as skipped and the list is marked
partial; no other source fills in. Pure.
"""
from __future__ import annotations

from typing import Collection

from .concepts import AUTHORITY_BY_COUNTRY, REPORT_KINDS, FilingKind
from .page import source

# The accounting bases a source may state for a report; where it states none the basis is null (unstated).
BASES = frozenset({"us_gaap", "ifrs"})
# A source that answers "no such entity" lists nothing for it; that is an empty list, not a failed source.
NOTHING_LISTED = frozenset({"missing_observation"})
# Form names an investor or agent uses for a form a source lists under another name.
# ACS is the FCA NSM's headline code for an annual financial report.
FORM_ALIASES = {"AFR": ("ESEF", "UKSEF", "ACS"), "ANNUAL": ("10-K", "20-F", "40-F", "ESEF", "UKSEF", "ACS"),
                "13G": ("SC 13G", "SCHEDULE 13G")}  # SEC renamed Schedule 13G in 2024; both names occur


def form_matches(form: str | None, forms: Collection[str]) -> bool:
    """Whether a filing's form is one of the requested forms; an amendment (10-K/A) matches its form."""
    if not forms:
        return True
    form = (form or "").upper()
    wanted = {name for item in forms for name in (item.upper(), *FORM_ALIASES.get(item.upper(), ()))}
    return any(form == item or form.startswith(item + "/") for item in wanted)


def dated(row: dict) -> tuple[str | None, str | None]:
    """(date, basis) that orders a filing: filed, else indexed by the source, else its period end."""
    for key, basis in (("filed_at", "filed"), ("indexed_at", "indexed"), ("period_end", "period_end")):
        if isinstance(row.get(key), str) and row[key]:
            return row[key][:10], basis
    return None, None


def report_period(issuer: str, kind: str, period_end: str | None) -> str | None:
    """What a periodic report reports on: its issuer, kind and period end, shared by its parallel reports."""
    return "|".join((issuer, kind, period_end)) if kind in REPORT_KINDS and period_end else None


def malformed(row: dict) -> bool:
    """A row whose period end is not a date string: it is left out, and the list says so."""
    return row.get("period_end") is not None and not isinstance(row["period_end"], str)


def filing_items(result: dict, answer: dict, authorities: Collection[str], issuer: str = "") -> list[dict]:
    """A source's filings as core's filing items, only those of the authorities this source was chosen for.

    A source row gives `kind`, `accepted_at` (the filed time), `items` (8-K items), `basis` where it states it,
        `language`, `format` and `parties` besides the fields it always had. A source serving several authorities gives
    the `country` of the mechanism it collected the row from; a row of a mechanism it was not chosen for is left
    out (the source counts rows of mechanisms it does not declare as drift)."""
    data = result.get("data") if isinstance(result.get("data"), dict) else {}
    declared = answer.get("authorities") or []
    items = []
    for row in data.get("filings", []) if isinstance(data.get("filings"), list) else []:
        if not isinstance(row, dict) or malformed(row):
            continue
        country = str(row.get("country") or "").upper()
        authority = declared[0] if len(declared) == 1 else AUTHORITY_BY_COUNTRY.get(country)
        if authority not in authorities:
            continue
        when, date_basis = dated(row)
        kind = str(row["kind"]) if row.get("kind") in list(FilingKind) else FilingKind.OTHER.value
        period = report_period(issuer, kind, row.get("period_end"))
        items.append({"id": row.get("accession") or row.get("report_id"), "kind": kind, "form": row.get("form"),
                      "title": row.get("title"), "filed_at": row.get("filed_at"), "filed_time": row.get("accepted_at"),
                      "period_end": row.get("period_end"), "date": when, "date_basis": date_basis,
                      "event_codes": row.get("items") or [], "basis": row["basis"] if row.get("basis") in BASES else None,
                      "language": row.get("language"), "format": row.get("format"),
                      "parties": row.get("parties") or [], "url": row.get("url"), "authority": str(authority),
                      "report_period": period, "report_key": period and f"{period}|{authority}", **source(answer)})
    return items


def merge_filings(parts: list[tuple[dict, Collection[str], dict | None, str | None]],
                  forms: Collection[str] = (), kinds: Collection[str] = (), issuer: str = "") -> dict:
    """One date-sorted list of the issuer's filings from each chosen source's result; a failed source is skipped
    and the list partial.

    Each part is (answer, authorities served, result or None, failure reason or None); `forms` and `kinds` keep
    only those."""
    items, skipped, sources = [], [], []
    for answer, authorities, result, failure in parts:
        codes = {issue.get("code") for issue in (result or {}).get("issues") or [] if isinstance(issue, dict)} \
            if isinstance(result, dict) else set()
        if failure is None and isinstance(result, dict) and codes and codes <= NOTHING_LISTED:
            sources.append({**source(answer), "authorities": list(authorities), "url": None})  # an honest empty list
            continue
        if failure is not None or not isinstance(result, dict) or result.get("outcome") == "error":
            issue = next(iter((result or {}).get("issues") or []), {}) if isinstance(result, dict) else {}
            skipped.append({**source(answer), "code": "failed",
                            "reason": failure or issue.get("message") or f"{answer['label']} could not be read"})
            continue
        items.extend(item for item in filing_items(result, answer, authorities, issuer)
                     if form_matches(item["form"], forms) and (not kinds or item["kind"] in kinds))
        rows = (result.get("data") or {}).get("filings") if isinstance(result.get("data"), dict) else None
        bad = sum(1 for row in rows if isinstance(row, dict) and malformed(row)) if isinstance(rows, list) else 0
        if bad:
            skipped.append({**source(answer), "code": "invalid_rows",
                            "reason": f"{answer['label']} listed {bad} filing(s) with an unreadable period end; "
                                      "they are left out"})
        if "incomplete" in codes:  # the source answered but could not search everything asked: keep its rows
            skipped.append({**source(answer), "code": "incomplete", "reason": next(
                issue.get("message") for issue in result["issues"] if isinstance(issue, dict)
                and issue.get("code") == "incomplete") or f"{answer['label']} answered incompletely"})
        sources.append({**source(answer), "authorities": list(authorities),
                        "url": ((result.get("data") or {}).get("source") or {}).get("url")})
    items.sort(key=lambda item: item["date"] or "", reverse=True)
    return {"filings": items, "sources": sources, "skipped": skipped, "partial": bool(skipped) and bool(sources)}
