"""SEC ticker lines, their OpenFIGI identifiers, and CIK-to-LEI issuer links.

Links are made by identifier agreement first (FIRDS US ISIN, shared share-class
FIGI, GLEIF's EDGAR registration), then by a unique normalised name. Any
disagreement becomes a flag, never a merge.
"""

from __future__ import annotations

from collections import Counter, defaultdict

from . import rules
from .assemble import FigiMap, Inputs
from .model import GleifEntity, Issuer, Listing, Security, SecTicker, Snapshot
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
    answers = figi_map([{"idType": "TICKER", "idValue": t.ticker.replace("-", "/"), "exchCode": "US"} for t in tickers])
    rows = {t.ticker: _pick(a.get("data") or []) for t, a in zip(tickers, answers)}
    audit["openfigi_found"] = sum(1 for r in rows.values() if r)

    evidence, isins = _link_evidence(snap, entities, tickers, rows, figi_map)
    links = _decide(snap, tickers, evidence, audit)
    share_classes = {s.share_class_figi: s for s in snap.securities.values() if s.share_class_figi and s.isin}
    for ticker in tickers:
        listing = _listing(snap, ticker, rows.get(ticker.ticker), links.get(ticker.cik), audit)
        if not listing.security_id:
            listing.security_id = _security_for(snap, listing, isins.get(ticker.ticker), share_classes)
    _mark_us_primaries(snap)


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


def _listing(snap: Snapshot, ticker: SecTicker, row: dict | None, link, audit: Counter) -> Listing:
    issuer = _issuer_for(snap, ticker, link)
    mic = EXCHANGE_MIC.get(ticker.exchange or "")
    row_class = rules.sec_row_class((row or {}).get("securityType2"), ticker.ticker)
    audit[f"row_class_{row_class}"] += 1
    listing_id = f"{mic or 'US'}:{ticker.ticker}"
    listing = snap.listings.get(listing_id) or Listing(listing_id=listing_id, source="sec", row_class=row_class)
    root, klass = rules.split_ticker(ticker.ticker)
    listing.issuer_id, listing.mic, listing.operating_mic, listing.country = issuer.issuer_id, mic, mic, "US"
    listing.ticker, listing.ticker_root, listing.ticker_class, listing.ticker_source = ticker.ticker, root, klass, "sec"
    listing.currency = listing.currency or "USD"
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
        if listing.mic in LISTED_MICS:
            snap.flag(listing.listing_id, "co_primary_same_security", security.security_id)
        return security.security_id
    security_id = f"figi:{listing.share_class_figi}" if listing.share_class_figi else f"sec:{listing.ticker}"
    kind = listing.row_class if listing.row_class in ("share", "dr", "preferred", "fund") else "other"
    snap.securities.setdefault(
        security_id,
        Security(security_id=security_id, kind=kind, source="sec", issuer_id=listing.issuer_id, share_class_figi=listing.share_class_figi),
    )
    return security_id


def _mark_us_primaries(snap: Snapshot) -> None:
    """A SEC-only security's first exchange-listed line is its primary listing."""
    by_security: dict[str, list[Listing]] = defaultdict(list)
    for listing in snap.listings.values():
        if listing.source == "sec" and listing.security_id:
            by_security[listing.security_id].append(listing)
    for security_id, lines in by_security.items():
        security = snap.securities[security_id]
        if security.source != "sec":
            continue
        listed = [l for l in lines if l.mic in LISTED_MICS]
        if listed:
            listed[0].is_primary = True
            security.primary_mic, security.primary_rule = listed[0].mic, "sec_exchange_listing"
