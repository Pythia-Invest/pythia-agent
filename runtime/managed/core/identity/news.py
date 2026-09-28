"""Core's combined news feed (ADR 0040): every eligible source's items in one list. Pure.

The feed merges every source's items newest first. An item another source
already listed is dropped: the same link, or the same headline published less
than `NEAR` apart; the item of the higher-ranked source stays. One source's own
items are never dropped, so a recurring daily headline and two announcements
under one title both stay. Semantic duplicates stay, and every item keeps its
source. Core's news item is `{id, title, url, published_at, publisher, language,
source, provider, plugin}`: a source lists its items under `data.news`, and
`language` is the one the source states.

A source that fails is listed as skipped and the feed is marked partial; no
other source fills in.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit, urlunsplit

from .page import source

NEAR = timedelta(hours=24)  # the same headline from two sources less than this apart is one story
WORDS = re.compile(r"\w+")


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
    """One newest-first feed from (answer, result or None, failure or None) in ranked order, without the items a
    higher-ranked source already listed."""
    items, sources, skipped = [], [], []
    links: dict[str, str] = {}                              # link -> the plugin that listed it
    headlines: dict[str, list[tuple[str, datetime]]] = {}   # headline -> (plugin, published) of kept items
    for answer, result, failure in parts:
        if failure is not None or not isinstance(result, dict) or result.get("outcome") == "error":
            issue = next(iter((result or {}).get("issues") or []), {}) if isinstance(result, dict) else {}
            skipped.append({**source(answer), "code": "failed", "reason": failure or (
                issue.get("message") if isinstance(issue, dict) else None) or f"{answer['label']} could not be read"})
            continue
        sources.append(source(answer))
        plugin, data = answer["plugin"], result.get("data") if isinstance(result.get("data"), dict) else {}
        for row in data.get("news") if isinstance(data.get("news"), list) else []:
            if not (isinstance(row, dict) and all(isinstance(row.get(key), str) and row[key].strip()
                                                  for key in ("title", "url", "published_at"))):
                continue
            link, at = _link(row["url"]), _instant(row["published_at"])
            headline = " ".join(WORDS.findall(row["title"].casefold()))
            if links.get(link, plugin) != plugin or (headline and at and any(
                    other != plugin and abs(at - when) < NEAR for other, when in headlines.get(headline, ()))):
                continue
            links.setdefault(link, plugin)
            if headline and at:
                headlines.setdefault(headline, []).append((plugin, at))
            items.append({"id": row.get("id"), "title": row["title"], "url": row["url"],
                          "published_at": row["published_at"], "publisher": row.get("publisher"),
                          "language": row.get("language"), **source(answer)})
    items.sort(key=lambda item: _instant(item["published_at"]) or datetime.min.replace(tzinfo=timezone.utc),
               reverse=True)
    return {"news": items, "sources": sources, "skipped": skipped, "partial": bool(skipped) and bool(sources)}
