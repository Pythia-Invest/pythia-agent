"""US lines: SEC ticker lines, SEC fund ETFs, their OpenFIGI identifiers, and CIK-to-LEI issuer links.

Links are made by identifier agreement first (FIRDS US ISIN, shared share-class
FIGI, GLEIF's EDGAR registration), then by a unique normalised name. Any
disagreement becomes a flag, never a merge.
"""

from __future__ import annotations

from collections import Counter, defaultdict

from . import rules
from .assemble import FigiMap, Inputs, operating
from .model import GleifEntity, Issuer, Listing, Security, SecTicker, Snapshot, Venue
from .sec import EXCHANGE_MIC, LISTED_MICS

SEC_EDGAR_RA = "RA000665"
IDENTIFIER_RULES = ("isin_exch_us", "share_class_figi", "gleif_edgar_registration")


def _pick(rows: list[dict]) -> dict | None:
    equity = [r for r in rows if r.get("marketSector") in (None, "Equity")]
    return (equity or rows or [None])[0]


def build_sec(snap: Snapshot, inputs: Inputs, entities: dict[str, GleifEntity], figi_map: FigiMap) -> None:
    audit = snap.audit.setdefault("sec", Counter())
    tickers = inputs.sec_tickers
    audit["tickers"] = len(tickers)
    answers = figi_map([_ticker_job(t.ticker, "US") for t in tickers])
    rows = {t.ticker: _pick(a.get("data") or []) for t, a in zip(tickers, answers)}
    audit["openfigi_found"] = sum(1 for r in rows.values() if r)
    lines = _exchange_lines(figi_map, [(t.ticker, EXCHANGE_CODES.get(t.exchange or "", ())) for t in tickers if rows.get(t.ticker)])
    for ticker, line in lines.items():  # the venue line's own FIGI, not the US composite's
        rows[ticker] = rows[ticker] | {"figi": line["figi"]}
    audit["listing_figi_from_composite"] = sum(1 for t in tickers if rows.get(t.ticker) and t.ticker not in lines)

    evidence, isins = _link_evidence(snap, entities, tickers, rows, figi_map)
    links = _decide(snap, tickers, evidence, audit)
    _flag_suspect_links(snap, tickers, links)
    share_classes = {s.share_class_figi: s for s in snap.securities.values() if s.share_class_figi and s.isin}
    for ticker in tickers:
        listing = _listing(snap, inputs, ticker, rows.get(ticker.ticker), links.get(ticker.cik), audit)
        if not listing.security_id:
            listing.security_id = _security_for(snap, listing, isins.get(ticker.ticker), share_classes)
    build_us_etfs(snap, inputs, figi_map)
    _flag_split_issuers(snap)
    _mark_us_primaries(snap, inputs.venues)


def build_us_etfs(snap: Snapshot, inputs: Inputs, figi_map: FigiMap) -> None:
    """Exchange-traded funds from the SEC fund file, placed with OpenFIGI, as issuer-less ETF securities.

    The fund file names no fund and no exchange. OpenFIGI's US line gives the name
    and the security type (ETP is exchange-traded; mutual-fund classes are not). It
    shows ETF lines on every US exchange alike, except that only a Nasdaq-listed
    ETF has a Nasdaq (`UQ`) line, so only Nasdaq ETFs can be placed; the others are
    counted as unplaced. A fund trust's CIK covers every series it runs, so it is
    no issuer for search; an ETF that FIRDS also lists joins that security.
    """
    audit = snap.audit.setdefault("us_etfs", Counter())
    have = {t.ticker for t in inputs.sec_tickers}
    funds = [f for f in inputs.sec_funds if f.ticker not in have]
    rows = [_pick(a.get("data") or []) for a in figi_map([_ticker_job(f.ticker, "US") for f in funds])]
    etfs = [(f, row) for f, row in zip(funds, rows) if row and row.get("securityType") == "ETP"]
    nasdaq = figi_map([_ticker_job(f.ticker, "UQ") for f, _ in etfs])
    audit["fund_tickers"], audit["exchange_traded"] = len(funds), len(etfs)
    share_classes = {s.share_class_figi: s for s in snap.securities.values() if s.share_class_figi and s.isin}
    for (fund, row), on_nasdaq in zip(etfs, nasdaq):
        line = _pick(on_nasdaq.get("data") or [])
        if not line:
            audit["unplaced_not_nasdaq"] += 1
            continue
        audit["placed_nasdaq"] += 1
        root, klass = rules.split_ticker(fund.ticker)
        listing = Listing(
            listing_id=f"XNAS:{fund.ticker}", source="sec_funds", row_class="etf", mic="XNAS", operating_mic="XNAS",
            country="US", ticker=fund.ticker, ticker_root=root, ticker_class=klass, ticker_source="sec_funds", currency="USD",
            name=row.get("name"), figi=line.get("figi"), composite_figi=row.get("compositeFIGI"),
            share_class_figi=row.get("shareClassFIGI"), security_type=row.get("securityType"),
        )
        security = share_classes.get(listing.share_class_figi or "")
        if security:
            audit["joined_firds_security"] += 1
            listing.security_id = security.security_id
        else:
            listing.security_id = f"figi:{listing.share_class_figi}" if listing.share_class_figi else f"etf:{fund.ticker}"
            snap.securities.setdefault(listing.security_id, Security(
                security_id=listing.security_id, kind="etf", source="sec_funds", share_class_figi=listing.share_class_figi,
                name=listing.name))
        snap.listings[listing.listing_id] = listing


