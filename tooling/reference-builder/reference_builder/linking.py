"""US lines: SEC ticker lines, SEC fund ETFs, their OpenFIGI identifiers, and CIK-to-LEI issuer links.

Links are made by identifier agreement only (FIRDS US ISIN, shared share-class
FIGI, GLEIF's EDGAR registration). A unique name match is no link: the CIK stays
a CIK-only issuer, and the match is kept as an open question carrying the LEI as
its candidate (R2: unknown plus a question, never a stored guess). Identifiers
that disagree where no rule decides leave the link unresolved and ask each CIK's
issuer (ADR 0044, A2), never a merge or a winner by CIK order. Among candidates
the identifiers already name, an exact full name (`_named`) may choose one; it
never links on its own, and no tie-break picks a LAPSED LEI.
"""

from __future__ import annotations

from collections import Counter, defaultdict

from . import gleif, rules
from .link_review import flag_split_issuers, flag_suspect_links, titles_by_cik
from .assemble import FigiMap, Inputs, operating
from .model import JOINED_LINKS, STATED_LINKS, Evidence, GleifEntity, Issuer, Listing, Security, SecTicker, Snapshot
from .sec import EXCHANGE_MIC, LISTED_MICS

SEC_EDGAR_RA = "RA000665"
IDENTIFIER_RULES = (*JOINED_LINKS, *STATED_LINKS)


def _pick(rows: list[dict]) -> dict | None:
    equity = [r for r in rows if r.get("marketSector") in (None, "Equity")]
    return (equity or rows or [None])[0]


def build_sec(snap: Snapshot, inputs: Inputs, entities: dict[str, GleifEntity], figi_map: FigiMap) -> None:
    audit = snap.audit.setdefault("sec", Counter())
    tickers = inputs.sec_tickers
    audit["tickers"] = len(tickers)
    answers = figi_map([_ticker_job(t.ticker, "US") for t in tickers])
    rows = {t.ticker: _pick(a.get("data") or []) for t, a in zip(tickers, answers)}
    lines = _exchange_lines(figi_map, [(t.ticker, EXCHANGE_CODES.get(t.exchange or "", ())) for t in tickers if rows.get(t.ticker)])
    for ticker, line in lines.items():  # the venue line's own FIGI, not the US composite's
        rows[ticker] = rows[ticker] | {"figi": line["figi"]}
    if inputs.openfigi:
        audit["openfigi_found"] = sum(1 for r in rows.values() if r)
        audit["listing_figi_from_composite"] = sum(1 for t in tickers if rows.get(t.ticker) and t.ticker not in lines)

    evidence, isins = _link_evidence(snap, entities, tickers, rows, figi_map, inputs.claims().digests, inputs.gleif)
    links = _decide(snap, tickers, evidence, audit)
    _ask_name_candidates(snap, tickers, links, audit)
    flag_suspect_links(snap, tickers, links)
    share_classes = {s.share_class_figi: s for s in snap.securities.values() if s.share_class_figi and s.isin}
    for ticker in tickers:
        listing = _listing(snap, inputs, ticker, rows.get(ticker.ticker), links.get(ticker.cik), audit)
        if not listing.security_id:
            listing.security_id = _security_for(snap, listing, ticker.cik, isins.get(ticker.ticker), share_classes)
    build_us_etfs(snap, inputs, figi_map)
    flag_split_issuers(snap)
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
            listing_id=f"XNAS:{fund.ticker}", source="sec_funds", evidence=Evidence.REGISTRANT_FILING, row_class="etf",
            mic="XNAS", operating_mic="XNAS",
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
                security_id=listing.security_id, kind="etf", source="sec_funds", evidence=Evidence.REGISTRANT_FILING,
                share_class_figi=listing.share_class_figi, name=listing.name))
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


