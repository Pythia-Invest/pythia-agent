"""Local search (ADR 0037): the directory of the reference file and the device's subjects, and its search groups.

Search is one local read: no provider call, no identity write, no reconciliation.
The directory is an in-memory FTS5 index of the reference's lines, built once per
reference file, with the device's part (`search_device`) laid over it in place
whenever the device's state changes (`renew`); `ranking` scores every line alike,
whatever its origin. Each line knows its instrument (`inst`: a security with what
`fold` relations fold into it, such as its depositary receipts) and its search group
(`grp`: the company for its equity, the product itself for a fund, ETF or note, the
asset for crypto, a pool or protocol its own). Results are search groups, each with
its relevant listings first.
"""
from __future__ import annotations

import re
import sqlite3
import threading
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping

from . import ranking
from .ranking import norm, tnorm
from .search_index import DOC_COLUMNS, Index

VENUE_WORDS = {"nasdaq": "XNAS", "nyse": "XNYS", "amsterdam": "XAMS", "xetra": "XETR", "paris": "XPAR",
               "frankfurt": "XFRA", "milan": "XMIL", "otc": "OTCM"}
# Which listing represents an instrument, unless the query names one (settings.json `search_listing_preference`).
PREFERENCES = ("primary", "EU", "US")
# The search contract's kinds (packages/market-data/src/search.ts); the reference holds a subset.
KINDS = ("ordinary", "preferred", "depositary_receipt", "etf", "fund", "bond", "index", "fx", "coin", "token", "other",
         "market", "protocol")
SHOWN = 3  # relevant listing rows a search group carries
# A line the page lists and prices through: not dormant (its line or its security is inactive) and not a tickerless row.
LIVE = "dormant = 0 AND tickerless = 0"
GROUP_ROWS = 500  # listings one group read ("all listings") carries at most

ISIN = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")
LEI = re.compile(r"^[A-Z0-9]{18}[0-9]{2}$")
FIGI = re.compile(r"^BBG[0-9A-Z]{9}$")
CIK = re.compile(r"^\d{6,10}$")


def classify(query: str) -> tuple[str, str]:
    compact = query.strip().upper().replace(" ", "")
    if FIGI.match(compact):
        return "figi", compact
    if ISIN.match(compact):
        return "isin", compact
    if LEI.match(compact):
        return "lei", compact
    if CIK.match(compact):
        return "cik", compact.lstrip("0")
    if compact.endswith("-USD") or compact.endswith("-USDT"):
        return "pair", compact.split("-")[0]
    return "text", query.strip()


