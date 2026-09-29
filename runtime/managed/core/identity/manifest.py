"""Plugin contract (ADR 0038 and its contract-v1 amendment): `contract.json` and its validator.

A plugin ships a static `contract.json` at its package root, beside `plugin.yaml`
and its `configuration.json`. The core evaluates it without running plugin code,
so addressing and source selection work for disabled plugins too. Native Hermes
stays the authority for discovery and enablement.

Version 1 declares, per core data concept (ADR 0040), the plugin operation that
serves each concept operation, its coverage and its qualities from core's closed
vocabulary, plus the provider terms core must know (`rights`), the source's
onboarding sign-off (`signoff`, ADR 0042) and optional published limits.
Contracts name plugin operations, never Hermes tools; the Hermes adapter maps an
operation to the tool that declares it.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field, replace
from enum import StrEnum
from typing import Any, Mapping

from .concepts import REGISTRY, Combine, Concept, FilingAuthority, Licence
from .schemes import INSTRUMENT_KINDS, MIC, NAMESPACE, SCHEME_LEVEL, Kind, Level, Scheme
from .trust import CONFIRM
from .vocabulary import AssetClass

MANIFEST_FILE = "contract.json"
CONTRACT_VERSION = 1  # the newest contract shape this core reads
RESERVED = frozenset({"reference"})  # tags the reference build's own questions in core's queue (build_questions)
OPERATION = re.compile(r"^[a-z][a-z0-9_-]{0,63}\Z")  # a plugin operation name, as `declare_operation` accepts
DEPTH = {Level.ISSUER: 0, Level.SECURITY: 1, Level.COMPOSITE: 2, Level.LISTING: 3}
LIMIT_UNITS = ("call", "credit", "request")
RECORD = re.compile(r"^(docs/sources/[a-z0-9][a-z0-9-]{0,63}\.md|https://\S{1,500})\Z")  # a public source record


class CatalogueMode(StrEnum):
    BULK = "bulk"                  # pages typed records onto the device
    RESOLVE_ONLY = "resolve_only"  # the default: only records the user picked are kept


class SignOff(StrEnum):
    """A source's declared standing under the onboarding standard (ADR 0042). Core honours it only where a grant on the
    plugin's files confirms it (`trust.py`); Pythia's release grants confirm its own signed-off or grandfathered ones."""

    SIGNED_OFF = "signed_off"        # passed the four stages; its record says so
    GRANDFATHERED = "grandfathered"  # in use before the standard: keeps its role until its turn
    UNSIGNED = "unsigned"            # display: off in fresh profiles; once enabled it serves and merges, labelled,
                                     # after every audited source where one serves; never confirms identity


@dataclass(frozen=True, slots=True)
class NativeScope:
    native_scope: str
    level: Level | Kind  # a kind outside the hierarchy (a market) is addressed through core's curated table
    asset_classes: tuple[AssetClass, ...]


@dataclass(frozen=True, slots=True)
class Coverage:
    asset_classes: frozenset[str] | None = None  # None: whatever the plugin can address
    markets: frozenset[str] | None = None        # operating MICs; None: any


@dataclass(frozen=True, slots=True)
class ConceptEntry:
    level: Level | Kind | None          # the level the data is about (fundamentals: issuer), or a kind outside
                                        # the hierarchy (a market), which is addressed as itself; None: market-wide
    via: Level | Kind | None            # the level of the reference used to call (fundamentals: a listing symbol)
    operations: Mapping[str, str]       # concept operation -> plugin operation
    coverage: Coverage
    qualities: Mapping[str, Mapping[str, Any]]  # concept operation -> declared qualities (claims, not entitlements)
    authorities: tuple[FilingAuthority, ...] = ()
    operation_coverage: Mapping[str, Coverage] = field(default_factory=dict)  # per-operation narrowing

    def coverage_for(self, operation: str) -> Coverage:
        """The coverage of one concept operation: its own override where declared, else the concept's."""
        return self.operation_coverage.get(operation, self.coverage)