def _link_evidence(snap, entities, tickers, rows, figi_map, digests: dict[str, str], gleif_read: bool = True
                   ) -> tuple[dict[str, list[tuple[str | None, str, str | None]]], dict[str, str]]:
    """Candidate LEIs per CIK with the rule that produced each and the record it rests on (`record:<digest>`: the
    FIRDS record of the ISIN or share class, or GLEIF's record), and FIRDS ISINs per SEC ticker.

    A CIK's exchange tickers (Nasdaq, NYSE, Cboe) outrank its OTC rows: OTC Markets lists foreign lines and unrelated
    companies' tickers under a registrant's CIK (CIBC's CNDIF is Canadian Copper), so OTC evidence counts only for a
    CIK with none from an exchange ticker (`link_otc_outranked` counts the ones that disagreed), unless an exchange
    LEI is lapsed: a tie-break never picks a lapsed LEI, so the OTC claim stays beside it."""
    by_ticker = {t.ticker: t for t in tickers}
    listed: dict[str, list[tuple[str | None, str, str | None]]] = defaultdict(list)
    otc: dict[str, list[tuple[str | None, str, str | None]]] = defaultdict(list)
    isins: dict[str, str] = {}

    def add(ticker: SecTicker, item: tuple[str | None, str, str | None]) -> None:
        (otc if ticker.exchange == "OTC" else listed)[ticker.cik].append(item)

    us_isins = sorted(s.isin for s in snap.securities.values() if s.isin and s.isin.startswith("US") and s.kind == "share")
    for isin, answer in zip(us_isins, figi_map([{"idType": "ID_ISIN", "idValue": i, "exchCode": "US"} for i in us_isins])):
        row = _pick(answer.get("data") or [])
        match = by_ticker.get((row or {}).get("ticker", "").replace("/", "-"))
        if match:
            security = snap.securities[f"isin:{isin}"]
            if security.issuer_id or _unconfirmed(security, gleif_read):
                add(match, (_lei(security), "isin_exch_us", _record(digests.get(isin))))
            snap.audit["sec"]["isin_from_firds"] += 1
            isins[match.ticker] = isin
    share_classes = {s.share_class_figi: s for s in snap.securities.values() if s.share_class_figi and s.isin}
    for ticker in tickers:
        security = share_classes.get((rows.get(ticker.ticker) or {}).get("shareClassFIGI"))
        if security and (security.issuer_id or _unconfirmed(security, gleif_read)):
            add(ticker, (_lei(security), "share_class_figi", _record(digests.get(security.isin))))
    evidence = listed
    for cik, found in otc.items():
        if cik not in evidence:
            evidence[cik] = found
        elif {lei for lei, _r, _c in found} - {lei for lei, _r, _c in evidence[cik]}:
            if any(_lapsed(snap, lei) for lei, _r, _c in evidence[cik]):  # a tie-break never picks a lapsed LEI
                evidence[cik] = [*evidence[cik], *found]
            else:
                snap.audit.setdefault("sec", Counter())["link_otc_outranked"] += 1
    for entity in entities.values():
        if entity.registered_at == SEC_EDGAR_RA and (entity.registered_as or "").isdigit():
            evidence[str(int(entity.registered_as))].append((entity.lei, "gleif_edgar_registration",
                                                             _record(gleif.record_digest(entity))))
    return evidence, isins


def _lei(security: Security) -> str | None:
    """The LEI a FIRDS security's issuer claims for a CIK, or None (`_unconfirmed`)."""
    return security.issuer_id.removeprefix("lei:") if security.issuer_id else None


def _unconfirmed(security: Security, gleif_read: bool) -> bool:
    """A live security whose field 5 GLEIF could have confirmed as its issuer, in a build without GLEIF: its claim for a
    CIK is unknown (None), so it may not leave another claim unopposed."""
    return not gleif_read and not security.issuer_id and security.activity != "inactive"


def _record(digest: str | None) -> str | None:
    return f"record:{digest}" if digest else None


NAME_QUESTION = "issuer_identity_name_candidate"


