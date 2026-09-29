"""Core identity operations on the native tool registry: search, subject and resolve.

`identity-search` and `identity-subject` are local reads of the reference file,
identity.sqlite3 and the installed plugins' contracts; neither calls a provider.
`identity-resolve` runs one plugin's declared resolve tool, bounded by a short
timeout, and stores the decided binding or queue item. `reference-status`
describes the installed reference package. The resolution-queue operations live
in `queue_ops`.
"""
from __future__ import annotations

import concurrent.futures
import contextvars
import json
import logging
import sqlite3
import threading
from functools import partial
from pathlib import Path
from typing import Any

from .identity import (
    MANIFEST_FILE, ClaimError, Kind, Level, ManifestError, ManifestNeedsUpdate, check_batch, subject_kind,
    validate_manifest, vouched,
)
from . import queue_ops, read_checks, search_venues
from .native_ops import native_operations, operation_tools  # noqa: F401  (the Hermes adapter, re-exported)
from .queue_ops import ISSUE_CODES, NO_REFERENCE, SUBJECT_ID, UNKNOWN_SUBJECT
from .identity import batch_from_json, batch_to_json, build_questions, lifecycle, location, markets, page, queue, reference_package, search, store
from .identity import declared, subject as subjects, trust

logger = logging.getLogger(__name__)
RESOLVE_TIMEOUT = 8.0
TOOLSET = "pythia-core"  # operations for Desk and core; the agent reaches them through agent_tools
PLUGIN = "pythia"  # the core plugin (plugin.yaml)
NO_MATCH_TTL = 24 * 3600  # a plugin that found nothing is asked again after a day
MISS_RETRY = 10 * 60      # a timeout or failure after ten minutes
PREFERENCE = "search_listing_preference"  # declared in configuration.json
SOURCE_ORDER = "source_order"             # declared in configuration.json: the investor's one source order

