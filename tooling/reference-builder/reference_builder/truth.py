"""Identity truth-set audit: a reference build plus core derivation against hand-verified instruments.

The truth set (`truth/instruments.json`) names, for hard identity cases, the issuer,
security, listings, relations and provider symbols each instrument should resolve
to. This module locates every entry in a reference file, runs core's own search
directory and page derivation on it, and scores each check as pass, fail or n/a
(outside the build's scope). A committed baseline turns the scores into a
regression gate: a check that passed in the baseline and fails now, or a subject
ID that changed without an alias, is a regression.
"""

from __future__ import annotations

import importlib
import json
import re
import sqlite3
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from .schema import derive, identity

TRUTH_DIR = Path(__file__).resolve().parents[1] / "truth"
PLUGINS = Path(__file__).resolve().parents[3] / "runtime" / "managed" / "plugins"
US_MICS = frozenset({"XNAS", "XNYS", "XCBO", "OTCM"})
EEA = frozenset("AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO".split())
CHECKS = ("coverage", "lifecycle", "issuer", "security", "separate", "listing", "primary", "relation", "fold", "symbols",
          "subject_key")
search = importlib.import_module(f"{identity.__name__}.search")
page = importlib.import_module(f"{identity.__name__}.page")


def tnorm(ticker: str | None) -> str:
    return re.sub(r"[^A-Z0-9]", "", (ticker or "").upper())


@dataclass
class Scope:
    """What a reference build claims to cover, read from the build itself."""

    us: bool = False
    eea: bool = False                            # every EEA venue (FIRDS)
    mics: frozenset[str] = frozenset()           # otherwise these operating MICs
    cfi: tuple[str, ...] | None = None           # FIRDS populations (CFI prefixes); None: unknown, all
    crypto: frozenset[str] = frozenset()         # crypto kinds present (coin, token)
    label: str = ""

    def covers(self, entry: dict, listing: dict, venues: dict) -> bool:
        if "chain" in listing:
            return entry["kind"] in self.crypto
        mic = listing["mic"]
        if mic in US_MICS:
            return self.us
        if venues.get(mic, {}).get("country") in EEA and (self.eea or mic in self.mics):
            return self.cfi is None or not entry.get("cfi") or entry["cfi"].startswith(self.cfi)
        return mic in self.mics


def read_scope(ref: sqlite3.Connection, reference: Path, cfi: tuple[str, ...] | None = None) -> Scope:
    label = (ref.execute("SELECT value FROM release WHERE key = 'scope'").fetchone() or [""])[0]
    tokens = {token.strip().upper() for token in label.split(",") if token.strip()}
    stored = (ref.execute("SELECT value FROM release WHERE key = 'cfi_prefixes'").fetchone() or [None])[0]
    if cfi is None and stored:
        cfi = tuple(stored.split(","))
    manifest = reference.parent / "manifest.json"  # builds before the release carried cfi_prefixes
    if cfi is None and manifest.exists():
        data = json.loads(manifest.read_text(encoding="utf-8"))
        if data.get("snapshot", {}).get("file") == reference.name:
            cfi = tuple(data.get("scope", {}).get("cfi_prefixes") or ()) or None
    crypto = frozenset(row[0] for row in ref.execute("SELECT DISTINCT kind FROM securities WHERE asset_class = 'crypto'"))
    return Scope(us=bool(tokens & {"SEC", "US"}), eea=bool(tokens & {"EEA", "ALL"}),
                 mics=frozenset(t for t in tokens if re.fullmatch(r"[A-Z0-9]{4}", t) and t not in {"EEA"}),
                 cfi=cfi, crypto=crypto, label=label)


def load_contracts(root: Path = PLUGINS) -> dict[str, "page.PluginInfo"]:
    """Installed plugin contracts by provider, as core's page composition sees them."""
    contracts = {}
    for path in sorted(root.glob("*/contract.json")):
        manifest = identity.validate_manifest(json.loads(path.read_text(encoding="utf-8")))
        contracts[manifest.provider] = page.PluginInfo(key=path.parent.name, manifest=manifest)
    return contracts


