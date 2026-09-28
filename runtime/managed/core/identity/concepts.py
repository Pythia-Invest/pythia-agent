"""Core data concepts (ADR 0040): the concept registry.

Core owns what a concept means, its operations, the closed vocabulary of qualities
a plugin may claim for each operation, and core's default source order. Plugins
only declare what they serve (`contract.json`, ADR 0038); they never define a
concept. One selection rule serves every concept (ADR 0040): the investor's
order, then this default order; the first eligible source serves, and a
combining concept takes one source per filing authority (filings) or every
eligible source (news; estimates and fundamentals side by side). A source that
answers `not_covered` gives way to the next. Pure standard library.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Callable, Mapping

from .schemes import Kind, Level


class Concept(StrEnum):
    MARKET_DATA = "market_data"
    PROFILE = "profile"
    FILINGS = "filings"
    FUNDAMENTALS = "fundamentals"  # registered; its statements read is the parallel-reports work (P8)
    ESTIMATES = "estimates"        # side by side through core's combined read; no bundled plugin declares it yet
    NEWS = "news"                  # one merged feed through core's combined read; no bundled plugin declares it yet
    MARKET_MOVERS = "market_movers"  # a market's ranked lists (most active, gainers, losers); about no one subject


class Combine(StrEnum):
    """How a concept that does not pick one source combines several. Core-owned; never a user setting."""

    PER_AUTHORITY = "per_authority"  # one source per filing authority; the lists merge by date
    MERGE = "merge"                  # lists: every eligible source; one feed without exact or near-exact duplicates
    SIDE_BY_SIDE = "side_by_side"    # single values: every eligible source, one labelled row each; never blended


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


# ---- quality vocabulary ------------------------------------------------------------------------------------------

Check = Callable[[Any], Any]
DELAY = ("realtime", "delayed", "eod", "unknown")  # the market-data wire's feed classes a plugin may claim
ADJUSTMENT = ("none", "split", "split_dividend", "unknown")
LIVE_CONTEXT = ("mark", "oracle", "mid", "funding", "open_interest", "prev_day", "day_volume",
                "session", "venue_status", "reference_close")
SHORT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}\Z")


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
# What a live snapshot carries, so a 20-level signed crypto book (Hyperliquid) and a one-level, unsigned,
# single-venue stock feed (EODHD's Cboe EDGX stream) declare `live` alike. Connection settings (auth, opt-in,
# symbol budgets, publish rates) are plugin configuration, not data qualities.
LIVE = {"book": one_of("top", "snapshot"), "book_levels": whole(1, 100), "trades": flag, "trade_side": flag,
        "scope": one_of("venue", "consolidated"), "venue": matching(SHORT), "context": some_of(*LIVE_CONTEXT),
        "line": one_of("last_trade", "mid", "mark")}
BASIS = {"basis": some_of("as_reported", "standardized")}


@dataclass(frozen=True, slots=True)
class ConceptSpec:
    operations: Mapping[str, Mapping[str, Check]]  # operation -> its closed quality vocabulary
    levels: frozenset[Level]                        # the levels the concept's data may be about
    kinds: frozenset[Kind] = frozenset()            # subject kinds outside the hierarchy it may be about (no `via`)
    default_order: tuple[str, ...] = ()             # providers, free before paid; used after the investor's order
    combine: Combine | None = None


REGISTRY: dict[Concept, ConceptSpec] = {
    Concept.MARKET_DATA: ConceptSpec(
        operations={"quote": PRICE_TIMING, "intraday": {**PRICE_TIMING, **HISTORY},
                    "daily": {"adjustment": some_of(*ADJUSTMENT), "feed_note": text(80), **HISTORY},
                    "live": LIVE},
        levels=frozenset({Level.LISTING, Level.COMPOSITE, Level.SECURITY}), kinds=frozenset({Kind.MARKET}),
        default_order=("yahoo", "coingecko", "eodhd", "coinmarketcap")),
    Concept.PROFILE: ConceptSpec(operations={"fields": {}}, levels=frozenset({Level.ISSUER, Level.SECURITY}),
                                 default_order=("gleif",)),
    Concept.FILINGS: ConceptSpec(operations={"list": {}, "read": {}}, levels=frozenset({Level.ISSUER}),
                                 default_order=("xbrl-filings", "sec"), combine=Combine.PER_AUTHORITY),
    Concept.FUNDAMENTALS: ConceptSpec(operations={"statements": BASIS, "metrics": BASIS}, levels=frozenset({Level.ISSUER}),
                                      combine=Combine.SIDE_BY_SIDE),
    Concept.ESTIMATES: ConceptSpec(operations={"consensus": {}, "targets": {}}, levels=frozenset({Level.ISSUER}),
                                   default_order=("yahoo", "eodhd"), combine=Combine.SIDE_BY_SIDE),
    Concept.NEWS: ConceptSpec(operations={"list": {}}, levels=frozenset({Level.ISSUER, Level.SECURITY}),
                              default_order=("yahoo", "eodhd"), combine=Combine.MERGE),
    # About no subject (no levels or kinds): a market's lists. Each list is an operation, so a source declares the
    # lists it has; `delay` is the rows' quote timing.
    Concept.MARKET_MOVERS: ConceptSpec(operations={name: {"delay": one_of(*DELAY), "feed_note": text(80)}
                                                   for name in ("most_active", "gainers", "losers")},
                                       levels=frozenset(), default_order=("yahoo",)),
}


# ---- selection ---------------------------------------------------------------------------------------------------

ELIGIBLE = frozenset({"ready", "resolving"})  # resolving: a lookup runs before the first read, then it serves
# The issue code of a read answer that says "I do not cover this subject for this concept": not an error, so the
# next eligible source serves (a failed read never switches source). A plugin answers
# {"outcome": "empty", "issues": [{"code": "not_covered", "severity": "warning", "message": ...}]}.
NOT_COVERED = "not_covered"
# Skips that signal something went wrong rather than the investor's own setup: they warrant a visible notice.
NOTICE = frozenset({"conflict", "unresolved"})
# Filing authority of an item by the filer's country, for a source serving several authorities.
AUTHORITY_BY_COUNTRY = {"US": FilingAuthority.SEC, "GB": FilingAuthority.FCA, "CA": FilingAuthority.SEDAR}


def parse_order(text: str | None) -> tuple[str, ...]:
    """The investor's one source order from settings: plugin ids or provider names, comma or space separated."""
    return tuple(dict.fromkeys(item.strip().lower() for item in re.split(r"[,\s]+", text or "") if item.strip()))


