"""Assemble FIRDS, GLEIF and OpenFIGI rows into EU issuers, securities and listings.

Source access is injected (`gleif_fetch`, `figi_map`) so the whole assembly runs
on hand-made rows in tests.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date

from . import rules
from .config import Scope
from .model import FirdsRecord, GleifEntity, Issuer, Listing, Relationship, Security, SecFund, SecTicker, Snapshot, Transparency, Venue

FigiMap = Callable[[list[dict]], list[dict]]
GleifFetch = Callable[[set[str]], dict[str, GleifEntity]]
XETRA_SEGMENTS = frozenset({"XETA", "XETR", "XETB", "XETS"})
FIGI_MIC_OVERRIDE = {"BMEX": "XMAD"}


@dataclass
class Inputs:
    as_of: date
    scope: Scope
    venues: dict[str, Venue]
    admissions: dict[tuple[str, str], FirdsRecord]
    transparency: dict[str, Transparency] | None
    sec_tickers: list[SecTicker]
    figi_mic_codes: set[str]
    sec_funds: list[SecFund] = field(default_factory=list)


def operating(venues: dict[str, Venue], mic: str | None) -> str | None:
    if not mic:
        return None
    venue = venues.get(mic)
    return venue.operating_mic if venue else mic


def scope_isins(inputs: Inputs) -> dict[str, list[FirdsRecord]]:
    """ISINs with an admission on a scope venue, with all of their admissions."""
    by_isin: dict[str, list[FirdsRecord]] = defaultdict(list)
    for record in inputs.admissions.values():
        by_isin[record.isin].append(record)
    return {
        isin: sorted(records, key=lambda r: r.mic)
        for isin, records in sorted(by_isin.items())
        if any(inputs.scope.covers(operating(inputs.venues, rules.lit_segment(r.mic))) for r in records)
    }


def issuer_from_gleif(entity: GleifEntity) -> Issuer:
    name, rule = rules.display_name(entity.legal_name, entity.names)
    names = [(entity.legal_name, "LEGAL_NAME", entity.legal_language, "gleif")]
    names += [(n, kind, lang, "gleif") for n, kind, lang in entity.names]
    return Issuer(
        issuer_id=f"lei:{entity.lei}", name=name, source="gleif", lei=entity.lei, legal_name=entity.legal_name,
        name_rule=rule, jurisdiction=entity.jurisdiction, country=entity.country, entity_status=entity.entity_status,
        registration_status=entity.registration_status, names=names,
    )


def _eu_listings(inputs: Inputs, isin: str, records: list[FirdsRecord]) -> dict[str, FirdsRecord]:
    """One admission per operating venue in scope, keyed by its segment MIC.

    A venue's segments (lit, off-book, midpoint, auction, a second retail book)
    are one line to an investor, and core keys a listing by operating MIC and
    currency. The operator's own MIC wins, then a regulated-market segment, then
    a lit segment.
    """
    chosen: dict[str, FirdsRecord] = {}
    for record in records:
        lit = rules.lit_segment(record.mic)
        op = operating(inputs.venues, lit)
        if not inputs.scope.covers(op):
            continue
        current = chosen.get(op or lit)
        if current is None or _segment_order(inputs, op, record) < _segment_order(inputs, op, current):
            chosen[op or lit] = record
    listing = {op: record for op, record in chosen.items() if op not in rules.TRADING_ONLY_VENUES}
    if not listing:  # traded only on trading-only venues: keep the line on its relevant venue
        relevant = operating(inputs.venues, next((r.relevant_mic for r in records if r.relevant_mic), None))
        listing = {op: record for op, record in chosen.items() if op == relevant} or chosen
    return {rules.lit_segment(record.mic): record for record in listing.values()}


def _segment_order(inputs: Inputs, op: str | None, record: FirdsRecord) -> tuple:
    venue = inputs.venues.get(record.mic)
    return (record.mic != op, (venue.category if venue else None) != "RMKT", record.mic != rules.lit_segment(record.mic), record.mic)


def _figi_job(inputs: Inputs, isin: str, segment: str) -> dict:
    op = operating(inputs.venues, segment) or segment
    mic = segment if segment in inputs.figi_mic_codes else FIGI_MIC_OVERRIDE.get(op, op)
    return {"idType": "ID_ISIN", "idValue": isin, "micCode": mic}


def build_eu(snap: Snapshot, inputs: Inputs, gleif_fetch: GleifFetch, figi_map: FigiMap) -> dict[str, GleifEntity]:
    audit = snap.audit.setdefault("eu", Counter())
    scoped = scope_isins(inputs)
    audit["scope_isins"] = len(scoped)
    entities = gleif_fetch({r.issuer_lei for rs in scoped.values() for r in rs if r.issuer_lei})

    plan = [(isin, seg, rec) for isin, rs in scoped.items() for seg, rec in sorted(_eu_listings(inputs, isin, rs).items())]
    answers = figi_map([_figi_job(inputs, isin, seg) for isin, seg, _ in plan])
    # Every OpenFIGI line of an ISIN, for home-market evidence and US cross-listings. ETFs need
    # neither, and a US ISIN's home line comes from the SEC and symbol-directory lines instead.
    wanted = [isin for isin, rs in scoped.items() if not isin.startswith("US") and rules.firds_kind(rs[0].cfi) != "etf"]
    fanout = {isin: (a.get("data") or []) for isin, a in zip(wanted, figi_map([{"idType": "ID_ISIN", "idValue": i} for i in wanted]))}
    audit["openfigi_fanout_isins_answered"] = sum(1 for rows in fanout.values() if rows)

    as_of = inputs.as_of.isoformat()
    for (isin, segment, record), answer in zip(plan, answers):
        rows = answer.get("data") or []
        row, pick = rules.pick_figi_row(rows, operating(inputs.venues, segment) or segment)
        audit[f"openfigi_{pick}"] += 1
        issuer = _issuer(snap, entities, record)
        op = operating(inputs.venues, segment)
        venue = inputs.venues.get(segment) or inputs.venues.get(op or "")
        listing = Listing(
            listing_id=f"{segment}:{isin}", source="esma_firds", row_class=rules.firds_kind(record.cfi),
            security_id=f"isin:{isin}", issuer_id=issuer.issuer_id, mic=segment, operating_mic=op,
            country=venue.country if venue else None, currency=record.currency, name=record.full_name,
            valid_from=record.first_trade, valid_to=record.termination,
        )
        if row:
            _apply_figi(listing, row, record.short_name)
        listing.status, listing.status_reasons = rules.admission_status(
            as_of=as_of, termination=record.termination, full_name=record.full_name, cfi=record.cfi,
            entity_status=_entity_attr(entities, record.issuer_lei, "entity_status"),
            registration_status=_entity_attr(entities, record.issuer_lei, "registration_status"),
            venue_count=len(scoped[isin]),
            has_transparency=None if inputs.transparency is None else isin in inputs.transparency,
            has_figi=row is not None,
        )
        snap.listings[listing.listing_id] = listing

    by_security: dict[str, list[Listing]] = defaultdict(list)
    for listing in snap.listings.values():
        by_security[listing.security_id or ""].append(listing)
    for isin, records in scoped.items():
        _security(snap, inputs, isin, records, by_security[f"isin:{isin}"], fanout.get(isin, []), audit)
    return entities


def _entity_attr(entities: dict[str, GleifEntity], lei: str | None, name: str) -> str | None:
    entity = entities.get(lei or "")
    return getattr(entity, name) if entity else None


def _issuer(snap: Snapshot, entities: dict[str, GleifEntity], record: FirdsRecord) -> Issuer:
    issuer_id = f"lei:{record.issuer_lei}"
    if issuer_id not in snap.issuers:
        entity = entities.get(record.issuer_lei or "")
        if entity:
            snap.issuers[issuer_id] = issuer_from_gleif(entity)
        else:
            snap.issuers[issuer_id] = Issuer(
                issuer_id=issuer_id, name=record.full_name or record.isin, source="esma_firds",
                lei=record.issuer_lei, name_rule="firds_full_name",
            )
            snap.flag(issuer_id, "lei_not_in_gleif")
    return snap.issuers[issuer_id]


def _apply_figi(listing: Listing, row: dict, fisn: str | None) -> None:
    ticker = row.get("ticker")
    root, klass = rules.split_ticker(ticker)
    if ticker and klass is None:
        glued = rules.split_glued_class(ticker, fisn)
        if glued:
            root, klass = glued
    listing.ticker, listing.ticker_root, listing.ticker_class = ticker, root, klass
    listing.ticker_source = "openfigi"
    listing.figi = row.get("figi")
    listing.composite_figi = row.get("compositeFIGI")
    listing.share_class_figi = row.get("shareClassFIGI")
    listing.security_type = row.get("securityType2") or row.get("securityType")


def _security(snap, inputs, isin, records, listings, fanout, audit) -> None:
    head = next((r for r in records if r.mic == r.relevant_mic), records[0])
    relevant = next((r.relevant_mic for r in records if r.relevant_mic), None)
    moved = operating(inputs.venues, relevant) in rules.TRADING_ONLY_VENUES and _listing_venue(inputs, isin, listings)
    if moved:
        relevant = moved.mic
    share_class = next((l.share_class_figi for l in listings if l.share_class_figi), None)
    xetra_live = any(r.mic in XETRA_SEGMENTS and not (r.termination and r.termination <= inputs.as_of.isoformat()) for r in records)
    primary_mic, rule, home_row = rules.primary_venue(isin, operating(inputs.venues, relevant), xetra_live, fanout)
    if moved and rule == "firds_relevant_venue":
        rule = "trading_venue_to_listing_venue"
    audit[f"primary_{rule}"] += 1
    fitrs = (inputs.transparency or {}).get(isin)
    security = Security(
        security_id=f"isin:{isin}", kind=rules.firds_kind(head.cfi), source="esma_firds",
        issuer_id=f"lei:{head.issuer_lei}", isin=isin, share_class_figi=share_class, cfi=head.cfi, fisn=head.short_name,
        name=head.full_name, currency=head.currency, primary_mic=primary_mic, primary_rule=rule,
        turnover_eur=fitrs.turnover_eur if fitrs else None, turnover_method=fitrs.methodology if fitrs else None,
    )
    snap.securities[security.security_id] = security
    if rules.also_us_listed(fanout, share_class):
        snap.flag(security.security_id, "also_us_listed")
    if head.cfi.startswith("ED") and head.underlying_isin and head.underlying_isin != isin:
        snap.relationships.append(Relationship(security.security_id, "depositary_receipt_of", f"isin:{head.underlying_isin}", "esma_firds", "firds_underlying_isin"))
    _mark_primary(snap, security, listings, relevant, home_row)
    states = {l.status for l in listings}
    security.activity = "active" if "active" in states else ("suspect" if "suspect" in states else ("inactive" if states else "active"))


def _listing_venue(inputs: Inputs, isin: str, listings: list[Listing]) -> Listing | None:
    """The primary line when FIRDS names a trading-only venue: home country, then regulated market, then MIC."""
    def order(line: Listing) -> tuple:
        venue = inputs.venues.get(line.mic or "")
        return (line.country != isin[:2], (venue.category if venue else None) != "RMKT", line.mic or "")

    return min((l for l in listings if l.operating_mic not in rules.TRADING_ONLY_VENUES), key=order, default=None)


def _mark_primary(snap, security, listings, relevant, home_row) -> None:
    on_primary = [l for l in listings if l.operating_mic == security.primary_mic]
    if on_primary:
        best = sorted(on_primary, key=lambda l: (l.mic != rules.lit_segment(relevant or ""), l.status != "active", l.mic or ""))[0]
        best.is_primary = True
        return
    if home_row and home_row.get("ticker"):
        mic = security.primary_mic
        listing = Listing(
            listing_id=f"{mic}:{home_row['ticker'].replace('/', '-')}", source="openfigi", row_class=security.kind,
            security_id=security.security_id, issuer_id=security.issuer_id, mic=mic, operating_mic=mic,
            country=security.isin[:2] if security.isin else None, is_primary=True, name=home_row.get("name"),
        )
        _apply_figi(listing, home_row, security.fisn)
        listing.status_reasons = ["home_line_from_openfigi"]
        snap.listings.setdefault(listing.listing_id, listing)
