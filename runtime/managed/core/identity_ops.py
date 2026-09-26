"""Core identity operations on the native tool registry: search, subject and resolve.

`identity-search` and `identity-subject` are local reads of the reference file,
identity.sqlite3 and the installed plugins' contracts; neither calls a provider.
`identity-resolve` runs one plugin's declared resolve tool, bounded by a short
timeout, and stores the decided binding or queue item.
"""
from __future__ import annotations

import concurrent.futures
import contextvars
import json
import logging
import sqlite3
import threading
from pathlib import Path
from typing import Any

from .identity import MANIFEST_FILE, ClaimError, Level, ManifestError, check_batch, validate_manifest
from .identity import batch_from_json, batch_to_json, page, search, store

logger = logging.getLogger(__name__)
RESOLVE_TIMEOUT = 8.0
TOOLSET = "pythia-desk"
PLUGIN = "pythia"  # the core plugin (plugin.yaml)
NO_REFERENCE = "No reference data on this device yet."
NO_MATCH_TTL = 24 * 3600  # a plugin that found nothing is asked again after a day
MISS_RETRY = 10 * 60      # a timeout or failure after ten minutes
SUBJECT_ID = {"type": "string", "minLength": 4, "maxLength": 320, "pattern": "^(issuer|security|composite|listing):"}

SEARCH_SCHEMA = {
    "name": "pythia_identity_search",
    "description": "Search the device's local directory of securities, listings and crypto assets by name, ticker "
                   "or identifier (ISIN, LEI, FIGI, CIK). Local only; no provider is called.",
    "parameters": {"type": "object", "properties": {
        "query": {"type": "string", "minLength": 1, "maxLength": 128},
        "kinds": {"type": "array", "items": {"type": "string", "enum": list(search.KINDS)}, "maxItems": 16},
        "limit": {"type": "integer", "minimum": 1, "maximum": 50}},
        "required": ["query", "limit"], "additionalProperties": False},
}
SUBJECT_SCHEMA = {
    "name": "pythia_identity_subject",
    "description": "Describe one subject (listing, security, issuer or crypto asset) by its subject id: identifiers, "
                   "sibling listings, and which plugin serves each page section. Local only.",
    "parameters": {"type": "object", "properties": {"subject_id": SUBJECT_ID},
                   "required": ["subject_id"], "additionalProperties": False},
}
RESOLVE_SCHEMA = {
    "name": "pythia_identity_resolve",
    "description": "Ask one plugin to resolve a subject to its native reference, and store the decided binding or "
                   "review item. Calls that plugin's provider once.",
    "parameters": {"type": "object", "properties": {
        "subject_id": SUBJECT_ID, "plugin": {"type": "string", "minLength": 1, "maxLength": 128}},
        "required": ["subject_id", "plugin"], "additionalProperties": False},
}


