"""Local search (ADR 0037): the directory derived from the reference file, and its ranking.

Search is one local read: no provider call, no identity write, no reconciliation.
The directory is an in-memory FTS5 index built once per reference file and
rebuilt when the file changes. Ranking is additive (weights `W`, version
`RANKING_VERSION`, calibrated on the ranking gold set); results group by
security (a crypto asset is its own group), best line first.
"""
from __future__ import annotations

import math
import re
import sqlite3
import threading
from pathlib import Path
from typing import Any, Callable, Iterable

RANKING_VERSION = "ranking@1"
W = dict(exact_ticker=6.0, exact_id=20.0, name_exact=3.0, name_prefix=1.5, bm25=0.15, size=6.0, size_missing=0.3,
         prim=1.0, home=1.2, otc=-2.5, deriv=-3.0, fund=-0.3, dr=-0.3, venue=4.0, fuzzy=-0.5)
LEGAL = set("nv n v se ag inc corp corporation plc sa s a spa asa ab oyj the co company ltd limited holding holdings "
            "aktiengesellschaft aktiebolag aktiebolaget koninklijke group groep kgaa ohg abp inhaber aktien o".split())
VENUE_WORDS = {"nasdaq": "XNAS", "nyse": "XNYS", "amsterdam": "XAMS", "xetra": "XETR", "paris": "XPAR",
               "frankfurt": "XFRA", "milan": "XMIL", "otc": "OTCM"}
US_LISTED = ("XNAS", "XNYS", "XCBO")
# The search contract's kinds (packages/market-data/src/search.ts); the reference holds a subset.
KINDS = ("ordinary", "preferred", "depositary_receipt", "etf", "fund", "bond", "index", "fx", "coin", "token", "other")
MAX_ROWS = 8
PER_ISSUER = 2  # securities shown per issuer

ISIN = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")
LEI = re.compile(r"^[A-Z0-9]{18}[0-9]{2}$")
FIGI = re.compile(r"^BBG[0-9A-Z]{9}$")
CIK = re.compile(r"^\d{6,10}$")


def logrank(rank: int | None) -> float | None:
    """Notability comparable across sources: rank 1 -> 1.0, rank 100k -> 0."""
    return max(0.0, 1 - math.log10(rank) / 5) if rank else None


def norm(text: str | None) -> str:
    return " ".join(re.findall(r"\w+", (text or "").lower()))


def core_name(text: str | None) -> str:
    return " ".join(token for token in norm(text).split() if token not in LEGAL)


