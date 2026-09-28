"""US lines: SEC ticker lines, SEC fund ETFs, their OpenFIGI identifiers, and CIK-to-LEI issuer links.

Links are made by identifier agreement first (FIRDS US ISIN, shared share-class
FIGI, GLEIF's EDGAR registration), then by a unique normalised name. Any
disagreement becomes a flag, never a merge.
"""

from __future__ import annotations

from collections import Counter, defaultdict

from . import rules
from .assemble import FigiMap, Inputs, operating
from .model import GleifEntity, Issuer, Listing, Relationship, Security, SecTicker, Snapshot
from .sec import EXCHANGE_MIC, LISTED_MICS

SEC_EDGAR_RA = "RA000665"
# Name words too common to show two names belong to one company.
GENERIC_WORDS = frozenset("THE AND OF GROUP HOLDING HOLDINGS INTERNATIONAL INDUSTRIES BANK FINANCIAL CAPITAL TRUST FUND "
                          "PARTNERS TECHNOLOGIES TECHNOLOGY SYSTEMS RESOURCES ENERGY AMERICA AMERICAN GLOBAL NEW".split())
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
    _mark_us_primaries(snap)


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
            issuer_id = snap.securities[f"isin:{isin}"].issuer_id
            if issuer_id:  # none when FIRDS names a venue operator's LEI: that is no issuer to link
                evidence[match.cik].append((issuer_id[4:], "isin_exch_us"))
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
    titles = _titles(tickers)
    links: dict[str, tuple[str, str]] = {}
    claimed: dict[str, str] = {}
    alike = {(cik, lei): rule == "name_unique" or _name_alike(titles[cik], snap.issuers.get(f"lei:{lei}"))
             for _weak, cik, lei, rule in candidates}
    # A LEI several CIKs claim and none of them names (FIRDS puts a venue's or data vendor's LEI on US ISINs:
    # TP ICAP, Frankfurter Wertpapierbörse, Bloomberg) links to none of them.
    claimants = Counter(lei for _weak, _cik, lei, _rule in candidates)
    named = {lei for (_cik, lei), match in alike.items() if match}
    for _weak, cik, lei, _rule in candidates:
        if claimants[lei] > 1 and lei not in named:
            snap.flag(f"cik:{cik}", "lei_contested_unnamed", lei)
            audit["link_conflicts"] += 1
    candidates = [c for c in candidates if claimants[c[2]] == 1 or c[2] in named]
    # Identifier links first; among CIKs claiming one LEI, one whose SEC title matches the LEI's names first (FIRDS
    # gives Lee Enterprises' ISIN Berkshire Hathaway's LEI); otherwise CIK order.
    ordered = sorted(candidates, key=lambda c: (c[0], not alike[(c[1], c[2])]))
    for _weak, cik, lei, rule in ordered:
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


def _titles(tickers: list[SecTicker]) -> dict[str, str]:
    return {t.cik: t.name for t in reversed(tickers)}  # a CIK's first SEC title


def _name_alike(title: str, issuer: Issuer | None) -> bool:
    """Whether a SEC title shares a name word with any GLEIF name of the issuer, or its letters apart from
    spacing ("MOODY S", "F N B")."""
    if issuer is None:
        return False
    x = rules.normalized_name(title)
    for name in (issuer.name, *(name for name, *_ in issuer.names)):
        y = rules.normalized_name(name)
        joined = sorted((x.replace(" ", ""), y.replace(" ", "")), key=len)
        if (set(x.split()) & set(y.split())) - GENERIC_WORDS or (joined[0] and joined[1].startswith(joined[0])):
            return True
    return False


def _flag_suspect_links(snap: Snapshot, tickers: list[SecTicker], links: dict[str, tuple[str, str]]) -> None:
    """An identifier link whose SEC title matches no GLEIF name of the LEI: a rename, or a wrong LEI in the
    source. Flagged, kept."""
    titles = _titles(tickers)
    for cik, (lei, rule) in links.items():
        issuer = snap.issuers[f"lei:{lei}"]
        if rule != "name_unique" and not _name_alike(titles[cik], issuer):
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


