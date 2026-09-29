"""Core concept reads on the native tool registry: combined reads of several sources (ADR 0040).

`filings` reads every source chosen for a subject's filings, one per filing
authority, and merges them into one date-sorted list of core filing items.
`news` reads every eligible source of news into one feed without cross-source
duplicates. A source that answers `not_covered`
gives way to the next eligible source; one that fails is listed as skipped and
the result is marked partial, and nothing switches to another source; one still
to be looked up is listed, not awaited. Each source runs only if Pythia may run
its native tool for this caller, with the caller's cancellation.

The shared "run one plugin tool for a trusted caller" helper belongs to the
agent-tools work (`run_tool`); this read should use it once both land.
"""
from __future__ import annotations

import concurrent.futures
import contextvars
import json
import logging
import sqlite3
import time
from typing import Any

from .identity import filings, news, page
from .identity.concepts import NOT_COVERED, FilingKind, not_covered
from .identity.page import Section
from .queue_ops import SUBJECT_ID

logger = logging.getLogger(__name__)
READ_BUDGET = 20.0   # seconds for all of one combined read's sources together
ROWS_LIMIT = 50      # rows asked of each source
PLUGIN_ID = {"type": "string", "minLength": 1, "maxLength": 128}
FILINGS_SCHEMA = {
    "name": "pythia_filings_combined",
    "description": "A company's regulatory filings from every connected filings source, one source per filing "
                   "authority (sec; the national mechanism for European reports: oam-fr, oam-nl, fca…), merged newest "
                   "first. Each item names its kind, source and authority; a chosen source that failed or was not "
                   "read (not yet looked up) is listed under skipped and the list is marked partial. `date` orders the list; `date_basis` says what it is: "
                   "filed, indexed (the day the source indexed a report that has no published filing date, not a "
                   "filing date) or period_end; `filed_time` is the exact UTC filing time where known. Items with one "
                   "`report_key` are versions of one report (format, language, amendment); items sharing `report_period` "
                   "are parallel reports of one period under other authorities (a 20-F beside an ESEF report).",
    "parameters": {"type": "object", "properties": {
        "subject_id": SUBJECT_ID,
        "use": {**PLUGIN_ID, "description": "Read this source for its authorities instead of the chosen one: a plugin "
                                            "id, provider or common name (sec, edgar, esef)."},
        "forms": {"type": "array", "minItems": 1, "maxItems": 8,
                  "items": {"type": "string", "minLength": 1, "maxLength": 16},
                  "description": "Only these forms (10-K, 20-F, ESEF; AFR or annual for annual reports); an "
                                 "amendment matches its form. Sources search beyond their most recent filings. "
                                 "Without forms, SEC insider and major-holder filings are left out; name them "
                                 "(3, 4, 5, 144, 13G) or ask for the ownership kind to read them."},
        "kinds": {"type": "array", "minItems": 1, "maxItems": 8,
                  "items": {"type": "string", "enum": [kind.value for kind in FilingKind]},
                  "description": "Only these kinds of filing: annual, half_year, quarterly, earnings_release, event "
                                 "(material events, inside information), ownership, prospectus, other."}},
        "required": ["subject_id"], "additionalProperties": False},
}
NEWS_SCHEMA = {
    "name": "pythia_news_combined",
    "description": "A subject's news from every connected source in one feed, newest first. An item another source "
                   "already listed (same link, or same headline less than a day apart) is left out; each item names "
                   "its source. A source that failed or was not read is listed under skipped and the feed is marked "
                   "partial; one that does not cover the subject is skipped as not_covering.",
    "parameters": {"type": "object", "properties": {"subject_id": SUBJECT_ID},
                   "required": ["subject_id"], "additionalProperties": False},
}


def _envelope(outcome: str, data: Any, issue: str | None = None, code: str | None = None) -> str:
    body: dict[str, Any] = {"schema_version": 1, "outcome": outcome, "data": data}
    if issue:
        body["issues"] = [{"code": code or ("unavailable" if data is None else "empty"), "message": issue}]
    return json.dumps(body, ensure_ascii=False, separators=(",", ":"))