@dataclass(frozen=True, slots=True)
class Resolve:
    operation: str
    input_schemes: tuple[Scheme, ...]
    echoes: tuple[Scheme, ...]  # identifiers an answer only repeats from the query: never evidence


@dataclass(frozen=True, slots=True)
class Attribution:
    text: str
    url: str


@dataclass(frozen=True, slots=True)
class Rights:
    licence: Licence
    cache_seconds: int | None       # how long data may stay on the device: 0 memory only, None unlimited
    hostable: bool                  # whether data may appear in a published package
    attribution: Attribution | None  # what every surface showing the data renders


@dataclass(frozen=True, slots=True)
class Limits:
    """A provider's published rate limits for the named plan. Declared only; nothing enforces them yet."""

    plan: str
    unit: str
    per_second: int | None
    per_minute: int | None
    per_day: int | None
    per_month: int | None


@dataclass(frozen=True, slots=True)
class Manifest:
    plugin: str
    provider: str
    native: tuple[NativeScope, ...]
    schemes: Mapping[Level, tuple[Scheme, ...]]
    mic_table: Mapping[str, str]  # operating MIC -> the literal suffix core appends to the ticker (".AS", "")
    concepts: Mapping[Concept, ConceptEntry]
    catalogue: CatalogueMode
    catalogue_operation: str | None
    catalogue_scopes: tuple[str, ...]
    resolve: Resolve | None
    rights: Rights
    signoff: SignOff
    record: str | None              # the source record: required once signed off, pending before
    limits: Limits | None = None
    contract_version: int = CONTRACT_VERSION
    venue_codes: Mapping[str, str] = field(default_factory=dict)  # the provider's venue code -> operating MIC ("NMS": "XNAS")

    @property
    def unaudited(self) -> bool:
        return self.signoff is SignOff.UNSIGNED

    def native_scope(self, native_scope: str) -> NativeScope | None:
        return next((item for item in self.native if item.native_scope == native_scope), None)

    @property
    def plugin_operations(self) -> frozenset[str]:
        """Every plugin operation the contract names: concept operations, catalogue and resolve."""
        named = {name for entry in self.concepts.values() for name in entry.operations.values()}
        named |= {self.catalogue_operation} if self.catalogue_operation else set()
        return frozenset(named | ({self.resolve.operation} if self.resolve else set()))


class ManifestError(ValueError):
    pass


class ManifestNeedsUpdate(ManifestError):
    """The contract is newer than this core reads: Pythia must be updated to use the plugin. Not invalid."""

    def __init__(self, version: int):
        super().__init__(f"contract_version: {version} is newer than this Pythia reads ({CONTRACT_VERSION})")
        self.version = version


def _object(value: Any, path: str, required: set[str], optional: set[str] = frozenset()) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ManifestError(f"{path}: object required")
    for name in sorted(set(value) - required - optional):
        raise ManifestError(f"{path}.{name}: unknown field")
    for name in sorted(required - set(value)):
        raise ManifestError(f"{path}.{name}: required")
    return value


def _name(value: Any) -> str:
    """A plugin's own name; a reserved one would let it pose as a core-tagged source."""
    name = _match(NAMESPACE, value, "manifest.plugin")
    if name in RESERVED:
        raise ManifestError(f"manifest.plugin: {name} is reserved")
    return name


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


def _place(value: Any, path: str) -> Level | Kind:
    """An instrument level, or a registered subject kind outside the hierarchy."""
    if value in set(Level):
        return Level(value)
    if value in set(Kind) and value not in INSTRUMENT_KINDS:
        return Kind(value)
    raise ManifestError(f"{path}: expected an instrument level or a subject kind")


def _count(value: Any, path: str, low: int = 1) -> int:
    if type(value) is not int or not low <= value <= 10**9:
        raise ManifestError(f"{path}: expected a whole number of at least {low}")
    return value