SEARCH_SCHEMA = {
    "name": "pythia_identity_search",
    "description": "Search the device's local directory of securities, listings and crypto assets by name, ticker "
                   "or identifier (ISIN, LEI, FIGI, CIK). Answers groups (a company, a fund or a crypto asset), "
                   "each with its most relevant listings and its total listing count. Pass `group` with a group's "
                   f"id instead of `query` to list its listings, up to {search.GROUP_ROWS}; `limit` (groups, "
                   "default 20) does not apply there. Local only; no provider is called.",
    "parameters": {"type": "object", "properties": {
        "query": {"type": "string", "minLength": 1, "maxLength": 128},
        "group": {"type": "string", "minLength": 1, "maxLength": 256},
        "kinds": {"type": "array", "items": {"type": "string", "enum": list(search.KINDS)}, "maxItems": 16},
        "limit": {"type": "integer", "minimum": 1, "maximum": 50}},
        "additionalProperties": False},
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
    """Per-process state: Pythia's store directory and the identity store, opened on first use."""

    def __init__(self, ctx: Any, data_dir: Path | None = None):  # data_dir: a test's own store directory
        self.ctx, self._data_dir = ctx, data_dir and Path(data_dir)
        self._store: store.IdentityStore | None = None
        self._rekeyed: Path | None = None  # the reference build local rows were carried to, this process
        self.reset_told = False  # whether a set-aside store was reported (once per process)
        self._lock = threading.Lock()
        self._pool = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="pythia-resolve")

    @property
    def data_dir(self) -> Path:  # <data>/store: its first use in a process moves an earlier store there (location)
        return self._data_dir or location.store_dir(Path(self.ctx.state.data_dir))

    @property
    def store(self) -> store.IdentityStore:
        with self._lock:
            if self._store is None:
                self._store = store.IdentityStore(self.data_dir)
            return self._store

    def reference_path(self, *, again: bool = False) -> Path | None:
        """The installed reference package's database. Its first use carries local rows to its subject IDs (Lifecycle A) and
        retires the previous build's open questions; a failure is retried on the next use. `again` carries rows written meanwhile under an older build's IDs."""
        path = store.reference_path(self.data_dir)
        if path is not None and (again or path != self._rekeyed):
            try:
                ref = store.open_reference(path)
                try:
                    done = lifecycle.rekey(self.store, ref, reference_package.release_key(path), again=again)
                finally:
                    ref.close()
                if done:
                    logger.info("identity store carried to reference %(release)s: %(moved)d subject IDs re-keyed, %(rows)d rows re-pointed, %(vanished)d subjects vanished", done)  # noqa: E501
                    queue.retire_build(self.store, store.now())
                self._rekeyed = path
            except (sqlite3.Error, OSError, ValueError):
                logger.warning("identity store could not be carried to %s", path.name, exc_info=True)
        return path

    def reference(self):
        path = self.reference_path()
        return (path, store.open_reference(path)) if path else (None, None)

    # ---- operations ----------------------------------------------------------------------------------------------

    def search(self, arguments: dict, **_context: Any) -> str:
        empty = {"groups": [], "lookup": []}
        query = str(arguments.get("query") or "").strip()[:128]
        group = str(arguments.get("group") or "").strip()[:256]
        limit = max(1, min(50, arguments.get("limit") if isinstance(arguments.get("limit"), int) else 20))
        try:
            path = self.reference_path()
            if path is None:
                return _envelope("empty", empty, issue=NO_REFERENCE)
            directory = search.directory(path, store.open_reference)
            kinds = arguments.get("kinds")
            data = (directory.group(group, kinds=kinds) if group
                    else directory.search(query, limit=limit, kinds=kinds, prefer=self._preference(),
                                          suffixes=search_venues.suffixes, priced=search_venues.priced) if query else empty)
        except (sqlite3.Error, OSError) as error:  # search degrades, never errors out; a closed store says why
            logger.warning("identity search unavailable", exc_info=True)
            return _envelope("empty", empty, issue=f"Search is unavailable. {location.reason(error)}")
        return _envelope("ok" if data["groups"] else "empty", data)

    def reference_status(self, _arguments: dict, **_context: Any) -> str:
        data = {**reference_package.status(self.data_dir), "both_present": location.both_present(self.data_dir)}
        return _envelope("ok", data) if data["installed"] else _envelope("empty", data, issue=NO_REFERENCE)

    def subject(self, arguments: dict, **_context: Any) -> str:
        try:
            view, issue = self._compose(str(arguments.get("subject_id") or ""))
        except ValueError:  # a malformed subject id
            view, issue = None, UNKNOWN_SUBJECT
        except (sqlite3.Error, OSError) as error:
            logger.warning("identity subject unavailable", exc_info=True)
            view, issue = None, location.reason(error)
        return _envelope("ok", view) if view else _envelope("empty", None, issue=issue)

    def resolve(self, arguments: dict, **_context: Any) -> str:
        subject_id, wanted = str(arguments.get("subject_id") or ""), arguments.get("plugin")
        try:  # the subject as its page composes it (a security or issuer through its default listing)
            path, subject, _lookups, issue = self._load(subject_id)
        except (ValueError, sqlite3.Error, OSError):
            path, subject, issue = None, None, None
        if issue == NO_REFERENCE:
            return _envelope("empty", None, issue=NO_REFERENCE)
        info = next((item for item in installed() if wanted in (item.key, item.manifest.plugin)), None)
        if subject is None or info is None or info.manifest.resolve is None:
            return _envelope("empty", None, issue="Unknown subject or no resolving plugin.")
        # A disabled or unconfigured plugin is never called; its sections already say why.
        reason, transient = self._resolve(info, subject) if info.enabled and not info.missing else (None, False)
        # A miss is kept where bindings go (each level the plugin addresses): every page and read of it sees it.
        targets = {subject["ids"].get(entry.via) for entry in info.manifest.concepts.values()} - {None}
        for target in targets if reason else ():
            self.store.put_miss(target, info.key, reason, MISS_RETRY if transient else NO_MATCH_TTL)
        if store.reference_path(self.data_dir) != path:  # a new build landed during the call: carry this answer to it
            self.reference_path(again=True)
        queue_ops.settle(self, [value for value in subject["ids"].values() if value])
        view, issue = self._compose(subject_id)
        # The sections this plugin can serve, whoever serves them now: after a miss the next source leads (ADR 0040).
        names = {str(section) for section in page.SECTIONS if page.served_by(info.manifest, section)}
        sections = [section for section in (view or {}).get("sections", []) if section["section"] in names]
        for section in sections:
            if section["status"] == "resolving" and section["plugin"] == info.key:
                section.update(status="unresolved", reason=reason or f"{info.label} is not available")
        return _envelope("ok", {"sections": sections})

    def _preference(self) -> str:
        """The investor's `search_listing_preference` (settings.json); anything else means primary."""
        from .platform import configuration
        try:
            _status, value = configuration.value(self.ctx, PREFERENCE)
        except (AttributeError, TypeError, ValueError, OSError):  # no readable declaration beside this core
            return "primary"
        return next((item for item in search.PREFERENCES if (value or "").lower() == item.lower()), "primary")

    def order(self) -> tuple[str, ...]:
        """The investor's `source_order` (settings.json): plugin ids or provider names; empty means core's order."""
        from .identity.concepts import parse_order
        from .platform import configuration
        try:
            _status, value = configuration.value(self.ctx, SOURCE_ORDER)
        except (AttributeError, TypeError, ValueError, OSError):  # no readable declaration beside this core
            return ()
        plugins = installed()  # common names ("edgar", "esef") mean the plugin; unknown names are kept as written
        return tuple(dict.fromkeys(page.named(name, plugins) or name for name in parse_order(value)))

    # ---- internals -----------------------------------------------------------------------------------------------

    def price_sources(self, subject_id: str) -> dict:
        """Where market data for a subject comes from: its asset class, the native references that serve
        its quote and chart in core's order, the providers the investor named in `source_order` and those not
        yet audited (ADR 0042), or the reason there are none. Local only."""
        try:
            path, subject, lookups, _issue = self._load(subject_id)
        except ValueError:  # a malformed subject id
            return unrouted("unknown_subject")
        except (sqlite3.Error, OSError):
            logger.warning("identity unreadable for a market-data read", exc_info=True)
            return unrouted("no_reference_data")
        if subject is None:
            # A market needs no reference file, so an unknown one is unknown, not missing reference data.
            return unrouted("unknown_subject" if path or subject_kind(subject_id) in markets.CURATED_KINDS else "no_reference_data")
        plugins = installed()
        named = [info.manifest.provider for info in plugins if info.key in lookups["order"]]
        unaudited = [info.manifest.provider for info in plugins if info.manifest.unaudited]
        return {"asset_class": subject["asset_class"], "refs": page.price_sources(subject, plugins, **lookups),
                "named": named, "unaudited": unaudited, "reason": None}

    def _compose(self, subject_id: str) -> tuple[dict | None, str | None]:
        path, subject, lookups, issue = self._load(subject_id)
        if subject is None:
            return None, issue
        security = subject["ids"].get(Level.SECURITY)
        view = subject["view"]
        view["other_securities"] = []
        if subject["level"] is not Kind.MARKET:  # the curated markets that are derivatives on it, as links
            view["related"] += markets.markets_on(markets.curated(), [value for value in subject["ids"].values() if value])
        if subject["asset_class"] == "equity" and security:  # the instrument's lines, receipts folded in
            directory = search.directory(path, store.open_reference)
            view["listings"] = directory.instrument_listings(security) or view["listings"]
            # The company's other instruments; a share class listed there is not repeated under `related`.
            view["other_securities"] = directory.other_instruments(security)
            others = {item["id"] for item in view["other_securities"]}
            view["related"] = [item for item in view["related"] if item["id"] not in others or "authority" in item]
        sections = page.compose(subject, installed(), **lookups)
        return {**subject["view"], "sections": sections, "queue": lookups["queue"]}, None

    def _load(self, subject_id: str) -> tuple[Path | None, dict | None, dict, str | None]:
        """The reference path and the subject from it, with the store lookups page composition reads."""
        if subject_kind(subject_id) in markets.CURATED_KINDS:  # a curated market subject needs no reference file
            subject = markets.load_market(markets.curated(), subject_id)
            return (None, None, {}, UNKNOWN_SUBJECT) if subject is None else (None, subject, self._lookups(subject), None)
        path, ref = self.reference()
        if ref is None:
            return None, None, {}, NO_REFERENCE
        try:
            if ":provisional:" in subject_id:  # a confirm-level contract may address it under its subject's key now
                subject_id = subjects.current_id(ref, subject_id, declared.aliases(info.manifest for info in installed()))
            subject = build_questions.load_subject(ref, subject_id, None, self.store)
            if subject is None:
                return path, None, {}, UNKNOWN_SUBJECT
            default = self._default_listing(path, subject)
            if default and default != (subject["listing"] or {"id": None})["id"]:
                subject = build_questions.load_subject(ref, subject_id, default, self.store)
        finally:
            ref.close()
        return path, subject, self._lookups(subject), None

    def _lookups(self, subject: dict) -> dict:
        """The store lookups page composition reads for a subject: bindings, queue items and misses at each level."""
        identity_store = self.store
        subject_ids = [value for value in subject["ids"].values() if value]
        stored = {(row["subject_id"], row["provider"]): row
                  for row in identity_store.bindings(subject_ids, ("confirmed", "conflicting"))}
        return {"stored": lambda target, provider: stored.get((target, provider)),
                "queue": identity_store.open_queue(subject_ids),
                "misses": {(target, plugin): reason for target in subject_ids
                           for plugin, reason in identity_store.misses(target).items()},
                "order": self.order(), **read_checks.lookups(self, subject_ids)}

    @staticmethod
    def _default_listing(path: Path, subject: dict) -> str | None:
        """The line an equity security or issuer subject is priced through: the first of the instrument's own
        lines in the listing selector's order (a flagged primary, else the best exchange line), so the page
        and market-data reads agree with the selector. None for a listing subject or anything else."""
        security = subject["ids"].get(Level.SECURITY)
        if subject["level"] == Level.LISTING or subject["asset_class"] != "equity" or not security:
            return None
        own = [line for line in search.directory(path, store.open_reference).instrument_listings(security)
               if not line["folded"]]
        return own[0]["id"] if own else None

    def _resolve(self, info: page.PluginInfo, subject: dict) -> tuple[str | None, bool]:
        """Run the plugin's resolve once; store what the authority rule decides.

        Returns (reason when nothing was found, whether the failure is transient)."""
        from tools.registry import registry
        sent = page.resolve_input(info, subject)
        levels = {entry.via for entry in info.manifest.concepts.values()} & {level for level in Level if subject["ids"].get(level)}
        tool = info.operations.get(info.manifest.resolve.operation)
        if not sent or not levels or tool is None:
            return f"{info.label} cannot look up this subject", False
        call = contextvars.copy_context().run
        future = self._pool.submit(call, registry.dispatch, tool, {"identifiers": sent})
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

        for level in sorted(levels, key=lambda item: item != Level.LISTING):
            binding, item, _records = page.apply_resolve(batch, info, level, subject, sent, now=now,
                                                         bound_to=self.store.bound_subject)
            if binding is not None:
                if self.store.put_binding(binding):
                    return None, False
                return f"{info.label}'s reference is already bound to another subject", False
            if item is not None and self.store.dismissed(item.key, item.evidence_ids):
                return f"{info.label}'s record was reviewed: it is not this instrument", False
            if item is not None:
                self.store.put_queue_item(item)  # not a miss: the open item says why, and ends with its review
                return None, False
        return f"{info.label} found no match", False