class ConceptReads:
    def __init__(self, identity: Any):
        self.identity = identity
        self._pool = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="pythia-concept")

    # ---- filings ---------------------------------------------------------------------------------------------------

    @staticmethod
    def eligible() -> set[str] | None:
        """The native tools Pythia may run for this caller, from the calling thread's trusted context."""
        from .platform.access import ContextUnavailable, eligible_tools
        try:
            return set(eligible_tools())
        except ContextUnavailable:
            return set()

    def filings(self, arguments: dict, **context: Any) -> str:
        from . import identity_ops
        subject_id, use = str(arguments.get("subject_id") or ""), arguments.get("use")
        forms = [str(item) for item in arguments.get("forms") or []][:8]
        kinds = [str(item) for item in arguments.get("kinds") or []][:8]
        subject, lookups, issue = self._subject(subject_id)
        if subject is None:
            return _envelope("empty", None, issue)
        plugins = identity_ops.installed()
        if use:  # read the named source once: it goes first for the authorities it serves
            chosen_name = page.named(str(use), plugins)
            if chosen_name is None:
                return _envelope("empty", None, f"No installed filings source is called {use}.")
            lookups = {**lookups, "order": (chosen_name, *lookups.get("order", ()))}
        chosen, alternatives, skipped, results, waiting = self._select_and_read(
            subject, plugins, Section.FILINGS, lookups, context, forms, kinds)
        parts = [(answer, authorities, *results[answer["plugin"]]) for answer, authorities in chosen
                 if answer["plugin"] in results]
        issuer = subject["ids"].get("issuer") or subject["id"]
        merged = filings.merge_filings(parts, forms, kinds, issuer)
        from .documents import remember
        remember(issuer, merged["filings"])  # every listed filing stays readable by the document reader
        return self._finish(merged, subject, chosen, alternatives, skipped, waiting, bool(parts), "filings")

    def news(self, arguments: dict, **context: Any) -> str:
        """Every eligible source's news in one feed. Single values (estimates, statements) get their side-by-side
        read with their first source's onboarding."""
        from . import identity_ops
        subject, lookups, issue = self._subject(str(arguments.get("subject_id") or ""))
        if subject is None:
            return _envelope("empty", None, issue)
        chosen, alternatives, skipped, results, waiting = self._select_and_read(
            subject, identity_ops.installed(), Section.NEWS, lookups, context)
        parts = [(answer, *results[answer["plugin"]]) for answer, _ in chosen if answer["plugin"] in results]
        return self._finish(news.merge_news(parts), subject, chosen, alternatives, skipped, waiting, bool(parts),
                            "news")

    def _subject(self, subject_id: str) -> tuple[dict | None, dict, str | None]:
        try:
            _path, subject, lookups, issue = self.identity._load(subject_id)
        except ValueError:
            return None, {}, "Unknown subject."
        except (sqlite3.Error, OSError):
            logger.warning("identity unavailable for a combined read", exc_info=True)
            return None, {}, "The reference data could not be read."
        return subject, lookups, issue

    def _select_and_read(self, subject: dict, plugins: list, section: Section, lookups: dict, context: dict,
                         forms: list[str] = (), kinds: list[str] = ()) -> tuple[list, list, list, dict, list]:
        """Select, read the chosen sources at once, and let each that answers `not_covered` give way to the next
        eligible source (for its authorities, under `per_authority`), until none does. A failure never switches
        source. Returns (chosen, alternatives, skipped, {plugin: (result, failure)}, waiting)."""
        found = page.answers(subject, plugins, section, **lookups)
        combine = page.REGISTRY[page.SERVES[section][0]].combine
        infos = {info.key: info for info in plugins}
        eligible, cancelled = self.eligible(), context.get("cancelled") or (lambda: False)
        deadline = time.monotonic() + READ_BUDGET
        results, waiting, uncovered, tried = {}, [], {}, set()
        noun = "fund" if subject.get("kind") in ("etf", "fund") else "company"
        while True:
            entries = [{**answer, "status": "not_covering", "reason": f"{answer['label']}: {uncovered[answer['plugin']]}"}
                       if answer["plugin"] in uncovered else answer for answer in found]
            chosen, alternatives, skipped = page.select(entries, combine=combine)
            futures = {}
            for answer, _ in chosen:
                if answer["plugin"] in tried:
                    continue
                tried.add(answer["plugin"])
                info = infos[answer["plugin"]]
                tool = info.operations.get(page.serving(info.manifest, section)[1])
                if answer["status"] != "ready":  # still to be looked up: listed, not awaited, not a failure
                    waiting.append({**page.source(answer), "code": answer["status"],
                                    "reason": f"{answer['label']} has not been looked up for this {noun} yet"})
                elif tool is None or (eligible is not None and tool not in eligible):
                    waiting.append({**page.source(answer), "code": "unavailable",
                                    "reason": f"{answer['label']} is not available in this profile"})
                else:
                    call = contextvars.copy_context().run
                    futures[self._pool.submit(call, self._dispatch, tool, answer["binding"], forms, cancelled,
                                              kinds)] = answer
            if not futures:
                return chosen, alternatives, skipped, results, waiting
            _done, pending = concurrent.futures.wait(futures, timeout=max(0.0, deadline - time.monotonic()))
            for future, answer in futures.items():
                if future in pending:
                    future.cancel()
                    results[answer["plugin"]] = (None, f"{answer['label']} did not answer in time")
                    continue
                result, failure = future.result()
                message = None if failure else not_covered(result)
                if message:
                    uncovered[answer["plugin"]] = message
                else:
                    results[answer["plugin"]] = (result, failure)

    @staticmethod
    def _finish(merged: dict, subject: dict, chosen: list, alternatives: list, skipped: list, waiting: list,
                read: bool, key: str) -> str:
        rest = {entry["plugin"] for entry, _ in chosen}
        merged["skipped"] = [*merged["skipped"], *waiting,
                             *({**page.source(answer), "code": answer["status"],
                                "reason": answer["reason"] or answer["status"].replace("_", " ")}
                               for answer in skipped if answer["plugin"] not in rest)]
        merged["alternatives"] = [{**page.source(answer), "status": answer["status"]} for answer in alternatives]
        merged["subject_id"] = subject["id"]
        # A chosen source not read (still to be looked up, not runnable here) leaves the list short, as a failure does.
        merged["partial"] = bool(merged["sources"]) and (merged["partial"] or bool(waiting))
        if merged["sources"]:
            return _envelope("partial" if merged["partial"] else "ok" if merged[key] else "empty", merged)
        # No source answered: every read failed (an error, never an empty list), or none serves this subject yet.
        if read:
            failures = "; ".join(f"{item['source']}: {item['reason']}" for item in merged["skipped"]
                                 if item["code"] == "failed")
            return _envelope("error", merged, f"No {key} source could be read: {failures}", "unavailable")
        reasons = "; ".join(item["reason"] for item in merged["skipped"]) or "no source declares it"
        return _envelope("empty", merged, f"No {key} source serves this subject: {reasons}",
                         "empty" if waiting else NOT_COVERED)

    @staticmethod
    def _dispatch(tool: str, binding: dict, forms: list[str] = (), cancelled: Any = lambda: False,
                  kinds: list[str] = ()) -> tuple[dict | None, str | None]:
        from tools.registry import registry
        arguments: dict[str, Any] = {"native_ref": binding}
        try:
            accepted = (registry.get_schema(tool) or {}).get("parameters", {}).get("properties", {})
        except (AttributeError, TypeError):
            accepted = {}
        if isinstance(accepted.get("limit"), dict):  # as many rows as the source allows, up to core's limit
            arguments["limit"] = min(ROWS_LIMIT, accepted["limit"].get("maximum") or ROWS_LIMIT)
        if forms and "forms" in accepted:  # a source that can search by form does; core filters every answer
            expanded = [name for item in forms for name in filings.FORM_ALIASES.get(item.upper(), (item,))]
            arguments["forms"] = list(dict.fromkeys(expanded))[:8]
        if kinds and "kinds" in accepted:
            arguments["kinds"] = kinds
        try:
            if cancelled():
                return None, "The read was cancelled"
            raw = registry.dispatch(tool, arguments, cancelled=cancelled)
            result = json.loads(raw) if isinstance(raw, str) else None
        except Exception:  # a failing source never breaks the others
            logger.warning("combined read failed for %s", tool, exc_info=True)
            return None, "The source failed while answering"
        if not isinstance(result, dict) or result.get("schema_version") != 1:
            return None, "The source answered with something Pythia could not read"
        return result, None


def register(ctx: Any, identity: Any) -> None:
    from .identity_ops import PLUGIN, TOOLSET
    from .platform.operations import declare_operation
    reads = ConceptReads(identity)
    # Registered like core's other Desk operations; see the ADR 0040 note on model visibility.
    declare_operation(FILINGS_SCHEMA, plugin=PLUGIN, operation="filings", handler=reads.filings, read_only=True)
    declare_operation(NEWS_SCHEMA, plugin=PLUGIN, operation="news", handler=reads.news, read_only=True)
    for schema, handler in ((FILINGS_SCHEMA, reads.filings), (NEWS_SCHEMA, reads.news)):
        ctx.register_tool(name=schema["name"], toolset=TOOLSET, schema=schema, handler=handler,
                          description=schema["description"])