def contract_version(document: Any) -> int:
    """The declared contract version, read before anything else."""
    version = document.get("contract_version") if isinstance(document, Mapping) else None
    if type(version) is not int or version < 1:
        raise ManifestError("manifest.contract_version: a positive integer is required")
    return version


def _concept(key: str, item: Any, addressable: set[Level | Kind]) -> ConceptEntry:
    path = f"concepts.{key}"
    concept = _enum(Concept, key, "concepts")
    spec = REGISTRY[concept]
    per_authority = spec.combine is Combine.PER_AUTHORITY
    about = {"level", "via"} if spec.levels | spec.kinds else set()  # a market-wide concept is about no subject
    entry = _object(item, path, about | {"operations"} | ({"authorities"} if per_authority else set()),
                    {"coverage", "qualities"})
    level = via = None
    if about:
        level, via = _place(entry["level"], f"{path}.level"), _place(entry["via"], f"{path}.via")
        if level not in spec.levels | spec.kinds:
            raise ManifestError(f"{path}.level: {concept} data is about {', '.join(sorted(spec.levels | spec.kinds))}")
        if isinstance(level, Level) != isinstance(via, Level) or via not in addressable or (
                DEPTH[via] < DEPTH[level] if isinstance(level, Level) else via != level):
            raise ManifestError(f"{path}.via: the plugin cannot address {level} data through a {via}")
    operations = {}
    declared = _object(entry["operations"], f"{path}.operations", set(), set(spec.operations))
    if not declared:
        raise ManifestError(f"{path}.operations: at least one operation is required")
    for name, plugin_operation in declared.items():
        operations[name] = _match(OPERATION, plugin_operation, f"{path}.operations.{name}")
    body = _object(entry.get("coverage", {}), f"{path}.coverage", set(), {"asset_classes", "markets", "operations"})
    coverage = _coverage(body, f"{path}.coverage")
    narrowed = {}
    for name, item in _object(body.get("operations", {}), f"{path}.coverage.operations", set(), set(operations)).items():
        at = f"{path}.coverage.operations.{name}"
        own = _coverage(_object(item, at, set(), {"asset_classes", "markets"}), at)
        narrowed[name] = Coverage(own.asset_classes if "asset_classes" in item else coverage.asset_classes,
                                  own.markets if "markets" in item else coverage.markets)
    qualities = {}
    for name, claimed in _object(entry.get("qualities", {}), f"{path}.qualities", set(), set(operations)).items():
        vocabulary = spec.operations[name]
        qualities[name] = {}
        for quality, value in _object(claimed, f"{path}.qualities.{name}", set(), set(vocabulary)).items():
            try:
                qualities[name][quality] = vocabulary[quality](value)
            except ValueError as error:
                raise ManifestError(f"{path}.qualities.{name}.{quality}: {error}") from None
    for name, claimed in qualities.items():
        if claimed.get("delay_minutes", 0) > 0 and claimed.get("delay") != "delayed":
            raise ManifestError(f"{path}.qualities.{name}.delay_minutes: a delay in minutes needs delay \"delayed\"")
    authorities = _enums(FilingAuthority, entry["authorities"], f"{path}.authorities") if per_authority else ()
    if per_authority and not authorities:
        raise ManifestError(f"{path}.authorities: a combining concept names the authorities the plugin serves")
    return ConceptEntry(level, via, operations, coverage, qualities, authorities, narrowed)


def _coverage(body: Mapping[str, Any], path: str) -> Coverage:
    classes, markets = body.get("asset_classes"), body.get("markets")
    if classes is not None and (not isinstance(classes, list) or not classes):
        raise ManifestError(f"{path}.asset_classes: a non-empty list is required")
    if markets is not None and (not isinstance(markets, list) or not markets or len(set(map(str, markets))) != len(markets)):
        raise ManifestError(f"{path}.markets: a list of distinct operating MICs is required")
    return Coverage(None if classes is None else frozenset(_enums(AssetClass, classes, f"{path}.asset_classes")),
                    None if markets is None else frozenset(_match(MIC, mic, f"{path}.markets") for mic in markets))