def tnorm(text: str | None) -> str:
    return re.sub(r"[^A-Z0-9]", "", (text or "").upper())


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
  venue TEXT, currency TEXT, prim INTEGER, home INTEGER, otc INTEGER, deriv INTEGER, fund INTEGER, dr INTEGER,
  fus INTEGER, size REAL, depositary_of TEXT)"""


class Directory:
    """The search directory of one reference file."""

    def __init__(self, reference: sqlite3.Connection):
        self.db = sqlite3.connect(":memory:", check_same_thread=False)
        self.db.execute(DOC)
        self._load(reference)
        self.db.execute("CREATE VIRTUAL TABLE fts USING fts5(ticker, names, content='doc', content_rowid='id',"
                        " tokenize=\"unicode61 remove_diacritics 2\", prefix='2 3 4')")
        self.db.execute("INSERT INTO fts(rowid, ticker, names) SELECT id, coalesce(ticker, ''), names FROM doc")
        for column in ("tnorm", "isin", "lei", "cik", "grp", "security"):
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
        receipts = dict(ref.execute("SELECT from_id, to_id FROM relations WHERE type = 'depositary_receipt_of'"))
        rows = ref.execute(
            "SELECT l.id, l.security_id, l.composite_id, l.mic, l.operating_mic, l.ticker, l.currency, l.chain,"
            " l.is_primary, s.issuer_id, s.name, s.kind, s.asset_class, s.rank FROM listings l"
            " JOIN securities s ON s.id = l.security_id WHERE l.status <> 'inactive' AND s.status <> 'inactive'")
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
            self.db.execute(
                "INSERT INTO doc VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (index, security if crypto else listing, security, issuer, issuer or security, kind, int(crypto),
                 ticker, tnorm(ticker), (issuer_name if not crypto else None) or name, label, isin, values.get("lei"),
                 (values.get("cik") or "").lstrip("0") or None, figis, op if not crypto else None,
                 venue_name, currency, int(bool(primary)), int(home), int(op == "OTCM"), int(kind == "other"),
                 int(kind in ("fund", "etf")), int(kind == "depositary_receipt"),
                 int(bool(issuer_country and issuer_country != "US" and op in (*US_LISTED, "OTCM"))),
                 logrank(rank), receipts.get(security)))

    # ---- query side ------------------------------------------------------------------------------------------

    COLUMNS = ("id listing security issuer grp kind crypto ticker tnorm name names isin lei cik figis mic venue "
               "currency prim home otc deriv fund dr fus size depositary_of g").split()

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
            distance = _distance(token, word, limit)
            if distance <= limit and (best is None or (distance, -size) < best[0]):
                best = ((distance, -size), word)
        return best[1] if best else None

    def lines(self, query: str) -> list[tuple[float, dict, tuple]]:
        """Scored directory lines for a query: (score, line, representative key)."""
        kind, value = classify(query)
        by_id = {"isin": "d.isin = ?", "lei": "d.lei = ?", "cik": "d.cik = ?",
                 "figi": "(' ' || d.figis || ' ') LIKE ?", "pair": "d.crypto = 1 AND d.tnorm = ?"}
        with self.lock:
            if kind in by_id:
                argument = f"% {value} %" if kind == "figi" else value
                return _score(self._fetch(by_id[kind], (argument,)), query, id_rows=True)
            tokens, hint = norm(query).split(), None
            if len(tokens) > 1:
                for token in list(tokens):
                    if token in VENUE_WORDS:
                        hint = VENUE_WORDS[token]
                        tokens.remove(token)
            if not tokens:
                return []
            exact = tnorm(query) if len(query) <= 12 and " " not in query.strip() else None
            found = {row["id"]: row for row in self._fetch("d.tnorm = ?", (exact,))} if exact else {}
            if exact and not found and "." in query:  # a provider symbol such as ASML.AS: try its root
                exact = tnorm(query.split(".")[0])
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
            return _score(found.values(), query, exact=exact, hint=hint, fuzzy=fuzzy)

    def search(self, query: str, *, limit: int, kinds: Iterable[str] | None = None,
               bindings: Callable[[list[str]], dict[str, list[dict]]] = lambda ids: {}) -> dict[str, Any]:
        """The SearchResponse (packages/market-data/src/search.ts) for one query."""
        allowed = set(kinds) if kinds else None
        # Rank issuers by their best line (an issuer's lines compete once); inside an issuer, its best
        # securities (see _security_order), at most PER_ISSUER of them.
        issuers: dict[str, list] = {}
        for score, line, key in self.lines(query):
            if allowed is not None and line["kind"] not in allowed:
                continue
            issuer = issuers.setdefault(line["grp"], [score, {}])
            issuer[0] = max(issuer[0], score)
            issuer[1].setdefault(line["security"], []).append((score, key, line))
        rows: dict[str, list[dict]] = {}
        for _score, securities in sorted(issuers.values(), key=lambda item: -item[0]):
            best = sorted(securities.items(), key=_security_order, reverse=True)
            for security, members in best[:PER_ISSUER]:  # an issuer's preferreds never crowd out other issuers
                # The primary listing first (the contract), then the best line for the query.
                ordered = sorted(members, key=lambda entry: (entry[2]["prim"], entry[1]), reverse=True)
                rows[security] = [line for _score, _key, line in ordered][:MAX_ROWS]
            if len(rows) >= limit:
                break
        rows = dict(list(rows.items())[:limit])
        bound = bindings([line["listing"] for lines in rows.values() for line in lines])
        names = self._names([line["depositary_of"] for lines in rows.values() for line in lines if line["depositary_of"]])
        result = []
        for security, lines in rows.items():
            head = lines[0]
            underlying = head["depositary_of"]
            result.append({
                "id": security, "name": head["name"], "kind": head["kind"],
                "depositary_of": {"id": underlying, "name": names.get(underlying, underlying)} if underlying else None,
                "rows": [{"id": line["listing"], "ticker": line["ticker"], "mic": line["mic"], "venue": line["venue"],
                          "currency": line["currency"], "bindings": bound.get(line["listing"], [])[:16]}
                         for line in lines]})
        return {"groups": result, "lookup": []}

    def _names(self, securities: list[str]) -> dict[str, str]:
        if not securities:
            return {}
        with self.lock:
            return dict(self.db.execute(
                f"SELECT security, name FROM doc WHERE security IN ({','.join('?' * len(securities))})", securities))


KIND_ORDER = {"ordinary": 3, "coin": 3, "depositary_receipt": 2}  # notes, funds and preferreds rank below


def _security_order(item: tuple[str, list]) -> tuple:
    """Order an issuer's securities: a venue named in the query, then the home line over a foreign
    issuer's US line, then an exact ticker, then an exchange line over OTC (representative-key fields),
    then the main share before a receipt before notes, funds and preferreds, then the best line score."""
    members = item[1]
    return (max(key[:3] + key[4:5] for _score, key, _line in members), KIND_ORDER.get(members[0][2]["kind"], 1),
            max(score for score, _key, _line in members))


def _score(lines: Iterable[dict], query: str, *, exact: str | None = None, hint: str | None = None,
           id_rows: bool = False, fuzzy: bool = False) -> list[tuple[float, dict, tuple]]:
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
        if wanted_core and wanted_core in primary_cores:
            score += W["name_exact"]
        elif any(item.startswith(wanted) for item in plains) or (wanted_core and any(item.startswith(wanted_core) for item in cores)):
            score += W["name_prefix"]
        score += W["bm25"] * min(-line.get("bm25", 0.0), 20)
        score += W["size"] * (line["g"] if line["g"] is not None else W["size_missing"]) + (line["size"] or 0)
        score += (W["prim"] * line["prim"] + W["home"] * line["home"] + W["otc"] * line["otc"] + W["deriv"] * line["deriv"]
                  + W["fund"] * line["fund"] + W["dr"] * line["dr"])
        venue_hit = bool(hint and line["mic"] == hint)
        if venue_hit:
            score += W["venue"]
        if fuzzy:
            score += W["fuzzy"]
        # The representative line inside a group: lexicographic, not additive.
        key = (int(venue_hit), -line["fus"], int(exact_hit), -line["deriv"], -line["otc"], line["home"], line["prim"],
               -line["dr"], line["size"] or 0)
        out.append((score, line, key))
    return out


def _distance(a: str, b: str, limit: int) -> int:
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
