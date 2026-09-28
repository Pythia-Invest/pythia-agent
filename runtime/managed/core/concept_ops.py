"""Core concept reads on the native tool registry: the combined filings list (ADR 0040).

`filings` reads every source chosen for a subject's filings, one per filing
authority, and merges them into one date-sorted list of core filing items. A
source that fails is listed as skipped and the list is marked partial; one still
to be looked up is listed, not awaited; nothing switches to another source. Each
source runs only if Pythia may run its native tool for this caller, with the
caller's cancellation.

The shared "run one plugin tool for a trusted caller" helper belongs to the
agent-tools work (`run_tool`); this read should use it once both land.
"""
from __future__ import annotations

import concurrent.futures
import contextvars
import json
import logging
import sqlite3
from typing import Any

from .identity import filings, page
from .identity.page import Section
from .queue_ops import SUBJECT_ID

logger = logging.getLogger(__name__)
READ_BUDGET = 20.0   # seconds for all of one combined read's sources together
FILINGS_LIMIT = 50   # rows asked of each source
PLUGIN_ID = {"type": "string", "minLength": 1, "maxLength": 128}
FILINGS_SCHEMA = {
    "name": "pythia_filings_combined",
    "description": "A company's regulatory filings from every connected filings source, one source per filing "
                   "authority (SEC; ESEF reports of EU issuers; UK), merged newest first. Each item names its source "
                   "and authority; a source that failed is listed under skipped and the list is marked partial. "
                   "`date` orders the list; `date_basis` says what it is: filed, indexed (the day the source indexed "
                   "a report that has no published filing date, not a filing date) or period_end.",
    "parameters": {"type": "object", "properties": {
        "subject_id": SUBJECT_ID,
        "use": {**PLUGIN_ID, "description": "Read this source for its authorities instead of the chosen one: a plugin "
                                            "id, provider or common name (sec, edgar, esef)."},
        "forms": {"type": "array", "minItems": 1, "maxItems": 8,
                  "items": {"type": "string", "minLength": 1, "maxLength": 16},
                  "description": "Only these forms (10-K, 20-F, ESEF; AFR or annual for annual reports); an "
                                 "amendment matches its form. Sources search beyond their most recent filings."}},
        "required": ["subject_id"], "additionalProperties": False},
}
def _envelope(outcome: str, data: Any, issue: str | None = None) -> str:
    body: dict[str, Any] = {"schema_version": 1, "outcome": outcome, "data": data}
    if issue:
        body["issues"] = [{"code": "unavailable" if data is None else "empty", "message": issue}]
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
        try:
            _path, subject, lookups, issue = self.identity._load(subject_id)
        except ValueError:
            return _envelope("empty", None, "Unknown subject.")
        except (sqlite3.Error, OSError):
            logger.warning("identity unavailable for filings", exc_info=True)
            return _envelope("empty", None, "The reference data could not be read.")
        if subject is None:
            return _envelope("empty", None, issue)
        plugins = identity_ops.installed()
        if use:  # read the named source once: it goes first for the authorities it serves
            chosen_name = page.named(str(use), plugins)
            if chosen_name is None:
                return _envelope("empty", None, f"No installed filings source is called {use}.")
            lookups = {**lookups, "order": (chosen_name, *lookups.get("order", ()))}
        found = page.answers(subject, plugins, Section.FILINGS, **lookups)
        chosen, alternatives, skipped = page.select(found, combine=page.REGISTRY[page.Concept.FILINGS].combine)
        infos = {info.key: info for info in plugins}
        eligible, cancelled = self.eligible(), context.get("cancelled") or (lambda: False)
        parts, futures, waiting = [], {}, []
        for answer, authorities in chosen:
            info = infos[answer["plugin"]]
            tool = info.operations.get(page.serving(info.manifest, Section.FILINGS)[1])
            if answer["status"] != "ready":  # still to be looked up: listed, not awaited, not a failure
                waiting.append({**page.source(answer), "code": answer["status"],
                                "reason": f"{answer['label']} has not been looked up for this company yet"})
                continue
            if tool is None or (eligible is not None and tool not in eligible):
                waiting.append({**page.source(answer), "code": "unavailable",
                                "reason": f"{answer['label']} is not available in this profile"})
                continue
            call = contextvars.copy_context().run
            futures[self._pool.submit(call, self._dispatch, tool, answer["binding"], forms, cancelled)] = (
                answer, authorities)
        done, pending = concurrent.futures.wait(futures, timeout=READ_BUDGET)
        for future in futures:
            answer, authorities = futures[future]
            if future in pending:
                future.cancel()
                parts.append((answer, authorities, None, f"{answer['label']} did not answer in time"))
                continue
            result, failure = future.result()
            parts.append((answer, authorities, result, failure))
        merged = filings.merge_filings(parts, forms)
        rest = {entry["plugin"] for entry, _ in chosen}
        merged["skipped"] = [*merged["skipped"], *waiting,
                             *({**page.source(answer), "code": answer["status"],
                                "reason": answer["reason"] or answer["status"].replace("_", " ")}
                               for answer in skipped if answer["plugin"] not in rest)]
        merged["alternatives"] = [{**page.source(answer), "status": answer["status"]} for answer in alternatives]
        merged["subject_id"] = subject["id"]
        outcome = "error" if not merged["sources"] and parts else "partial" if merged["partial"] else (
            "ok" if merged["filings"] else "empty")
        return _envelope(outcome, merged)

    @staticmethod
    def _dispatch(tool: str, binding: dict, forms: list[str] = (),
                  cancelled: Any = lambda: False) -> tuple[dict | None, str | None]:
        from tools.registry import registry
        arguments: dict[str, Any] = {"native_ref": binding, "limit": FILINGS_LIMIT}
        try:
            accepted = (registry.get_schema(tool) or {}).get("parameters", {}).get("properties", {})
        except (AttributeError, TypeError):
            accepted = {}
        if forms and "forms" in accepted:  # a source that can search by form does; core filters every answer
            expanded = [name for item in forms for name in filings.FORM_ALIASES.get(item.upper(), (item,))]
            arguments["forms"] = list(dict.fromkeys(expanded))[:8]
        try:
            if cancelled():
                return None, "The read was cancelled"
            raw = registry.dispatch(tool, arguments, cancelled=cancelled)
            result = json.loads(raw) if isinstance(raw, str) else None
        except Exception:  # a failing source never breaks the others
            logger.warning("filings read failed for %s", tool, exc_info=True)
            return None, "The source failed while answering"
        if not isinstance(result, dict) or result.get("schema_version") != 1:
            return None, "The source answered with something Pythia could not read"
        return result, None


def register(ctx: Any, identity: Any) -> None:
    from .identity_ops import PLUGIN, TOOLSET
    from .platform import declare_operation
    reads = ConceptReads(identity)
    # Registered like core's other Desk operations; see the ADR 0040 note on model visibility.
    declare_operation(FILINGS_SCHEMA, plugin=PLUGIN, operation="filings", handler=reads.filings, read_only=True)
    ctx.register_tool(name=FILINGS_SCHEMA["name"], toolset=TOOLSET, schema=FILINGS_SCHEMA, handler=reads.filings,
                      description=FILINGS_SCHEMA["description"])
