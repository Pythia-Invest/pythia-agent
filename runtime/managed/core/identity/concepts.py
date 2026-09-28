"""Core data concepts (ADR 0040): the concept registry and the one source-selection rule.

Core owns what a concept means, its operations, the closed vocabulary of qualities
a plugin may claim for each operation, and how a source is chosen. Plugins only
declare what they serve (`contract.json`, ADR 0038); they never define a concept.

Selection is one rule for every concept: the investor's order, then connected
(keyed and configured) sources, then core's default order; the first source that
can serve the subject is chosen, and every other source is listed with a reason.
A concept that combines (filings) chooses one source per filing authority instead
of one overall. There is no automatic switch after a failed read. `build_index`
indexes the static contracts once; `select` is then a pure in-memory lookup with
no I/O and no trial calls. Pure standard library.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Callable, Collection, Iterable, Mapping, Sequence

from .schemes import Level
from .vocabulary import AssetClass


class Concept(StrEnum):
    MARKET_DATA = "market_data"
    PROFILE = "profile"
    FILINGS = "filings"
    FUNDAMENTALS = "fundamentals"  # registered; nothing serves it until its core result schema exists
    ESTIMATES = "estimates"        # registered; nothing serves it yet
    NEWS = "news"                  # registered; nothing serves it yet


class Combine(StrEnum):
    """How a concept that does not pick one source combines several. Core-owned; never a user setting."""

    PER_AUTHORITY = "per_authority"  # one source per filing authority; the lists merge by date


class FilingAuthority(StrEnum):
    """Who a filing is filed with. A source declares the authorities it serves."""

    SEC = "sec"      # US SEC EDGAR
    ESMA = "esma"    # EU/EEA issuers' ESEF reports, filed with national officially appointed mechanisms
    FCA = "fca"      # UK issuers' reports on the FCA National Storage Mechanism
    SEDAR = "sedar"  # Canadian SEDAR+


class Licence(StrEnum):
    """The terms a plugin's data is used under. Declared now; only personal mode exists."""

    OPEN = "open"          # public data under open terms
    PERSONAL = "personal"  # one investor's non-professional use
    BUSINESS = "business"  # a firm licence, internal use
    SEAT = "seat"          # bound to one user's running terminal


class SkipReason(StrEnum):
    """Why a source that declares the concept does not serve this subject. Ordinary selection, never fallback."""

    DISABLED = "disabled"
    NEEDS_CONFIGURATION = "needs_configuration"
    NOT_COVERING = "not_covering"        # the contract's coverage excludes the asset class or market
    NOT_ADDRESSABLE = "not_addressable"  # identity gives no binding or derivable address for this subject
    CONFLICT = "conflict"                # the plugin's record contradicts the reference; queued for review
    UNRESOLVED = "unresolved"            # a lookup found nothing usable
    NOT_ENTITLED = "not_entitled"        # a provider said this is not on the investor's plan
    THROTTLED = "throttled"              # reserved: produced once quota state exists
    EXHAUSTED = "exhausted"              # reserved: produced once quota state exists


# ---- quality vocabulary ------------------------------------------------------------------------------------------

Check = Callable[[Any], Any]
DELAY = ("realtime", "delayed", "eod", "unknown")  # the market-data wire's feed classes a plugin may claim
ADJUSTMENT = ("none", "split", "split_dividend", "unknown")
LIVE_CONTEXT = ("mark", "oracle", "mid", "funding", "open_interest", "prev_day", "day_volume",
                "session", "venue_status", "reference_close")
SHORT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}\Z")
OPT_IN = re.compile(r"^[a-z][a-z0-9_-]{2,63}\Z")


def one_of(*values: str) -> Check:
    def check(value: Any) -> str:
        if value not in values:
            raise ValueError(f"expected one of {', '.join(values)}")
        return value
    return check


def some_of(*values: str) -> Check:
    def check(value: Any) -> tuple[str, ...]:
        if not isinstance(value, list) or not value or any(item not in values for item in value) or len(set(value)) != len(value):
            raise ValueError(f"expected distinct values from {', '.join(values)}")
        return tuple(value)
    return check


def whole(low: int, high: int) -> Check:
    def check(value: Any) -> int:
        if type(value) is not int or not low <= value <= high:
            raise ValueError(f"expected an integer from {low} to {high}")
        return value
    return check


def flag(value: Any) -> bool:
    if type(value) is not bool:
        raise ValueError("expected true or false")
    return value


def text(limit: int) -> Check:
    def check(value: Any) -> str:
        if not isinstance(value, str) or not value.strip() or len(value) > limit or any(ord(c) < 32 for c in value):
            raise ValueError(f"expected one line of text, at most {limit} characters")
        return value
    return check


