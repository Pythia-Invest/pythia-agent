"""Plugin claims into core (ADR 0038, amendment "core dispatches catalogue and resolve"; ADR 0037, amendment "ingest").

`identity-sync {plugin}` pages one plugin's declared bulk catalogue, scope by scope in the order its contract lists
them, within a page and time bound. `identity-lookup {plugin, query}` sends one identifier the query names to the
plugin's resolve (the "Look up in X" backend). Both run only when asked, on one plugin at a time, with no scheduler,
and store every record through `identity.ingest`, answering its counts. `identity-resolve` stores its answer the same
way (`keep`). They are Desk operations: the agent's tool list has no room for them (test_agent_surface.py's budget).
"""
from __future__ import annotations

import concurrent.futures
import contextvars
import json
import logging
import sqlite3
import time
from functools import partial
from typing import TYPE_CHECKING, Any, Iterable

from .identity import CatalogueMode, ClaimError, RecordClaim, batch_from_json
from .identity import ingest, search_device

if TYPE_CHECKING:
    from .identity_ops import Identity

logger = logging.getLogger(__name__)
SYNC_PAGES, SYNC_SECONDS, LOOKUP_SECONDS = 50, 120.0, 20.0
PLUGIN_ID = {"type": "string", "minLength": 1, "maxLength": 128}
SYNC_SCHEMA = {
    "name": "pythia_identity_sync",
    "description": "Read one plugin's bulk catalogue into the device's identity store. Each record joins the subject "
                   "its identifiers name, introduces one the plugin's contract declares, or stays unmatched; answers "
                   "the counts. Calls that plugin's provider, a bounded number of pages.",
    "parameters": {"type": "object", "properties": {"plugin": PLUGIN_ID}, "required": ["plugin"],
                   "additionalProperties": False},
}
LOOKUP_SCHEMA = {
    "name": "pythia_identity_lookup",
    "description": "Look one identifier (ISIN, FIGI, LEI or CIK) up in one plugin and store every record it answers, "
                   "as identity-sync does; answers the counts and the subjects placed. Calls that plugin's provider once.",
    "parameters": {"type": "object", "properties": {"plugin": PLUGIN_ID, "query": {"type": "string", "minLength": 1,
                                                                                   "maxLength": 128}},
                   "required": ["plugin", "query"], "additionalProperties": False},
}


def register(ctx: Any, identity: Identity) -> None:
    from .identity_ops import PLUGIN, TOOLSET
    from .platform.operations import declare_operation
    for schema, handler, operation in ((SYNC_SCHEMA, partial(sync, identity), "identity-sync"),
                                       (LOOKUP_SCHEMA, partial(lookup, identity), "identity-lookup")):
        declare_operation(schema, plugin=PLUGIN, operation=operation, handler=handler, read_only=False)
        ctx.register_tool(name=schema["name"], toolset=TOOLSET, schema=schema, handler=handler,
                          description=schema["description"])


def keep(identity: Identity, info, batch, seen: Iterable[tuple[str, str]] = ()) -> dict:
    """Store one plugin batch through ingest, against the installed reference."""
    from .identity_ops import installed
    _path, ref = identity.reference()
    try:
        return ingest.ingest(identity.store, ref, info, batch, plugins=installed(), seen=seen)
    finally:
        if ref is not None:
            ref.close()


def sync(identity: Identity, arguments: dict, **_context: Any) -> str:
    """identity-sync: every declared catalogue scope, in the contract's order (a DeFi source's protocols before the
    pools that name them), page by page, until the scope ends or the bound is reached (`partial`)."""
    from .identity_ops import _envelope
    info, issue = _usable(arguments.get("plugin"))
    manifest = info and info.manifest
    tool = manifest and manifest.catalogue is CatalogueMode.BULK and info.operations.get(manifest.catalogue_operation)
    if info is None or not tool:
        return _envelope("empty", None, issue=issue or f"{info.label} has no catalogue core can read.")
    totals: dict[str, Any] = dict.fromkeys(ingest.COUNTS, 0) | {"pages": 0, "partial": False}
    deadline = time.monotonic() + SYNC_SECONDS
    try:
        for scope in manifest.catalogue_scopes:
            cursor, seen = None, set()
            while True:
                if totals["pages"] >= SYNC_PAGES or time.monotonic() >= deadline:
                    totals["partial"] = True
                    return _envelope("ok", totals)
                try:
                    result = _call(identity, tool, {"scope": scope, **({"cursor": cursor} if cursor else {})},
                                   deadline - time.monotonic())
                except LookupError:  # an empty page ends the scope
                    break
                batch = batch_from_json(result["data"])
                if batch.scope != scope:
                    raise ClaimError(f"batch: a page of {scope} names scope {batch.scope}")
                done = keep(identity, info, batch, seen)
                seen |= {(ref.native_scope, ref.native_id) for claim in batch.claims if isinstance(claim, RecordClaim)
                         and (ref := ingest.claim_ref(info.manifest.provider, claim))}
                totals.update({name: totals[name] + done[name] for name in ingest.COUNTS}, pages=totals["pages"] + 1)
                cursor = result.get("next_cursor")
                if not cursor:
                    break
    except (concurrent.futures.TimeoutError, PluginFailed, ValueError, ClaimError, sqlite3.Error, OSError) as error:
        logger.warning("identity sync of %s stopped: %s", info.key, error)
        return _stopped({**totals, "partial": True}, f"{info.label}'s catalogue stopped: {_why(error)}")
    return _envelope("ok", totals)


