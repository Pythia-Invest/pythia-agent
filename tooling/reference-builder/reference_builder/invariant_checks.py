"""Row access and the currency, ticker, primary-listing and venue invariants (see `invariants.py`)."""

from __future__ import annotations

import json
import re
import sqlite3
from collections import defaultdict
from pathlib import Path

from .rules import EEA, SINGLE_CURRENCY_VENUES, TRADING_ONLY_VENUES, country_currency

# ISO 4217 codes withdrawn on the given day (replaced by the euro or redenominated), and
# `XXX` ("no currency"). A line quoted in one of them after that day is a stale record.
WITHDRAWN = {
    **{code: "2002-03-01" for code in "ATS BEF DEM ESP FIM FRF IEP ITL LUF NLG PTE GRD".split()},
    "SIT": "2007-01-15", "CYP": "2008-02-01", "MTL": "2008-02-01", "SKK": "2009-01-17", "EEK": "2011-01-15",
    "LVL": "2014-01-15", "LTL": "2015-01-16", "HRK": "2023-01-15", "BGN": "2026-02-01", "ROL": "2006-12-31",
    "TRL": "2005-12-31", "XXX": "0000-01-01", "XEU": "1999-01-01",
}
US_EXCHANGES = frozenset({"XNAS", "XNYS", "XCBO"})
GERMAN_FLOORS = frozenset({"XFRA", "XSTU", "XMUN", "XDUS", "XHAM", "XHAN", "XBER"})
CURRENCY_SUFFIX = re.compile(r"^(?P<root>[A-Z0-9]{2,})(?P<ccy>EUR|USD|GBP|GBX|CHF|SEK|NOK|DKK|PLN|CZK|HUF|JPY|CAD|AUD)$")


class Build:
    """The snapshot's rows, loaded once for every invariant."""

    def __init__(self, path: Path):
        db = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
        db.row_factory = sqlite3.Row
        self.db, self.path = db, path
        release = {row["key"]: row["value"] for row in db.execute("SELECT key, value FROM release")}
        self.as_of = release.get("as_of") or (release.get("built_at") or "")[:10] or "9999-12-31"
        self.us = bool({t.strip().upper() for t in (release.get("scope") or "").split(",")} & {"US", "SEC"})
        self.venues = {row["mic"]: dict(row) for row in db.execute("SELECT * FROM venues")}
        self.securities = {row["id"]: dict(row) for row in db.execute("SELECT * FROM securities")}
        self.issuers = {row["id"]: dict(row) for row in db.execute("SELECT * FROM issuers")}
        self.listings = [dict(row) for row in db.execute("SELECT * FROM listings WHERE mic IS NOT NULL")]
        self.isin: dict[str, str] = {}
        self.ids: dict[str, dict[str, str]] = defaultdict(dict)
        for row in db.execute("SELECT subject_id, scheme, value FROM assertions WHERE scheme IN ('isin', 'lei', 'cik')"):
            if row["scheme"] == "isin":
                self.isin[row["subject_id"]] = row["value"]
            else:
                self.ids[row["subject_id"]][row["scheme"]] = row["value"]
        self.names: dict[str, list[tuple[str, str]]] = defaultdict(list)
        for row in db.execute("SELECT subject_id, name, source FROM names WHERE subject_id LIKE 'issuer:%'"):
            self.names[row["subject_id"]].append((row["name"], row["source"]))
        self.relations = [dict(row) for row in db.execute("SELECT type, from_id, to_id FROM relations")]
        self.by_security: dict[str, list[dict]] = defaultdict(list)
        for line in self.listings:
            self.by_security[line["security_id"]].append(line)

    def live(self, line: dict) -> bool:
        return line["status"] != "inactive"

    def live_security(self, security_id: str) -> bool:
        security = self.securities.get(security_id)
        return bool(security and security["status"] != "inactive" and security["asset_class"] == "equity")

    def category(self, line: dict) -> str | None:
        return (self.venues.get(line["mic"]) or {}).get("category")

    def country(self, line: dict) -> str | None:
        return (self.venues.get(line["mic"]) or self.venues.get(line["operating_mic"]) or {}).get("country")

    def currency_of(self, country: str | None) -> str | None:
        return country_currency(country, self.as_of)

    def label(self, line: dict) -> str:
        security = self.securities.get(line["security_id"]) or {}
        return f"{line['ticker'] or '-'}@{line['operating_mic']} {line['currency']} {security.get('name', '')[:40]}"