def _rights(value: Any) -> Rights:
    body = _object(value, "rights", {"licence", "cache", "hostable"}, {"attribution"})
    cache = body["cache"]
    if cache == "none":
        seconds = 0
    elif cache == "unlimited":
        seconds = None
    else:
        seconds = _count(_object(cache, "rights.cache", {"ttl_seconds"})["ttl_seconds"], "rights.cache.ttl_seconds")
    if type(body["hostable"]) is not bool:
        raise ManifestError("rights.hostable: true or false")
    attribution = None
    if body.get("attribution") is not None:
        item = _object(body["attribution"], "rights.attribution", {"text", "url"})
        if not isinstance(item["text"], str) or not 0 < len(item["text"]) <= 120:
            raise ManifestError("rights.attribution.text: one line of at most 120 characters")
        if not isinstance(item["url"], str) or not re.match(r"^https://[^\s]{1,500}\Z", item["url"]):
            raise ManifestError("rights.attribution.url: an https link")
        attribution = Attribution(item["text"], item["url"])
    return Rights(_enum(Licence, body["licence"], "rights.licence"), seconds, body["hostable"], attribution)


def _signoff(value: Any) -> tuple[SignOff, str | None]:
    body = _object(value, "signoff", {"status"}, {"record"})
    status = _enum(SignOff, body["status"], "signoff.status")
    if status is SignOff.SIGNED_OFF and "record" not in body:
        raise ManifestError("signoff.record: a signed-off source links its record")
    return status, _match(RECORD, body["record"], "signoff.record") if "record" in body else None


def _limits(value: Any) -> Limits:
    body = _object(value, "limits", {"plan", "unit"}, {"per_second", "per_minute", "per_day", "per_month"})
    if not isinstance(body["plan"], str) or not 0 < len(body["plan"]) <= 64:
        raise ManifestError("limits.plan: the plan these limits describe, at most 64 characters")
    if body["unit"] not in LIMIT_UNITS:
        raise ManifestError(f"limits.unit: expected one of {', '.join(LIMIT_UNITS)}")
    return Limits(body["plan"], body["unit"], **{name: _count(body[name], f"limits.{name}") if name in body else None
                                                 for name in ("per_second", "per_minute", "per_day", "per_month")})


def vouched(manifest: Manifest, level: str) -> Manifest:
    """The contract as core trusts it at the trust level granted to its plugin's files (`trust.level`): as declared
    at confirm, else unsigned. A plugin cannot vouch for itself: its `signoff` alone never raises its trust."""
    return manifest if level == CONFIRM else replace(manifest, signoff=SignOff.UNSIGNED)


