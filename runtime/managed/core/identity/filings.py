"""Core's filing item and the combined filings list (ADR 0040): one source per filing authority, merged by date.

Core's filing item: `id` (accession or report hash), `form`, `title`, `filed_at`
and `period_end` (ISO dates or null), `date` with its `date_basis`, `url`,
`authority`, and the source that listed it (`source`, `provider`, `plugin`).
`date` orders the list: the filing date where the source has one, else the day
the source indexed the report (`indexed`: filings.xbrl.org has no filing date),
else the period end. A source that fails is listed as skipped and the list is
marked partial; no other source fills in. Pure.
"""
from __future__ import annotations

from typing import Collection

from .concepts import AUTHORITY_BY_COUNTRY
from .page import source

# A source that answers "no such entity" lists nothing for it; that is an empty list, not a failed source.
NOTHING_LISTED = frozenset({"missing_observation"})
# Form names an investor or agent uses for a form a source lists under another name.
FORM_ALIASES = {"AFR": ("ESEF", "UKSEF"), "ANNUAL": ("10-K", "20-F", "40-F", "ESEF", "UKSEF")}


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


def filing_items(result: dict, answer: dict, authorities: Collection[str]) -> list[dict]:
    """A source's filings as core's filing items, only those of the authorities this source was chosen for.

    Core's filing item: `id` (accession or report hash), `form`, `title`, `filed_at` and `period_end` (dates or
    null), `url`, `authority`, and the source (`source`, `provider`, `plugin`)."""
    data = result.get("data") if isinstance(result.get("data"), dict) else {}
    declared = answer.get("authorities") or []
    items = []
    for row in data.get("filings", []) if isinstance(data.get("filings"), list) else []:
        if not isinstance(row, dict):
            continue
        country = str(row.get("country") or "").upper()
        authority = declared[0] if len(declared) == 1 else str(AUTHORITY_BY_COUNTRY.get(country, "esma"))
        if authority not in authorities:
            continue
        when, basis = dated(row)
        items.append({"id": row.get("accession") or row.get("report_id"), "form": row.get("form"),
                      "title": row.get("title"), "filed_at": row.get("filed_at"), "period_end": row.get("period_end"),
                      "date": when, "date_basis": basis, "url": row.get("url"), "authority": authority,
                      **source(answer)})
    return items


def merge_filings(parts: list[tuple[dict, Collection[str], dict | None, str | None]],
                  forms: Collection[str] = ()) -> dict:
    """One date-sorted list from each chosen source's result; a failed source is skipped and the list partial.

    Each part is (answer, authorities served, result or None, failure reason or None); `forms` keeps only those."""
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
        items.extend(item for item in filing_items(result, answer, authorities) if form_matches(item["form"], forms))
        if "incomplete" in codes:  # the source answered but could not search everything asked: keep its rows
            skipped.append({**source(answer), "code": "incomplete", "reason": next(
                issue.get("message") for issue in result["issues"] if isinstance(issue, dict)
                and issue.get("code") == "incomplete") or f"{answer['label']} answered incompletely"})
        sources.append({**source(answer), "authorities": list(authorities),
                        "url": ((result.get("data") or {}).get("source") or {}).get("url")})
    items.sort(key=lambda item: item["date"] or "", reverse=True)
    return {"filings": items, "sources": sources, "skipped": skipped, "partial": bool(skipped) and bool(sources)}
