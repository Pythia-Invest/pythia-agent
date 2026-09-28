"""Local search (ADR 0037): the directory derived from the reference file, and its search groups.

Search is one local read: no provider call, no identity write, no reconciliation.
The directory is an in-memory FTS5 index built once per reference file and
rebuilt when the file changes; `ranking` scores its lines. Each line knows its
instrument (`inst`: a security with what `fold` relations fold into it, such as
its depositary receipts) and its search group (`grp`: the company for its
equity, the product itself for a fund, ETF or note, the asset for crypto).
Results are search groups, each with its relevant listings first.
"""
from __future__ import annotations

import logging
import re
import sqlite3
import threading
from pathlib import Path
from typing import Any, Callable, Iterable

from . import ranking
from .model import fold_roots
from .ranking import logrank, norm, tnorm
from .vocabulary import ISSUER_INTERESTS

logger = logging.getLogger(__name__)
VENUE_WORDS = {"nasdaq": "XNAS", "nyse": "XNYS", "amsterdam": "XAMS", "xetra": "XETR", "paris": "XPAR",
               "frankfurt": "XFRA", "milan": "XMIL", "otc": "OTCM"}
US_LISTED = ("XNAS", "XNYS", "XCBO")
# Which listing represents an instrument, unless the query names one (settings.json `search_listing_preference`).
PREFERENCES = ("primary", "EU", "US")
# The search contract's kinds (packages/market-data/src/search.ts); the reference holds a subset.
KINDS = ("ordinary", "preferred", "depositary_receipt", "etf", "fund", "bond", "index", "fx", "coin", "token", "other")
SHOWN = 3  # compact listing rows per company group before "all listings"
MAX_ROWS = 40  # listings one group carries at most

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


DOC = """CREATE TABLE doc (
  id INTEGER PRIMARY KEY, listing TEXT, security TEXT, issuer TEXT, grp TEXT, kind TEXT, crypto INTEGER,
  ticker TEXT, tnorm TEXT, name TEXT, names TEXT, isin TEXT, lei TEXT, cik TEXT, figis TEXT, mic TEXT,
  venue TEXT, country TEXT, currency TEXT, prim INTEGER, home INTEGER, otc INTEGER, deriv INTEGER, fund INTEGER,
  dr INTEGER, fus INTEGER, size REAL, inst TEXT, ikind TEXT)"""
DOC_COLUMNS = ("id listing security issuer grp kind crypto ticker tnorm name names isin lei cik figis mic venue country "
               "currency prim home otc deriv fund dr fus size inst ikind").split()