def _mark_us_primaries(snap: Snapshot) -> None:
    """A SEC security's first exchange-listed line is its primary listing: OpenFIGI shows US lines on every
    exchange, so it cannot name the home one. FIRDS securities are decided in `reconcile`."""
    by_security: dict[str, list[Listing]] = defaultdict(list)
    for listing in snap.listings.values():
        if listing.security_id:
            by_security[listing.security_id].append(listing)
    for security_id, lines in by_security.items():
        security = snap.securities[security_id]
        listed = us_lines(lines)
        if not listed or security.source not in ("sec", "sec_funds"):
            continue
        for line in lines:
            line.is_primary = line is listed[0]
        security.primary_mic, security.primary_rule = listed[0].operating_mic, "us_exchange_listing"


def us_lines(lines: list[Listing]) -> list[Listing]:
    """A security's US exchange lines (not OTC), in SEC file order."""
    return sorted((l for l in lines if l.country == "US" and l.operating_mic in LISTED_MICS and l.currency),
                  key=lambda l: (l.position is None, l.position or 0, l.listing_id))


RECEIPT_RULE = "receipt_issuer_share@1"


def link_receipts(snap: Snapshot, firds_isins: frozenset[str] = frozenset()) -> None:
    """Every receipt's `depositary_receipt_of` names a security of this build, or the receipt has none.

    A FIRDS-stated underlying ISIN is kept when an active security of the build carries it; FIRDS often names a
    superseded ISIN (GSK, ArcelorMittal, Tenaris) or one outside the scope, so such an edge is dropped, flagged
    and counted. A
    receipt no source links (SEC ADRs and New York registry shares; OpenFIGI names no underlying) is linked to its
    issuer's one active ordinary share. Several candidates narrow to the ones FIRDS lists (an ISIN); an issuer with
    a preferred share, or still several candidates, gets no edge: a receipt of a preferred or of another class is
    never guessed. Every drop and narrowing is counted in the build report."""
    audit = snap.audit.setdefault("relations", Counter())
    by_isin = {security.isin: key for key, security in snap.securities.items() if security.isin}
    kept, asked = [], set()
    for item in snap.relationships:
        if item.relation == "depositary_receipt_of":
            target = item.to_id if item.to_id in snap.securities else by_isin.get(item.to_id.split(":", 1)[1])
            # A superseded underlying (Tenaris' old ISIN) may still be in the build, inactive: like a missing one,
            # the edge is dropped, flagged and counted, and the issuer rule below decides.
            reason = ("firds_underlying_outside_build" if target is None else
                      "firds_underlying_inactive" if snap.securities[target].activity == "inactive" else None)
            if reason:  # FIRDS names an underlying this build cannot hold: which security it is now is a question
                audit[reason] += 1
                snap.flag(item.from_id, reason, item.to_id)
                asked.add(item.from_id)
                continue
            item = Relationship(item.from_id, item.relation, target, item.source, item.rule_id)
        kept.append(item)
    snap.relationships[:] = kept
    stated = {item.from_id for item in kept if item.relation == "depositary_receipt_of"}
    # Search keeps only active lines with a ticker; a share with none of them folds nothing in.
    lined = {listing.security_id for listing in snap.listings.values() if listing.ticker and listing.status == "active"}
    by_issuer: dict[str, list[Security]] = defaultdict(list)
    for security in snap.securities.values():
        if security.issuer_id:
            by_issuer[security.issuer_id].append(security)
    for security in snap.securities.values():
        if security.kind != "dr" or security.security_id in stated:
            continue
        siblings = by_issuer.get(security.issuer_id or "", [])
        shares = [item for item in siblings if item.kind == "share" and item.activity == "active" and item.security_id in lined]
        if security.security_id in asked or security.isin in firds_isins:
            # FIRDS states receipts' underlyings (field 26): where it names none this build holds, the answer is a
            # question, not the issuer rule's guess. The issuer's shares are its candidates.
            if security.activity != "inactive":
                snap.ask("receipt_underlying", security.security_id, [item.security_id for item in shares])
            audit["receipt_underlying_question"] += 1
            continue
        if not security.issuer_id:
            continue
        narrowed = len(shares) > 1
        shares = [item for item in shares if item.isin] if narrowed else shares
        if len(shares) != 1 or any(item.kind == "preferred" for item in siblings):
            audit["receipt_without_underlying"] += 1
            continue
        snap.relationships.append(Relationship(security.security_id, "depositary_receipt_of", shares[0].security_id,
                                               "pythia", RECEIPT_RULE))
        audit[RECEIPT_RULE] += 1
        audit["receipt_issuer_share_narrowed_to_firds"] += narrowed  # a guess worth seeing in the report
