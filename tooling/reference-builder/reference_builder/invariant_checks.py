"""Row access and the currency, ticker, primary-listing and venue invariants (see `invariants.py`)."""

from __future__ import annotations

import re
import sqlite3
from collections import defaultdict
from pathlib import Path

from .rules import EEA, TRADING_ONLY_VENUES
from .schema import identity

# Trading currency by venue country (ISO 4217); a country that changed currency lists
# (currency, first day) pairs, newest last.
COUNTRY_CURRENCY: dict[str, tuple[tuple[str, str], ...]] = {
    **{c: (("EUR", "1999-01-01"),) for c in "AT BE DE ES FI FR IE IT LU NL PT".split()},
    "GR": (("EUR", "2001-01-01"),), "SI": (("EUR", "2007-01-01"),), "CY": (("EUR", "2008-01-01"),),
    "MT": (("EUR", "2008-01-01"),), "SK": (("EUR", "2009-01-01"),), "EE": (("EUR", "2011-01-01"),),
    "LV": (("EUR", "2014-01-01"),), "LT": (("EUR", "2015-01-01"),), "HR": (("HRK", "1994-05-30"), ("EUR", "2023-01-01")),
    "BG": (("BGN", "1999-07-05"), ("EUR", "2026-01-01")),
    "SE": (("SEK", "1900-01-01"),), "DK": (("DKK", "1900-01-01"),), "NO": (("NOK", "1900-01-01"),),
    "IS": (("ISK", "1900-01-01"),), "PL": (("PLN", "1995-01-01"),), "CZ": (("CZK", "1993-01-01"),),
    "HU": (("HUF", "1900-01-01"),), "RO": (("RON", "2005-07-01"),), "LI": (("CHF", "1900-01-01"),),
    "CH": (("CHF", "1900-01-01"),), "GB": (("GBP", "1900-01-01"),), "US": (("USD", "1900-01-01"),),
    "CA": (("CAD", "1900-01-01"),), "JP": (("JPY", "1900-01-01"),), "HK": (("HKD", "1900-01-01"),),
    "AU": (("AUD", "1900-01-01"),),
}
# ISO 4217 codes withdrawn on the given day (replaced by the euro or redenominated), and
# `XXX` ("no currency"). A line quoted in one of them after that day is a stale record.
WITHDRAWN = {
    **{code: "2002-03-01" for code in "ATS BEF DEM ESP FIM FRF IEP ITL LUF NLG PTE GRD".split()},
    "SIT": "2007-01-15", "CYP": "2008-02-01", "MTL": "2008-02-01", "SKK": "2009-01-17", "EEK": "2011-01-15",
    "LVL": "2014-01-15", "LTL": "2015-01-16", "HRK": "2023-01-15", "BGN": "2026-02-01", "ROL": "2006-12-31",
    "TRL": "2005-12-31", "XXX": "0000-01-01", "XEU": "1999-01-01",
}
# Operating MICs that quote every instrument in one currency (Pythia-authored, from each
# venue's trading rules): the German exchanges and Vienna trade foreign shares, receipts and
# ETFs in euros. A line there in another currency is FIRDS' notional currency, not the
# trading currency.
SINGLE_CURRENCY_VENUES = {mic: "EUR" for mic in ("XETR", "XFRA", "XSTU", "XMUN", "XDUS", "XHAM", "XHAN", "XBER", "TGAT",
                                                 "XWBO")}
US_EXCHANGES = frozenset({"XNAS", "XNYS", "XCBO"})
GERMAN_FLOORS = frozenset({"XFRA", "XSTU", "XMUN", "XDUS", "XHAM", "XHAN", "XBER"})
CURRENCY_SUFFIX = re.compile(r"^(?P<root>[A-Z0-9]{2,})(?P<ccy>EUR|USD|GBP|GBX|CHF|SEK|NOK|DKK|PLN|CZK|HUF|JPY|CAD|AUD)$")
# Per-venue ticker shapes (operating MIC -> pattern). Venues not listed only need core's grammar.
TICKER_SHAPES = {
    **{mic: re.compile(r"^[A-Z]{1,5}(?:-[A-Z]{1,3})?$") for mic in ("XNAS", "XNYS", "XCBO")},
    "OTCM": re.compile(r"^[A-Z]{4,5}$"),
    **{mic: re.compile(r"^[A-Z0-9]{2,6}$") for mic in (*GERMAN_FLOORS, "XETR", "TGAT")},
    **{mic: re.compile(r"^[A-Z0-9]{1,6}$") for mic in ("XAMS", "XPAR", "XBRU", "XLIS", "XMIL")},
    **{mic: re.compile(r"^[A-Z0-9]{1,8}(?: [A-Z])?$") for mic in ("XSTO", "XCSE")},
}


class Build:
    """The snapshot's rows, loaded once for every invariant."""

    def __init__(self, path: Path):
        db = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
        db.row_factory = sqlite3.Row
        self.db = db
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
        periods = COUNTRY_CURRENCY.get(country or "")
        current = [code for code, start in periods or () if start <= self.as_of]
        return current[-1] if current else None

    def label(self, line: dict) -> str:
        security = self.securities.get(line["security_id"]) or {}
        return f"{line['ticker'] or '-'}@{line['operating_mic']} {line['currency']} {security.get('name', '')[:40]}"


# ---- currency -----------------------------------------------------------------


def currency_withdrawn(build: Build) -> list[tuple]:
    return [(build.label(line), line["id"]) for line in build.listings
            if build.live(line) and WITHDRAWN.get(line["currency"] or "", "9999") <= build.as_of]