@dataclass
class Result:
    entry: str
    check: str
    key: str
    status: str               # pass | fail | na
    reason: str = ""


@dataclass
class Audit:
    reference: str
    scope: Scope
    truth_version: str
    tags: dict[str, list[str]]
    results: list[Result] = field(default_factory=list)
    ids: dict[str, dict] = field(default_factory=dict)
    in_scope: int = 0
    future: list[str] = field(default_factory=list)   # entries of subject kinds core does not have yet (M1)

    def add(self, entry: str, check: str, sub: str, ok: bool | None, reason: str = "") -> None:
        status = "na" if ok is None else ("pass" if ok else "fail")
        self.results.append(Result(entry, check, f"{entry}:{check}:{sub}", status, "" if ok else reason))

    def scores(self) -> dict[str, dict[str, int]]:
        table: dict[str, Counter] = defaultdict(Counter)
        for result in self.results:
            table[result.check][result.status] += 1
        return {check: dict(table[check]) for check in CHECKS if check in table}


class Reference:
    """Read-only lookups on one reference file."""

    def __init__(self, path: Path):
        self.path = path
        self.db = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
        self.db.row_factory = sqlite3.Row

    def one(self, sql: str, *args) -> sqlite3.Row | None:
        return self.db.execute(sql, args).fetchone()

    def all(self, sql: str, *args) -> list[sqlite3.Row]:
        return self.db.execute(sql, args).fetchall()

    def subjects(self, scheme: str, value: str) -> list[str]:
        return [row[0] for row in self.all("SELECT DISTINCT subject_id FROM assertions WHERE scheme = ? AND value = ?",
                                            scheme, value)]

    def security_of(self, subject: str) -> str | None:
        if subject.startswith("security:"):
            return subject
        if subject.startswith("listing:"):
            row = self.one("SELECT security_id FROM listings WHERE id = ?", subject)
        elif subject.startswith("composite:"):
            row = self.one("SELECT security_id FROM composites WHERE id = ?", subject)
        else:
            return None
        return row[0] if row else None

    def issuer_ids(self, issuer: str | None) -> dict[str, str]:
        if not issuer:
            return {}
        return {row["scheme"]: row["value"] for row in
                self.all("SELECT scheme, value FROM assertions WHERE subject_id = ? AND scheme IN ('lei', 'cik')", issuer)}

    def locate(self, entry: dict) -> tuple[str | None, str]:
        """The reference security for an entry and the route that found it."""
        security = entry["security"]
        for scheme in ("isin", "share_class_figi", "caip19"):
            if security.get(scheme):
                found = [s for s in map(self.security_of, self.subjects(scheme, security[scheme])) if s]
                if scheme == "caip19" and self.one("SELECT 1 FROM securities WHERE id = ?", f"security:caip19:{security[scheme]}"):
                    found = [f"security:caip19:{security[scheme]}"]
                if found:
                    return found[0], scheme
        for listing in entry["listings"]:
            for scheme in ("figi", "composite_figi", "caip19"):
                if listing.get(scheme):
                    found = [s for s in map(self.security_of, self.subjects(scheme, listing[scheme])) if s]
                    if found:
                        return found[0], scheme
        cik = entry["issuer"].get("cik")
        for listing in entry["listings"]:
            if "mic" not in listing:
                continue
            for subject in self.subjects("ticker_mic", f"{listing['ticker']}@{listing['mic']}"):
                security = self.security_of(subject)
                row = security and self.one("SELECT issuer_id FROM securities WHERE id = ?", security)
                if security and (not cik or self.issuer_ids(row and row[0]).get("cik", "").lstrip("0") == cik):
                    return security, "ticker_mic"
        return None, ""