def lookup(identity: Identity, arguments: dict, **_context: Any) -> str:
    """identity-lookup: the query's identifier in a scheme the plugin's resolve accepts (`search_device.identifier`),
    sent to it once; every record it answers is stored, joined or introduced like a catalogue's."""
    from .identity_ops import _envelope
    info, issue = _usable(arguments.get("plugin"))
    if info is None:
        return _envelope("empty", None, issue=issue)
    query = str(arguments.get("query") or "").strip()[:128]
    resolve = info.manifest.resolve
    tool = resolve and info.operations.get(resolve.operation)
    scheme, value = (tool and search_device.identifier(query, resolve)) or (None, None)
    if value is None:
        return _envelope("empty", None, issue=f"{info.label} cannot look up {query or 'nothing'}.")
    try:
        result = _call(identity, tool, {"identifiers": {scheme: value}}, LOOKUP_SECONDS)
        batch = batch_from_json(result["data"])
        done = keep(identity, info, batch)
    except LookupError:  # an answer, not a failure: the counts are all zero
        return _envelope("empty", {**dict.fromkeys(ingest.COUNTS, 0), "subjects": []},
                         issue=f"{info.label} found no match.")
    except (concurrent.futures.TimeoutError, PluginFailed, ValueError, ClaimError, sqlite3.Error, OSError) as error:
        logger.warning("identity lookup in %s failed: %s", info.key, error)
        return _envelope("empty", None, issue=f"{info.label} lookup failed: {_why(error)}")
    return _envelope("ok", done)


def _usable(wanted: Any) -> tuple[Any, str | None]:
    """The installed plugin a request names, if core may call it now, else the reason."""
    from .identity_ops import installed
    info = next((item for item in installed() if wanted in (item.key, item.manifest.plugin)), None)
    if info is None:
        return None, "Unknown plugin."
    if not info.enabled or info.missing:
        return None, f"{info.label} is {'disabled' if not info.enabled else 'not configured'}."
    return info, None


class PluginFailed(Exception):
    """The plugin's operation reported a failure (`outcome: error`, or an error answer): never "no records"."""


def _call(identity: Identity, tool: str, arguments: dict, seconds: float) -> dict:
    """Run one plugin operation for core, bounded in time; its answer's `data` is a claim batch. PluginFailed when it
    reports a failure, LookupError when it answered nothing."""
    from tools.registry import registry
    future = identity._pool.submit(contextvars.copy_context().run, registry.dispatch, tool, arguments)
    result = json.loads(future.result(timeout=max(0.1, seconds)))
    if not isinstance(result, dict):
        raise ValueError("an answer that is not an object")
    if "error" in result or result.get("outcome") == "error":
        raise PluginFailed("the plugin reported an error")
    if not result.get("data"):
        raise LookupError("no records")
    return result


def _stopped(data: dict, message: str) -> str:
    """A sync the source's failure stopped: what it placed, and the failure (`unavailable`, as `_envelope` codes one
    with no data)."""
    return json.dumps({"schema_version": 1, "outcome": "ok", "data": data,
                       "issues": [{"code": "unavailable", "message": message}]}, ensure_ascii=False, separators=(",", ":"))


def _why(error: BaseException) -> str:
    return "no answer in time" if isinstance(error, concurrent.futures.TimeoutError) else \
        "the source reported an error" if isinstance(error, PluginFailed) else "an unusable answer"