# ---- currency -----------------------------------------------------------------


def currency_withdrawn(build: Build) -> list[tuple]:
    return [(build.label(line), line["id"]) for line in build.listings
            if build.live(line) and WITHDRAWN.get(line["currency"] or "", "9999") <= build.as_of]


# The currency rules below check the trading currency a line shows (`trading_currency`); `currency` is the key
# currency, FIRDS' notional one on a FIRDS line, and never shown.


def currency_single_currency_venue(build: Build) -> list[tuple]:
    found = []
    for line in build.listings:
        wanted = SINGLE_CURRENCY_VENUES.get(line["operating_mic"] or "")
        if wanted and build.live(line) and line.get("trading_currency") != wanted:
            found.append((build.label(line), line["id"]))
    return found


def currency_is_issue_country(build: Build) -> list[tuple]:
    """Any venue: a foreign currency that is exactly the ISIN country's currency is the notional currency leaking in."""
    found = []
    for line in build.listings:
        if (not build.live(line) or line["operating_mic"] in SINGLE_CURRENCY_VENUES.keys() | TRADING_ONLY_VENUES
                or (line["operating_mic"] == "XLUX" and (build.securities.get(line["security_id"]) or {}).get("kind") == "depositary_receipt")):
            continue  # RFQ platforms and internalisers quote US ISINs in USD; Luxembourg lists GDRs in USD
        if (build.securities.get(line["security_id"]) or {}).get("kind") == "etf":
            continue  # ETFs list lines in several currencies (SIX, London); the venue rule covers the rest
        home = build.currency_of(build.country(line))
        isin = build.isin.get(line["security_id"]) or ""
        issued = build.currency_of(isin[:2])
        if home and issued and line.get("trading_currency") not in (None, home) and line["trading_currency"] == issued:
            found.append((build.label(line), line["id"]))
    return found


def ticker_currency_suffix(build: Build) -> list[tuple]:
    """A ticker that names its trading currency (`HONAEUR`) must agree with the line's currency."""
    found = []
    for line in build.listings:
        match = CURRENCY_SUFFIX.match(line["ticker"] or "")
        if (match and build.live(line) and len(match["root"]) >= 3
                and line.get("trading_currency") not in (None, match["ccy"])):
            found.append((build.label(line), match["ccy"], line["id"]))
    return found


# ---- tickers ------------------------------------------------------------------


def ticker_two_securities(build: Build) -> list[tuple]:
    owners: dict[tuple[str, str], set[str]] = defaultdict(set)
    for line in build.listings:
        if line["ticker"] and build.live(line):
            owners[(line["operating_mic"] or line["mic"], line["ticker"])].add(line["security_id"])
    return [(f"{ticker}@{mic}", " | ".join(sorted((build.securities.get(s) or {}).get("name", s)[:30] for s in ids)))
            for (mic, ticker), ids in sorted(owners.items()) if len(ids) > 1]


# ---- primary listing -----------------------------------------------------------


def _primaries(build: Build, security_id: str) -> list[dict]:
    return [line for line in build.by_security.get(security_id, []) if line["is_primary"]]


def primary_more_than_one(build: Build) -> list[tuple]:
    return [((build.securities.get(s) or {}).get("name"), ", ".join(build.label(l) for l in lines), s)
            for s in build.by_security if len(lines := _primaries(build, s)) > 1]


def primary_inactive(build: Build) -> list[tuple]:
    return [(build.label(line), line["id"]) for s in build.by_security if build.live_security(s)
            for line in _primaries(build, s) if line["status"] == "inactive"]