def audit(reference: Path, truth: dict, contracts: dict | None = None, cfi: tuple[str, ...] | None = None) -> Audit:
    """Score one reference file; `cfi` is the build's FIRDS populations when its manifest is not written yet."""
    ref = Reference(reference)
    scope = read_scope(ref.db, reference, cfi)
    contracts = load_contracts() if contracts is None else contracts
    venues = truth.get("venues", {})
    entries = {entry["id"]: entry for entry in truth["entries"]}
    build = (ref.one("SELECT value FROM release WHERE key = 'release'") or [reference.stem])[0]
    report = Audit(build, scope, truth.get("version", ""), {e["id"]: e.get("tags", []) for e in truth["entries"]})
    located = {entry_id: ref.locate(entry)[0] for entry_id, entry in entries.items()}
    directory = search.Directory(ref.db)
    folded = {row[0]: row[1] for row in directory.db.execute("SELECT security, inst FROM doc GROUP BY security")}
    issuers = {}
    for entry_id, security in located.items():
        row = security and ref.one("SELECT issuer_id FROM securities WHERE id = ?", security)
        issuers[entry_id] = row[0] if row else None
    for entry_id, entry in entries.items():
        if entry.get("future_kind"):
            report.future.append(entry_id)
            continue
        scoped = [l for l in entry["listings"] if scope.covers(entry, l, venues)]
        if not scoped and entry["status"] == "active":
            continue
        report.in_scope += 1
        _check_entry(report, ref, entry, entries, scoped, located, issuers, folded, contracts, scope, venues)
    _check_issuer_groups(report, entries, located, issuers)
    return report