def _ask_name_candidates(snap: Snapshot, tickers: list[SecTicker], links: dict[str, tuple[str, str]], audit: Counter) -> None:
    """A CIK no identifier links, whose SEC title normalises to exactly one active LEI issuer's name (and no other
    CIK's): an open issuer-identity question with that LEI as its candidate, never a link. Biofrontera Inc., a
    Delaware company, normalises to Biofrontera AG's name. A CIK already asked about its conflicting identifiers
    (`_decide`) is not asked again. Counted as `name_candidate_questions`."""
    claimed = {lei for lei, _rule in links.values()}
    asked = {question.subject_id for question in snap.questions}
    by_name: dict[str, set[str]] = defaultdict(set)
    for issuer in snap.issuers.values():
        if issuer.lei and issuer.entity_status != "INACTIVE":
            for name, kind, _lang, _src in issuer.names:
                if kind != "PREVIOUS_LEGAL_NAME":
                    by_name[rules.normalized_name(name)].add(issuer.lei)
    ciks_by_name: dict[str, set[str]] = defaultdict(set)
    for ticker in tickers:
        ciks_by_name[rules.normalized_name(ticker.name)].add(ticker.cik)
    for key, ciks in sorted(ciks_by_name.items()):
        leis = by_name.get(key, set())
        if len(key) < rules.MIN_NAME_KEY or len(leis) != 1 or len(ciks) != 1:
            continue
        cik, lei = next(iter(ciks)), next(iter(leis))
        if cik in links or lei in claimed or f"cik:{cik}" in asked:
            continue
        snap.ask(NAME_QUESTION, f"cik:{cik}", [f"lei:{lei}"])
        audit["name_candidate_questions"] += 1


def _decide(snap, tickers, evidence, audit) -> dict[str, tuple[str, str]]:
    """One LEI per CIK, from identifier evidence only. A CIK no identifier links stays a CIK-only issuer. Where the
    identifiers disagree and no rule decides, nothing links and each CIK's issuer is asked (`issuer_identity`, the
    LEIs as candidates): a CIK several LEIs claim, or a LEI several CIKs claim whose names more than one of them
    matches (Vishay Intertechnology and Vishay Precision Group). In both directions the tie is broken by exact name
    (`_named`): the one LEI whose GLEIF name is the CIK's SEC title, or the one CIK whose SEC title is the LEI's
    name. In a build without GLEIF, a CIK one of whose securities has an issuer GLEIF could have confirmed links to
    none either (`_unconfirmed`). A CIK whose LEIs each issue only funds is a multi-series fund trust (ProShares Trust
    II: a CIK covers every series it runs, and each series has its own LEI), no issuer of any: no link, no question
    (as `build_us_etfs` already says)."""
    titles = titles_by_cik(tickers)
    kinds: dict[str, set[str]] = defaultdict(set)
    for security in snap.securities.values():
        kinds[security.issuer_id or ""].add(security.kind)
    candidates = []
    for cik in sorted({t.cik for t in tickers}, key=int):
        found = evidence.get(cik, [])
        claimed = {lei for lei, rule, _cite in found if rule in IDENTIFIER_RULES}
        strong = claimed - {None}
        if len(strong) > 1 and all(kinds.get(f"lei:{lei}") == {"etf"} for lei in strong):
            snap.flag(f"cik:{cik}", "fund_trust", ",".join(sorted(strong)))
            audit["fund_trust_ciks"] += 1
            continue
        if len(strong) > 1:
            named = {lei for lei in strong if _named(titles[cik], snap.issuers.get(f"lei:{lei}"))}
            if len(named) != 1 or _lapsed(snap, next(iter(named))):  # none, several or a lapsed LEI: no rule decides
                snap.flag(f"cik:{cik}", "cik_lei_conflict", ",".join(sorted(strong)))
                _ask_link(snap, cik, sorted(strong), _cites(evidence, [cik], strong))
                audit["link_conflicts"] += 1
                continue
            # CIBC's CIK, whose OTC line is Canadian Copper's: the claims of the LEIs it is not named for are dropped.
            snap.flag(f"cik:{cik}", "cik_lei_claim_rejected", ",".join(sorted(strong - named)))
            audit["link_name_tiebreak"] += 1
            strong = named
        if None in claimed and strong:  # a claim GLEIF could have confirmed is unknown: it might contradict
            audit["link_issuer_unknown"] += 1
            continue
        if not strong:
            continue
        lei = next(iter(strong))
        candidates.append((cik, lei, next(r for l, r, _cite in found if l == lei and r in IDENTIFIER_RULES)))
    claimants: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for cik, lei, rule in candidates:
        claimants[lei].append((cik, rule))
    links: dict[str, tuple[str, str]] = {}
    for lei, found in claimants.items():
        named = [(cik, rule) for cik, rule in found if _named(titles[cik], snap.issuers.get(f"lei:{lei}"))]
        if len(found) > 1 and (len(named) != 1 or _lapsed(snap, lei)):
            for cik, _rule in found:
                if named:  # several CIKs the LEI's names match: no rule decides, so each is asked, citing every claim
                    _ask_link(snap, cik, [lei], _cites(evidence, [c for c, _r in found], {lei}))
                else:  # none names it: FIRDS puts a venue's or data vendor's LEI on US ISINs (TP ICAP, Bloomberg)
                    snap.flag(f"cik:{cik}", "lei_contested_unnamed", lei)
                audit["link_conflicts"] += 1
            continue
        # One claimant, or the one whose SEC title is the LEI's name (FIRDS gives Lee Enterprises' ISIN Berkshire
        # Hathaway's LEI).
        cik, rule = found[0] if len(found) == 1 else named[0]
        for other, _rule in found:
            if other != cik:
                snap.flag(f"cik:{other}", "lei_already_linked", f"{lei} to cik:{cik}")
                audit["link_conflicts"] += 1
        links[cik] = (lei, rule)
        audit[f"link_{rule}"] += 1
    return links


