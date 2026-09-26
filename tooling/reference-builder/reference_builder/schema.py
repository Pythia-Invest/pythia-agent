"""Reference snapshot tables: the only module that knows the on-disk layout.

The file is core's reference store (`runtime/managed/core/identity/sql/reference.sql`)
with subject IDs from core's `subject_id()`, so core reads it without a mapping.
The assembled snapshot keeps its own working IDs; this module translates them.
Identifier assertions carry authority `snapshot` (carried from a verified build);
the curated native-coin seed carries `curated`.
"""

from __future__ import annotations

import importlib.util
import json
import re
import sys
from collections import Counter
from pathlib import Path

from . import rules
from .config import BUILDER_VERSION
from .model import Snapshot

CORE = Path(__file__).resolve().parents[3] / "runtime" / "managed" / "core" / "identity"


def _core():
    """Load core's identity package from the checkout (standard library only, no I/O at import)."""
    name = "pythia_core_identity"
    if name not in sys.modules:
        spec = importlib.util.spec_from_file_location(name, CORE / "__init__.py", submodule_search_locations=[str(CORE)])
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
    return sys.modules[name]


identity = _core()
DDL = identity.schema_sql(identity.Store.REFERENCE)
SCHEMA_VERSION = int(importlib.import_module("pythia_core_identity.store").REFERENCE_SCHEMA_VERSION)
# Curated short venue labels (Pythia-authored), by operating MIC or by a segment that
# investors name on its own (growth markets, ETF segments). A segment without its own
# label takes its operator's; other venues keep their ISO 10383 name.
VENUE_NAMES = {
    # Euronext
    "XAMS": "Euronext Amsterdam", "XPAR": "Euronext Paris", "XBRU": "Euronext Brussels", "XLIS": "Euronext Lisbon",
    "XMIL": "Euronext Milan", "XDUB": "Euronext Dublin", "XMSM": "Euronext Dublin", "XOSL": "Euronext Oslo",
    "ALXP": "Euronext Growth Paris", "XMLI": "Euronext Access Paris", "ALXB": "Euronext Growth Brussels",
    "MLXB": "Euronext Access Brussels", "VPXB": "Euronext Brussels", "ALXL": "Euronext Growth Lisbon",
    "ENXL": "Euronext Access Lisbon", "XESM": "Euronext Growth Dublin", "XACD": "Euronext Access Dublin",
    "EXGM": "Euronext Growth Milan", "MTAA": "Euronext Milan", "ETFP": "Borsa Italiana ETFplus", "ETLX": "EuroTLX",
    "BGEM": "Borsa Italiana Global Equity", "MERK": "Euronext Growth Oslo", "XOAS": "Euronext Expand Oslo",
    # Germany and Austria
    "XETR": "Xetra", "XFRA": "Frankfurt", "XSTU": "Stuttgart", "XMUN": "Munich", "MUND": "gettex",
    "XDUS": "Düsseldorf", "XHAM": "Hamburg", "HAMN": "LS Exchange", "XHAN": "Hanover", "XBER": "Berlin",
    "TGAT": "Tradegate", "XWBO": "Vienna Stock Exchange",
    # Nordics and Baltics
    "XSTO": "Nasdaq Stockholm", "XHEL": "Nasdaq Helsinki", "XCSE": "Nasdaq Copenhagen", "XICE": "Nasdaq Iceland",
    "XTAL": "Nasdaq Tallinn", "XRIS": "Nasdaq Riga", "XLIT": "Nasdaq Vilnius", "SSME": "First North Sweden",
    "FSME": "First North Finland", "DSME": "First North Denmark", "FNIS": "First North Iceland",
    "FNEE": "First North Estonia", "FNLV": "First North Latvia", "FNLT": "First North Lithuania",
    "XSAT": "Spotlight Stock Market", "XNGM": "Nordic Growth Market",
    # Southern, central and eastern Europe
    "BMEX": "BME Spanish Exchanges", "XMAD": "Madrid Stock Exchange", "GROW": "BME Growth", "SCLE": "BME Scaleup",
    "XLAT": "Latibex", "POSE": "Portfolio Stock Exchange", "ASEX": "Athens Stock Exchange", "XCYS": "Cyprus Stock Exchange",
    "XMAL": "Malta Stock Exchange", "XWAR": "Warsaw Stock Exchange", "XNCO": "NewConnect", "XPRA": "Prague Stock Exchange",
    "XRMZ": "RM-System Prague", "XBUD": "Budapest Stock Exchange", "XBRA": "Bratislava Stock Exchange",
    "XLJU": "Ljubljana Stock Exchange", "XZAG": "Zagreb Stock Exchange", "XBSE": "Bucharest Stock Exchange",
    "XBUL": "Bulgarian Stock Exchange", "MBUL": "MTF Sofia", "XLUX": "Luxembourg Stock Exchange",
    "EMTF": "Luxembourg Euro MTF", "NPEX": "NPEX", "XNXC": "NXCHANGE", "HMTF": "Vorvel",
    # Pan-European trading venues (multilateral, dark and request-for-quote)
    "CCXE": "Cboe Europe", "CCRM": "Cboe Europe RM", "AQEU": "Aquis Europe", "TQEX": "Turquoise Europe",
    "ITGL": "Posit", "XIGG": "Blockmatch Europe", "SGMU": "Sigma X Europe", "TPIC": "TP ICAP", "TWEU": "Tradeweb EU",
    "BTFE": "Bloomberg MTF", "MANL": "MarketAxess", "OCXE": "OneChronos Europe", "UBSL": "UBS Europe",
    # United Kingdom, Switzerland, United States
    "XLON": "London Stock Exchange", "XSWX": "SIX Swiss Exchange",
    "XNAS": "Nasdaq", "XNGS": "Nasdaq", "XNMS": "Nasdaq", "XNCM": "Nasdaq", "XNYS": "NYSE", "XASE": "NYSE American",
    "ARCX": "NYSE Arca", "XCHI": "NYSE Texas", "BATS": "Cboe BZX", "XCBO": "Cboe", "IEXG": "IEX",
    "TXSE": "Texas Stock Exchange", "OTCM": "OTC Markets",
}
KIND = {"share": "ordinary", "dr": "depositary_receipt", "etf": "etf", "preferred": "preferred", "fund": "fund"}
STATUS = {"active": "active", "suspect": "unknown", "inactive": "inactive"}
FIRST_WINS = {"names", "listings", "composites", "assertions"}  # collapsed lines share an ID; the first row wins
# (the writer audits every ignored row, so a constraint violation is counted, not hidden)