def currency_single_currency_venue(build: Build) -> list[tuple]:
    found = []
    for line in build.listings:
        wanted = SINGLE_CURRENCY_VENUES.get(line["operating_mic"] or "")
        if wanted and build.live(line) and line["currency"] != wanted and line["currency"] not in WITHDRAWN:
            found.append((build.label(line), line["id"]))
    return found


def currency_is_issue_country(build: Build) -> list[tuple]:
    """Any venue: a foreign currency that is exactly the ISIN country's currency is the notional currency leaking in."""
    found = []
    for line in build.listings:
        if not build.live(line) or line["operating_mic"] in SINGLE_CURRENCY_VENUES:
            continue
        home = build.currency_of(build.country(line))
        isin = build.isin.get(line["security_id"]) or ""
        issued = build.currency_of(isin[:2])
        if home and issued and line["currency"] != home and line["currency"] == issued:
            found.append((build.label(line), line["id"]))
    return found


def ticker_currency_suffix(build: Build) -> list[tuple]:
    """A ticker that names its trading currency (`HONAEUR`) must agree with the line's currency."""
    found = []
    for line in build.listings:
        match = CURRENCY_SUFFIX.match(line["ticker"] or "")
        if match and build.live(line) and len(match["root"]) >= 3 and match["ccy"] != line["currency"]:
            found.append((build.label(line), match["ccy"]))
    return found


# ---- tickers ------------------------------------------------------------------


def ticker_grammar(build: Build) -> list[tuple]:
    found = []
    for line in build.listings:
        if line["ticker"] and build.live(line):
            try:
                identity.normalize_identifier("ticker_mic", f"{line['ticker']}@{line['operating_mic'] or line['mic']}")
            except ValueError:
                found.append((build.label(line),))
    return found


def ticker_venue_shape(build: Build) -> list[tuple]:
    found = []
    for line in build.listings:
        shape = TICKER_SHAPES.get(line["operating_mic"] or "")
        if shape and line["ticker"] and build.live(line) and not shape.match(line["ticker"]):
            found.append((build.label(line),))
    return found


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
    return [((build.securities[s] or {}).get("name"), ", ".join(build.label(l) for l in lines))
            for s in build.by_security if len(lines := _primaries(build, s)) > 1]


def primary_inactive(build: Build) -> list[tuple]:
    return [(build.label(line),) for s in build.by_security if build.live_security(s)
            for line in _primaries(build, s) if line["status"] == "inactive"]


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
                found.append((build.label(line), f"also {us[0]['ticker']}@{us[0]['operating_mic']}"))
    return found


def primary_on_open_market_beside_regulated(build: Build) -> list[tuple]:
    """Primary on an open-market segment while the same security has a live regulated-market line in its ISIN's country."""
    found = []
    for security_id, lines in build.by_security.items():
        isin = build.isin.get(security_id) or ""
        if not build.live_security(security_id):
            continue
        for line in _primaries(build, security_id):
            if build.category(line) == "RMKT" or build.country(line) not in EEA:  # only EEA venues declare it
                continue
            regulated = [l for l in lines if l is not line and build.live(l) and build.category(l) == "RMKT"
                         and build.country(l) == isin[:2]]
            if regulated:
                found.append((build.label(line), f"regulated {build.label(regulated[0])}"))
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
                found.append((build.label(line),))
    return found


def primary_foreign_country(build: Build) -> list[tuple]:
    """An EEA ISIN whose primary is abroad although it has a live regulated line at home."""
    found = []
    for security_id, lines in build.by_security.items():
        isin = build.isin.get(security_id) or ""
        if (not build.live_security(security_id) or build.securities[security_id]["kind"] == "etf"
                or build.currency_of(isin[:2]) is None or isin[:2] in ("US", "CA", "JP", "HK", "AU", "GB", "CH")):
            continue  # an ETF's relevant venue is where it trades most, often not its domicile
        for line in _primaries(build, security_id):
            country = build.country(line)
            home = [l for l in lines if build.live(l) and build.country(l) == isin[:2] and build.category(l) == "RMKT"]
            if country and country != isin[:2] and home:
                found.append((build.label(line), f"home {build.label(home[0])}"))
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


def security_without_listing(build: Build) -> list[tuple]:
    """A live security that has no venue line at all: search and pages cannot reach it."""
    return [(s["name"], s["id"]) for s in build.securities.values()
            if build.live_security(s["id"]) and not build.by_security.get(s["id"])]


def top_ranked_unreachable(build: Build, top: int = 1000) -> list[tuple]:
    """Among the `top` most notable live shares, receipts and ETFs: no live line with a ticker (search cannot find
    them) or no primary (the page opens a secondary line)."""
    ranked = sorted((s for s in build.securities.values() if s["rank"] and build.live_security(s["id"])
                     and s["kind"] in ("ordinary", "depositary_receipt", "etf")), key=lambda s: s["rank"])
    found = []
    for security in ranked[:top]:
        lines = [l for l in build.by_security.get(security["id"], []) if build.live(l)]
        if not any(l["ticker"] for l in lines):
            found.append((security["name"], "no ticker"))
        elif not any(l["is_primary"] for l in lines):
            found.append((security["name"], "no primary"))
    return found


def us_share_without_us_line(build: Build) -> list[tuple]:
    """A live share with a US ISIN and no NYSE, Nasdaq, Cboe or OTC line in a build with SEC lines: usually a
    company delisted or taken over (VMware, Splunk, Marathon Oil) that EU venues still carry."""
    if not build.us:
        return []
    return [(s["name"], build.isin[s["id"]]) for s in build.securities.values()
            if s["kind"] == "ordinary" and build.live_security(s["id"]) and build.isin.get(s["id"], "").startswith("US")
            and not any(l["operating_mic"] in US_EXCHANGES | {"OTCM"} for l in build.by_security.get(s["id"], []))]
