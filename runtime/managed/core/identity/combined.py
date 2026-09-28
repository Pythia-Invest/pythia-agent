"""Core's combined reads of concepts every eligible source serves (ADR 0040): lists and single values. Pure.

A list (news) merges every source's items into one feed, newest first, without
exact duplicates (the same link) or near-exact ones (the same headline within
`NEAR`); the item a higher-ranked source listed stays. Semantic duplicates stay,
and every item keeps its source. Core's news item is `{id, title, url,
published_at, publisher, language, source, provider, plugin}`: a source lists
its items under `data.news`, and `language` is the one the source states.

A single value (estimates, targets) is never blended or averaged: each source is
one labelled row `{value, date, basis, analysts, source, provider, plugin}` with
what the source's `data` states (`value` is its figures as it gives them).

Statements are side by side too, on the report identity of the filings v2
amendment: a source lists each report it read under `data.reports` (`kind`,
`period_end`, `authority`, `basis`, `value`), and each becomes one row with that
report's `report_key` and `report_period`. Rows of one period sit together,
newest first, so parallel reports (a 20-F beside the ESEF report) and two
sources' figures for one report stay separate rows.

A source that fails is listed as skipped and the result is marked partial; no
other source fills in.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit, urlunsplit

from .filings import report_period
from .page import source

NEAR = timedelta(hours=24)  # the same headline this close together is one story
WORDS = re.compile(r"\w+")


def answered(parts: list[tuple[dict, dict | None, str | None]]) -> tuple[list[tuple[dict, dict]], list[dict], list[dict]]:
    """(each answering source with its data, sources, skipped) from (answer, result or None, failure or None)."""
    ok, sources, skipped = [], [], []
    for answer, result, failure in parts:
        if failure is None and isinstance(result, dict) and result.get("outcome") != "error":
            ok.append((answer, result["data"] if isinstance(result.get("data"), dict) else {}))
            sources.append(source(answer))
            continue
        issue = next(iter((result or {}).get("issues") or []), {}) if isinstance(result, dict) else {}
        skipped.append({**source(answer), "code": "failed", "reason": failure or (
            issue.get("message") if isinstance(issue, dict) else None) or f"{answer['label']} could not be read"})
    return ok, sources, skipped


def _link(url: str) -> str:
    parts = urlsplit(url.strip())
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path.rstrip("/"), parts.query, ""))


def _instant(value: str) -> datetime | None:
    try:
        moment = datetime.fromisoformat(value)
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def merge_news(parts: list[tuple[dict, dict | None, str | None]]) -> dict:
    """One newest-first feed from the sources' news, in their ranked order, without exact or near-exact duplicates."""
    ok, sources, skipped = answered(parts)
    items, links, headlines = [], set(), {}
    for answer, data in ok:
        for row in data.get("news") if isinstance(data.get("news"), list) else []:
            if not (isinstance(row, dict) and all(isinstance(row.get(key), str) and row[key].strip()
                                                  for key in ("title", "url", "published_at"))):
                continue
            link, headline, at = _link(row["url"]), " ".join(WORDS.findall(row["title"].casefold())), \
                _instant(row["published_at"])
            seen = headlines.setdefault(headline, [])
            if link in links or (at and any(abs(at - other) <= NEAR for other in seen)):
                continue
            links.add(link)
            seen.extend([at] if at else [])
            items.append({"id": row.get("id"), "title": row["title"], "url": row["url"],
                          "published_at": row["published_at"], "publisher": row.get("publisher"),
                          "language": row.get("language"), **source(answer)})
    items.sort(key=lambda item: _instant(item["published_at"]) or datetime.min.replace(tzinfo=timezone.utc),
               reverse=True)
    return {"news": items, "sources": sources, "skipped": skipped, "partial": bool(skipped) and bool(sources)}


def side_by_side(parts: list[tuple[dict, dict | None, str | None]]) -> dict:
    """One labelled row per answering source, in ranked order, as each source states it; nothing is combined."""
    ok, sources, skipped = answered(parts)
    rows = [{"value": data["value"], **{key: data.get(key) for key in ("date", "basis", "analysts")}, **source(answer)}
            for answer, data in ok if data.get("value") is not None]
    return {"rows": rows, "sources": sources, "skipped": skipped, "partial": bool(skipped) and bool(sources)}


def statements(parts: list[tuple[dict, dict | None, str | None]], issuer: str) -> dict:
    """One row per source and report it read, keyed by the report's identity; nothing is combined."""
    ok, sources, skipped = answered(parts)
    rows = []
    for answer, data in ok:
        for report in data.get("reports") if isinstance(data.get("reports"), list) else []:
            period = isinstance(report, dict) and report.get("value") is not None and isinstance(
                report.get("authority"), str) and report_period(issuer, str(report.get("kind")), report.get("period_end"))
            if period:
                rows.append({"report_key": f"{period}|{report['authority']}", "report_period": period,
                             **{key: report.get(key) for key in ("kind", "period_end", "authority", "basis", "value")},
                             **source(answer)})
    rows.sort(key=lambda row: row["period_end"], reverse=True)  # stable: ranked source order within a period
    return {"rows": rows, "sources": sources, "skipped": skipped, "partial": bool(skipped) and bool(sources)}