class Directory:
    """The search directory of one reference file."""

    def __init__(self, reference: sqlite3.Connection):
        self.db = sqlite3.connect(":memory:", check_same_thread=False)
        self.db.execute(DOC)
        self._load(reference)
        self.db.execute("CREATE VIRTUAL TABLE fts USING fts5(ticker, names, content='doc', content_rowid='id',"
                        " tokenize=\"unicode61 remove_diacritics 2\", prefix='2 3 4')")
        self.db.execute("INSERT INTO fts(rowid, ticker, names) SELECT id, coalesce(ticker, ''), names FROM doc")
        for column in ("tnorm", "isin", "lei", "cik", "grp", "security", "inst"):
            self.db.execute(f"CREATE INDEX doc_{column} ON doc ({column})")
        self.db.execute("CREATE TABLE gsize AS SELECT grp, max(size) g FROM doc GROUP BY grp")
        self.db.execute("CREATE INDEX gsize_grp ON gsize (grp)")
        self.vocab: dict[str, float] = {}
        for names, ticker, size in self.db.execute("SELECT d.names, d.ticker, s.g FROM doc d JOIN gsize s USING (grp)"):
            for token in set(norm(names).split()) | ({ticker.lower()} if ticker else set()):
                if len(token) >= 3:
                    self.vocab[token] = max(self.vocab.get(token, 0), size or 0)
        self.db.commit()
        self.lock = threading.Lock()

    def _load(self, ref: sqlite3.Connection) -> None:
        def many(sql: str) -> dict[str, list[str]]:
            out: dict[str, list[str]] = {}
            for key, value in ref.execute(sql):
                out.setdefault(key, []).append(value)
            return out

        venues = {row[0]: (row[1], row[2]) for row in ref.execute("SELECT mic, name, country FROM venues")}
        issuers = {row[0]: (row[1], row[2]) for row in ref.execute("SELECT id, name, country FROM issuers")}
        ids = many("SELECT subject_id, scheme || ':' || value FROM assertions WHERE scheme IN"
                   " ('isin', 'lei', 'cik', 'figi', 'composite_figi', 'share_class_figi', 'caip19')")
        names = many("SELECT subject_id, name FROM names")
        units, odd = fold_roots(ref.execute("SELECT type, from_id, to_id FROM relations"))
        if odd:  # the builder's report and the reference audit list them
            logger.warning("reference fold relations: %d second targets and cycles kept apart", len(odd))
        rows = ref.execute(
            "SELECT l.id, l.security_id, l.composite_id, l.mic, l.operating_mic, l.ticker, l.currency, l.chain,"
            " l.is_primary, s.issuer_id, s.name, s.kind, s.asset_class, s.rank FROM listings l"
            " JOIN securities s ON s.id = l.security_id WHERE l.status <> 'inactive' AND s.status <> 'inactive'")
        docs = []
        for index, row in enumerate(rows, 1):
            (listing, security, composite, mic, operating, ticker, currency, chain, primary, issuer, name, kind,
             asset_class, rank) = row
            if not ticker:
                continue
            values = {item.split(":", 1)[0]: item.split(":", 1)[1] for key in (listing, security, composite, issuer)
                      for item in ids.get(key or "", [])}
            figis = " ".join(item.split(":", 1)[1] for key in (listing, security, composite)
                             for item in ids.get(key or "", []) if "figi:" in item)
            issuer_name, issuer_country = issuers.get(issuer or "", (None, None))
            crypto = asset_class == "crypto"
            venue_name, venue_country = venues.get(mic or "", (None, None))
            op = operating or mic
            isin = values.get("isin")
            primary_names = [name, issuer_name, *names.get(listing, [])]
            aliases = [*names.get(issuer or "", []), *names.get(security, [])]
            label = " | ".join(dict.fromkeys(filter(None, primary_names)))
            label += " || " + " | ".join(dict.fromkeys(filter(None, aliases))) if aliases else ""
            home = crypto or bool((isin and isin[:2] == venue_country) or (issuer_country and issuer_country == venue_country)
                                  or (not issuer_country and op in US_LISTED and not isin))
            docs.append(dict(zip(DOC_COLUMNS, (
                index, security if crypto else listing, security, issuer, None, kind, int(crypto),
                ticker, tnorm(ticker), (issuer_name if not crypto else None) or name, label, isin, values.get("lei"),
                (values.get("cik") or "").lstrip("0") or None, figis, op if not crypto else None,
                venue_name, venue_country if not crypto else None, currency, int(bool(primary)), int(home),
                int(op == "OTCM"), int(kind == "other"), int(kind in ("fund", "etf")), int(kind == "depositary_receipt"),
                int(bool(issuer_country and issuer_country != "US" and op in (*US_LISTED, "OTCM"))), logrank(rank),
                security, kind))))
        # Relations with `fold` behaviour (vocabulary.RELATIONS) make one unit of the same economic thing: a receipt
        # folds into its share (`inst`, the page's listings). A unit that is an interest in its issuer
        # (vocabulary.ISSUER_INTERESTS) groups under the issuer's company (`grp`, search's company groups); a fund,
        # an ETF or a crypto asset is its own group.
        kinds = {doc["security"]: doc["kind"] for doc in docs}
        issuers_of = {doc["security"]: doc["issuer"] for doc in docs}
        for doc in docs:
            unit = units.get(doc["security"])
            unit = unit if unit in kinds else doc["security"]  # a unit outside the directory folds nothing in
            company = issuers_of[unit] if kinds[unit] in ISSUER_INTERESTS else None
            doc.update(inst=unit, ikind=kinds[unit], grp=company or unit)
        self.db.executemany(f"INSERT INTO doc VALUES ({','.join('?' * len(DOC_COLUMNS))})",
                            [tuple(doc.values()) for doc in docs])

    # ---- query side ------------------------------------------------------------------------------------------

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
              suffixes: Callable[[], dict[str, set[str]]] = dict) -> list[tuple[float, dict, tuple]]:
        """Scored directory lines for a query: (score, line, representative key).

        `suffixes` maps a provider symbol suffix (".AS") to the operating MICs it names."""
        kind, value = classify(query)
        by_id = {"isin": "d.isin = ?", "lei": "d.lei = ?", "cik": "d.cik = ?",
                 "figi": "(' ' || d.figis || ' ') LIKE ?", "pair": "d.crypto = 1 AND d.tnorm = ?"}
        with self.lock:
            if kind in by_id:
                argument = f"% {value} %" if kind == "figi" else value
                return ranking.score_lines(self._fetch(by_id[kind], (argument,)), query, prefer, id_rows=True)
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
            return ranking.score_lines(found.values(), query, prefer, exact=exact, hint=hint, fuzzy=fuzzy)

    def instrument_listings(self, security: str) -> list[dict]:
        """The listings of the instrument a security belongs to: its own lines, then those of each security
        that folds into it (a receipt), one security after another. The instrument's primary (else home,
        exchange) listing comes first and is marked primary, even when a receipt carries its own primary flag.
        Empty for a security not in the directory."""
        with self.lock:
            rows = self.db.execute(
                "SELECT listing, ticker, mic, venue, currency, kind, security <> inst FROM doc"
                " WHERE inst = (SELECT inst FROM doc WHERE security = ? LIMIT 1) AND crypto = 0"
                " ORDER BY security <> inst, security, prim DESC, fus, otc, home DESC, mic, listing",
                (security,)).fetchall()
        # `folded`: a line of a security that folds into the instrument (a receipt), not of the instrument's own.
        return [dict(zip(("id", "ticker", "mic", "venue", "currency", "kind"), row), folded=bool(row[6]),
                     primary=index == 0) for index, row in enumerate(rows)]

    def other_instruments(self, security: str) -> list[dict]:
        """The other instruments of a security's search group (a company's other share classes, preferreds and
        warrants), each with its own name and its representative line: the primary, else an exchange line. Empty
        for a fund, ETF, note or crypto asset, which is its own group."""
        with self.lock:
            rows = self.db.execute(
                "SELECT inst, names, ikind, listing, ticker, mic, venue, currency, size FROM doc d JOIN"
                " (SELECT grp, inst AS own FROM doc WHERE security = ? LIMIT 1) me ON d.grp = me.grp AND d.inst <> me.own"
                " WHERE d.crypto = 0 ORDER BY d.inst, d.security <> d.inst, -d.prim, d.fus, d.otc, -d.home, d.mic, d.listing",
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
               bindings: Callable[[list[str]], dict[str, list[dict]]] = lambda ids: {}) -> dict[str, Any]:
        """The SearchResponse (packages/market-data/src/search.ts): listings grouped per company (ADR 0037), a
        fund, ETF or crypto asset on its own. Groups compete by their best line; each group's first `shown`
        rows are its relevant listings, the rest are for "all listings"."""
        allowed = set(kinds) if kinds else None
        groups: dict[str, list] = {}
        for score, line, key in self.lines(query, prefer, suffixes):
            # A type filter matches the instrument or the line (a folded receipt for "depositary_receipt").
            if allowed is not None and line["ikind"] not in allowed and line["kind"] not in allowed:
                continue
            group = groups.setdefault(line["grp"], [score, {}])
            group[0] = max(group[0], score)
            group[1].setdefault(line["security"], []).append((score, key, line))
        chosen = sorted(groups.items(), key=lambda item: -item[1][0])[:limit]
        out = []
        for key, (_score, securities) in chosen:
            # The lead is the best line of the best instrument (receipts folded in), then the main share's
            # primary listing and a line of each other matched security (receipts, classes): one the query
            # names, else that security's own primary listing.
            folded: dict[str, list] = {}
            for members in securities.values():
                folded.setdefault(members[0][2]["inst"], []).extend(members)
            lead = max(max(folded.values(), key=lambda m: _order(m, "ikind")), key=lambda entry: entry[1])[2]
            best = [max(members, key=lambda entry: (entry[1][:2], entry[2]["prim"], entry[1]))[2]
                    for members in sorted(securities.values(), key=lambda m: _order(m, "kind"), reverse=True)]
            everything = self._group_lines(key)
            shown: list[dict] = []
            for line in [lead, *everything[:1], *best]:
                if len(shown) < SHOWN and all(line["listing"] != item["listing"] for item in shown):
                    shown.append(line)
            rest = [line for line in everything if all(line["listing"] != item["listing"] for item in shown)]
            out.append((key, lead, [*shown, *rest][:MAX_ROWS], len(shown)))
        bound = bindings([line["listing"] for *_head, rows, _shown in out for line in rows])

        def row(line: dict) -> dict:
            return {"id": line["listing"], "ticker": line["ticker"], "name": _own(line["names"]) or line["name"],
                    "kind": line["kind"], "mic": line["mic"], "venue": line["venue"], "country": line["country"],
                    "currency": line["currency"], "bindings": bound.get(line["listing"], [])[:16]}

        return {"groups": [{"id": key, "name": lead["name"], "kind": lead["ikind"], "shown": shown,
                            "rows": [row(line) for line in rows]} for key, lead, rows, shown in out],
                "lookup": []}

    def _group_lines(self, key: str) -> list[dict]:
        """Every listing of a search group: the main share's lines first (primary, then exchange, then OTC),
        then other share classes, receipts, preferreds and notes."""
        with self.lock:
            lines = self._fetch("d.grp = ?", (key,))
        lines.sort(key=lambda line: (-KIND_ORDER.get(line["kind"], 1), -(line["size"] or 0), line["security"],
                                     -line["prim"], line["fus"], line["otc"], -line["home"], line["mic"] or "",
                                     line["listing"]))
        seen: set[str] = set()  # a crypto asset's chain deployments are one listing
        return [line for line in lines if not (line["listing"] in seen or seen.add(line["listing"]))]