def derive(level: str, identifiers: dict[str, str | None], **context) -> str | None:
    """Core's subject ID from the well-formed identifiers only (a malformed value is no key)."""
    valid = {}
    for scheme, value in identifiers.items():
        try:
            valid[scheme] = identity.normalize_identifier(scheme, value) if value else None
        except ValueError:
            pass
    return identity.subject_id(level, valid, **context)


class _Ids:
    """Working IDs (`lei:X`, `isin:X`, `XAMS:<ISIN>`) to core subject IDs."""

    def __init__(self, snap: Snapshot):
        self.snap = snap
        self.issuers = {key: self._issuer(item) for key, item in snap.issuers.items()}
        self.securities = {key: self._security(item) for key, item in snap.securities.items()}

    def _issuer(self, issuer) -> str:
        found = derive("issuer", {"lei": issuer.lei, "cik": issuer.cik})
        return found or identity.provisional_id("issuer", issuer.source, "id", issuer.issuer_id.split(":", 1)[1])

    def _security(self, security) -> str:
        found = derive("security", {"isin": security.isin, "share_class_figi": security.share_class_figi})
        return found or identity.provisional_id("security", security.source, "id", security.security_id.split(":", 1)[1])

    def listing(self, listing) -> str | None:
        security = self.snap.securities.get(listing.security_id or "")
        if not listing.mic or not listing.currency or security is None:
            return None
        found = derive("listing", {"isin": security.isin, "figi": listing.figi},
                       operating_mic=listing.operating_mic or listing.mic, currency=listing.currency)
        return found or identity.provisional_id("listing", listing.source, "ticker", f"{listing.mic}.{listing.ticker}")


