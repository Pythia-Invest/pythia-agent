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

SUBJECT = {"type": "string", "minLength": 5, "maxLength": 370,
           "description": "A subject id from pythia_find, such as listing:… or security:…"}
SOURCE = {"type": "string", "minLength": 2, "maxLength": 64,
          "description": "Read only this source (a provider name such as yahoo or sec). Without it, the first "
                         "source in Pythia's order that serves the subject is used; nothing falls back."}

FIND = {
    "name": "pythia_find",
    "description": "Find companies, securities, funds, listings and crypto assets in the investor's local reference by "
                   "name, ticker, ISIN, LEI, CIK or FIGI. Start here for any investment the user names. Each row carries "
                   "its subject id (pass it to the other pythia tools), ticker, venue and key identifiers. Local only; "
                   "no provider is called. A row is a candidate: check name and venue before relying on it.",
    "parameters": {"type": "object", "properties": {
        "query": {"type": "string", "minLength": 1, "maxLength": 128},
        "kinds": {"type": "array", "maxItems": 16, "items": {"type": "string"},
                  "description": "Optional instrument kinds, such as ordinary, etf, fund or coin."},
        "limit": {"type": "integer", "minimum": 1, "maximum": 25}},
        "required": ["query"], "additionalProperties": False},
}
INSTRUMENT = {
    "name": "pythia_instrument",
    "description": "Everything Pythia knows locally about one investment: identifiers (ISIN, LEI, CIK, FIGI), issuer, "
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
            "description": "Record the agent's provisional answer to one open identity question after reading it in "
                           "full with `pythia identity queue`. "
                           + queue_ops.VERDICT_SCHEMA["description"].split(". ", 1)[1]}



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


# Common names for a source, as an investor or the model says them, mapped to its contract provider.
ALIASES = {"esef": "xbrl-filings", "xbrl": "xbrl-filings", "filings.xbrl.org": "xbrl-filings", "edgar": "sec",
           "sec edgar": "sec", "cmc": "coinmarketcap", "yahoo finance": "yahoo", "eod": "eodhd"}


def source_key(name: Any, infos: dict[str, Any]) -> str | None:
    """The plugin key a source name means: its key, its key without `pythia-`, its provider, its label or an alias."""
    wanted = str(name or "").strip().lower()
    wanted = ALIASES.get(wanted, wanted)
    for key, info in infos.items():
        if wanted in (key.lower(), key.lower().removeprefix("pythia-"), info.manifest.provider, info.label.lower()):
            return key
    return None


def unknown_source(name: Any, infos: dict[str, Any]) -> dict:
    known = sorted({info.manifest.provider for info in infos.values()})
    return failure("unknown_source", f"No source named '{name}'. Sources: {', '.join(known)}.")


def plugins() -> dict[str, Any]:
    """The installed contracts by plugin key, read once per tool call."""
    return {info.key: info for info in identity_ops.installed()}


def label(plugin_key: str, infos: dict[str, Any]) -> dict:
    info = infos.get(plugin_key)
    provider = info.manifest.provider if info else plugin_key
    return {"source": page.LABELS.get(provider, provider), "provider": provider, "plugin": plugin_key}


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
    for row in (result.get("data") or {}).get("rows", []):
        row.pop("bindings", None)  # Desk's confirmed provider bindings; the agent reads through subject ids
    (result.get("data") or {}).pop("lookup", None)
    if result.get("outcome") == "ok":
        result["next"] = ("pythia_instrument for a row's identifiers, listings and sources; pythia_prices, "
                          "pythia_filings and `pythia help` take its subject id.")
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
    queue = view.pop("queue", [])
    view["functions"] = functions_for(str(arguments.get("subject_id") or ""), bool(queue))
    if queue:
        view["open_identity_questions"] = len(queue)
    result["next"] = ("pythia_prices for quote and chart, pythia_filings for filings; run a listed function with "
                      "`pythia` and args {subject_id} for provider depth.")
    return encode(result)


def functions_for(subject_id: str, questions: bool) -> list[dict]:
    """The `pythia` functions that can serve this subject now: enabled, configured sources that address it."""
    from .pythia_command import catalog, status, summary
    _path, subject, _lookups, _issue = identity()._load(subject_id)
    if subject is None:
        return []
    found = []
    for source, (_text, info, functions) in catalog().items():
        if info is None:
            reachable = questions  # core's identity queue, when this subject has open questions
        else:
            reachable = status(info) is None and any(
                subject["ids"].get(scope.level) and (not scope.asset_classes or subject["asset_class"] in scope.asset_classes)
                for scope in info.manifest.native)
        found += [{"command": f"pythia {source} {name}", "purpose": summary(tool)}
                  for name, tool in functions.items() if reachable and tool]
    return found


# ---- the identity answer (a narrow, provisional write) --------------------------------------------------------------

def answer(arguments: dict, **context: Any) -> str:
    return encode(json.loads(queue_ops.submit_verdict(identity(), arguments, **context)))


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
    from .agent_reads import FILINGS, PRICES, filings, prices
    from .pythia_command import SCHEMA as PYTHIA, command
    tools: list[tuple[dict, Callable[..., str]]] = [
        (FIND, guarded(find)), (INSTRUMENT, guarded(instrument)), (PRICES, guarded(partial(prices, ctx))),
        (FILINGS, guarded(partial(filings, ctx))), (PYTHIA, partial(command, ctx)), (answer_schema(), guarded(answer))]
    for schema, handler in tools:
        ctx.register_tool(name=schema["name"], toolset=TOOLSET, schema=schema, handler=handler,
                          description=schema["description"].split(". ")[0])
