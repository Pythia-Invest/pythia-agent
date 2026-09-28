"""Core's filing item and the combined filings list (ADR 0040): one source per filing authority, merged by date.

Core's filing item: `id` (accession or report hash), `form`, `title`, `filed_at`
and `period_end` (ISO dates or null), `url`, `authority`, and the source that
listed it (`source`, `provider`, `plugin`). A source that fails is listed as
skipped and the list is marked partial; no other source fills in. Pure.
"""
from __future__ import annotations

from typing import Collection

from .concepts import AUTHORITY_BY_COUNTRY
from .page import source


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
        items.append({"id": row.get("accession") or row.get("report_id"), "form": row.get("form"),
                      "title": row.get("title"), "filed_at": row.get("filed_at"), "period_end": row.get("period_end"),
                      "url": row.get("url"), "authority": authority, **source(answer)})
    return items


def merge_filings(parts: list[tuple[dict, Collection[str], dict | None, str | None]]) -> dict:
    """One date-sorted list from each chosen source's result; a failed source is skipped and the list partial.

    Each part is (answer, authorities served, result or None, failure reason or None)."""
    items, skipped, sources = [], [], []
    for answer, authorities, result, failure in parts:
        if failure is not None or not isinstance(result, dict) or result.get("outcome") == "error":
            issue = next(iter((result or {}).get("issues") or []), {}) if isinstance(result, dict) else {}
            skipped.append({**source(answer), "code": "failed",
                            "reason": failure or issue.get("message") or f"{answer['label']} could not be read"})
            continue
        items.extend(filing_items(result, answer, authorities))
        sources.append({**source(answer), "authorities": list(authorities),
                        "url": ((result.get("data") or {}).get("source") or {}).get("url")})
    items.sort(key=lambda item: (item["filed_at"] or item["period_end"] or ""), reverse=True)
    return {"filings": items, "sources": sources, "skipped": skipped, "partial": bool(skipped) and bool(sources)}
