"""Search's index (ADR 0037, amendment "search over reference and device"): one in-memory FTS5 table of directory
lines that `search.Directory` queries.

The reference's lines are built once per reference file. What the device adds (`search_device.Additions`: its
subjects' lines, and what enabled plugins state about the reference's) is laid over them in place by `renew`, whose
cost is the device's, not the reference's: a device line gets an ID above the reference's, and a reference line the
device restates is replaced under its own ID and put back by the next `renew`. Every line, whatever its origin, is
built by one function (`_docs`), so the same rules rank it.
"""
from __future__ import annotations

import json
import logging
import sqlite3
import threading
from collections import ChainMap
from typing import Any, Iterable, Mapping

from . import ranking, relations
from .evidence import level
from .model import fold_roots
from .ranking import logrank, norm, tnorm
from .trust import CONFIRM
from .vocabulary import ISSUER_INTERESTS

logger = logging.getLogger(__name__)
US_LISTED = ("XNAS", "XNYS", "XCBO")
SEARCHED = "('isin', 'lei', 'cik', 'figi', 'composite_figi', 'share_class_figi', 'caip19')"  # the identifiers indexed

DOC = """CREATE TABLE doc (
  id INTEGER PRIMARY KEY, listing TEXT, security TEXT, issuer TEXT, grp TEXT, kind TEXT, crypto INTEGER,
  ticker TEXT, tnorm TEXT, name TEXT, names TEXT, isin TEXT, lei TEXT, cik TEXT, figis TEXT, mic TEXT,
  venue TEXT, country TEXT, currency TEXT, prim INTEGER, home INTEGER, otc INTEGER, deriv INTEGER, fund INTEGER,
  dr INTEGER, fus INTEGER, size REAL, inst TEXT, ikind TEXT, reg INTEGER, liq INTEGER, trust INTEGER, source TEXT,
  line TEXT)"""
DOC_COLUMNS = ("id listing security issuer grp kind crypto ticker tnorm name names isin lei cik figis mic venue country "
               "currency prim home otc deriv fund dr fus size inst ikind reg liq trust source line").split()
LINE = ("SELECT l.id, l.security_id, l.composite_id, l.mic, l.operating_mic, l.ticker, l.trading_currency, l.chain,"
        " l.is_primary, s.issuer_id, s.name, s.kind, s.asset_class, s.rank, l.most_liquid FROM {} JOIN securities s"
        " ON s.id = l.security_id WHERE l.status <> 'inactive' AND s.status <> 'inactive'")
JOIN = LINE.format("listings l")  # every line of the reference
# The lines a subject the device states something about is, or holds, found through the reference's indexes.
HELD = {"listing": "SELECT value FROM json_each(?)",
        "security": "SELECT l.id FROM json_each(?) j CROSS JOIN listings l ON l.security_id = j.value",
        "composite": "SELECT id FROM listings WHERE composite_id IN (SELECT value FROM json_each(?))",
        "issuer": "SELECT l.id FROM securities s CROSS JOIN listings l ON l.security_id = s.id"
                  " WHERE s.issuer_id IN (SELECT value FROM json_each(?))"}


