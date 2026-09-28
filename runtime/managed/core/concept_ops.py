"""Core concept reads on the native tool registry: combined filings and remembered plan refusals (ADR 0040).

`filings` reads every source chosen for a subject's filings, one per filing
authority, and merges them into one date-sorted list of core filing items. A
source that fails is listed as skipped and the list is marked partial; nothing
switches to another source. `source-refusals` lists the operations providers
refused as not on the investor's plan, and `source-refusals-clear` forgets
them so selection tries those sources again. `observe` records a refusal from
any plugin read that passes through the protected HTTP adapter.
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
MARKET_DATA = "pythia-market-data"
FILINGS_SCHEMA = {
    "name": "pythia_filings_combined",
    "description": "A company's regulatory filings from every connected filings source, one source per filing "
                   "authority (SEC; ESEF reports of EU issuers; UK), merged newest first. Each item names its source "
                   "and authority; a source that failed is listed under skipped and the list is marked partial.",
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
REFUSALS_SCHEMA = {
    "name": "pythia_source_refusals",
    "description": "Sources a provider refused as not on the investor's plan, per concept operation. Pythia skips "
                   "them until cleared.",
    "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
}
CLEAR_SCHEMA = {
    "name": "pythia_source_refusals_clear",
    "description": "Forget remembered plan refusals (one plugin's, or all) so Pythia tries those sources again, for "
                   "example after the investor upgraded a plan.",
    "parameters": {"type": "object", "properties": {"plugin": PLUGIN_ID}, "additionalProperties": False},
}


def _envelope(outcome: str, data: Any, issue: str | None = None) -> str:
    body: dict[str, Any] = {"schema_version": 1, "outcome": outcome, "data": data}
    if issue:
        body["issues"] = [{"code": "unavailable" if data is None else "empty", "message": issue}]
    return json.dumps(body, ensure_ascii=False, separators=(",", ":"))


def refusal(result: Any) -> str | None:
    """The provider's plan refusal in a plugin result, if any: `not_entitled`, or access denied with 402/403.

    A 401 is a key problem, not a plan limit, and is never remembered."""
    if not isinstance(result, dict) or not isinstance(result.get("issues"), list):
        return None
    for issue in result["issues"]:
        if not isinstance(issue, dict):
            continue
        status = issue.get("source_code", issue.get("http_status"))
        if issue.get("code") == "not_entitled" or (issue.get("code") == "access_denied" and status in (402, 403)):
            return str(issue.get("message") or "The provider said this is not on your plan.")[:300]
    return None


class ConceptReads:
    def __init__(self, identity: Any):
        self.identity = identity
        self._pool = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="pythia-concept")

    # ---- filings ---------------------------------------------------------------------------------------------------

    def filings(self, arguments: dict, **_context: Any) -> str:
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
        parts, futures = [], {}
        for answer, authorities in chosen:
            info = infos[answer["plugin"]]
            tool = info.operations.get(page.serving(info.manifest, Section.FILINGS)[1])
            if answer["status"] != "ready" or tool is None:
                parts.append((answer, authorities, None, f"{answer['label']} is still being looked up"))
                continue
            call = contextvars.copy_context().run
            futures[self._pool.submit(call, self._dispatch, tool, answer["binding"], forms)] = (answer, authorities)
        done, pending = concurrent.futures.wait(futures, timeout=READ_BUDGET)
        for future in futures:
            answer, authorities = futures[future]
            if future in pending:
                future.cancel()
                parts.append((answer, authorities, None, f"{answer['label']} did not answer in time"))
                continue
            result, failure = future.result()
            reason = refusal(result)
            if reason:
                self.identity.store.refuse(answer["plugin"], "filings", "list", reason)
            parts.append((answer, authorities, result, failure))
        merged = filings.merge_filings(parts, forms)
        rest = {entry["plugin"] for entry, _ in chosen}
        merged["skipped"] = [*merged["skipped"], *({**page.source(answer), "code": answer["status"],
                                                    "reason": answer["reason"] or answer["status"].replace("_", " ")}
                                                   for answer in skipped if answer["plugin"] not in rest)]
        merged["alternatives"] = [{**page.source(answer), "status": answer["status"]} for answer in alternatives]
        merged["subject_id"] = subject["id"]
        outcome = "error" if not merged["sources"] and chosen else "partial" if merged["partial"] else (
            "ok" if merged["filings"] else "empty")
        return _envelope(outcome, merged)

    @staticmethod
    def _dispatch(tool: str, binding: dict, forms: list[str] = ()) -> tuple[dict | None, str | None]:
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
            raw = registry.dispatch(tool, arguments)
            result = json.loads(raw) if isinstance(raw, str) else None
        except Exception:  # a failing source never breaks the others
            logger.warning("filings read failed for %s", tool, exc_info=True)
            return None, "The source failed while answering"
        if not isinstance(result, dict) or result.get("schema_version") != 1:
            return None, "The source answered with something Pythia could not read"
        return result, None

    # ---- plan refusals ---------------------------------------------------------------------------------------------

    def refusals(self, _arguments: dict, **_context: Any) -> str:
        rows = self.identity.store.refusals()
        return _envelope("ok" if rows else "empty", {"refusals": rows})

    def clear(self, arguments: dict, **_context: Any) -> str:
        plugin = arguments.get("plugin") or None
        return _envelope("ok", {"cleared": self.identity.store.clear_refusals(plugin)})


CURRENT: ConceptReads | None = None


def observe(plugin: str, operation: str, arguments: Any, result: Any) -> None:
    """Remember a plan refusal seen on a plugin read through the protected HTTP adapter. Never raises."""
    try:
        reason = refusal(result)
        if reason is None or CURRENT is None:
            return
        from . import identity_ops
        for key, concept, concept_operation in refused_operations(identity_ops.installed(), plugin, operation,
                                                                   arguments, result):
            CURRENT.identity.store.refuse(key, concept, concept_operation, reason)
    except Exception:
        logger.warning("could not record a plan refusal", exc_info=True)


def refused_operations(plugins: list, plugin: str, operation: str, arguments: Any, result: dict) -> list[tuple[str, str, str]]:
    """(plugin, concept, operation) a refused read was for; pure. Unknown when it cannot be told: then none."""
    if plugin == MARKET_DATA:  # a price read: the provider in the answer, latest is a quote, history by interval
        request = result.get("request") if isinstance(result.get("request"), dict) else (
            (arguments or {}).get("request") if isinstance(arguments, dict) else None) or {}
        subject = (request.get("view") or {}).get("subject") if isinstance(request.get("view"), dict) else None
        provider = (result.get("provenance") or {}).get("provider") or (subject or {}).get("provider")
        interval = ((result.get("series") or {}).get("interval") or {}).get("kind") or (
            ((arguments or {}).get("criteria") or {}).get("interval") or {}).get("kind")
        name = {"latest": "quote"}.get(request.get("operation")) or (
            ("daily" if interval in ("day", "week", "month") else "intraday") if request.get("operation") == "history"
            and interval else None)
        info = next((item for item in plugins if item.manifest.provider == provider), None)
        entry = info and info.manifest.concepts.get(page.Concept.MARKET_DATA)
        return [(info.key, "market_data", name)] if entry and name in entry.operations else []
    info = next((item for item in plugins if plugin in (item.key, item.manifest.plugin)), None)
    if info is None:
        return []
    return [(info.key, str(concept), name) for concept, entry in info.manifest.concepts.items()
            for name, plugin_operation in entry.operations.items() if plugin_operation == operation]


def register(ctx: Any, identity: Any) -> None:
    global CURRENT
    from .identity_ops import PLUGIN, TOOLSET
    from .platform import declare_operation
    reads = CURRENT = ConceptReads(identity)
    for schema, handler, operation, read_only in ((FILINGS_SCHEMA, reads.filings, "filings", True),
                                                  (REFUSALS_SCHEMA, reads.refusals, "source-refusals", True),
                                                  (CLEAR_SCHEMA, reads.clear, "source-refusals-clear", False)):
        declare_operation(schema, plugin=PLUGIN, operation=operation, handler=handler, read_only=read_only)
        ctx.register_tool(name=schema["name"], toolset=TOOLSET, schema=schema, handler=handler,
                          description=schema["description"])