def _own(names: str | None) -> str | None:
    """A line's own security name (a share class, a receipt): the first of its search names."""
    return (names or "").split("||")[0].split("|")[0].strip() or None


KIND_ORDER = {"ordinary": 3, "coin": 3, "depositary_receipt": 2}  # notes, funds and preferreds rank below


def _order(members: list, kind: str) -> tuple:
    """Order a group's instruments ("ikind", receipts folded in) or securities ("kind"): one whose line the
    query names (venue, exact ticker) first, then the main share before a receipt before notes, funds and
    preferreds, then the best line score."""
    return (max(key[:2] for _score, key, _line in members), KIND_ORDER.get(members[0][2][kind], 1),
            max(score for score, _key, _line in members))


_cache: dict[str, tuple[tuple, Directory]] = {}
_cache_lock = threading.Lock()


def directory(path: Path, open_reference: Callable[[Path], sqlite3.Connection]) -> Directory:
    """The directory for a reference file, rebuilt when the file changes."""
    info = Path(path).stat()
    stamp = (str(path), info.st_mtime_ns, info.st_size)
    with _cache_lock:
        cached = _cache.get("current")
        if cached and cached[0] == stamp:
            return cached[1]
        reference = open_reference(path)
        try:
            built = Directory(reference)
        finally:
            reference.close()
        _cache["current"] = (stamp, built)
        return built