class Identity:
    """Per-process state: the core data directory and the identity store, opened on first use."""

    def __init__(self, ctx: Any):
        self.ctx = ctx
        self._store: store.IdentityStore | None = None
        self._lock = threading.Lock()
        self._pool = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="pythia-resolve")

    @property
    def data_dir(self) -> Path:
        return Path(self.ctx.state.data_dir)  # native, profile-scoped plugin data directory

    @property
    def store(self) -> store.IdentityStore:
        with self._lock:
            if self._store is None:
                self._store = store.IdentityStore(self.data_dir)
            return self._store

    def reference(self):
        path = store.reference_path(self.data_dir)
        return (path, store.open_reference(path)) if path else (None, None)

    # ---- operations ----------------------------------------------------------------------------------------------

    def search(self, arguments: dict, **_context: Any) -> str:
        empty = {"groups": [], "lookup": []}
        query = str(arguments.get("query") or "").strip()[:128]
        limit = max(1, min(50, arguments.get("limit") if isinstance(arguments.get("limit"), int) else 20))
        try:
            path = store.reference_path(self.data_dir)
            if path is None:
                return _envelope("empty", empty, issue=NO_REFERENCE)
            directory = search.directory(path, store.open_reference)
            data = directory.search(query, limit=limit, kinds=arguments.get("kinds"), bindings=self._bindings) if query else empty
        except (sqlite3.Error, OSError):  # search degrades, never errors out
            logger.warning("identity search unavailable", exc_info=True)
            return _envelope("empty", empty, issue="Search is unavailable: the reference data could not be read.")
        return _envelope("ok" if data["groups"] else "empty", data)

    def subject(self, arguments: dict, **_context: Any) -> str:
        try:
            view, issue = self._compose(str(arguments.get("subject_id") or ""))
        except ValueError:  # a malformed subject id
            view, issue = None, "Unknown subject."
        except (sqlite3.Error, OSError):
            logger.warning("identity subject unavailable", exc_info=True)
            view, issue = None, "The reference data could not be read."
        return _envelope("ok", view) if view else _envelope("empty", None, issue=issue)

    def resolve(self, arguments: dict, **_context: Any) -> str:
        subject_id, wanted = str(arguments.get("subject_id") or ""), arguments.get("plugin")
        try:
            path, ref = self.reference()
            if ref is None:
                return _envelope("empty", None, issue=NO_REFERENCE)
            try:
                subject = page.load_subject(ref, subject_id)
            finally:
                ref.close()
        except (ValueError, sqlite3.Error, OSError):
            subject = None
        info = next((item for item in installed() if wanted in (item.key, item.manifest.plugin)), None)
        if subject is None or info is None or info.manifest.resolve is None:
            return _envelope("empty", None, issue="Unknown subject or no resolving plugin.")
        # A disabled or unconfigured plugin is never called; its sections already say why.
        reason, transient = self._resolve(info, subject) if info.enabled and not info.missing else (None, False)
        if reason:  # remember the miss so reopening the page does not call the provider again
            self.store.put_miss(subject_id, info.key, reason, MISS_RETRY if transient else NO_MATCH_TTL)
        view, issue = self._compose(subject_id)
        sections = [section for section in (view or {}).get("sections", []) if section["plugin"] == info.key]
        for section in sections:
            if section["status"] == "resolving":
                section.update(status="unresolved", reason=reason or f"{info.label} is not available")
        return _envelope("ok", {"sections": sections})

    def _bindings(self, listing_ids: list[str]) -> dict[str, list[dict]]:
        """Confirmed bindings for search rows; optional, so a store problem only drops them."""
        out: dict[str, list[dict]] = {}
        try:
            rows = self.store.bindings(listing_ids)
        except sqlite3.Error:
            logger.warning("identity store unreadable; search rows carry no bindings", exc_info=True)
            return out
        for row in rows:
            out.setdefault(row["subject_id"], []).append({"plugin": row["plugin"], "ref": row["native_id"]})
        return out

    # ---- internals -----------------------------------------------------------------------------------------------

    def _compose(self, subject_id: str) -> tuple[dict | None, str | None]:
        path, ref = self.reference()
        if ref is None:
            return None, NO_REFERENCE
        try:
            subject = page.load_subject(ref, subject_id)
            if subject is None:
                return None, "Unknown subject."
            coins = {(row[0], row[1]): row[2] for row in ref.execute("SELECT provider, caip19, native_id FROM native_coins")}
        finally:
            ref.close()
        identity_store = self.store
        subject_ids = [value for value in subject["ids"].values() if value]
        stored = {(row["subject_id"], row["provider"]): row
                  for row in identity_store.bindings(subject_ids, ("confirmed", "conflicting"))}
        queue = identity_store.open_queue(subject_ids)
        sections = page.compose(subject, installed(), stored=lambda target, provider: stored.get((target, provider)),
                                coins=lambda provider, caip19: coins.get((provider, caip19)), queue=queue,
                                misses=identity_store.misses(subject_id))
        return {**subject["view"], "sections": sections, "queue": queue}, None

    def _resolve(self, info: page.PluginInfo, subject: dict) -> tuple[str | None, bool]:
        """Run the plugin's resolve once; store what the authority rule decides.

        Returns (reason when unresolved, whether the failure is transient)."""
        from tools.registry import registry
        sent = page.resolve_input(info, subject)
        levels = {entry.via for entry in info.manifest.content.values()} & {level for level in Level if subject["ids"].get(level)}
        if not sent or not levels:
            return f"{info.label} cannot look up this subject", False
        call = contextvars.copy_context().run
        future = self._pool.submit(call, registry.dispatch, info.manifest.resolve.tool, {"identifiers": sent})
        try:
            raw = future.result(timeout=RESOLVE_TIMEOUT)
        except concurrent.futures.TimeoutError:
            return f"{info.label} did not answer in time", True
        except Exception:  # a failing plugin never breaks the page
            logger.warning("resolve failed for %s", info.key, exc_info=True)
            return f"{info.label} lookup failed", True
        try:
            result = json.loads(raw)
            if not isinstance(result, dict) or "error" in result or not result.get("data"):
                return f"{info.label} found no match", False
            batch = batch_from_json(result["data"])
            check_batch(batch, info.manifest)
        except (ValueError, ClaimError) as error:
            logger.warning("resolve answer rejected for %s: %s", info.key, error)
            return f"{info.label} gave an unusable answer", False
        now = store.now()
        for claim in batch_to_json(batch)["claims"]:
            self.store.put_claim(batch.plugin, batch.provider, claim)

        def bound_to(ref):
            row = self.store.binding_for(ref)
            return row["subject_id"] if row is not None and row["status"] == "confirmed" else None

        for level in sorted(levels, key=lambda item: item != Level.LISTING):
            binding, item, _records = page.apply_resolve(batch, info, level, subject, sent, now=now, bound_to=bound_to)
            if binding is not None:
                if self.store.put_binding(binding):
                    return None, False
                return f"{info.label}'s reference is already bound to another subject", False
            if item is not None:
                self.store.put_queue_item(item)
                return f"{info.label}'s answer is queued for review ({item.reason})", False
        return f"{info.label} found no match", False


