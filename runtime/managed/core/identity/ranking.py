"""Search ranking (ADR 0037): text normalisation and the additive score of directory lines.

One versioned, gold-calibrated score (`W`, `RANKING_VERSION`): exact ticker or identifier, name match,
notability, primary and home line, penalties for OTC lines and derivatives, and a lexicographic key that
picks the listing representing an instrument.
"""
from __future__ import annotations

import math
import re
from typing import Iterable, Mapping

RANKING_VERSION = "ranking@1"
W = dict(exact_ticker=6.0, exact_id=20.0, name_exact=3.0, name_prefix=1.5, bm25=0.15, size=6.0, size_missing=0.3,
         prim=1.0, home=1.2, otc=-2.5, deriv=-3.0, fund=-0.3, dr=-0.3, venue=4.0, fuzzy=-0.5)
LEGAL = set("nv n v se ag inc corp corporation plc sa s a spa asa ab oyj the co company ltd limited holding holdings "
            "aktiengesellschaft aktiebolag aktiebolaget koninklijke group groep kgaa ohg abp inhaber aktien o".split())
EEA = frozenset("AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO".split())
# The last tie-break among otherwise equal lines of an instrument (after regulated market, home, primary and
# price): the largest EEA equity markets (as the reference builder's primary fallback), then Tradegate,
# Frankfurt and the German regional floors, then every other venue; then the listing ID.
VENUE_ORDER = ("XETR", "XPAR", "XAMS", "XMIL", "TGAT", "XFRA", "XSTU", "XMUN", "XDUS", "XHAM", "XHAN", "XBER")


def logrank(rank: int | None) -> float | None:
    """Notability comparable across sources: rank 1 -> 1.0, rank 100k -> 0."""
    return max(0.0, 1 - math.log10(rank) / 5) if rank else None


def notability(signals: Mapping[str, float] | None) -> float | None:
    """A plugin record's rank signals on `logrank`'s scale: its largest amount in US dollars (`*_usd`: market cap,
    total value locked), $1M -> 0 and $1T -> 1. None without one."""
    amounts = [value for key, value in (signals or {}).items() if key.endswith("_usd") and value > 0]
    return min(1.0, max(0.0, (math.log10(max(amounts)) - 6) / 6)) if amounts else None


def norm(text: str | None) -> str:
    return " ".join(re.findall(r"\w+", (text or "").lower()))


def core_name(text: str | None) -> str:
    return " ".join(token for token in norm(text).split() if token not in LEGAL)


def tnorm(text: str | None) -> str:
    return re.sub(r"[^A-Z0-9]", "", (text or "").upper())


def score_lines(lines: Iterable[dict], query: str, prefer: str, *, exact: str | None = None,
                hint: set[str] | None = None, id_rows: bool = False, fuzzy: bool = False,
                priced: Mapping[str, frozenset[str]] = {}) -> list[tuple[float, dict, tuple]]:
    """Each line's additive score and its representative key: (score, line, key). `priced` maps the operating
    MICs where an installed plugin can address a quote from the line's ticker to the asset classes it covers
    (empty: any)."""
    wanted_core, wanted = core_name(query), norm(query)
    out = []
    for line in lines:
        score = W["exact_id"] if id_rows else 0.0
        exact_hit = bool(exact and line["tnorm"] == exact)
        if exact_hit:
            score += W["exact_ticker"]
        primary, _, aliases = (line["names"] or "").partition("||")
        variants = [item.strip() for item in (primary + "|" + aliases).split("|") if item.strip()]
        cores, plains = [core_name(item) for item in variants], [norm(item) for item in variants]
        primary_cores = [core_name(item) for item in primary.split("|") if item.strip()]
        named = bool(wanted_core and wanted_core in primary_cores)  # the query is the name, not only its start
        if named:
            score += W["name_exact"]
        elif any(item.startswith(wanted) for item in plains) or (wanted_core and any(item.startswith(wanted_core) for item in cores)):
            score += W["name_prefix"]
        score += W["bm25"] * min(-line.get("bm25", 0.0), 20)
        score += W["size"] * (line["g"] if line["g"] is not None else W["size_missing"]) + (line["size"] or 0)
        score += (W["prim"] * line["prim"] + W["home"] * line["home"] + W["otc"] * line["otc"] + W["deriv"] * line["deriv"]
                  + W["fund"] * line["fund"] + W["dr"] * line["dr"])
        venue_hit = bool(hint and line["mic"] in hint)
        if venue_hit:
            score += W["venue"]
        if fuzzy:
            score += W["fuzzy"]
        # The representative listing of an instrument: lexicographic, not additive. A live line before a delisted
        # one, and one with a ticker before a tickerless one, whatever the query names; then a listing the query names first (its venue, or its exact ticker unless
        # the query is also the name: "relx", "ing"), then the preferred region, then any line but OTC, then the company's own shares over a non-US receipt folded into them
        # (a receipt's home and primary line, such as a Toronto CDR, never represents the shares; an ADR still
        # beats the shares' OTC line), then a regulated listing over open-market trading (ARM's Nasdaq line over
        # its Stuttgart open-market line), then the home and primary market, then a line an installed plugin can
        # price, then a fixed venue order (VENUE_ORDER) and the listing ID, so the pick never depends on hit order.
        preferred = (prefer == "EU" and line["country"] in EEA) or (prefer == "US" and line["country"] == "US"
                                                                     and not line["otc"])
        classes = priced.get(line["mic"] or "")
        priceable = classes is not None and (not classes or ("crypto" if line["crypto"] else "equity") in classes)
        venue = -VENUE_ORDER.index(line["mic"]) if line["mic"] in VENUE_ORDER else -len(VENUE_ORDER)
        key = (-line["delisted"], -line["tickerless"], int(venue_hit), int(exact_hit and not named), int(preferred), -line["otc"], -(line["dr"] and not line["fus"]), line["reg"],
               -line["fus"], -line["deriv"], line["home"], line["prim"], int(priceable), line["size"] or 0, venue,
               line["listing"])
        out.append((score, line, key))
    return out


def distance(a: str, b: str, limit: int) -> int:
    """Damerau-Levenshtein distance with an early exit above `limit`."""
    previous, before = list(range(len(b) + 1)), None
    for i, left in enumerate(a, 1):
        current, low = [i] + [0] * len(b), i
        for j, right in enumerate(b, 1):
            current[j] = min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (left != right))
            if before is not None and j > 1 and left == b[j - 2] and a[i - 2] == right:
                current[j] = min(current[j], before[j - 2] + 1)
            low = min(low, current[j])
        if low > limit:
            return limit + 1
        before, previous = previous, current
    return previous[-1]