def _ticker_job(ticker: str, exchange: str) -> dict:
    return {"idType": "TICKER", "idValue": ticker.replace("-", "/"), "exchCode": exchange}


# OpenFIGI exchange codes of a SEC exchange label's venue lines, most likely first: Nasdaq's
# three tiers; NYSE, then NYSE Arca and NYSE American (the SEC's "NYSE" covers all three);
# Cboe BZX; OTC Markets.
EXCHANGE_CODES = {"Nasdaq": ("UW", "UQ", "UR"), "NYSE": ("UN", "UP", "UA"), "CBOE": ("UF",), "OTC": ("PQ",)}


def _exchange_lines(figi_map: FigiMap, wanted: list[tuple[str, tuple[str, ...]]]) -> dict[str, dict]:
    """Each ticker's OpenFIGI row on the first of its exchange codes that has one (one round per code)."""
    found: dict[str, dict] = {}
    for round_ in range(max((len(codes) for _, codes in wanted), default=0)):
        jobs = [(ticker, codes[round_]) for ticker, codes in wanted if ticker not in found and round_ < len(codes)]
        for (ticker, _code), answer in zip(jobs, figi_map([_ticker_job(t, c) for t, c in jobs])):
            row = _pick(answer.get("data") or [])
            if row and row.get("figi"):
                found[ticker] = row
    return found


def _link_evidence(snap, entities, tickers, rows, figi_map) -> tuple[dict[str, list[tuple[str, str]]], dict[str, str]]:
    """Candidate LEIs per CIK with the rule that produced each, and FIRDS ISINs per SEC ticker."""
    by_ticker = {t.ticker: t for t in tickers}
    evidence: dict[str, list[tuple[str, str]]] = defaultdict(list)
    isins: dict[str, str] = {}
    us_isins = sorted(s.isin for s in snap.securities.values() if s.isin and s.isin.startswith("US") and s.kind == "share")
    for isin, answer in zip(us_isins, figi_map([{"idType": "ID_ISIN", "idValue": i, "exchCode": "US"} for i in us_isins])):
        row = _pick(answer.get("data") or [])
        match = by_ticker.get((row or {}).get("ticker", "").replace("/", "-"))
        if match:
            evidence[match.cik].append((snap.securities[f"isin:{isin}"].issuer_id[4:], "isin_exch_us"))
            snap.audit["sec"]["isin_from_firds"] += 1
            isins[match.ticker] = isin
    share_classes = {s.share_class_figi: s for s in snap.securities.values() if s.share_class_figi and s.isin}
    for ticker in tickers:
        security = share_classes.get((rows.get(ticker.ticker) or {}).get("shareClassFIGI"))
        if security and security.issuer_id and security.issuer_id.startswith("lei:"):
            evidence[ticker.cik].append((security.issuer_id[4:], "share_class_figi"))
    for entity in entities.values():
        if entity.registered_at == SEC_EDGAR_RA and (entity.registered_as or "").isdigit():
            evidence[str(int(entity.registered_as))].append((entity.lei, "gleif_edgar_registration"))
    _name_evidence(snap, tickers, evidence)
    return evidence, isins