def _check_entry(report, ref, entry, entries, scoped, located, issuers, folded, contracts, scope, venues) -> None:
    eid, security = entry["id"], located[entry["id"]]
    if entry["status"] != "active":
        _check_delisted(report, ref, entry, security)
        return
    report.add(eid, "coverage", "found", security is not None, "missing")
    _check_former(report, ref, entry, security, scope, venues)
    if security is None:
        return
    row = ref.one("SELECT * FROM securities WHERE id = ?", security)
    report.add(eid, "security", "kind", row["kind"] == entry["kind"], f"kind:{row['kind']}")
    ids = {"security": security, "issuer": issuers[eid], "listings": {}}
    # Issuer identifiers: CIK when the build has SEC tickers; LEI when it has the entry's EEA lines (FIRDS names the LEI).
    held = ref.issuer_ids(issuers[eid])
    eea_line = any(venues.get(l.get("mic"), {}).get("country") in EEA for l in scoped)
    for scheme, knowable in (("cik", scope.us), ("lei", eea_line)):
        want = entry["issuer"].get(scheme)
        if not want:
            continue
        have = held.get(scheme, "").lstrip("0") if scheme == "cik" else held.get(scheme)
        if have and have != want:
            report.add(eid, "issuer", scheme, False, f"{scheme}_wrong")
        else:
            report.add(eid, "issuer", scheme, bool(have) if knowable else None, f"{scheme}_missing")
    isin = entry["security"].get("isin")
    held_isins = {r[0] for r in ref.all("SELECT value FROM assertions WHERE subject_id = ? AND scheme = 'isin'", security)}
    if isin:
        if held_isins - {isin}:
            report.add(eid, "security", "isin", False, "isin_wrong")
        else:
            report.add(eid, "security", "isin", (isin in held_isins) if eea_line else None, "isin_missing")
    for other_id, other in located.items():
        if other_id != eid and other == security and entries[other_id]["status"] == "active":
            report.add(eid, "separate", other_id, False, "merged")
    lines = ref.all("SELECT * FROM listings WHERE security_id = ? AND status <> 'inactive'", security)
    for listing in scoped:
        if "chain" in listing:
            chain = listing.get("caip19") or listing["chain"]
            found = next((l for l in lines if l["chain"] == listing["chain"]), None)
            report.add(eid, "listing", chain, found is not None, "missing")
            if found is not None:
                ids["listings"][chain] = found["id"]
                _check_symbols(report, ref, entry, listing, found, contracts, crypto=True)
            continue
        label = f"{listing['ticker']}@{listing['mic']}"
        venue = [l for l in lines if (l["operating_mic"] or l["mic"]) == listing["mic"]]
        found = (next((l for l in venue if tnorm(l["ticker"]) == tnorm(listing["ticker"]) and l["currency"] == listing["currency"]), None)
                 or next((l for l in venue if tnorm(l["ticker"]) == tnorm(listing["ticker"])), None) or next(iter(venue), None))
        if found is None:
            elsewhere = [s for s in ref.subjects("ticker_mic", label) if ref.security_of(s) != security]
            report.add(eid, "listing", label, False, "on_other_security" if elsewhere else "missing")
            continue
        ids["listings"][label] = found["id"]
        report.add(eid, "listing", f"{label}:present", True)
        report.add(eid, "listing", f"{label}:ticker", tnorm(found["ticker"]) == tnorm(listing["ticker"]), f"ticker:{found['ticker']}")
        report.add(eid, "listing", f"{label}:currency", found["currency"] == listing["currency"], f"currency:{found['currency']}")
        if listing.get("figi"):
            figis = {r[0] for r in ref.all("SELECT value FROM assertions WHERE subject_id = ? AND scheme = 'figi'", found["id"])}
            reason = "composite_figi_as_listing_figi" if listing.get("composite_figi") in figis else "figi_missing" if not figis else "figi_wrong"
            report.add(eid, "listing", f"{label}:figi", listing["figi"] in figis, reason)
        wanted = derive("listing", {"isin": isin, "figi": listing.get("figi")},
                                     operating_mic=listing["mic"], currency=listing["currency"])
        if wanted:
            report.add(eid, "subject_key", label, found["id"] == wanted, _keyed(found["id"], wanted))
        _check_symbols(report, ref, entry, listing, found, contracts)
    _check_primary(report, entry, lines, scoped, scope, venues)
    for relation in entry.get("relations", []):
        target = located.get(relation["to"])
        edge = target and ref.one("SELECT 1 FROM relations WHERE type = ? AND from_id = ? AND to_id = ?",
                                  relation["type"], security, target)
        report.add(eid, "relation", relation["to"], bool(edge) if target else None, "no_edge")
    target = located.get(entry["fold"]) if entry["fold"] != eid else security
    inst = folded.get(security)
    if inst is None:
        report.add(eid, "fold", "row", False if target else None, "not_searchable")
    elif target:
        reason = "not_folded" if inst == security else f"folded_into:{_name(inst, located)}"
        report.add(eid, "fold", "row", inst == target, reason)
    wanted = derive("security", {k: v for k, v in entry["security"].items()
                                              if k in ("isin", "share_class_figi", "caip19")})
    if wanted:
        report.add(eid, "subject_key", "security", security == wanted, _keyed(security, wanted))
    wanted = derive("issuer", entry["issuer"]) if entry["issuer"] else None
    if wanted and issuers[eid]:
        report.add(eid, "subject_key", "issuer", issuers[eid] == wanted, _keyed(issuers[eid], wanted))
    report.ids[eid] = ids


def _keyed(have: str, want: str) -> str:
    """Why an ID differs from the ideal one: the key it used instead, or a different value."""
    have_key, want_key = have.split(":")[1], want.split(":")[1]
    return f"keyed_by_{have_key}_not_{want_key}" if have_key != want_key else "different_value"


def _name(security: str, located: dict) -> str:
    return next((entry_id for entry_id, found in located.items() if found == security), security)


def _check_symbols(report, ref, entry, listing, found, contracts, crypto=False) -> None:
    subject = page.load_subject(ref.db, found["security_id"] if crypto else found["id"])
    level = identity.Level.SECURITY if crypto else identity.Level.LISTING
    coins = lambda provider, caip19: (ref.one("SELECT native_id FROM native_coins WHERE provider = ? AND caip19 = ?",  # noqa: E731
                                              provider, caip19) or [None])[0]
    for provider, want in listing.get("symbols", {}).items():
        info = contracts.get(provider)
        if info is None:
            report.add(entry["id"], "symbols", f"{provider}:{want}", None)
            continue
        derived = page.derive(info, level, subject, coins)
        got = derived[0].native_id if derived else None
        if got is None:
            mic = listing.get("mic")
            reason = f"no_suffix:{mic}" if mic and mic not in info.manifest.mic_table else "not_derived"
        else:
            reason = f"wrong:{got}"
        report.add(entry["id"], "symbols", f"{provider}:{want}", got == want, reason)


