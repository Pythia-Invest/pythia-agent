"""The agent's always-visible Pythia tools: find, instrument and one identity answer, plus shared helpers.

These are thin core front ends over operations that already exist: core identity, the market-data
feature's read backend and each plugin's contract-declared filings tool. Plugin tools stay registered
under their own owners but out of the model's view; these handlers run them through `may_run`
(`platform.access.eligible_tools`), never through model visibility. Schemas carry no `$comment`
operation markers, and every result is bounded. See docs/architecture/agent-tools.md.
"""
from __future__ import annotations

import copy
import json
import logging
from functools import partial
from typing import Any, Callable

from . import identity_ops, queue_ops
from .identity import page
from .identity.page import Section

logger = logging.getLogger(__name__)
TOOLSET = "pythia-desk"  # the only Pythia toolset the model sees; plugin and core operation toolsets stay hidden
MAX_CHARS = 16_000       # far below Hermes's 100k spill: a result is replayed on every later turn
CONTEXT = ("task_id", "session_id")      # what a nested dispatch forwards from the native call
HOME_UNKNOWN = ("Pythia's reference data does not decide this instrument's home listing; say so, and label any web "
                "answer as unverified.")

SUBJECT = {"type": "string", "minLength": 5, "maxLength": 370,
           "description": "A subject id from pythia_find, such as listing:… or security:…"}
SOURCE = {"type": "string", "minLength": 2, "maxLength": 64,
          "description": "Read only this source (a provider name such as yahoo or sec). Without it, the first "
                         "source in Pythia's order that serves the subject is used; nothing falls back."}

FIND = {
    "name": "pythia_find",
    "description": "Find a stock, fund or crypto asset by name, ticker or ISIN. Searches the investor's local "
                   "reference of companies, securities, listings and crypto assets by name, ticker, ISIN, LEI, CIK or "
                   "FIGI. Start here for any investment the user names. Results are grouped per company or "
                   "instrument; each row is a listing with its subject id (pass it to the other tools), ticker, "
                   "venue and currency. Local only; no provider is called. A row is a candidate: check name and "
                   "venue before relying on it.",
    "parameters": {"type": "object", "properties": {
        "query": {"type": "string", "minLength": 1, "maxLength": 128},
        "kinds": {"type": "array", "maxItems": 16, "items": {"type": "string"},
                  "description": "Optional instrument kinds, such as ordinary, etf, fund or coin."},
        "limit": {"type": "integer", "minimum": 1, "maximum": 25}},
        "required": ["query"], "additionalProperties": False},
}
INSTRUMENT = {
    "name": "pythia_instrument",
    "description": "Identifiers, listings and data sources of an investment. Everything Pythia knows locally about "
                   "one investment: identifiers (ISIN, LEI, CIK, FIGI), issuer, "
                   "its listings and related instruments, and which source serves each concept (quote, chart, profile, "
                   "filings) or why none does. Use it to pick a listing, find an issuer's LEI or CIK, or see which "
                   "sources are connected. Local only.",
    "parameters": {"type": "object", "properties": {"subject_id": SUBJECT},
                   "required": ["subject_id"], "additionalProperties": False},
}


def answer_schema() -> dict:
    """The Desk identity-verdict arguments without its HTTP operation marker, whenever it is built: registration
    stamps that marker on the shared schema, and a second declaration would break the Desk's operation."""
    parameters = {key: value for key, value in copy.deepcopy(queue_ops.VERDICT_SCHEMA["parameters"]).items()
                  if key != "$comment"}
    parameters["properties"]["chosen_id"] = {"type": "string", "minLength": 5, "maxLength": 370}
    return {"name": "pythia_answer_identity_question", "parameters": parameters,
            "description": "Answer an open identity question in Repairs. Read it in full first with "
                           "pythia_identity_questions. "
                           + queue_ops.VERDICT_SCHEMA["description"].split(". ", 1)[1]}