def _ask_link(snap: Snapshot, cik: str, leis: list[str], cites: list[str]) -> None:
    snap.ask("issuer_identity", f"cik:{cik}", [f"lei:{lei}" for lei in leis], cites, values=leis)


def _cites(evidence, ciks: list[str], leis: set[str]) -> list[str]:
    """The records the CIKs' identifier links to these LEIs rest on: a conflict cites its evidence."""
    return sorted({cite for cik in ciks for lei, rule, cite in evidence.get(cik, [])
                   if cite and lei in leis and rule in IDENTIFIER_RULES})


def _issuer_for(snap: Snapshot, ticker: SecTicker, link: tuple[str, str] | None) -> Issuer:
    if link:
        issuer = snap.issuers[f"lei:{link[0]}"]
        issuer.cik, issuer.cik_rule = ticker.cik, link[1]
    else:
        issuer = snap.issuers.setdefault(f"cik:{ticker.cik}", Issuer(issuer_id=f"cik:{ticker.cik}", name=ticker.name, source="sec", cik=ticker.cik, name_rule="sec_title"))
    if (ticker.name, "SEC_TITLE", None, "sec") not in issuer.names:
        issuer.names.append((ticker.name, "SEC_TITLE", None, "sec"))
    return issuer


def _lapsed(snap: Snapshot, lei: str | None) -> bool:
    """GLEIF's registration of the LEI has lapsed (renewal not paid): no name or ticker tie-break may pick it."""
    issuer = snap.issuers.get(f"lei:{lei}")
    return bool(issuer and issuer.registration_status == "LAPSED")


