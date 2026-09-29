"""Core's document reader, the filings concept's `read` (ADR 0040, the document reader amendment).

A document is addressed by report identity (`report_key`) and its version (the filing `id`); a filing that is no
periodic report has only an `id`. Core finds it in its combined filings list; the source that listed it opens it
and hands the response to `document_text.extract` (`platform.read_document`). Core keeps the extracted text in a
disposable disk cache and answers with the outline, a bounded part of a section or search passages, every part
cited: the document, its section and offsets, and the document URL at the section's anchor where it has one.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import sqlite3
import threading
from collections import OrderedDict
from pathlib import Path
from typing import Any, Callable

from .document_text import MAX_BYTES, MAX_TEXT, search
from .identity import page
from .identity.concepts import Concept
from .identity.page import Section
from .queue_ops import SUBJECT_ID

logger = logging.getLogger(__name__)
EXTRACTOR = 2              # the extraction's version: a cached document of another version is read again
CACHE_BYTES = 256_000_000  # the disk cache; the least recently read documents go first
SECTION_CHARS, MAX_SECTION_CHARS = 12_000, 30_000  # text returned per section read
TOO_LARGE = (f"The document is larger than Pythia reads ({MAX_BYTES // 1_000_000} MB, {MAX_TEXT:,} characters of "
             "text); open its url instead.")
READ_TOOL = "pythia_filings_read"
LIST_TOOL = "pythia_filings_combined"

# What names a document and what to read in it; core's operation and the agent's pythia_document share them.
PROPERTIES = {
    "report_key": {"type": "string", "minLength": 5, "maxLength": 512},
    "id": {"type": "string", "minLength": 1, "maxLength": 128},
    "section": {"type": "string", "pattern": "^s[0-9]{1,5}$"},
    "start": {"type": "integer", "minimum": 0},
    "query": {"type": "string", "minLength": 2, "maxLength": 200},
    "max_chars": {"type": "integer", "minimum": 1000, "maximum": MAX_SECTION_CHARS},
    "limit": {"type": "integer", "minimum": 1, "maximum": 10},
}
SCHEMA = {
    "name": READ_TOOL,
    "description": "Read one filing's document: with neither section nor query its outline (sections with ids and "
                   "sizes); with section that section's text, bounded, with continue_from for the rest; with query "
                   "the best-matching passages. Every section and passage carries a citation (document, section, "
                   "offsets and a link to the place). Address a periodic report by report_key and, when it has "
                   "several versions, the version's id; any other filing by id.",
    "parameters": {"type": "object", "properties": {"subject_id": SUBJECT_ID, **PROPERTIES},
                   "required": ["subject_id"], "additionalProperties": False},
}


# ---- filings the lists served ------------------------------------------------------------------------------------

LISTED_KEPT = 5_000  # filings remembered from list reads, the oldest forgotten first
_listed: OrderedDict[tuple[str, str], dict] = OrderedDict()
_listed_lock = threading.Lock()


def remember(issuer: str, rows: list) -> None:
    """Filings a combined list read served, with whatever forms, kinds or source it was asked for, so each is readable
    by its id or report_key afterwards: an older 8-K, a Form 4, another source's row. Process memory only; after a
    restart the reader looks in the default list, and a filing it misses is listed again first."""
    with _listed_lock:
        for row in rows:
            if isinstance(row, dict) and row.get("id"):
                _listed[(issuer, str(row["id"]))] = row
                _listed.move_to_end((issuer, str(row["id"])))
        while len(_listed) > LISTED_KEPT:
            _listed.popitem(last=False)


def _matching(rows: Any, report_key: str | None, document_id: str | None) -> list[dict]:
    return [row for row in rows if isinstance(row, dict) and (not report_key or row.get("report_key") == report_key)
            and (not document_id or row.get("id") == document_id)]


# ---- the disposable cache ----------------------------------------------------------------------------------------

class Cache:
    """Extracted documents on disk, one JSON file per filing id; losing a file only means reading it again."""

    def __init__(self, directory: Path, limit: int = CACHE_BYTES):
        self.directory, self.limit = Path(directory), limit

    def path(self, document_id: str) -> Path:
        return self.directory / (hashlib.sha256(f"{EXTRACTOR}|{document_id}".encode()).hexdigest()[:32] + ".json")

    def get(self, document_id: str) -> dict | None:
        path = self.path(document_id)
        try:
            document = json.loads(path.read_text("utf-8"))
            os.utime(path)  # recently read documents are kept longest
        except (OSError, ValueError):
            return None
        return document if isinstance(document, dict) and document.get("id") == document_id else None

    def put(self, document: dict) -> None:
        try:
            self.directory.mkdir(parents=True, exist_ok=True)
            path = self.path(document["id"])
            partial = path.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")  # one per concurrent read
            partial.write_text(json.dumps(document, ensure_ascii=False, separators=(",", ":")), "utf-8")
            os.replace(partial, path)
            files = sorted(self.directory.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True)
            total = 0
            for item in files:
                total += item.stat().st_size
                if total > self.limit and item != path:
                    item.unlink(missing_ok=True)
        except OSError:
            logger.warning("the document cache could not be written", exc_info=True)


# ---- the read ----------------------------------------------------------------------------------------------------

def _envelope(outcome: str, data: Any, code: str | None = None, message: str | None = None) -> str:
    body: dict[str, Any] = {"schema_version": 1, "outcome": outcome, "data": data}
    if code:
        body["issues"] = [{"code": code, "severity": "error" if outcome == "error" else "warning", "message": message}]
    return json.dumps(body, ensure_ascii=False, separators=(",", ":"))


def _dispatch(tool: str, arguments: dict, cancelled: Callable[[], bool]) -> dict | None:
    from tools.registry import registry
    try:
        raw = registry.dispatch(tool, arguments, cancelled=cancelled)
        result = json.loads(raw) if isinstance(raw, str) else None
    except Exception:  # a failing source is an error answer, never an exception
        logger.warning("document read failed for %s", tool, exc_info=True)
        return None
    return result if isinstance(result, dict) else None


class Reader:
    def __init__(self, identity: Any):
        self.identity = identity

    @property
    def cache(self) -> Cache:
        return Cache(Path(self.identity.data_dir) / "documents")

    def read(self, arguments: dict, **context: Any) -> str:
        subject_id = str(arguments.get("subject_id") or "")
        report_key, document_id = arguments.get("report_key"), arguments.get("id")
        if not report_key and not document_id:
            return _envelope("error", None, "invalid_request", "Name the document by report_key, id or both.")
        try:
            _path, subject, lookups, issue = self.identity._load(subject_id)
        except ValueError:
            return _envelope("error", None, "unknown_subject", "Unknown subject.")
        except (sqlite3.Error, OSError):
            logger.warning("identity unavailable for a document read", exc_info=True)
            return _envelope("error", None, "unavailable", "The reference data could not be read.")
        if subject is None:
            return _envelope("error", None, "unknown_subject", issue or "Unknown subject.")
        issuer = subject["ids"].get("issuer") or subject["id"]
        document = self.cache.get(document_id) if document_id else None
        if document is not None and (document.get("issuer") != issuer
                                     or (report_key and document.get("report_key") != report_key)):
            document = None
        if document is None:
            document, failure = self._fetch(subject, lookups, issuer, report_key, document_id,
                                            context.get("cancelled") or (lambda: False))
            if failure is not None:
                return failure
        return self._answer(document, arguments)

    def _fetch(self, subject: dict, lookups: dict, issuer: str, report_key: str | None, document_id: str | None,
               cancelled: Callable[[], bool]) -> tuple[dict | None, str | None]:
        """Find the filing in core's combined list, have its source read the document, extract and cache it."""
        from . import identity_ops
        with _listed_lock:
            matches = _matching([row for (owner, _id), row in _listed.items() if owner == issuer], report_key,
                                document_id)
        if not matches:  # not listed in this process yet: look in the default list
            kind = report_key.split("|")[1] if report_key and report_key.count("|") == 3 else None
            listed = _dispatch(LIST_TOOL, {"subject_id": subject["id"], **({"kinds": [kind]} if kind else {})},
                               cancelled)
            matches = _matching(((listed or {}).get("data") or {}).get("filings") or [], report_key, document_id)
            if not matches:
                reason = "; ".join(item.get("reason", "") for item in
                                   ((listed or {}).get("data") or {}).get("skipped", []))
                return None, _envelope("error", None, "not_listed",
                                       "No listed filing matches this report_key and id; list the filings again and "
                                       "pass a listed report_key or id." + (f" Skipped sources: {reason}." if reason
                                                                           else ""))
        if len(matches) > 1:
            versions = [{key: row.get(key) for key in ("id", "form", "title", "language", "format", "filed_at", "url")}
                        for row in matches]
            return None, _envelope("error", {"versions": versions}, "several_versions",
                                   "This report has several versions; pass the id of the one to read.")
        filing = matches[0]
        cached = self.cache.get(str(filing["id"]))
        if cached is not None and cached.get("issuer") == issuer:
            return cached, None
        plugins = {info.key: info for info in identity_ops.installed()}
        info = plugins.get(str(filing.get("plugin")))
        entry = info and info.manifest.concepts.get(Concept.FILINGS)
        tool = info and entry and info.operations.get(entry.operations.get("read", ""))
        answer = next((item for item in page.answers(subject, [info], Section.FILINGS, **lookups)
                       if item["status"] == "ready" and item["binding"]), None) if tool else None
        if answer is None:
            return None, _envelope("error", None, "unreadable",
                                   f"{filing.get('source') or 'This source'} cannot read its documents in Pythia yet; "
                                   "open the filing's url instead.")
        from .platform.access import ContextUnavailable, eligible_tools
        try:
            eligible = tool in eligible_tools()
        except ContextUnavailable:
            eligible = False
        if not eligible:
            return None, _envelope("error", None, "unavailable",
                                   f"{answer['label']} is not available in this profile.")
        from tools.registry import registry
        accepted = ((registry.get_schema(tool) or {}).get("parameters") or {}).get("properties") or {}
        arguments = {"native_ref": answer["binding"], "id": filing["id"], "url": filing.get("url")}
        result = _dispatch(tool, {key: value for key, value in arguments.items() if key in accepted}, cancelled)
        data = (result or {}).get("data")
        if not isinstance(data, dict) or not isinstance(data.get("text"), str):
            issue = next(iter((result or {}).get("issues") or []), {})
            code = issue.get("code") or "source_error"
            return None, _envelope("error", None, code, TOO_LARGE if code == "output_limit" else
                                   issue.get("message") or "The source could not read the document.")
        keep = ("id", "kind", "form", "title", "filed_at", "period_end", "authority", "report_key", "url", "source",
                "provider", "plugin", "format", "language")
        document = {**{key: filing.get(key) for key in keep}, "issuer": issuer, "document_title": data.get("title"),
                    "document_url": data.get("url") or filing.get("url"), "bytes": data.get("bytes"),
                    "text": data["text"], "sections": data.get("sections") or [],
                    "outline_method": data.get("outline_method")}
        self.cache.put(document)
        return document, None

    @staticmethod
    def _about(document: dict) -> dict:
        return {key: document.get(key) for key in ("id", "form", "title", "kind", "period_end", "filed_at",
                                                    "authority", "report_key", "source", "url")
                if document.get(key) is not None}

    @staticmethod
    def _cite(document: dict, section: dict, start: int, end: int) -> dict:
        url = document.get("document_url") or document.get("url")
        return {"document_id": document["id"], "form": document.get("form"), "filed": document.get("filed_at"),
                "section": section["id"], "section_title": section["title"], "offsets": [start, end],
                "url": f"{url}#{section['anchor']}" if url and section.get("anchor") else url}

    def _answer(self, document: dict, arguments: dict) -> str:
        text, sections = document["text"], document["sections"]
        about = self._about(document)
        if arguments.get("query"):
            limit = max(1, min(int(arguments.get("limit") or 5), 10))
            found, matched = search(document, str(arguments["query"]), limit)
            return _envelope("ok" if found else "empty", {
                "document": about, "query": arguments["query"], "matched_passages": matched,
                "passages": [{"text": text[start:end].strip(), "score": round(score, 2),
                              "citation": self._cite(document, section, start, end)}
                             for score, section, start, end in found]},
                None if found else "no_match", None if found else "No passage contains these words.")
        if arguments.get("section"):
            section = next((item for item in sections if item["id"] == arguments["section"]), None)
            if section is None:
                return _envelope("error", None, "unknown_section", "No such section; read the outline for ids.")
            size = max(1000, min(int(arguments.get("max_chars") or SECTION_CHARS), MAX_SECTION_CHARS))
            start = max(section["start"], min(int(arguments.get("start") or section["start"]), section["end"]))
            end = min(section["end"], start + size)
            if end < section["end"]:  # stop at a line break, so no line is cut
                cut = text.rfind("\n", start + size // 2, end)
                end = cut + 1 if cut > start else end
            return _envelope("ok", {"document": about, "section": {"id": section["id"], "title": section["title"],
                                                                   "chars": section["end"] - section["start"]},
                                    "text": text[start:end], "citation": self._cite(document, section, start, end),
                                    "continue_from": end if end < section["end"] else None})
        return _envelope("ok", {
            "document": {**about, "chars": len(text), "bytes": document.get("bytes"),
                         "outline_method": document.get("outline_method")},
            "sections": [{"id": item["id"], "title": item["title"], "chars": item["end"] - item["start"]}
                         for item in sections]})


def register(ctx: Any, identity: Any) -> None:
    from .identity_ops import PLUGIN, TOOLSET
    from .platform import declare_operation
    reader = Reader(identity)
    declare_operation(SCHEMA, plugin=PLUGIN, operation="filings-read", handler=reader.read, read_only=True)
    ctx.register_tool(name=SCHEMA["name"], toolset=TOOLSET, schema=SCHEMA, handler=reader.read,
                      description=SCHEMA["description"])
