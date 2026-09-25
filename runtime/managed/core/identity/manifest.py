"""Plugin addressing and content contract (ADR 0038): `contract.json` and its validator.

A plugin ships a static `contract.json` at its package root, beside `plugin.yaml`
and its `configuration.json`. The core evaluates it without running plugin code,
so addressing and section selection work for disabled plugins too. Native Hermes
stays the authority for discovery and enablement.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Mapping

from .schemes import MIC, NAMESPACE, SCHEME_LEVEL, Level, Scheme
from .vocabulary import AssetClass

MANIFEST_FILE = "contract.json"
TOOL = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
DEPTH = {Level.ISSUER: 0, Level.SECURITY: 1, Level.COMPOSITE: 2, Level.LISTING: 3}


class Section(StrEnum):
    """POC page sections. Exactly one plugin serves a section, chosen by user preference."""

    QUOTE = "quote"
    CHART = "chart"
    PROFILE = "profile"
    FINANCIALS = "financials"
    NEWS = "news"


class CatalogueMode(StrEnum):
    BULK = "bulk"                  # pages typed records onto the device
    RESOLVE_ONLY = "resolve_only"  # the default: only records the user picked are kept


@dataclass(frozen=True, slots=True)
class NativeScope:
    native_scope: str
    level: Level
    asset_classes: tuple[AssetClass, ...]


@dataclass(frozen=True, slots=True)
class ContentEntry:
    level: Level  # the level the data is about (financials: issuer)
    via: Level    # the level of the reference used to call (financials: a listing symbol)
    tool: str


@dataclass(frozen=True, slots=True)
class Resolve:
    tool: str
    input_schemes: tuple[Scheme, ...]
    echoes: tuple[Scheme, ...]  # identifiers an answer only repeats from the query: never evidence


@dataclass(frozen=True, slots=True)
class Manifest:
    plugin: str
    provider: str
    native: tuple[NativeScope, ...]
    schemes: Mapping[Level, tuple[Scheme, ...]]
    mic_table: Mapping[str, str]  # MIC -> the provider's venue code or symbol suffix
    content: Mapping[Section, ContentEntry]
    catalogue: CatalogueMode
    catalogue_tool: str | None
    catalogue_scopes: tuple[str, ...]
    resolve: Resolve | None

    def native_scope(self, native_scope: str) -> NativeScope | None:
        return next((item for item in self.native if item.native_scope == native_scope), None)


class ManifestError(ValueError):
    pass


def _object(value: Any, path: str, required: set[str], optional: set[str] = frozenset()) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ManifestError(f"{path}: object required")
    for name in sorted(set(value) - required - optional):
        raise ManifestError(f"{path}.{name}: unknown field")
    for name in sorted(required - set(value)):
        raise ManifestError(f"{path}.{name}: required")
    return value


def _match(pattern: re.Pattern[str], value: Any, path: str) -> str:
    if not isinstance(value, str) or not pattern.match(value):
        raise ManifestError(f"{path}: malformed value")
    return value


def _enum(kind: type[StrEnum], value: Any, path: str) -> Any:
    try:
        return kind(value)
    except (ValueError, TypeError):
        raise ManifestError(f"{path}: expected one of {', '.join(kind)}") from None


def _enums(kind: type[StrEnum], value: Any, path: str) -> tuple[Any, ...]:
    if not isinstance(value, list):
        raise ManifestError(f"{path}: list required")
    items = tuple(_enum(kind, item, path) for item in value)
    if len(set(items)) != len(items):
        raise ManifestError(f"{path}: duplicate values")
    return items


def validate_manifest(document: Any) -> Manifest:
    """Validate a parsed `contract.json`; raise ManifestError naming the first bad path."""
    body = _object(document, "manifest", {"plugin", "provider", "addressing"}, {"content", "catalogue", "resolve"})
    addressing = _object(body["addressing"], "addressing", set(), {"native", "schemes", "mic_table"})
    native = []
    if not isinstance(addressing.get("native", []), list):
        raise ManifestError("addressing.native: list required")
    for index, item in enumerate(addressing.get("native", [])):
        path = f"addressing.native[{index}]"
        entry = _object(item, path, {"native_scope", "level"}, {"asset_classes"})
        native.append(NativeScope(_match(NAMESPACE, entry["native_scope"], f"{path}.native_scope"),
                                  _enum(Level, entry["level"], f"{path}.level"),
                                  _enums(AssetClass, entry.get("asset_classes", []), f"{path}.asset_classes")))
    if len({item.native_scope for item in native}) != len(native):
        raise ManifestError("addressing.native: duplicate native_scope")
    schemes = {}
    for key, listed in _object(addressing.get("schemes", {}), "addressing.schemes", set(), set(Level)).items():
        schemes[Level(key)] = _enums(Scheme, listed, f"addressing.schemes.{key}")
        for scheme in schemes[Level(key)]:
            if SCHEME_LEVEL[scheme] is not Level(key):
                raise ManifestError(f"addressing.schemes.{key}: {scheme} identifies a {SCHEME_LEVEL[scheme]}")
    table = addressing.get("mic_table", {})
    mic_table = {_match(MIC, mic, "addressing.mic_table"): code
                 for mic, code in _object(table, "addressing.mic_table", set(), set(table)).items()}
    if not all(isinstance(code, str) and len(code) <= 16 for code in mic_table.values()):
        raise ManifestError("addressing.mic_table: provider venue codes are short text")

    catalogue = _object(body.get("catalogue", {"mode": "resolve_only"}), "catalogue", {"mode"}, {"tool", "scopes"})
    mode = _enum(CatalogueMode, catalogue["mode"], "catalogue.mode")
    scopes = catalogue.get("scopes", [])
    bulk = mode is CatalogueMode.BULK
    if bulk != ("tool" in catalogue) or bulk != bool(scopes) or not isinstance(scopes, list):
        raise ManifestError("catalogue: a bulk catalogue, and only it, names a tool and its scopes")
    tool = _match(TOOL, catalogue["tool"], "catalogue.tool") if "tool" in catalogue else None
    scopes = tuple(_match(NAMESPACE, scope, "catalogue.scopes") for scope in scopes)
    resolve = None
    if "resolve" in body:
        entry = _object(body["resolve"], "resolve", {"tool", "input_schemes", "echoes"})
        resolve = Resolve(_match(TOOL, entry["tool"], "resolve.tool"),
                          _enums(Scheme, entry["input_schemes"], "resolve.input_schemes"),
                          _enums(Scheme, entry["echoes"], "resolve.echoes"))
    for index, item in enumerate(native):
        if not (bulk or resolve or (item.level is Level.LISTING and mic_table)):
            raise ManifestError(f"addressing.native[{index}]: no catalogue, resolve or MIC table produces these refs")

    addressable = {item.level for item in native} | {level for level, listed in schemes.items() if listed}
    addressable |= {Level.LISTING} if mic_table else set()
    content = {}
    for key, item in _object(body.get("content", {}), "content", set(), set(Section)).items():
        path = f"content.{key}"
        entry = _object(item, path, {"level", "via", "tool"})
        level, via = _enum(Level, entry["level"], f"{path}.level"), _enum(Level, entry["via"], f"{path}.via")
        if DEPTH[via] < DEPTH[level] or via not in addressable:
            raise ManifestError(f"{path}.via: the plugin cannot address {level} data through a {via}")
        content[Section(key)] = ContentEntry(level, via, _match(TOOL, entry["tool"], f"{path}.tool"))
    return Manifest(_match(NAMESPACE, body["plugin"], "manifest.plugin"),
                    _match(NAMESPACE, body["provider"], "manifest.provider"),
                    tuple(native), schemes, mic_table, content, mode, tool, scopes, resolve)