def _name_evidence(snap, tickers, evidence) -> None:
    by_name: dict[str, set[str]] = defaultdict(set)
    for issuer in snap.issuers.values():
        if issuer.lei and issuer.entity_status != "INACTIVE":
            for name, kind, _lang, _src in issuer.names:
                if kind != "PREVIOUS_LEGAL_NAME":
                    by_name[rules.normalized_name(name)].add(issuer.lei)
    ciks_by_name: dict[str, set[str]] = defaultdict(set)
    for ticker in tickers:
        ciks_by_name[rules.normalized_name(ticker.name)].add(ticker.cik)
    for key, ciks in ciks_by_name.items():
        leis = by_name.get(key, set())
        if len(key) >= rules.MIN_NAME_KEY and len(leis) == 1 and len(ciks) == 1:
            evidence[next(iter(ciks))].append((next(iter(leis)), "name_unique"))


def _decide(snap, tickers, evidence, audit) -> dict[str, tuple[str, str]]:
    """One LEI per CIK. Identifier links claim their LEI before any name link does."""
    candidates = []
    for cik in sorted({t.cik for t in tickers}, key=int):
        found = evidence.get(cik, [])
        strong = {lei for lei, rule in found if rule in IDENTIFIER_RULES}
        weak = {lei for lei, rule in found if rule == "name_unique"}
        if len(strong) > 1:
            snap.flag(f"cik:{cik}", "cik_lei_conflict", ",".join(sorted(strong)))
            audit["link_conflicts"] += 1
            continue
        if strong:
            lei = next(iter(strong))
            rule = next(r for l, r in found if l == lei and r in IDENTIFIER_RULES)
            if weak and weak != strong:
                snap.flag(f"cik:{cik}", "name_link_contradicted", ",".join(sorted(weak)))
        elif len(weak) == 1:
            lei, rule = next(iter(weak)), "name_unique"
        else:
            continue
        candidates.append((rule == "name_unique", cik, lei, rule))
    links: dict[str, tuple[str, str]] = {}
    claimed: dict[str, str] = {}
    for _weak, cik, lei, rule in sorted(candidates, key=lambda c: c[0]):  # stable: CIK order within a pass
        if lei in claimed:
            snap.flag(f"cik:{cik}", "lei_already_linked", f"{lei} to cik:{claimed[lei]}")
            audit["link_conflicts"] += 1
            continue
        links[cik] = (lei, rule)
        claimed[lei] = cik
        audit[f"link_{rule}"] += 1
    return links


def _issuer_for(snap: Snapshot, ticker: SecTicker, link: tuple[str, str] | None) -> Issuer:
    if link:
        issuer = snap.issuers[f"lei:{link[0]}"]
        issuer.cik, issuer.cik_rule = ticker.cik, link[1]
    else:
        issuer = snap.issuers.setdefault(f"cik:{ticker.cik}", Issuer(issuer_id=f"cik:{ticker.cik}", name=ticker.name, source="sec", cik=ticker.cik, name_rule="sec_title"))
    if (ticker.name, "SEC_TITLE", None, "sec") not in issuer.names:
        issuer.names.append((ticker.name, "SEC_TITLE", None, "sec"))
    return issuer


def _flag_suspect_links(snap: Snapshot, tickers: list[SecTicker], links: dict[str, tuple[str, str]]) -> None:
    """An identifier link whose SEC title shares no name word with any GLEIF name of the LEI: a rename, or a
    wrong LEI in the source (FIRDS gives Lee Enterprises' ISIN Berkshire Hathaway's LEI). Flagged, kept."""
    titles = {t.cik: t.name for t in reversed(tickers)}

    def alike(a: str, b: str) -> bool:  # a shared word, or the same letters apart from spacing ("MOODY S", "F N B")
        x, y = rules.normalized_name(a), rules.normalized_name(b)
        joined = sorted((x.replace(" ", ""), y.replace(" ", "")), key=len)
        return bool(set(x.split()) & set(y.split())) or bool(joined[0]) and joined[1].startswith(joined[0])

    for cik, (lei, rule) in links.items():
        issuer = snap.issuers[f"lei:{lei}"]
        names = [issuer.name, *(name for name, *_ in issuer.names)]
        if rule != "name_unique" and not any(alike(titles[cik], name) for name in names):
            snap.flag(issuer.issuer_id, "cik_link_suspect", f"cik:{cik}")


def _flag_split_issuers(snap: Snapshot) -> None:
    """A CIK-only issuer named like a LEI issuer: probably one company split in two (a CIK linked elsewhere)."""
    by_name = {rules.normalized_name(issuer.name): issuer.issuer_id for issuer in snap.issuers.values() if issuer.lei}
    for issuer in snap.issuers.values():
        key = rules.normalized_name(issuer.name) if not issuer.lei else ""
        if len(key) >= rules.MIN_NAME_KEY and key in by_name:
            snap.flag(issuer.issuer_id, "issuer_split_lei_cik", by_name[key])