def validate_manifest(document: Any) -> Manifest:
    """Validate a parsed `contract.json`; raise ManifestError naming the first bad path.

    A contract newer than this core raises ManifestNeedsUpdate (a ManifestError) before any other check:
    the plugin needs a newer Pythia, and its fields are neither rejected nor silently ignored."""
    version = contract_version(document)
    if version > CONTRACT_VERSION:
        raise ManifestNeedsUpdate(version)
    body = _object(document, "manifest", {"contract_version", "plugin", "provider", "addressing", "rights", "signoff"},
                   {"concepts", "catalogue", "resolve", "limits"})
    addressing = _object(body["addressing"], "addressing", set(), {"native", "schemes", "mic_table", "venue_codes"})
    native = []
    if not isinstance(addressing.get("native", []), list):
        raise ManifestError("addressing.native: list required")
    for index, item in enumerate(addressing.get("native", [])):
        path = f"addressing.native[{index}]"
        entry = _object(item, path, {"native_scope", "level"}, {"asset_classes"})
        native.append(NativeScope(_match(NAMESPACE, entry["native_scope"], f"{path}.native_scope"),
                                  _place(entry["level"], f"{path}.level"),
                                  _enums(AssetClass, entry.get("asset_classes", []), f"{path}.asset_classes")))
    # One native scope may also address subjects outside the hierarchy (Yahoo's `symbol` names listings and
    # curated indexes alike), but each place only once.
    if len({(item.native_scope, item.level) for item in native}) != len(native):
        raise ManifestError("addressing.native: duplicate native_scope")
    schemes = {}
    for key, listed in _object(addressing.get("schemes", {}), "addressing.schemes", set(), set(Level)).items():
        schemes[Level(key)] = _enums(Scheme, listed, f"addressing.schemes.{key}")
        for scheme in schemes[Level(key)]:
            if SCHEME_LEVEL[scheme] is not Level(key):
                raise ManifestError(f"addressing.schemes.{key}: {scheme} identifies a {SCHEME_LEVEL[scheme]}")
    table = addressing.get("mic_table", {})
    table = _object(table, "addressing.mic_table", set(), set(table) if isinstance(table, Mapping) else set())
    mic_table = {_match(MIC, mic, "addressing.mic_table"): code for mic, code in table.items()}
    if not all(isinstance(code, str) and len(code) <= 16 for code in mic_table.values()):
        raise ManifestError("addressing.mic_table: provider venue codes are short text")
    codes = addressing.get("venue_codes", {})
    codes = _object(codes, "addressing.venue_codes", set(), set(codes) if isinstance(codes, Mapping) else set())
    if not all(0 < len(code) <= 16 for code in codes):
        raise ManifestError("addressing.venue_codes: provider venue codes are short text")
    venue_codes = {code: _match(MIC, mic, f"addressing.venue_codes.{code}") for code, mic in codes.items()}

    catalogue = _object(body.get("catalogue", {"mode": "resolve_only"}), "catalogue", {"mode"}, {"operation", "scopes"})
    mode = _enum(CatalogueMode, catalogue["mode"], "catalogue.mode")
    scopes = catalogue.get("scopes", [])
    bulk = mode is CatalogueMode.BULK
    if bulk != ("operation" in catalogue) or bulk != bool(scopes) or not isinstance(scopes, list):
        raise ManifestError("catalogue: a bulk catalogue, and only it, names an operation and its scopes")
    operation = _match(OPERATION, catalogue["operation"], "catalogue.operation") if "operation" in catalogue else None
    scopes = tuple(_match(NAMESPACE, scope, "catalogue.scopes") for scope in scopes)
    resolve = None
    if "resolve" in body:
        entry = _object(body["resolve"], "resolve", {"operation", "input_schemes", "echoes"})
        resolve = Resolve(_match(OPERATION, entry["operation"], "resolve.operation"),
                          _enums(Scheme, entry["input_schemes"], "resolve.input_schemes"),
                          _enums(Scheme, entry["echoes"], "resolve.echoes"))
    for index, item in enumerate(native):
        # A kind outside the hierarchy (a market) takes its refs from core's curated table (markets.json).
        if not (bulk or resolve or (item.level is Level.LISTING and mic_table) or not isinstance(item.level, Level)):
            raise ManifestError(f"addressing.native[{index}]: no catalogue, resolve or MIC table produces these refs")

    addressable: set[Level | Kind] = {item.level for item in native} | {level for level, listed in schemes.items() if listed}
    addressable |= {Level.LISTING} if mic_table else set()
    concepts = {Concept(key): _concept(key, item, addressable)
                for key, item in _object(body.get("concepts", {}), "concepts", set(), set(Concept)).items()}
    return Manifest(_name(body["plugin"]),
                    _match(NAMESPACE, body["provider"], "manifest.provider"),
                    tuple(native), schemes, mic_table, concepts, mode, operation, scopes, resolve,
                    _rights(body["rights"]), *_signoff(body["signoff"]),
                    _limits(body["limits"]) if "limits" in body else None, version, venue_codes)