def _envelope(outcome: str, data: Any, *, issue: str | None = None) -> str:
    body: dict[str, Any] = {"schema_version": 1, "outcome": outcome, "data": data}
    if issue:
        body["issues"] = [{"code": ISSUE_CODES.get(issue) or ("unavailable" if data is None else "empty"), "message": issue}]
    return json.dumps(body, ensure_ascii=False, separators=(",", ":"))


def installed() -> list[page.PluginInfo]:
    """Every installed plugin with a valid contract.json: its native enablement, configuration and trust (by digest).

    A contract newer than this core is skipped with a distinct `needs_update` log line, never reported invalid."""
    from hermes_cli.config import load_config_readonly
    from .platform import configuration, harness
    from .platform.access import native_plugin_enabled
    config, loaded = load_config_readonly(), []
    for key, plugin in harness.plugins().items():
        directory = Path(plugin.manifest.path) if plugin.manifest.path else None
        if directory is None or not directory.is_absolute() or not (directory / MANIFEST_FILE).is_file():
            continue
        try:
            manifest = vouched(validate_manifest(json.loads((directory / MANIFEST_FILE).read_text(encoding="utf-8"))),
                               trust.level(trust.digest(directory), key))  # trust follows the files, not the name
        except ManifestNeedsUpdate as error:
            logger.warning("%s of %s needs a newer Pythia (needs_update): %s", MANIFEST_FILE, key, error)
            continue
        except (OSError, ValueError, TypeError, ManifestError) as error:  # one bad contract never hides the others
            logger.warning("ignoring invalid %s of %s: %s", MANIFEST_FILE, key, error)
            continue
        loaded.append((key, plugin, directory, manifest))
    tools = native_operations({key for key, *_ in loaded})
    return [page.PluginInfo(key=key, manifest=manifest, enabled=native_plugin_enabled(key, plugin, config),
                            missing=tuple(configuration.missing_at(directory)),
                            operations={name: tool for name, tool in tools.get(key, {}).items()
                                        if name in manifest.plugin_operations})
            for key, plugin, directory, manifest in loaded]