def questions_schema() -> dict:
    """The Desk identity-queue arguments without its HTTP operation marker (see answer_schema)."""
    parameters = {key: value for key, value in copy.deepcopy(queue_ops.QUEUE_SCHEMA["parameters"]).items()
                  if key != "$comment"}
    parameters["properties"]["subject_id"] = {"type": "string", "minLength": 5, "maxLength": 370}
    return {"name": "pythia_identity_questions", "parameters": parameters,
            "description": "Open identity questions in Repairs, for review. "
                           + queue_ops.QUEUE_SCHEMA["description"].split(": ", 1)[1][0].upper()
                           + queue_ops.QUEUE_SCHEMA["description"].split(": ", 1)[1][1:]}



# ---- shared helpers ------------------------------------------------------------------------------------------------

def failure(code: str, message: str, **extra: Any) -> dict:
    return {"schema_version": 1, "outcome": "error", **extra,
            "issues": [{"code": code, "severity": "error", "message": message}]}


def encode(result: dict, limit: int = MAX_CHARS) -> str:
    """JSON for the model, within `limit` characters: the longest list is shortened, and the result says so."""
    text = json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    if len(text) <= limit:
        return text
    result = copy.deepcopy(result)
    lists = []

    def collect(value: Any, path: str, depth: int) -> None:
        if isinstance(value, list) and len(value) > 1:
            lists.append((path, value))
        if depth < 3 and isinstance(value, dict):
            for key, item in value.items():
                collect(item, f"{path}.{key}" if path else key, depth + 1)

    collect(result, "", 0)
    if lists:
        path, items = max(lists, key=lambda entry: len(json.dumps(entry[1], ensure_ascii=False)))
        total = len(items)
        while len(items) > 1 and len(text) > limit:
            del items[max(1, len(items) * 3 // 4):]
            result["truncated"] = {"field": path, "returned": len(items), "total": total,
                                   "hint": "Narrow the request (limit, dates, fields) to see the rest."}
            text = json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        if len(text) <= limit:
            return text
    return json.dumps(failure("result_too_large", f"The result has {len(text)} characters, more than the {limit} "
                                                  "a tool result may carry. Narrow the request."), separators=(",", ":"))


def forward(context: dict) -> dict:
    return {key: context[key] for key in CONTEXT if context.get(key)}


def may_run(plugin_key: str, operation: str | None) -> str | None:
    """ADR 0040's `may_run(plugin, operation)`: the native tool Pythia may run for it, or None. The plugin is natively
    enabled and the tool's availability check passes (`eligible_tools`, never model visibility), one tool the plugin
    owns declares the operation, and the plugin names it: in its contract, or by exposing it as an agent tool."""
    from tools.registry import registry
    from .agent_depth import native_operations
    from .platform.access import ContextUnavailable, eligible_tools, native_tool_owners
    tool = native_operations().get(plugin_key, {}).get(operation) if operation else None
    if tool is None:
        return None
    info = plugins().get(plugin_key)
    exposed = any(getattr(getattr(registry.get_entry(name), "handler", None), "pythia_agent_tool", None) == tool
                  for name, (key, _plugin) in native_tool_owners().items() if key == plugin_key)
    if info is not None and operation not in info.manifest.plugin_operations and not exposed:
        return None
    try:
        return tool if tool in eligible_tools() else None
    except ContextUnavailable:
        return None


def run_tool(ctx: Any, name: str, arguments: dict, context: dict) -> dict:
    """Run one plugin tool the model does not see, after `may_run`; any failure becomes an envelope."""
    from .platform.access import ContextUnavailable, eligible_tools
    try:
        if name not in eligible_tools():
            return failure("unavailable", "That source is disabled or unavailable in this profile.")
    except ContextUnavailable:
        return failure("unavailable", "No trusted caller context; the source was not called.")
    raw = ctx.dispatch_tool(name, arguments, **forward(context))
    try:
        result = json.loads(raw) if isinstance(raw, str) else None
    except ValueError:
        result = None
    if not isinstance(result, dict):
        return failure("invalid_response", "The source returned something Pythia could not read.")
    if "error" in result and "schema_version" not in result:  # Hermes's envelope for a handler that raised
        logger.warning("plugin tool %s failed: %s", name, str(result["error"])[:300])
        return failure("source_error", "The source failed while answering; try again or use another source.")
    return result


def identity() -> identity_ops.Identity:
    if identity_ops.CURRENT is None:
        raise RuntimeError("core identity is not loaded")
    return identity_ops.CURRENT


def source_key(name: Any, infos: dict[str, Any]) -> str | None:
    """The plugin key a source name means, as the page reads it (page.named: key, provider, label or alias)."""
    return page.named(str(name or ""), list(infos.values()))


def unknown_source(name: Any, infos: dict[str, Any]) -> dict:
    known = sorted({info.manifest.provider for info in infos.values()})
    return failure("unknown_source", f"No source named '{name}'. Sources: {', '.join(known)}.")


def plugins() -> dict[str, Any]:
    """The installed contracts by plugin key, read once per tool call."""
    return {info.key: info for info in identity_ops.installed()}


def label(plugin_key: str, infos: dict[str, Any]) -> dict:
    """A source as the page names it (page.source), marked `unaudited` until it is signed off (ADR 0042)."""
    info = infos.get(plugin_key)
    if info is None:
        return {"source": plugin_key, "provider": plugin_key, "plugin": plugin_key}
    return page.source({"label": info.label, "provider": info.manifest.provider, "plugin": plugin_key,
                        "unaudited": info.manifest.unaudited})


def serving(provider: str | None, infos: dict[str, Any]) -> str | None:
    """The plugin key of the provider a read reports it used."""
    return next((key for key, info in infos.items() if provider and info.manifest.provider == provider), None)


def concept_sources(subject_id: str, section: Section, wanted: str | None, infos: dict[str, Any]
                    ) -> tuple[dict | None, list, list, str | None]:
    """The subject, its usable sources for one concept in core's order and the skipped ones with reasons.

    A source whose reference needs a lookup is resolved once when it would be used, as the Desk does."""
    core = identity()
    try:
        _path, subject, lookups, issue = core._load(subject_id)
    except ValueError:
        return None, [], [], "Unknown subject id; find the investment with pythia_find."
    if subject is None:
        return None, [], [], issue or "Unknown subject id; find the investment with pythia_find."
    answers = page.answers(subject, list(infos.values()), section, **lookups)
    named = [answer for answer in answers if answer["plugin"] == wanted]
    usable = [answer for answer in answers if answer["status"] in ("ready", "resolving")]
    first = (named or ([] if wanted else usable) or [None])[0]
    if first is not None and first["status"] == "resolving":
        core.resolve({"subject_id": subject["id"], "plugin": first["plugin"]})
        _path, subject, lookups, _issue = core._load(subject_id)
        answers = page.answers(subject, list(infos.values()), section, **lookups)
    ready = [answer for answer in answers if answer["status"] == "ready" and answer["binding"]]
    skipped = [{**label(answer["plugin"], infos), "reason": answer["reason"] or answer["status"]}
               for answer in answers if answer not in ready]
    return subject, ready, skipped, None


def choose(ready: list, skipped: list, wanted: str | None, concept: str, infos: dict[str, Any]
           ) -> tuple[dict | None, dict | None]:
    """(chosen answer, error envelope): the named source, or the first usable one. Never a silent substitute."""
    if wanted:
        chosen = next((answer for answer in ready if answer["plugin"] == wanted), None)
        if chosen is None:
            why = next((row["reason"] for row in skipped if row["plugin"] == wanted), None)
            name = label(wanted, infos)["source"]
            return None, failure("source_unavailable", f"{name} cannot serve {concept} for this subject"
                                 + (f": {why}." if why else ".") + " The alternatives below can; name one to use it.",
                                 alternatives=[label(answer["plugin"], infos) for answer in ready], skipped=skipped)
        return chosen, None
    if not ready:
        return None, failure("no_source", f"No connected source serves {concept} for this subject.", skipped=skipped,
                             next="pythia_instrument shows each source's state; the investor can enable or configure one.")
    return ready[0], None


# ---- pythia_find and pythia_instrument -----------------------------------------------------------------------------

def find(arguments: dict, **_context: Any) -> str:
    arguments = {**arguments, "limit": min(int(arguments.get("limit") or 10), 25)}
    result = json.loads(identity().search(arguments))
    (result.get("data") or {}).pop("lookup", None)  # Desk's single-provider lookup offer
    if result.get("outcome") == "ok":
        result["next"] = ("pythia_instrument for a row's identifiers, listings and sources; pythia_prices, "
                          "pythia_filings and the provider tools it lists take its subject id.")
    return encode(result)


def instrument(arguments: dict, **_context: Any) -> str:
    result = json.loads(identity().subject(arguments))
    view = result.get("data")
    if not isinstance(view, dict):
        return encode(result)
    view["sources"] = [{"concept": section["section"], **section.get("source", {}), "status": section["status"],
                        **{key: section[key] for key in ("reason", "sources", "skipped") if section.get(key)},
                        **({"reference": section["binding"]} if section.get("binding") else {}),
                        "alternatives": [{key: item.get(key) for key in ("source", "provider", "plugin", "status")}
                                         for item in section.get("alternatives", [])]}
                       for section in view.pop("sections", [])]
    own = [line for line in view.get("listings", []) if not line.get("folded")]
    if own:  # the home is core's decided primary line, never the first line's guess (R2)
        view["home"] = next((line["id"] for line in own if line.get("primary")), "unknown")
        if view["home"] == "unknown":
            view["home_note"] = HOME_UNKNOWN
    queue = view.pop("queue", [])
    view["provider_tools"] = provider_tools_for(str(arguments.get("subject_id") or ""))
    if queue:
        view["open_identity_questions"] = len(queue)
    result["next"] = ("pythia_prices for quote and chart, pythia_filings for filings; a listed provider tool with "
                      "subject_id for provider depth (reported facts, fundamentals, profiles, news).")
    return encode(result)


def provider_tools_for(subject_id: str) -> list[dict]:
    """The plugins' agent tools that can serve this subject now: sources Desk's page would read for it (ready, or a
    lookup still pending), never one that is disabled, unconfigured, not covering it or in conflict."""
    from tools.registry import registry
    from .agent_depth import plugin_answer
    from .platform.access import native_tool_owners
    _path, subject, lookups, _issue = identity()._load(subject_id)
    if subject is None:
        return []
    infos, found = plugins(), []
    for name, (key, _plugin) in sorted(native_tool_owners().items()):
        entry = registry.get_entry(name)
        if not getattr(getattr(entry, "handler", None), "pythia_agent_tool", None):
            continue
        info = infos.get(key)
        answer = plugin_answer(info, subject, lookups) if info is not None else None
        if info is not None and (answer is None or answer["status"] not in ("ready", "resolving")):
            continue
        text = (registry.get_schema(name) or {}).get("description") or ""
        found.append({"tool": name, "purpose": text.split(". ")[0].rstrip(".") + "."})
    return found


# ---- the identity answer (a narrow write: a suggestion) -------------------------------------------------------------

def answer(arguments: dict, **context: Any) -> str:
    return encode(json.loads(queue_ops.submit_verdict(identity(), arguments, **context)))


def questions(arguments: dict, **context: Any) -> str:
    return encode(json.loads(queue_ops.read_queue(identity(), arguments, **context)))


def guarded(handler: Callable[..., str]) -> Callable[..., str]:
    """A core failure (reference, store, a bad argument) is a clean envelope, never exception text for the model."""
    def run(arguments: dict, **context: Any) -> str:
        try:
            return handler(arguments, **context)
        except Exception:
            logger.warning("Pythia agent tool failed", exc_info=True)
            return encode(failure("unavailable", "Pythia could not complete this request; try again."))
    return run


def register(ctx: Any) -> None:
    from .agent_reads import DOCUMENT, FILINGS, PRICES, document, filings, prices
    tools: list[tuple[dict, Callable[..., str]]] = [
        (FIND, guarded(find)), (INSTRUMENT, guarded(instrument)), (PRICES, guarded(partial(prices, ctx))),
        (FILINGS, guarded(partial(filings, ctx))), (DOCUMENT, guarded(partial(document, ctx))),
        (questions_schema(), guarded(questions)),
        (answer_schema(), guarded(answer))]
    for schema, handler in tools:
        ctx.register_tool(name=schema["name"], toolset=TOOLSET, schema=schema, handler=handler,
                          description=schema["description"].split(". ")[0])