def _listing(snap: Snapshot, inputs: Inputs, ticker: SecTicker, row: dict | None, link, audit: Counter) -> Listing:
    issuer = _issuer_for(snap, ticker, link)
    mic = EXCHANGE_MIC.get(ticker.exchange or "")
    etp = (row or {}).get("securityType") == "ETP"
    row_class = "etf" if etp else rules.sec_row_class((row or {}).get("securityType2"), ticker.ticker)
    audit[f"row_class_{row_class}"] += 1
    listing_id = f"{mic or 'US'}:{ticker.ticker}"
    listing = snap.listings.get(listing_id) or Listing(listing_id=listing_id, source="sec", row_class=row_class)
    root, klass = rules.split_ticker(ticker.ticker)
    listing.issuer_id, listing.mic, listing.operating_mic, listing.country = issuer.issuer_id, mic, operating(inputs.venues, mic), "US"
    listing.ticker, listing.ticker_root, listing.ticker_class, listing.ticker_source = ticker.ticker, root, klass, "sec"
    listing.currency = listing.currency or "USD"
    listing.position = ticker.position if listing.position is None else min(listing.position, ticker.position)
    listing.name = listing.name or ticker.name
    if row:
        listing.figi, listing.composite_figi = row.get("figi"), row.get("compositeFIGI")
        listing.share_class_figi = row.get("shareClassFIGI")
        listing.security_type = row.get("securityType2") or row.get("securityType")
    else:
        listing.status_reasons.append("no_openfigi_line")
    if ticker.exchange == "NYSE":
        listing.status_reasons.append("sec_nyse_may_be_american_or_arca")
    snap.listings[listing_id] = listing
    return listing


def _security_for(snap: Snapshot, listing: Listing, isin: str | None, share_classes: dict[str, Security]) -> str:
    """Same share class or FIRDS ISIN: the EU security. Otherwise a SEC-only security."""
    security = snap.securities.get(f"isin:{isin}") if isin else share_classes.get(listing.share_class_figi or "")
    if security:
        if listing.operating_mic in LISTED_MICS and not (security.isin or "").startswith("US"):
            snap.flag(listing.listing_id, "co_primary_same_security", security.security_id)
        return security.security_id
    security_id = f"figi:{listing.share_class_figi}" if listing.share_class_figi else f"sec:{listing.ticker}"
    kind = listing.row_class if listing.row_class in ("share", "dr", "etf", "preferred", "fund") else "other"
    snap.securities.setdefault(
        security_id,
        Security(security_id=security_id, kind=kind, source="sec", issuer_id=listing.issuer_id, share_class_figi=listing.share_class_figi),
    )
    return security_id


def _mark_us_primaries(snap: Snapshot, venues: dict[str, Venue]) -> None:
    """A US security's first exchange-listed line is its primary listing.

    US securities are the SEC ones, and FIRDS securities with a US ISIN: OpenFIGI
    shows US lines on every exchange, so it cannot name the home one. A non-US
    security with a US exchange line and no line in its ISIN's country (Linde,
    Accenture) has its home market in the US too, unless its primary is an EEA
    regulated-market admission (Stellantis and Ferrari on Euronext Milan).
    """
    by_security: dict[str, list[Listing]] = defaultdict(list)
    for listing in snap.listings.values():
        if listing.security_id:
            by_security[listing.security_id].append(listing)
    for security_id, lines in by_security.items():
        security = snap.securities[security_id]
        listed = sorted((l for l in lines if l.country == "US" and l.operating_mic in LISTED_MICS and l.currency),
                        key=lambda l: (l.position is None, l.position or 0, l.listing_id))
        if not listed:
            continue
        if security.source in ("sec", "sec_funds") or (security.isin or "").startswith("US"):
            rule = "us_exchange_listing"
        elif _us_home(security, lines, venues):
            rule = "us_exchange_no_home_line"
        else:
            continue
        for line in lines:
            line.is_primary = line is listed[0]
        security.primary_mic, security.primary_rule = listed[0].operating_mic, rule


def _us_home(security: Security, lines: list[Listing], venues: dict[str, Venue]) -> bool:
    if not security.isin or any(l.country == security.isin[:2] and l.status != "inactive" for l in lines):
        return False
    current = next((l for l in lines if l.is_primary), None)
    venue = venues.get(current.mic or "") if current else None
    return not (venue and venue.category == "RMKT" and venue.country in rules.EEA)