def rows(snap: Snapshot, meta: dict[str, str], sources: list[dict]) -> dict[str, list[dict]]:
    """Table name -> rows as column dicts, in dependency order."""
    at = meta.get("created_at") or f"{snap.as_of}T00:00:00Z"
    ids, audit = _Ids(snap), Counter()
    tables: dict[str, list[dict]] = {name: [] for name in (
        "release", "venues", "issuers", "securities", "composites", "listings", "assertions", "relations", "names",
        "chains", "provider_chains", "native_coins")}

    def assert_(subject, scheme, value, source, *, record=None, start=None, end=None, authority="snapshot"):
        try:
            item = identity.IdentifierAssertion(
                subject_id=subject, scheme=scheme, value=value, authority=authority,
                provenance={"plugin": source, "source": source, "adapter_version": BUILDER_VERSION, "retrieved_at": at,
                            "source_record": record},
                validity={"valid_from": start, "valid_to": end})
        except ValueError:
            audit[f"skipped_{scheme}"] += 1
            return
        tables["assertions"].append({
            "evidence_id": item.evidence_id, "subject_id": subject, "level": item.level, "scheme": scheme,
            "value": item.value, "valid_from": start, "valid_to": end, "authority": authority, "source": source,
            "source_record": record, "plugin": source, "adapter_version": BUILDER_VERSION, "retrieved_at": at})

    def name(subject, text, source):
        if text:
            tables["names"].append({"subject_id": subject, "name": text[:512], "source": source})

    for venue in snap.venues.values():
        label = VENUE_NAMES.get(venue.mic) or VENUE_NAMES.get(venue.operating_mic) or venue.name or venue.mic
        tables["venues"].append({"mic": venue.mic, "operating_mic": venue.operating_mic, "name": label, "country": venue.country or None})
    # An issuer's tickers keep their capitals when its name is re-cased for display (ASML, RELX).
    tickers: dict[str, frozenset[str]] = {}
    for listing in snap.listings.values():
        owner = snap.securities[listing.security_id].issuer_id if listing.security_id in snap.securities else None
        if owner and listing.ticker:
            tickers[owner] = tickers.get(owner, frozenset()) | set(re.split(r"[^A-Z0-9]+", listing.ticker.upper()))
    for key, issuer in sorted(snap.issuers.items()):
        subject = ids.issuers[key]
        country = issuer.country if issuer.country and len(issuer.country) == 2 else None
        status = "inactive" if issuer.entity_status == "INACTIVE" else "active"
        shown = rules.display_case(issuer.name, tickers.get(key, frozenset()), sec=issuer.source == "sec")
        tables["issuers"].append({"id": subject, "name": shown[:512], "country": country, "status": status})
        if issuer.lei:
            assert_(subject, "lei", issuer.lei, "gleif" if issuer.source == "gleif" else "esma_firds")
        if issuer.cik:
            assert_(subject, "cik", issuer.cik, "sec", record=issuer.cik_rule)
        for text, _kind, _language, source in issuer.names:
            if text != issuer.name:
                name(subject, text, source)
    line_names: dict[str, str] = {}
    for listing in snap.listings.values():
        if listing.name and listing.security_id:
            line_names.setdefault(listing.security_id, listing.name)
    titles: dict[str, str | None] = {}
    for key, security in sorted(snap.securities.items()):
        subject = ids.securities[key]
        title = titles[key] = security.name or line_names.get(key)
        issuer = snap.issuers.get(security.issuer_id or "")
        tables["securities"].append({
            "id": subject, "issuer_id": ids.issuers.get(security.issuer_id or ""),
            "name": rules.display_case(title or (issuer.name if issuer else None) or subject,
                                       tickers.get(security.issuer_id or "", frozenset()),
                                       sec=bool(issuer and issuer.source == "sec"))[:512], "asset_class": "equity",
            "kind": KIND.get(security.kind, "other"), "status": STATUS.get(security.activity, "unknown"),
            "rank": security.rank})
        if security.isin:
            assert_(subject, "isin", security.isin, "esma_firds")
        if security.share_class_figi:
            assert_(subject, "share_class_figi", security.share_class_figi, "openfigi")
    for listing in sorted(snap.listings.values(), key=lambda l: (not l.is_primary, l.status != "active", l.listing_id)):
        subject = ids.listing(listing)
        if subject is None:  # core needs a venue and a trading currency for a venue line
            audit["lines_without_venue" if not listing.mic else "lines_without_currency"] += 1
            continue
        security_id = ids.securities[listing.security_id]
        composite = None
        security = snap.securities[listing.security_id]
        if listing.composite_figi and listing.country:
            composite = derive("composite", {"isin": security.isin, "share_class_figi": security.share_class_figi},
                               country=listing.country)
            if composite:
                tables["composites"].append({"id": composite, "security_id": security_id, "country": listing.country})
                assert_(composite, "composite_figi", listing.composite_figi, "openfigi")
        tables["listings"].append({
            "id": subject, "security_id": security_id, "composite_id": composite, "mic": listing.mic,
            "operating_mic": listing.operating_mic, "ticker": listing.ticker, "currency": listing.currency,
            "chain": None, "is_primary": int(listing.is_primary), "status": STATUS.get(listing.status, "unknown")})
        span = {"start": listing.valid_from, "end": listing.valid_to}
        if listing.figi:
            assert_(subject, "figi", listing.figi, "openfigi", **span)
        if listing.ticker:
            assert_(subject, "ticker_mic", f"{listing.ticker}@{listing.operating_mic or listing.mic}",
                    listing.ticker_source or listing.source, **span)
        if listing.name != titles.get(listing.security_id):  # the security row already carries its title
            name(subject, listing.name, listing.source)
    for relation in snap.relationships:
        source, target = ids.securities.get(relation.from_id), f"security:{relation.to_id}"
        try:
            item = identity.Relation(type=relation.relation, from_id=source, to_id=target, authority="snapshot",
                                     provenance={"plugin": relation.source, "source": relation.source,
                                                 "adapter_version": BUILDER_VERSION, "retrieved_at": at,
                                                 "source_record": relation.rule_id})
        except (TypeError, ValueError):
            audit["skipped_relations"] += 1
            continue
        tables["relations"].append({
            "evidence_id": item.evidence_id, "type": item.type, "from_id": source, "to_id": target,
            "authority": "snapshot", "source": relation.source, "source_record": relation.rule_id,
            "plugin": relation.source, "adapter_version": BUILDER_VERSION, "retrieved_at": at})
    _native_coins(tables, assert_)
    snap.audit["schema"] = dict(sorted(audit.items()))
    release = {"schema_version": str(SCHEMA_VERSION), "release": meta.get("build_id", ""), "built_at": at,
               "built_by": "device", "sources": json.dumps(sources, sort_keys=True), **meta}
    tables["release"] = [{"key": key, "value": str(value)} for key, value in sorted(release.items())]
    return tables