class Directory(Index):
    """The search directory: the index (`search_index`) and its queries."""

    COLUMNS = (*DOC_COLUMNS, "g")

    def _fetch(self, where: str, args: tuple) -> list[dict]:
        sql = f"SELECT d.*, s.g FROM doc d JOIN gsize s USING (grp) WHERE {where}"
        return [dict(zip(self.COLUMNS, row)) for row in self.db.execute(sql, args)]

    def _fts(self, tokens: list[str], limit: int = 400) -> list[dict]:
        expression = " AND ".join(f'"{token}"' if len(token) == 1 else f'"{token}"*' for token in tokens)
        sql = ("SELECT d.*, s.g, bm25(fts, 5.0, 1.0) FROM fts JOIN doc d ON d.id = fts.rowid JOIN gsize s USING (grp)"
               f" WHERE fts MATCH ? ORDER BY bm25(fts, 5.0, 1.0) LIMIT {limit}")
        return [dict(zip([*self.COLUMNS, "bm25"], row)) for row in self.db.execute(sql, (expression,))]

    def _fuzzy(self, token: str) -> str | None:
        """Closest vocabulary token (edit distance 1 up to six letters, else 2), same first letter."""
        if len(token) < 4:
            return None
        limit, best = (1 if len(token) <= 6 else 2), None
        for word, size in self.vocab.items():
            if word[0] != token[0] or abs(len(word) - len(token)) > limit:
                continue
            distance = ranking.distance(token, word, limit)
            if distance <= limit and (best is None or (distance, -size) < best[0]):
                best = ((distance, -size), word)
        return best[1] if best else None

    def lines(self, query: str, prefer: str = "primary",
              suffixes: Callable[[], dict[str, set[str]]] = dict,
              priced: Mapping[str, frozenset[str]] = {}) -> list[tuple[float, dict, tuple]]:
        """Scored directory lines for a query: (score, line, representative key).

        `suffixes` maps a provider symbol suffix (".AS") to the operating MICs it names; `priced` maps the
        operating MICs where an installed plugin can address a quote from the line's ticker to the asset
        classes it covers (empty: any)."""
        kind, value = classify(query)
        by_id = {"isin": "d.isin = ?", "lei": "d.lei = ?", "cik": "d.cik = ?",
                 "figi": "(' ' || d.figis || ' ') LIKE ?", "pair": "d.crypto = 1 AND d.tnorm = ?"}
        with self.lock:
            if kind in by_id:
                argument = f"% {value} %" if kind == "figi" else value
                return ranking.score_lines(self._fetch(by_id[kind], (argument,)), query, prefer, id_rows=True,
                                           priced=priced)
            tokens, hint = norm(query).split(), None
            if len(tokens) > 1:
                for token in list(tokens):
                    if token in VENUE_WORDS:
                        hint = {VENUE_WORDS[token]}
                        tokens.remove(token)
            if not tokens:
                return []
            exact = tnorm(query) if len(query) <= 12 and " " not in query.strip() else None
            found = {row["id"]: row for row in self._fetch("d.tnorm = ?", (exact,))} if exact else {}
            if exact and not found and "." in query:  # a provider symbol such as ASML.AS: its root on that venue
                root, suffix = query.strip().rsplit(".", 1)
                exact, tokens = tnorm(root), norm(root).split() or tokens
                hint = suffixes().get(f".{suffix.upper()}", hint)  # EODHD ".US" names several venues
                found = {row["id"]: row for row in self._fetch("d.tnorm = ?", (exact,))}
            fuzzy = False
            try:
                hits = self._fts(tokens)
            except sqlite3.OperationalError:
                hits = []
            if not hits:
                fixed = []
                for token in tokens:
                    known = bool(self._fts([token], 1))
                    fixed.append(token if known else (self._fuzzy(token) or ("" if len(tokens) > 1 else token)))
                fixed, fuzzy = [token for token in fixed if token], True
                if fixed and fixed != tokens:
                    hits, query = self._fts(fixed), " ".join(fixed)
            for hit in hits:
                found.setdefault(hit["id"], hit)
            return ranking.score_lines(found.values(), query, prefer, exact=exact, hint=hint, fuzzy=fuzzy,
                                       priced=priced)

    def instrument_listings(self, security: str) -> list[dict]:
        """The listings of the instrument a security belongs to: its own lines, then those of each security
        that folds into it (a receipt), one security after another. The instrument's primary (else home,
        exchange) listing comes first; it is marked primary only when flagged so, never a receipt's line.
        Empty for a security not in the directory."""
        with self.lock:
            rows = self.db.execute(
                "SELECT listing, ticker, mic, venue, currency, kind, security <> inst, prim, liq FROM doc"
                f" WHERE inst = (SELECT inst FROM doc WHERE security = ? AND {LIVE} LIMIT 1) AND crypto = 0"
                f" AND {LIVE}"
                " ORDER BY security <> inst, security, prim DESC, fus, otc, home DESC, liq DESC, mic, listing",
                (security,)).fetchall()
        # `folded`: a line of a security that folds into the instrument (a receipt), not of the instrument's own.
        # Only a flagged line of the instrument's own security is its primary; with none, no line claims it.
        # With no primary, the first line may be FIRDS' most liquid EU market: labelled so, never primary.
        return [dict(zip(("id", "ticker", "mic", "venue", "currency", "kind"), row), folded=bool(row[6]),
                     primary=index == 0 and not row[6] and bool(row[7]),
                     most_liquid=index == 0 and not row[6] and not row[7] and bool(row[8]))
                for index, row in enumerate(rows)]

    def other_instruments(self, security: str) -> list[dict]:
        """The other instruments of a security's search group (a company's other share classes, preferreds and
        warrants), each with its own name and its representative line: the primary, else an exchange line. Empty
        for a fund, ETF, note or crypto asset, which is its own group."""
        with self.lock:
            rows = self.db.execute(
                "SELECT inst, names, ikind, listing, ticker, mic, venue, currency, size FROM doc d JOIN"
                f" (SELECT grp, inst AS own FROM doc WHERE security = ? AND {LIVE} LIMIT 1) me ON d.grp = me.grp"
                " AND d.inst <> me.own WHERE d.crypto = 0 AND d.dormant = 0 AND d.tickerless = 0"
                " ORDER BY d.inst, d.security <> d.inst, -d.prim, d.fus, d.otc, -d.home, -d.liq, d.mic, d.listing",
                (security,)).fetchall()
        seen: dict[str, tuple] = {}
        for row in rows:
            seen.setdefault(row[0], row)  # the instrument's first line in the listing selector's order
        ordered = sorted(seen.values(), key=lambda row: (-(row[8] or 0), row[0]))
        return [{"id": inst, "name": _own(names), "kind": kind, "listing": listing, "ticker": ticker, "mic": mic,
                 "venue": venue, "currency": currency}
                for inst, names, kind, listing, ticker, mic, venue, currency, _size in ordered]

    def search(self, query: str, *, limit: int, kinds: Iterable[str] | None = None, prefer: str = "primary",
               suffixes: Callable[[], dict[str, set[str]]] = dict,
               priced: Callable[[], Mapping[str, frozenset[str]]] = dict, delisted: bool = True) -> dict[str, Any]:
        """The SearchResponse (packages/market-data/src/search.ts): core's search groups (ADR 0037). Groups compete
        by their best line, a group with a live line before one with only delisted lines, and one with a ticker before
        one with none; each carries its relevant
        listings (at most `SHOWN`) and how many it has in all. `delisted=False` leaves delisted lines out."""
        allowed = set(kinds) if kinds else None
        groups: dict[str, list] = {}
        venues = priced()  # read before taking the directory lock
        for score, line, key in self.lines(query, prefer, suffixes, venues):
            if not _allowed(line, allowed, delisted):
                continue
            # A group's rank: its best live line with a ticker, else its best tickerless one, then its delisted ones.
            rank = (int(not line["delisted"]), int(not line["tickerless"]), score)
            group = groups.setdefault(line["grp"], [rank, {}])
            group[0] = max(group[0], rank)
            group[1].setdefault(line["security"], []).append((score, key, line))
        out = []
        for key, (_score, securities) in sorted(groups.items(), key=lambda item: item[1][0], reverse=True)[:limit]:
            # The lead is the best line of the best instrument (receipts folded in), then the main share's
            # primary listing (only a flagged one) and a line of each other matched security (receipts,
            # classes): one the query names, else that security's own primary listing.
            folded: dict[str, list] = {}
            for members in securities.values():
                folded.setdefault(members[0][2]["inst"], []).extend(members)
            lead = max(max(folded.values(), key=lambda m: _order(m, "ikind")), key=lambda entry: entry[1])[2]
            best = [max(members, key=lambda entry: (entry[1][:4], entry[2]["prim"], entry[1]))[2]
                    for members in sorted(securities.values(), key=lambda m: _order(m, "kind"), reverse=True)]
            everything = self._group_lines(key, allowed, delisted)
            primary = everything[:1] if everything and everything[0]["prim"] else []
            shown: list[dict] = []
            for line in [lead, *primary, *best]:
                if len(shown) < SHOWN and all(line["listing"] != item["listing"] for item in shown):
                    shown.append(line)
            out.append(_group(key, lead, shown, max(len(everything), len(shown))))
        return {"groups": out}

    def group(self, key: str, *, kinds: Iterable[str] | None = None, delisted: bool = True) -> dict[str, Any]:
        """One search group with all its listings (at most `GROUP_ROWS`), in `_group_lines` order: the SearchResponse
        a group's "All N listings" reads. No groups for an unknown key."""
        everything = self._group_lines(key, set(kinds) if kinds else None, delisted)
        if not everything:
            return {"groups": []}
        return {"groups": [_group(key, everything[0], everything[:GROUP_ROWS], len(everything))]}

    def _group_lines(self, key: str, allowed: set[str] | None = None, delisted: bool = True) -> list[dict]:
        """Every listing of a search group that the type filter allows: the live lines, then the delisted ones, the
        tickerless security rows last of each; each with the main share's lines first (primary, then exchange, then
        OTC), then other share classes, receipts, preferreds and notes."""
        with self.lock:
            lines = self._fetch("d.grp = ?", (key,))
        lines.sort(key=lambda line: (line["delisted"], line["tickerless"], -KIND_ORDER.get(line["kind"], 1),
                                     -(line["size"] or 0), line["security"],
                                     -line["prim"], line["fus"], line["otc"], -line["home"], -line["liq"], line["mic"] or "",
                                     line["listing"]))
        seen: set[str] = set()  # a crypto asset's chain deployments are one listing
        return [line for line in lines if _allowed(line, allowed, delisted)
                and not (line["listing"] in seen or seen.add(line["listing"]))]