class Index:
    """The index of one reference file (an empty one when none is installed): the reference's lines, built once, and
    what the device adds laid over them (`renew`). A fold relation a confirm-level plugin contests (`contested`,
    `relations`) folds nothing."""

    def __init__(self, reference: sqlite3.Connection, contested: frozenset = frozenset()):
        self.db = sqlite3.connect(":memory:", check_same_thread=False)
        self.db.execute(DOC)
        self._load(reference, contested)
        self.db.execute("CREATE VIRTUAL TABLE fts USING fts5(ticker, names, content='doc', content_rowid='id',"
                        " tokenize=\"unicode61 remove_diacritics 2\", prefix='2 3 4')")
        self.db.execute("INSERT INTO fts(rowid, ticker, names) SELECT id, coalesce(ticker, ''), names FROM doc")
        for column in ("tnorm", "isin", "lei", "cik", "grp", "security", "inst", "line"):
            self.db.execute(f"CREATE INDEX doc_{column} ON doc ({column})")
        self.db.execute("CREATE TABLE gsize AS SELECT grp, max(size) g FROM doc GROUP BY grp")
        self.db.execute("CREATE UNIQUE INDEX gsize_grp ON gsize (grp)")
        self.words = self._words(self.db.execute("SELECT d.names, d.ticker, s.g FROM doc d JOIN gsize s USING (grp)"))
        self.vocab: Mapping[str, float] = self.words  # with the device's words once `renew` lays them
        self.db.commit()
        self.lock = threading.Lock()
        # The reference's lines have IDs up to `base`; the device's part adds lines above it and replaces the
        # reference lines it restates, whose own rows `shadowed` keeps (`renew`). `key` names the device state laid.
        self.base = self.db.execute("SELECT coalesce(max(id), 0) FROM doc").fetchone()[0]
        self.shadowed: dict[int, tuple] = {}
        self.key: tuple | None = None

    def _load(self, ref: sqlite3.Connection, contested: frozenset) -> None:
        # Listings, not open-market trading: an ISO 10383 RMKT segment, a US exchange, or an exchange outside the
        # EEA whose ISO record leaves the category unspecified (NSPD: Toronto, the ASX, Hong Kong, Tel Aviv). In the
        # EEA, NSPD marks operator MICs (Frankfurt, Borsa Italiana, BME), never a listing. A build from before the
        # category column ranks no line as regulated.
        categorised = "category" in {row[1] for row in ref.execute("PRAGMA table_info(venues)")}
        self.venues = {row[0]: (row[1], row[2]) for row in ref.execute("SELECT mic, name, country FROM venues")}
        self.regulated = ({mic for mic, category, country in ref.execute("SELECT mic, category, country FROM venues")
                           if category == "RMKT" or (category == "NSPD" and country not in ranking.EEA)}
                          | set(US_LISTED)) if categorised else set()
        self.units, odd = fold_roots(edge for edge in ref.execute("SELECT type, from_id, to_id FROM relations")
                                     if not relations.contests(tuple(edge), contested))
        if odd:  # the builder's report and the reference audit list them
            logger.warning("reference fold relations: %d second targets and cycles kept apart", len(odd))
        self.package = int(level(ref) == CONFIRM)
        docs = self._docs(ref, list(ref.execute(JOIN)), None)
        self.kinds = {doc["security"]: doc["kind"] for doc in docs}
        self.issuers_of = {doc["security"]: doc["issuer"] for doc in docs}
        self._fold(docs)
        self.db.executemany(f"INSERT INTO doc VALUES ({','.join('?' * len(DOC_COLUMNS))})",
                            [tuple(doc.values()) for doc in docs])

    def _docs(self, ref: sqlite3.Connection, rows: list, device: Any) -> list[dict]:
        """The directory lines of the reference join's `rows` and, with `device` (`search_device.Additions`), of the
        device's lines, with what it states about each. Without it the maps are the reference's whole tables; with it,
        its rows' subjects only."""
        rows = rows + (device.rows if device else [])
        subjects = json.dumps(sorted({key for row in rows for key in (row[0], row[1], row[2], row[9]) if key}))
        where = " AND {} IN (SELECT value FROM json_each(?))" if device else ""

        def many(sql: str, column: str) -> dict[str, list]:
            out: dict[str, list] = {}
            for key, *value in ref.execute(sql + where.format(column), (subjects,) if device else ()):
                out.setdefault(key, []).append(value[0] if len(value) == 1 else tuple(value))
            return out

        issuers = {key: found[0] for key, found in many("SELECT id, name, country FROM issuers WHERE true", "id").items()}
        # A few subjects' identifiers are read through the subject index (`+scheme` keeps the planner off the scheme's).
        ids = many(f"SELECT subject_id, scheme || ':' || value FROM assertions WHERE {'+' if device else ''}scheme IN"
                   f" {SEARCHED}", "subject_id")
        names = many("SELECT subject_id, name FROM names WHERE true", "subject_id")
        lines, tickers, trust = (device.lines, device.tickers, device.package) if device else ({}, {}, self.package)
        if device:  # the device's issuers and names add to the reference's; its identifiers replace them
            issuers |= device.issuers
            ids |= device.ids
            for subject, named in device.names.items():
                names.setdefault(subject, []).extend(named)
        docs = []
        for index, row in enumerate(rows, 1):  # the device's lines are ranked as the reference's
            (listing, security, composite, mic, operating, ticker, currency, _chain, primary, issuer, name, kind,
             asset_class, rank, liquid) = row
            own, stated = lines.get(listing), tickers.get(listing, [])
            ticker = ticker or next(iter(stated), None)  # a plugin's ticker makes a ticker-less line findable
            if not ticker and own is None:
                continue
            values = {item.split(":", 1)[0]: item.split(":", 1)[1] for key in (listing, security, composite, issuer)
                      for item in ids.get(key or "", [])}
            figis = " ".join(item.split(":", 1)[1] for key in (listing, security, composite)
                             for item in ids.get(key or "", []) if "figi:" in item)
            issuer_name, issuer_country = issuers.get(issuer or "", (None, None))
            crypto = asset_class == "crypto"
            venue_name, venue_country = self.venues.get(mic or "", (None, None))
            op = operating or mic
            isin = values.get("isin")
            primary_names = [name, issuer_name, *names.get(listing, [])]
            aliases = [*names.get(issuer or "", []), *names.get(security, []), *(item for item in stated if item != ticker)]
            label = " | ".join(dict.fromkeys(filter(None, primary_names)))
            label += " || " + " | ".join(dict.fromkeys(filter(None, aliases))) if aliases else ""
            # A foreign company's receipt or OTC line ranks below its other lines; its own shares listed on a US
            # exchange (Linde, Shopify) compete like any other listing.
            foreign_us = (bool(issuer_country and issuer_country != "US" and op in (*US_LISTED, "OTCM"))
                          and (kind == "depositary_receipt" or op == "OTCM"))
            home = crypto or bool((isin and isin[:2] == venue_country) or (issuer_country and issuer_country == venue_country)
                                  or (not issuer_country and op in US_LISTED and not isin))
            docs.append(dict(zip(DOC_COLUMNS, (
                index, security if crypto else listing, security, issuer, None, kind, int(crypto),
                ticker, tnorm(ticker) or None, (issuer_name if not crypto else None) or name, label, isin, values.get("lei"),
                (values.get("cik") or "").lstrip("0") or None, figis, op if not crypto else None,
                venue_name, venue_country if not crypto else None, currency, int(bool(primary)), int(home),
                int(op == "OTCM"), int(kind == "other"), int(kind in ("fund", "etf")), int(kind == "depositary_receipt"),
                int(foreign_us), logrank(rank) if own is None else own["size"],
                security, kind, int(mic in self.regulated or op in self.regulated & set(US_LISTED)), int(bool(liquid)),
                trust if own is None else own["trust"], own and own["source"], listing))))
        return docs

    def _fold(self, docs: list[dict]) -> None:
        """Relations with `fold` behaviour (vocabulary.RELATIONS) make one unit of the same economic thing: a receipt
        folds into its share (`inst`, the page's listings). A unit that is an interest in its issuer
        (vocabulary.ISSUER_INTERESTS) groups under the issuer's company (`grp`, search's company groups); a fund, an ETF
        or a crypto asset is its own group, and so is a pool or a protocol."""
        kinds = ChainMap({doc["security"]: doc["kind"] for doc in docs}, self.kinds)
        issuers_of = ChainMap({doc["security"]: doc["issuer"] for doc in docs}, self.issuers_of)
        for doc in docs:
            unit = self.units.get(doc["security"])
            unit = unit if unit in kinds else doc["security"]  # a unit outside the directory folds nothing in
            company = issuers_of[unit] if kinds[unit] in ISSUER_INTERESTS else None
            doc.update(inst=unit, ikind=kinds[unit], grp=company or unit)

    @staticmethod
    def _words(rows: Iterable[tuple]) -> dict[str, float]:
        """The vocabulary fuzzy matching corrects towards: these lines' names and tickers, each with its largest size."""
        words: dict[str, float] = {}
        for names, ticker, size in rows:
            for token in set(norm(names).split()) | ({ticker.lower()} if ticker else set()):
                if len(token) >= 3:
                    words[token] = max(words.get(token, 0), size or 0)
        return words

    def renew(self, ref: sqlite3.Connection, device: Any, key: tuple) -> None:
        """Lay `device` (`search_device.Additions`, the state `key` names) over the reference's lines in place of what
        the device laid before: its own lines, and the reference's lines it states anything about, rebuilt with it (a
        reference line keeps its ID, and its own row is put back once the device no longer restates it). Only rows that
        changed are written, so the work is the device's size, never the reference's; queries wait only for the swap."""
        touched, lines = {*device.tickers, *device.names, *device.ids}, set()
        for kind, sql in HELD.items():
            held = sorted(subject for subject in touched if subject.startswith(kind + ":"))
            if held:
                lines.update(row[0] for row in ref.execute(sql, (json.dumps(held),)))
        rows = ref.execute(LINE.format("json_each(?) j CROSS JOIN listings l ON l.id = j.value"), (json.dumps(sorted(lines)),))
        docs = self._docs(ref, list(rows), device)
        self._fold(docs)
        ticker, names, grp, line = (DOC_COLUMNS.index(name) for name in ("ticker", "names", "grp", "line"))
        entries = lambda rows: [(row[0], row[ticker] or "", row[names]) for row in rows]  # noqa: E731  (their FTS rows)
        write = f"INSERT OR REPLACE INTO doc VALUES ({','.join('?' * len(DOC_COLUMNS))})"
        add, drop = ("INSERT INTO fts(rowid, ticker, names) VALUES (?, ?, ?)",
                     "INSERT INTO fts(fts, rowid, ticker, names) VALUES ('delete', ?, ?, ?)")
        with self.lock:
            db = self.db
            laid = {row[line]: tuple(row) for row in db.execute(  # what the device laid before, by line
                "SELECT * FROM doc WHERE id > ? OR id IN (SELECT value FROM json_each(?))",
                (self.base, json.dumps(list(self.shadowed))))}
            if device.package != self.package:  # the package's trust changed: its lines' tie-break follows
                db.execute("UPDATE doc SET trust = ? WHERE id <= ?", (device.package, self.base))
                self.shadowed = {id: (*row[:-3], device.package, *row[-2:]) for id, row in self.shadowed.items()}
                self.package = device.package
            held = dict(db.execute("SELECT line, id FROM doc WHERE id <= ? AND line IN (SELECT value FROM json_each(?))",
                                   (self.base, json.dumps([doc["line"] for doc in docs]))))
            fresh = max([self.base, *(row[0] for row in laid.values())]) + 1
            new = {}
            for doc in docs:
                old = laid.get(doc["line"])
                doc["id"] = held.get(doc["line"]) or (old[0] if old else fresh + len(new))
                new[doc["line"]] = tuple(doc.values())
            gone = [row for key, row in laid.items() if key not in new]
            changed = [row for key, row in new.items() if laid.get(key) != row]
            # Out: lines the device no longer lays; its own are deleted, the reference's put back.
            before = [laid[row[line]] for row in changed if row[line] in laid]
            db.executemany(drop, entries(gone + before))
            db.executemany("DELETE FROM doc WHERE id = ?", [(row[0],) for row in gone if row[0] > self.base])
            restored = [self.shadowed.pop(row[0]) for row in gone if row[0] in self.shadowed]
            db.executemany(write, restored)
            db.executemany(add, entries(restored))
            # In: new and changed lines; a reference line it now restates keeps its own row aside.
            for row in changed:
                if row[0] <= self.base and row[0] not in self.shadowed:
                    self.shadowed[row[0]] = tuple(db.execute("SELECT * FROM doc WHERE id = ?", (row[0],)).fetchone())
                    db.execute(drop, entries([self.shadowed[row[0]]])[0])
            db.executemany(write, changed)
            db.executemany(add, entries(changed))
            groups = json.dumps(sorted({row[grp] for row in [*gone, *restored, *changed, *before]}))
            db.execute("DELETE FROM gsize WHERE grp IN (SELECT value FROM json_each(?))", (groups,))
            db.execute("INSERT INTO gsize SELECT grp, max(size) FROM doc WHERE grp IN (SELECT value FROM json_each(?))"
                       " GROUP BY grp", (groups,))
            if gone or changed:  # the device's words are its current lines' only, so a disabled plugin's leave too
                size = DOC_COLUMNS.index("size")
                self.vocab = ChainMap(self._words((row[names], row[ticker], row[size]) for row in new.values()), self.words)
            db.commit()
            self.key = key