def _envelope(outcome: str, data: Any, *, issue: str | None = None) -> str:
    body: dict[str, Any] = {"schema_version": 1, "outcome": outcome, "data": data}
    if issue:
        body["issues"] = [{"code": "unavailable" if data is None else "empty", "message": issue}]
    return json.dumps(body, ensure_ascii=False, separators=(",", ":"))


def installed() -> list[page.PluginInfo]:
    """Every installed plugin that ships a valid contract.json, with its native enablement and configuration."""
    from hermes_cli.config import load_config_readonly
    from hermes_cli.plugins import get_plugin_manager
    from tools.registry import registry
    from .platform import configuration
    from .platform.access import native_plugin_enabled
    from .platform.operations import declaration
    config, found = load_config_readonly(), []
    for key, plugin in tuple(get_plugin_manager()._plugins.items()):
        directory = Path(plugin.manifest.path) if plugin.manifest.path else None
        if directory is None or not directory.is_absolute() or not (directory / MANIFEST_FILE).is_file():
            continue
        try:
            manifest = validate_manifest(json.loads((directory / MANIFEST_FILE).read_text(encoding="utf-8")))
        except (OSError, ValueError, ManifestError) as error:
            logger.warning("ignoring invalid %s of %s: %s", MANIFEST_FILE, key, error)
            continue
        operations = {}
        for entry in manifest.content.values():
            schema = registry.get_schema(entry.tool) if entry.tool in registry.get_all_tool_names() else None
            meta = declaration(schema) if schema else None
            if isinstance(meta, dict):
                operations[entry.tool] = meta["operation"]
        found.append(page.PluginInfo(key=key, manifest=manifest, enabled=native_plugin_enabled(key, plugin, config),
                                     missing=tuple(configuration.missing_at(directory)), operations=operations))
    return found


def register(ctx: Any) -> None:
    from .platform import declare_operation
    identity = Identity(ctx)
    for schema, handler, operation, read_only in ((SEARCH_SCHEMA, identity.search, "identity-search", True),
                                                  (SUBJECT_SCHEMA, identity.subject, "identity-subject", True),
                                                  (RESOLVE_SCHEMA, identity.resolve, "identity-resolve", False)):
        declare_operation(schema, plugin=PLUGIN, operation=operation, handler=handler, read_only=read_only)
        ctx.register_tool(name=schema["name"], toolset=TOOLSET, schema=schema, handler=handler,
                          description=schema["description"])