def _check_primary(report, entry, lines, scoped, scope, venues) -> None:
    accepted = {l["mic"] for l in entry["listings"] if l.get("primary") and "mic" in l}
    main = next((l for l in entry["listings"] if l.get("primary") is True and "mic" in l), None)
    if main is None or not scoped:
        return
    marked = {(l["operating_mic"] or l["mic"]) for l in lines if l["is_primary"] and l["mic"]}
    if scope.covers(entry, main, venues):
        ok = bool(marked) and marked <= accepted
        report.add(entry["id"], "primary", "home", ok, f"wrong:{','.join(sorted(marked - accepted))}" if marked else "not_marked")
    else:
        claims = marked - accepted
        report.add(entry["id"], "primary", "home_out_of_scope", not claims, f"claims_primary:{','.join(sorted(claims))}")


def _check_former(report, ref, entry, security, scope, venues) -> None:
    for isin in entry.get("former", {}).get("isins", []):
        active = [s for s in map(ref.security_of, ref.subjects("isin", isin))
                  if s and ref.one("SELECT 1 FROM listings WHERE security_id = ? AND status = 'active'", s)]
        report.add(entry["id"], "lifecycle", f"former_isin:{isin}", not active, "former_isin_active")
    for label in entry.get("former", {}).get("tickers", []):
        ticker, mic = label.rsplit("@", 1)
        if not scope.covers(entry, {"mic": mic}, venues):
            continue
        stale = [s for s in ref.subjects("ticker_mic", label) if ref.security_of(s) == security
                 and ref.one("SELECT 1 FROM listings WHERE id = ? AND status = 'active'", s)]
        report.add(entry["id"], "lifecycle", f"former_ticker:{label}", not stale, "former_ticker_active")


def _check_delisted(report, ref, entry, security) -> None:
    active = security and ref.one("SELECT 1 FROM listings WHERE security_id = ? AND status = 'active'", security)
    cik = entry["issuer"].get("cik")
    if not active and cik:
        active = ref.one("SELECT 1 FROM assertions a JOIN securities s ON s.issuer_id = a.subject_id"
                         " JOIN listings l ON l.security_id = s.id WHERE a.scheme = 'cik' AND ltrim(a.value, '0') = ?"
                         " AND l.status = 'active'", cik)
    report.add(entry["id"], "lifecycle", "delisted", not active, "still_active")


def _check_issuer_groups(report, entries, located, issuers) -> None:
    """Entries of one issuer (shared LEI or CIK) resolve to one reference issuer; different issuers never share one."""
    groups: dict[str, set[str]] = defaultdict(set)
    for entry_id, entry in entries.items():
        if located[entry_id] and issuers[entry_id] and entry["status"] == "active":
            for scheme in ("lei", "cik"):
                if entry["issuer"].get(scheme):
                    groups[f"{scheme}:{entry['issuer'][scheme]}"].add(entry_id)
    checked = {r.entry for r in report.results}
    for members in groups.values():
        members &= checked
        if len(members) < 2:
            continue
        counts = Counter(issuers[m] for m in members)
        majority = counts.most_common(1)[0][0]
        for member in sorted(members):
            report.add(member, "issuer", "same_as_siblings", issuers[member] == majority, "issuer_split")
    # Two entries on one reference issuer must share an expected LEI or CIK.
    on_issuer: dict[str, list[str]] = defaultdict(list)
    for entry_id in sorted(checked):
        if issuers.get(entry_id) and entries[entry_id]["issuer"]:
            on_issuer[issuers[entry_id]].append(entry_id)
    for members in on_issuer.values():
        for member in members:
            mine = set(entries[member]["issuer"].items())
            if any(not mine & set(entries[other]["issuer"].items()) for other in members if other != member):
                report.add(member, "issuer", "not_shared", False, "issuer_merged")