def primary_missing(build: Build) -> list[tuple]:
    """A live security with lines and no primary: the evidence did not decide it (a question), or a gap."""
    return [(build.securities[s]["name"], s) for s in build.by_security if build.live_security(s)
            and build.by_security[s] and not _primaries(build, s)]


def questions_open(build: Build) -> list[tuple]:
    """The questions the build left open (its package's `claims` file beside the snapshot)."""
    path = build.path.with_name(build.path.name.replace("reference-", "questions-", 1)).with_suffix(".json")
    try:
        found = json.loads(path.read_text(encoding="utf-8")).get("questions") or []
    except (OSError, ValueError):
        return []
    return [(item.get("question"), (item.get("subject_ids") or [""])[0]) for item in found]


def share_primary_silent(build: Build) -> list[tuple]:
    """A live share with neither a primary nor a line marked most liquid: nothing says which line it is priced on
    (a SEC OTC-only share, which no rule places, or a most liquid venue with no line of it)."""
    return [(build.securities[s]["name"], s) for s in build.by_security if build.live_security(s)
            and build.securities[s]["kind"] == "ordinary" and build.by_security[s] and not _primaries(build, s)
            and not any(line["most_liquid"] for line in build.by_security[s])]


def primary_open_market_beside_us_exchange(build: Build) -> list[tuple]:
    """A company with a live NYSE/Nasdaq line whose primary is an EEA open-market segment (Linde on Tradegate).

    Only EEA venues declare regulated versus open-market segments in ISO 10383; Toronto, Tel Aviv, Tokyo and
    ASX are "unspecified" there, so a home primary on them is not an open-market line."""
    found = []
    for security_id, lines in build.by_security.items():
        if not build.live_security(security_id):
            continue
        us = [l for l in lines if l["operating_mic"] in US_EXCHANGES and build.live(l)]
        for line in _primaries(build, security_id):
            if us and build.country(line) in EEA and build.category(line) != "RMKT":
                found.append((build.label(line), f"also {us[0]['ticker']}@{us[0]['operating_mic']}", line["id"]))
    return found


def primary_floor_beside_xetra(build: Build) -> list[tuple]:
    """Primary on a German floor exchange while a live Xetra line exists (unless the floor line is the regulated admission)."""
    found = []
    for security_id, lines in build.by_security.items():
        if not build.live_security(security_id):
            continue
        xetra = [l for l in lines if l["operating_mic"] == "XETR" and build.live(l)]
        for line in _primaries(build, security_id):
            if xetra and line["operating_mic"] in GERMAN_FLOORS and build.category(line) != "RMKT":
                found.append((build.label(line), line["id"]))
    return found


def venue_ticker_coverage(build: Build, minimum: int = 200, share: float = 0.5) -> list[tuple]:
    """A listing venue segment with many live lines of which most carry no ticker: the ticker lookup for that
    segment fails wholesale (Frankfurt's open market asked OpenFIGI under a segment MIC it answers nothing for)."""
    counts: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for line in build.listings:
        if build.live(line) and line["operating_mic"] not in TRADING_ONLY_VENUES:
            counts[line["mic"]][0] += 1
            counts[line["mic"]][1] += bool(line["ticker"])
    return [(f"{mic} ({(build.venues.get(mic) or {}).get('name', '?')})", f"{with_ticker}/{total} lines with a ticker")
            for mic, (total, with_ticker) in sorted(counts.items(), key=lambda item: -item[1][0])
            if total >= minimum and with_ticker < share * total]


def us_share_without_us_line(build: Build) -> list[tuple]:
    """A live share with a US ISIN and no NYSE, Nasdaq, Cboe or OTC line in a build with SEC lines: usually a
    company delisted or taken over (VMware, Splunk, Marathon Oil) that EU venues still carry."""
    if not build.us:
        return []
    return [(s["name"], build.isin[s["id"]], s["id"]) for s in build.securities.values()
            if s["kind"] == "ordinary" and build.live_security(s["id"]) and build.isin.get(s["id"], "").startswith("US")
            and not any(l["operating_mic"] in US_EXCHANGES | {"OTCM"} for l in build.by_security.get(s["id"], []))]