def matching(pattern: re.Pattern[str]) -> Check:
    def check(value: Any) -> str:
        if not isinstance(value, str) or not pattern.match(value):
            raise ValueError("malformed value")
        return value
    return check


PRICE_TIMING = {"delay": one_of(*DELAY), "delay_minutes": whole(0, 1440), "extended_hours": flag, "feed_note": text(80)}
HISTORY = {"history_days": whole(1, 36600)}
# Live qualities fit a 20-level signed crypto book (Hyperliquid) and a one-level, unsigned, single-venue stock
# feed (EODHD's Cboe EDGX stream) alike, so a second live provider needs no contract change.
LIVE = {"book": one_of("top", "snapshot"), "book_levels": whole(1, 100), "trades": flag, "trade_side": flag,
        "scope": one_of("venue", "consolidated"), "venue": matching(SHORT), "context": some_of(*LIVE_CONTEXT),
        "line": one_of("last_trade", "mid", "mark"), "min_publish_ms": whole(50, 60000), "auth": one_of("none", "key"),
        "opt_in": matching(OPT_IN), "symbol_budget": whole(1, 100000)}
BASIS = {"basis": some_of("as_reported", "standardized")}


@dataclass(frozen=True, slots=True)
class ConceptSpec:
    operations: Mapping[str, Mapping[str, Check]]  # operation -> its closed quality vocabulary
    levels: frozenset[Level]                        # the levels the concept's data may be about
    default_order: tuple[str, ...] = ()             # providers; core's order when nothing else decides
    combine: Combine | None = None


REGISTRY: dict[Concept, ConceptSpec] = {
    Concept.MARKET_DATA: ConceptSpec(
        operations={"quote": PRICE_TIMING, "intraday": {**PRICE_TIMING, **HISTORY},
                    "daily": {"adjustment": some_of(*ADJUSTMENT), "feed_note": text(80), **HISTORY},
                    "live": LIVE},
        levels=frozenset({Level.LISTING, Level.COMPOSITE, Level.SECURITY}),
        default_order=("yahoo", "eodhd", "coinmarketcap", "coingecko")),
    Concept.PROFILE: ConceptSpec(operations={"fields": {}}, levels=frozenset({Level.ISSUER, Level.SECURITY}),
                                 default_order=("gleif",)),
    Concept.FILINGS: ConceptSpec(operations={"list": {}, "read": {}}, levels=frozenset({Level.ISSUER}),
                                 default_order=("xbrl-filings", "sec"), combine=Combine.PER_AUTHORITY),
    Concept.FUNDAMENTALS: ConceptSpec(operations={"statements": BASIS, "metrics": BASIS}, levels=frozenset({Level.ISSUER})),
    Concept.ESTIMATES: ConceptSpec(operations={"consensus": {}, "targets": {}}, levels=frozenset({Level.ISSUER})),
    Concept.NEWS: ConceptSpec(operations={"list": {}}, levels=frozenset({Level.ISSUER, Level.SECURITY})),
}


# ---- selection ---------------------------------------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class Source:
    """One plugin's static facts for one concept operation, taken from its contract at load."""

    plugin: str                           # native plugin key
    provider: str
    asset_classes: frozenset[str] | None  # None: any
    markets: frozenset[str] | None        # operating MICs; None: any
    authorities: tuple[str, ...]          # filing authorities, for a combining concept
    rank: int                             # position in core's default order


@dataclass(frozen=True, slots=True)
class SourceState:
    """A plugin's current native and configuration state; read by the caller, never by selection."""

    enabled: bool = True
    configured: bool = True   # every required field is configured
    connected: bool = False   # a credential is configured: a connected source ranks ahead of keyless ones


@dataclass(frozen=True, slots=True)
class Skip:
    plugin: str
    reason: SkipReason


@dataclass(frozen=True, slots=True)
class Choice:
    plugin: str
    authorities: tuple[str, ...] = ()  # what this source serves when the concept combines


@dataclass(frozen=True, slots=True)
class Selection:
    concept: Concept
    operation: str
    chosen: tuple[Choice, ...]  # one source, or one per authority; empty when nothing can serve
    alternatives: tuple[str, ...]  # eligible sources not chosen, in order: what "Also:" and a switch name
    skipped: tuple[Skip, ...]      # every other declaring source, with its reason