def _allowed(line: dict, allowed: set[str] | None, delisted: bool = True) -> bool:
    """A type filter matches the instrument or the line (a folded receipt for "depositary_receipt"); a delisted
    line shows unless `delisted` is off."""
    return (delisted or not line["delisted"]) and (
        allowed is None or line["ikind"] in allowed or line["kind"] in allowed)


def _group(key: str, lead: dict, lines: list[dict], listings: int) -> dict:
    """A SearchGroup: named by its lead line, with these listing rows and its true listing count. Each row names
    its instrument (`inst`), which the page opens, and its own listing, which the page shows.

    In a company's group, the lines of its lead instrument (receipts folded in; the row's kind names a receipt)
    carry the company's name, not the security's FIRDS short name ("HSBC Hldgs PLC DL-,50"). Another instrument
    (a share class, a preferred) and a fund's or crypto asset's line keep their own security name."""
    return {"id": key, "name": lead["name"], "kind": lead["ikind"], "listings": listings,
            "rows": [{"id": line["listing"], "instrument": line["inst"], "ticker": line["ticker"],
                      "name": line["name"] if line["inst"] == lead["inst"] and line["grp"] != line["inst"] else
                      _own(line["names"]) or line["name"], "kind": line["kind"], "mic": line["mic"],
                      "venue": line["venue"], "country": line["country"], "currency": line["currency"],
                      **({"source": line["source"]} if line["source"] else {}),  # a plugin's subject names it
                      **({"delisted": True} if line["delisted"] else {}),
                      **({"no_ticker": True} if line["tickerless"] else {})}
                     for line in lines]}