def _native_coins(tables: dict[str, list[dict]], assert_) -> None:
    """Core's curated native-coin seed: the crypto assets search finds without any provider."""
    seed = json.loads((CORE / "native_coins.json").read_text(encoding="utf-8"))
    tables["chains"] += seed["chains"]
    tables["provider_chains"] += seed["provider_chains"]
    for coin in seed["coins"]:
        security = identity.subject_id("security", {"caip19": coin["caip19"]})
        listing = identity.subject_id("listing", {"caip19": coin["caip19"]})
        tables["securities"].append({"id": security, "issuer_id": None, "name": coin["name"], "asset_class": "crypto",
                                     "kind": "coin", "status": "active", "rank": coin["rank"]})
        tables["listings"].append({"id": listing, "security_id": security, "composite_id": None, "mic": None,
                                   "operating_mic": None, "ticker": coin["symbol"], "currency": None,
                                   "is_primary": 1, "status": "active", "chain": coin["caip19"].split("/", 1)[0]})
        assert_(listing, "caip19", coin["caip19"], "pythia", record=seed["rule_id"], authority="curated")
        for alias in coin.get("aliases", []):
            tables["names"].append({"subject_id": security, "name": alias, "source": "pythia"})
        for provider in ("coinmarketcap", "coingecko"):
            tables["native_coins"].append({"caip19": coin["caip19"], "provider": provider, "native_scope": "coin",
                                           "native_id": coin[provider]})