class Index:
    """Contract coverage indexed once by concept operation and asset class; rebuilt only when contracts change."""

    def __init__(self, sources: Mapping[tuple[Concept, str], tuple[Source, ...]]):
        self._sources = dict(sources)
        self._covering: dict[tuple[Concept, str, str | None], tuple[tuple[Source, ...], tuple[Source, ...]]] = {}
        for key, listed in self._sources.items():
            for asset_class in (*AssetClass, None):
                inside = tuple(item for item in listed if item.asset_classes is None or asset_class in item.asset_classes)
                outside = tuple(item for item in listed if item not in inside)
                self._covering[(*key, asset_class)] = (inside, outside)

    def sources(self, concept: Concept, operation: str) -> tuple[Source, ...]:
        return self._sources.get((concept, operation), ())

    def covering(self, concept: Concept, operation: str, asset_class: str | None) -> tuple[tuple[Source, ...], tuple[Source, ...]]:
        """The sources whose asset-class coverage includes this one, and those it excludes."""
        found = self._covering.get((concept, operation, asset_class))
        if found is None:  # an asset class the registry does not know yet: only unrestricted sources cover it
            listed = self.sources(concept, operation)
            found = (tuple(i for i in listed if i.asset_classes is None), tuple(i for i in listed if i.asset_classes))
        return found


def build_index(contracts: Iterable[tuple[str, Any]]) -> Index:
    """Index (plugin key, validated Manifest) pairs by the concept operations they declare."""
    found: dict[tuple[Concept, str], list[Source]] = {}
    for key, manifest in contracts:
        for concept, entry in manifest.concepts.items():
            order = REGISTRY[concept].default_order
            rank = order.index(manifest.provider) if manifest.provider in order else len(order)
            source = Source(key, manifest.provider, entry.coverage.asset_classes, entry.coverage.markets,
                            tuple(entry.authorities), rank)
            for operation in entry.operations:
                found.setdefault((concept, operation), []).append(source)
    return Index({key: tuple(sorted(listed, key=lambda item: (item.rank, item.plugin))) for key, listed in found.items()})


ADDRESS_SKIPS = {"conflict": SkipReason.CONFLICT, "unresolved": SkipReason.UNRESOLVED}


def select(index: Index, concept: Concept, operation: str, *, asset_class: str | None, market: str | None,
           address: Mapping[str, str], states: Mapping[str, SourceState], order: Sequence[str] = (),
           not_entitled: Collection[tuple[str, str]] = ()) -> Selection:
    """Choose the source(s) for one subject and concept operation. Pure: no I/O, no calls.

    `address` gives, per plugin, identity's answer for this subject: `ready` (a binding or a derived address),
    `resolving` (a lookup is still to run; still choosable), `conflict` or `unresolved`; a plugin absent from it
    cannot address the subject. `order` is the investor's one ordered list of plugins, across concepts.
    `not_entitled` holds (plugin, concept) pairs a provider has refused as not on the plan.
    """
    inside, outside = index.covering(concept, operation, asset_class)
    listed = {name: position for position, name in enumerate(order)}
    default = SourceState()

    def rank(item: Source) -> tuple:
        return (listed.get(item.plugin, len(listed)), not states.get(item.plugin, default).connected, item.rank, item.plugin)

    eligible: list[Source] = []
    skipped = [Skip(item.plugin, SkipReason.NOT_COVERING) for item in outside]
    for item in sorted(inside, key=rank):
        state = states.get(item.plugin, default)
        status = address.get(item.plugin)
        if item.markets is not None and market not in item.markets:
            reason = SkipReason.NOT_COVERING
        elif not state.enabled:
            reason = SkipReason.DISABLED
        elif not state.configured:
            reason = SkipReason.NEEDS_CONFIGURATION
        elif (item.plugin, concept) in not_entitled:
            reason = SkipReason.NOT_ENTITLED
        elif status is None:
            reason = SkipReason.NOT_ADDRESSABLE
        elif status in ADDRESS_SKIPS:
            reason = ADDRESS_SKIPS[status]
        else:
            eligible.append(item)
            continue
        skipped.append(Skip(item.plugin, reason))
    if REGISTRY[concept].combine is Combine.PER_AUTHORITY:
        served: dict[str, list[str]] = {}
        for item in eligible:  # the first eligible source per authority serves it
            for authority in item.authorities:
                if not any(authority in taken for taken in served.values()):
                    served.setdefault(item.plugin, []).append(authority)
        chosen = tuple(Choice(item.plugin, tuple(served[item.plugin])) for item in eligible if item.plugin in served)
    else:
        chosen = (Choice(eligible[0].plugin),) if eligible else ()
    picked = {choice.plugin for choice in chosen}
    return Selection(concept, operation, chosen, tuple(item.plugin for item in eligible if item.plugin not in picked),
                     tuple(skipped))