def _named(title: str, issuer: Issuer | None) -> bool:
    """Whether a SEC title is one of the issuer's current GLEIF names, apart from legal forms, punctuation and the
    SEC's state and ADR markers (`rules.normalized_name`): the whole name, never a shared word. Word matches
    (`link_review.name_alike`) picked the wrong entity for CANADIAN (Canadian Copper), ARCELORMITTAL (South Africa),
    METALS (Purecore Metals) and VISHAY. An issuer GLEIF did not describe (not read, or no record) has only a FIRDS
    instrument name, which names a security, not the entity, so it matches no title."""
    if issuer is None or issuer.name_rule == "firds_full_name":
        return False
    key = rules.normalized_name(rules.sec_name(title))
    names = (issuer.name, *(name for name, kind, _lang, _src in issuer.names if kind != "PREVIOUS_LEGAL_NAME"))
    return bool(key) and any(rules.normalized_name(name) == key for name in names)


def _listing(snap: Snapshot, inputs: Inputs, ticker: SecTicker, row: dict | None, link, audit: Counter) -> Listing:
    issuer = _issuer_for(snap, ticker, link)
    mic = EXCHANGE_MIC.get(ticker.exchange or "")
    etp = (row or {}).get("securityType") == "ETP"
    row_class = "etf" if etp else rules.sec_row_class((row or {}).get("securityType2"), ticker.ticker)
    audit[f"row_class_{row_class}"] += 1
    listing_id = f"{mic or 'US'}:{ticker.ticker}"
    listing = snap.listings.get(listing_id) or Listing(listing_id=listing_id, source="sec", evidence=Evidence.REGISTRANT_FILING,
                                                       row_class=row_class)
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
    elif inputs.openfigi:
        listing.status_reasons.append("no_openfigi_line")
    if ticker.exchange == "NYSE":
        listing.status_reasons.append("sec_nyse_may_be_american_or_arca")
    snap.listings[listing_id] = listing
    return listing


def _security_for(snap: Snapshot, listing: Listing, cik: str, isin: str | None, share_classes: dict[str, Security]) -> str:
    """Same share class or FIRDS ISIN: the EU security. Otherwise a SEC-only security, keyed by its share-class FIGI or
    else by its registrant's CIK and ticker: a ticker alone would name the next company to reuse it."""
    security = snap.securities.get(f"isin:{isin}") if isin else share_classes.get(listing.share_class_figi or "")
    if security:
        if listing.operating_mic in LISTED_MICS and not (security.isin or "").startswith("US"):
            snap.flag(listing.listing_id, "co_primary_same_security", security.security_id)
        return security.security_id
    security_id = f"figi:{listing.share_class_figi}" if listing.share_class_figi else f"sec:{cik}.{listing.ticker}"
    kind = listing.row_class if listing.row_class in ("share", "dr", "etf", "preferred", "fund") else "other"
    snap.securities.setdefault(
        security_id,
        Security(security_id=security_id, kind=kind, source="sec", evidence=Evidence.REGISTRANT_FILING, issuer_id=listing.issuer_id,
                 share_class_figi=listing.share_class_figi),
    )
    return security_id


def _mark_us_primaries(snap: Snapshot) -> None:
    """A registrant-filing (SEC) security's first exchange-listed line is its primary listing: OpenFIGI shows US lines
    on every exchange, so it cannot name the home one. Admission-register (FIRDS) securities are decided in
    `reconcile`."""
    by_security: dict[str, list[Listing]] = defaultdict(list)
    for listing in snap.listings.values():
        if listing.security_id:
            by_security[listing.security_id].append(listing)
    for security_id, lines in by_security.items():
        security = snap.securities[security_id]
        listed = us_lines(lines)
        if not listed or security.evidence != Evidence.REGISTRANT_FILING:
            continue
        for line in lines:
            line.is_primary = line is listed[0]
        security.primary_mic, security.primary_rule = listed[0].operating_mic, "us_exchange_listing"


def us_lines(lines: list[Listing]) -> list[Listing]:
    """A security's US exchange lines (not OTC), in SEC file order."""
    return sorted((l for l in lines if l.country == "US" and l.operating_mic in LISTED_MICS and l.currency),
                  key=lambda l: (l.position is None, l.position or 0, l.listing_id))