def ranked(entries: list[dict], order: tuple[str, ...], default_order: tuple[str, ...]) -> list[dict]:
    """Entries (each with `plugin` and `provider`) in the investor's order, then core's default order, then by id.

    An entry marked `unaudited` (a source not yet signed off, ADR 0042) is never in core's order: it follows
    every audited entry unless the investor's order names it."""
    def position(items: tuple[str, ...], entry: dict) -> int:
        return next((index for index, name in enumerate(items) if name in (entry["plugin"], entry["provider"])),
                    len(items))
    return sorted(entries, key=lambda entry: (position(order, entry), entry.get("unaudited", False),
                                              position(default_order, entry), entry["plugin"]))


def not_covered(result: Any) -> str | None:
    """The source's message when a read answer says it does not cover the subject (`NOT_COVERED`), else None."""
    if not isinstance(result, dict) or result.get("outcome") == "error":
        return None
    issue = next((item for item in result.get("issues") or [] if isinstance(item, dict)
                  and item.get("code") == NOT_COVERED), None)
    return None if issue is None else str(issue.get("message") or "does not cover this subject")


def select(entries: list[dict], *, combine: Combine | None = None, order: tuple[str, ...] = ()
           ) -> tuple[list[tuple[dict, tuple[str, ...]]], list[dict], list[dict]]:
    """(chosen with the authorities each serves, alternatives, skipped) from ranked entries. Pure: no I/O.

    Each entry has `plugin`, `status` and, for a combining concept, `authorities`. The first eligible entry
    serves; under `per_authority` the first eligible entry serving each authority serves it; under `merge` and
    `side_by_side` every eligible entry serves, except that a source not yet signed off (`unaudited`) serves only
    when the investor's `order` names it or no audited entry is eligible. The other eligible entries are
    alternatives; the rest are skipped with their status as the reason."""
    eligible = [entry for entry in entries if entry["status"] in ELIGIBLE]
    skipped = [entry for entry in entries if entry["status"] not in ELIGIBLE]
    if combine is Combine.PER_AUTHORITY:
        served: dict[str, str] = {}
        for entry in eligible:
            for authority in entry.get("authorities", ()):
                served.setdefault(authority, entry["plugin"])
        chosen = [(entry, tuple(a for a, plugin in served.items() if plugin == entry["plugin"]))
                  for entry in eligible if entry["plugin"] in served.values()]
    elif combine in (Combine.MERGE, Combine.SIDE_BY_SIDE):
        audited = [entry for entry in eligible if not entry.get("unaudited")
                   or {entry["plugin"], entry.get("provider")} & set(order)]
        chosen = [(entry, ()) for entry in audited or eligible]
    else:
        chosen = [(eligible[0], ())] if eligible else []
    taken = {entry["plugin"] for entry, _ in chosen}
    return chosen, [entry for entry in eligible if entry["plugin"] not in taken], skipped
