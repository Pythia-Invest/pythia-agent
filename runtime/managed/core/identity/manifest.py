"""Plugin addressing and content contract (ADR 0038): manifest schema and validator.

A plugin ships a static `contract.json` at its package root, beside `plugin.yaml`
and its separate `configuration.json` (settings, owned by the configuration
contract). The core evaluates it without running plugin code, so addressing,
section selection and coverage hints work for disabled plugins too. Native Hermes
stays the authority for discovery and enablement; this file only describes what
a package can do.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Mapping

from .schemes import MIC, NAMESPACE, SCHEME_LEVEL, Level, Scheme
from .vocabulary import AssetClass, Redistribution, VerdictRelation

MANIFEST_FILE = "contract.json"
TOOL = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
LEVEL_DEPTH = {Level.ISSUER: 0, Level.SECURITY: 1, Level.COMPOSITE: 2, Level.LISTING: 3}


class Section(StrEnum):
    """Page sections. Exactly one plugin serves a section, chosen by user preference."""

    QUOTE = "quote"
    CHART = "chart"
    PROFILE = "profile"
    FINANCIALS = "financials"      # as-reported statements and facts
    FUNDAMENTALS = "fundamentals"  # normalized ratios and metrics
    FILINGS = "filings"
    NEWS = "news"
    ESTIMATES = "estimates"
    TRANSCRIPTS = "transcripts"
    DIVIDENDS = "dividends"
    OWNERSHIP = "ownership"
    RATINGS = "ratings"
    EVENTS = "events"


class CatalogueMode(StrEnum):
    BULK = "bulk"                  # pages typed rows into a local overlay
    RESOLVE_ONLY = "resolve_only"  # the provider forbids local caching: only bindings are kept


@dataclass(frozen=True, slots=True)
class PageBudget:
    max_reads: int = 6
    max_resolves: int = 3
    max_resolves_per_plugin: int = 1
    resolve_wall_seconds: float = 5.0


PAGE_BUDGET = PageBudget()


@dataclass(frozen=True, slots=True)
class NativeScope:
    native_scope: str
    level: Level
    asset_classes: tuple[AssetClass, ...]


@dataclass(frozen=True, slots=True)
class VenueCode:
    code: str | None
    suffix: str | None


@dataclass(frozen=True, slots=True)
class SymbolRules:
    class_separator: str | None
    pad: Mapping[str, int]
    strip_trailing_dot: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class Addressing:
    native: tuple[NativeScope, ...]
    schemes: Mapping[Level, tuple[Scheme, ...]]
    mic_table: Mapping[str, VenueCode]
    composites: tuple[str, ...]
    symbol_rules: SymbolRules


@dataclass(frozen=True, slots=True)
class ContentEntry:
    section: Section
    level: Level  # the level the data is about (fundamentals: issuer)
    via: Level    # the level of the reference used to call (fundamentals: a listing symbol)
    tool: str
    operation: str | None


@dataclass(frozen=True, slots=True)
class Catalogue:
    mode: CatalogueMode
    tool: str | None
    scopes: tuple[str, ...]
    max_age_seconds: int | None
    binding_ttl_seconds: int | None
    redistribution: Redistribution


@dataclass(frozen=True, slots=True)
class Resolve:
    tool: str
    input_schemes: tuple[Scheme, ...]
    echoes: tuple[Scheme, ...]
    calls: int
    credits: int


@dataclass(frozen=True, slots=True)
class ResolverDeclaration:
    """A plugin that can answer resolution-queue items (e.g. a model judge such as Jev)."""

    tool: str
    relations: tuple[VerdictRelation, ...]


@dataclass(frozen=True, slots=True)
class Manifest:
    plugin: str
    provider: str
    label: str
    addressing: Addressing
    content: Mapping[Section, ContentEntry]
    catalogue: Catalogue | None
    resolve: Resolve | None
    resolver: ResolverDeclaration | None

    def native_scope(self, native_scope: str) -> NativeScope | None:
        return next((item for item in self.addressing.native if item.native_scope == native_scope), None)

    def addressable_levels(self) -> set[Level]:
        levels = {item.level for item in self.addressing.native}
        levels |= {level for level, schemes in self.addressing.schemes.items() if schemes}
        if self.addressing.mic_table:
            levels.add(Level.LISTING)
        return levels


class ManifestError(ValueError):
    def __init__(self, path: str, reason: str) -> None:
        super().__init__(f"{path}: {reason}")
        self.path, self.reason = path, reason


def _object(value: Any, path: str, required: set[str], optional: set[str] = frozenset()) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ManifestError(path, "object required")
    unknown = set(value) - required - optional
    if "search" in unknown:
        raise ManifestError(f"{path}.search", "provider search is not part of the plugin contract")
    if unknown:
        raise ManifestError(f"{path}.{sorted(unknown)[0]}", "unknown field")
    missing = required - set(value)
    if missing:
        raise ManifestError(f"{path}.{sorted(missing)[0]}", "required")
    return value


def _enum(kind: type[StrEnum], value: Any, path: str) -> Any:
    try:
        return kind(value)
    except (ValueError, TypeError):
        raise ManifestError(path, f"expected one of {', '.join(item.value for item in kind)}") from None


def _enums(kind: type[StrEnum], value: Any, path: str, minimum: int = 0) -> tuple[Any, ...]:
    if not isinstance(value, list) or len(value) < minimum or len(value) > 64:
        raise ManifestError(path, f"list of {minimum}-64 values required")
    items = tuple(_enum(kind, item, f"{path}[{index}]") for index, item in enumerate(value))
    if len(set(items)) != len(items):
        raise ManifestError(path, "duplicate values")
    return items


def _match(pattern: re.Pattern[str], value: Any, path: str) -> str:
    if not isinstance(value, str) or not pattern.match(value):
        raise ManifestError(path, "malformed value")
    return value


def _count(value: Any, path: str, minimum: int, maximum: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not minimum <= value <= maximum:
        raise ManifestError(path, f"integer {minimum}-{maximum} required")
    return value


def _addressing(value: Any) -> Addressing:
    body = _object(value, "addressing", set(), {"native", "schemes", "venues", "symbol_rules"})
    native = []
    for index, item in enumerate(body.get("native", [])):
        path = f"addressing.native[{index}]"
        entry = _object(item, path, {"native_scope", "level"}, {"asset_classes"})
        native.append(NativeScope(_match(NAMESPACE, entry["native_scope"], f"{path}.native_scope"),
                                  _enum(Level, entry["level"], f"{path}.level"),
                                  _enums(AssetClass, entry.get("asset_classes", []), f"{path}.asset_classes")))
    if len({item.native_scope for item in native}) != len(native):
        raise ManifestError("addressing.native", "duplicate native_scope")
    schemes: dict[Level, tuple[Scheme, ...]] = {}
    for key, listed in _object(body.get("schemes", {}), "addressing.schemes", set(), {item.value for item in Level}).items():
        level = Level(key)
        schemes[level] = _enums(Scheme, listed, f"addressing.schemes.{key}")
        for scheme in schemes[level]:
            if SCHEME_LEVEL[scheme] is not level:
                raise ManifestError(f"addressing.schemes.{key}", f"{scheme} identifies a {SCHEME_LEVEL[scheme]}")
    venues = _object(body.get("venues", {}), "addressing.venues", set(), {"mic_table", "composites"})
    mic_table = {}
    for mic, code in _object(venues.get("mic_table", {}), "addressing.venues.mic_table", set(), set(venues.get("mic_table", {}))).items():
        path = f"addressing.venues.mic_table.{mic}"
        _match(MIC, mic, path)
        entry = _object(code, path, set(), {"code", "suffix"})
        if not entry or not all(isinstance(text, str) and len(text) <= 16 for text in entry.values()):
            raise ManifestError(path, "code and/or suffix text required")
        mic_table[mic] = VenueCode(entry.get("code"), entry.get("suffix"))
    composites = venues.get("composites", [])
    if not isinstance(composites, list) or not all(isinstance(item, str) and re.match(r"^[A-Z]{2}$", item) for item in composites):
        raise ManifestError("addressing.venues.composites", "ISO 3166 alpha-2 countries required")
    rules = _object(body.get("symbol_rules", {}), "addressing.symbol_rules", set(), {"class_separator", "pad", "strip_trailing_dot"})
    separator = rules.get("class_separator")
    if separator is not None and (not isinstance(separator, str) or len(separator) != 1):
        raise ManifestError("addressing.symbol_rules.class_separator", "one character required")
    pad = {_match(MIC, mic, "addressing.symbol_rules.pad"): _count(width, f"addressing.symbol_rules.pad.{mic}", 1, 12)
           for mic, width in _object(rules.get("pad", {}), "addressing.symbol_rules.pad", set(), set(rules.get("pad", {}))).items()}
    strip = tuple(_match(MIC, mic, "addressing.symbol_rules.strip_trailing_dot") for mic in rules.get("strip_trailing_dot", []))
    return Addressing(tuple(native), schemes, mic_table, tuple(composites), SymbolRules(separator, pad, strip))


def _content(value: Any, addressable: set[Level]) -> dict[Section, ContentEntry]:
    body = _object(value, "content", set(), {item.value for item in Section})
    result = {}
    for key, item in body.items():
        path = f"content.{key}"
        entry = _object(item, path, {"level", "via", "tool"}, {"operation"})
        level, via = _enum(Level, entry["level"], f"{path}.level"), _enum(Level, entry["via"], f"{path}.via")
        if LEVEL_DEPTH[via] < LEVEL_DEPTH[level]:
            raise ManifestError(f"{path}.via", "a broader reference cannot address narrower data")
        if via not in addressable:
            raise ManifestError(f"{path}.via", f"the plugin declares no way to address a {via}")
        operation = entry.get("operation")
        if operation is not None:
            _match(NAMESPACE, operation, f"{path}.operation")
        result[Section(key)] = ContentEntry(Section(key), level, via, _match(TOOL, entry["tool"], f"{path}.tool"), operation)
    return result


def _catalogue(value: Any) -> Catalogue:
    body = _object(value, "catalogue", {"mode"}, {"tool", "scopes", "max_age_seconds", "binding_ttl_seconds", "redistribution"})
    mode = _enum(CatalogueMode, body["mode"], "catalogue.mode")
    if mode is CatalogueMode.BULK:
        _object(body, "catalogue", {"mode", "tool", "scopes", "max_age_seconds", "redistribution"})
        scopes = body["scopes"]
        if not isinstance(scopes, list) or not 1 <= len(scopes) <= 64 or len(set(scopes)) != len(scopes):
            raise ManifestError("catalogue.scopes", "1-64 distinct scopes required")
        return Catalogue(mode, _match(TOOL, body["tool"], "catalogue.tool"),
                         tuple(_match(NAMESPACE, scope, "catalogue.scopes") for scope in scopes),
                         _count(body["max_age_seconds"], "catalogue.max_age_seconds", 60, 2592000), None,
                         _enum(Redistribution, body["redistribution"], "catalogue.redistribution"))
    _object(body, "catalogue", {"mode", "binding_ttl_seconds"})
    return Catalogue(mode, None, (), None, _count(body["binding_ttl_seconds"], "catalogue.binding_ttl_seconds", 3600, 7776000),
                     Redistribution.LOCAL_ONLY)


def _resolve(value: Any) -> Resolve:
    body = _object(value, "resolve", {"tool", "input_schemes", "echoes", "cost"})
    cost = _object(body["cost"], "resolve.cost", {"calls", "credits"})
    return Resolve(_match(TOOL, body["tool"], "resolve.tool"), _enums(Scheme, body["input_schemes"], "resolve.input_schemes", 1),
                   _enums(Scheme, body["echoes"], "resolve.echoes", 1),
                   _count(cost["calls"], "resolve.cost.calls", 1, 10), _count(cost["credits"], "resolve.cost.credits", 0, 1000))


def validate_manifest(document: Any) -> Manifest:
    """Validate a parsed `pythia-plugin.json`; raise ManifestError naming the first bad path."""
    body = _object(document, "manifest", {"schema_version", "plugin", "provider", "label", "addressing"},
                   {"content", "catalogue", "resolve", "resolver"})
    if body["schema_version"] != 1:
        raise ManifestError("manifest.schema_version", "unsupported version")
    label = body["label"]
    if not isinstance(label, str) or not 0 < len(label) <= 64:
        raise ManifestError("manifest.label", "1-64 characters required")
    addressing = _addressing(body["addressing"])
    resolve = _resolve(body["resolve"]) if "resolve" in body else None
    catalogue = _catalogue(body["catalogue"]) if "catalogue" in body else None
    resolver = None
    if "resolver" in body:
        entry = _object(body["resolver"], "resolver", {"tool", "relations"})
        resolver = ResolverDeclaration(_match(TOOL, entry["tool"], "resolver.tool"),
                                       _enums(VerdictRelation, entry["relations"], "resolver.relations", 1))
    if catalogue is not None and catalogue.mode is CatalogueMode.RESOLVE_ONLY and resolve is None:
        raise ManifestError("catalogue.mode", "resolve_only requires a resolve block")
    for index, native in enumerate(addressing.native):
        obtainable = catalogue is not None or resolve is not None or (native.level is Level.LISTING and addressing.mic_table)
        if not obtainable:
            raise ManifestError(f"addressing.native[{index}]", "no catalogue, resolve or venue table can produce these refs")
    manifest = Manifest(_match(NAMESPACE, body["plugin"], "manifest.plugin"), _match(NAMESPACE, body["provider"], "manifest.provider"),
                        label, addressing, {}, catalogue, resolve, resolver)
    content = _content(body.get("content", {}), manifest.addressable_levels())
    return Manifest(manifest.plugin, manifest.provider, label, addressing, content, catalogue, resolve, resolver)