def _own(names: str | None) -> str | None:
    """A line's own security name (a share class, a receipt): the first of its search names."""
    return (names or "").split("||")[0].split("|")[0].strip() or None


KIND_ORDER = {"ordinary": 3, "coin": 3, "depositary_receipt": 2}  # notes, funds and preferreds rank below


def _order(members: list, kind: str) -> tuple:
    """Order a group's instruments ("ikind", receipts folded in) or securities ("kind"): one whose line the
    query names (venue, exact ticker) first, then the main share before a receipt before notes, funds and
    preferreds, then the best line score."""
    return (max(key[:4] for _score, key, _line in members), KIND_ORDER.get(members[0][2][kind], 1),
            max(score for score, _key, _line in members))


_cache: dict[str, tuple[tuple, Directory]] = {}
_cache_lock = threading.Lock()


def directory(path: Path | None, open_reference: Callable[[Path | None], sqlite3.Connection],
              contested: frozenset = frozenset(), device: Callable[[sqlite3.Connection], Any] | None = None,
              key: tuple = ()) -> Directory:
    """The directory for the installed reference file (None: none; `open_reference` then gives an empty one). Its
    reference part is rebuilt only when the file or the plugin relations contesting its folds change; `device`, from
    the device state `key` names (`search_device`), is laid over it in place whenever that state changes (`renew`)."""
    info = Path(path).stat() if path else None
    stamp = ((str(path), info.st_mtime_ns, info.st_size) if info else None, contested)
    with _cache_lock:
        cached = _cache.get("current")
        built = cached[1] if cached and cached[0] == stamp else None
        if built is None or (device is not None and built.key != key):
            reference = open_reference(path)
            try:
                built = built or Directory(reference, contested)
                if device is not None:
                    built.renew(reference, device(reference), key)
            except BaseException:  # a renew that failed partway never serves its half-written index
                _cache.pop("current", None)
                raise
            finally:
                reference.close()
            _cache["current"] = (stamp, built)
        return built