def unrouted(reason: str) -> dict:
    return {"asset_class": None, "refs": [], "reason": reason}


def price_sources(subject_id: str) -> dict:
    """Market-data routing for one subject through the registered core (exported as `pythia_platform.price_sources`)."""
    return CURRENT.price_sources(subject_id) if CURRENT is not None else unrouted("core_unavailable")


CURRENT: Identity | None = None  # the one registered core identity of this process


def register(ctx: Any) -> None:
    global CURRENT
    from .platform.operations import declare_operation
    identity = CURRENT = Identity(ctx)
    for schema, handler, operation, read_only in ((SEARCH_SCHEMA, identity.search, "identity-search", True),
                                                  (SUBJECT_SCHEMA, partial(queue_ops.read_subject, identity), "identity-subject", True),
                                                  (RESOLVE_SCHEMA, identity.resolve, "identity-resolve", False),
                                                  (queue_ops.QUEUE_SCHEMA, partial(queue_ops.read_queue, identity),
                                                   "identity-queue", True),
                                                  (queue_ops.VERDICT_SCHEMA, partial(queue_ops.submit_verdict, identity),
                                                   "identity-verdict", False),
                                                  (reference_package.STATUS_SCHEMA, identity.reference_status,
                                                   "reference-status", True)):
        declare_operation(schema, plugin=PLUGIN, operation=operation, handler=handler, read_only=read_only)
        ctx.register_tool(name=schema["name"], toolset=TOOLSET, schema=schema, handler=handler,
                          description=schema["description"])
    from . import concept_ops
    concept_ops.register(ctx, identity)
