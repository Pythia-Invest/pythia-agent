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
import threading
from pathlib import Path
from typing import Any

from .identity import MANIFEST_FILE, ClaimError, Level, ManifestError, check_batch, validate_manifest
from .identity import batch_from_json, page, search, store

logger = logging.getLogger(__name__)
RESOLVE_TIMEOUT = 8.0
TOOLSET = "pythia-desk"
PLUGIN = "pythia"  # the core plugin (plugin.yaml)
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
        path = store.reference_path(self.data_dir)
        if path is None:
            return _envelope("empty", {"groups": [], "lookup": []}, issue="No reference data on this device yet.")
        directory = search.directory(path, store.open_reference)

        def bindings(listing_ids: list[str]) -> dict[str, list[dict]]:
            out: dict[str, list[dict]] = {}
            for row in self.store.bindings(listing_ids):
                out.setdefault(row["subject_id"], []).append({"plugin": row["plugin"], "ref": row["native_id"]})
            return out

        query = str(arguments.get("query") or "").strip()[:128]
        limit = max(1, min(50, arguments.get("limit") if isinstance(arguments.get("limit"), int) else 20))
        data = directory.search(query, limit=limit, kinds=arguments.get("kinds"), bindings=bindings) if query else {
            "groups": [], "lookup": []}
        return _envelope("ok" if data["groups"] else "empty", data)

    def subject(self, arguments: dict, **_context: Any) -> str:
        try:
            view = self._compose(str(arguments.get("subject_id") or ""))
        except ValueError:  # a malformed subject id
            view = None
        return _envelope("ok", view) if view else _envelope("empty", None, issue="Unknown subject.")

    def resolve(self, arguments: dict, **_context: Any) -> str:
        subject_id, wanted = str(arguments.get("subject_id") or ""), arguments.get("plugin")
        path, ref = self.reference()
        if ref is None:
            return _envelope("empty", None, issue="No reference data on this device yet.")
        try:
            subject = page.load_subject(ref, subject_id)
        except ValueError:
            subject = None
        finally:
            ref.close()
        info = next((item for item in installed() if wanted in (item.key, item.manifest.plugin)), None)
        if subject is None or info is None or info.manifest.resolve is None:
            return _envelope("empty", None, issue="Unknown subject or no resolving plugin.")
        reason = self._resolve(info, subject)
        sections = [section for section in self._compose(subject_id)["sections"] if section["plugin"] == info.key]
        for section in sections:
            if section["status"] == "resolving":
                section.update(status="unresolved", reason=reason or f"{info.label} found no match")
        return _envelope("ok", {"sections": sections})

    # ---- internals -----------------------------------------------------------------------------------------------

    def _compose(self, subject_id: str) -> dict | None:
        path, ref = self.reference()
        if ref is None:
            return None
        try:
            subject = page.load_subject(ref, subject_id)
            if subject is None:
                return None
            coins = {(row[0], row[1]): row[2] for row in ref.execute("SELECT provider, caip19, native_id FROM native_coins")}
        finally:
            ref.close()
        identity_store = self.store
        subject_ids = [value for value in subject["ids"].values() if value]
        stored = {(row["subject_id"], row["provider"]): row
                  for row in identity_store.bindings(subject_ids, ("confirmed", "conflicting"))}
        queue = identity_store.open_queue(subject_ids)
        sections = page.compose(subject, installed(), stored=lambda target, provider: stored.get((target, provider)),
                                coins=lambda provider, caip19: coins.get((provider, caip19)), queue=queue)
        return {**subject["view"], "sections": sections, "queue": queue}

    def _resolve(self, info: page.PluginInfo, subject: dict) -> str | None:
        """Run the plugin's resolve once; store what the authority rule decides. Returns a reason when unresolved."""
        from tools.registry import registry
        sent = page.resolve_input(info, subject)
        levels = {entry.via for entry in info.manifest.content.values()} & {level for level in Level if subject["ids"].get(level)}
        if not sent or not levels:
            return None
        call = contextvars.copy_context().run
        future = self._pool.submit(call, registry.dispatch, info.manifest.resolve.tool, {"identifiers": sent})
        try:
            raw = future.result(timeout=RESOLVE_TIMEOUT)
        except concurrent.futures.TimeoutError:
            return f"{info.label} did not answer in time"
        except Exception:  # a failing plugin never breaks the page
            logger.warning("resolve failed for %s", info.key, exc_info=True)
            return f"{info.label} lookup failed"
        try:
            result = json.loads(raw)
            if not isinstance(result, dict) or "error" in result or not result.get("data"):
                return f"{info.label} found no match"
            batch = batch_from_json(result["data"])
            check_batch(batch, info.manifest)
        except (ValueError, ClaimError) as error:
            logger.warning("resolve answer rejected for %s: %s", info.key, error)
            return f"{info.label} gave an unusable answer"
        now = store.now()
        for level in sorted(levels, key=lambda item: item != Level.LISTING):
            binding, item, records = page.apply_resolve(batch, info, level, subject, sent, now=now)
            for record in records:
                self.store.put_claim(batch.plugin, batch.provider, _claim_json(record))
            if binding is not None:
                self.store.put_binding(binding)
                return None
            if item is not None:
                self.store.put_queue_item(item)
                return f"{info.label}'s answer is queued for review ({item.reason})"
        return None


def _claim_json(record) -> dict:
    from dataclasses import asdict
    return json.loads(json.dumps(asdict(record)))


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
