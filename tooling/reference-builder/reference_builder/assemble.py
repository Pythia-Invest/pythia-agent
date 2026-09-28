"""Assemble FIRDS, GLEIF and OpenFIGI rows into EU issuers, securities and listings.

Source access is injected (`gleif_fetch`, `figi_map`) so the whole assembly runs
on hand-made rows in tests.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date

from . import firds, rules
from .claims import Claims, Meaning, Venues, load
from .config import Scope
from .model import FirdsRecord, GleifEntity, Issuer, Listing, Relationship, Security, SecFund, SecTicker, Snapshot, Transparency, Venue

FigiMap = Callable[[list[dict]], list[dict]]
GleifFetch = Callable[[set[str]], dict[str, GleifEntity]]
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
    firds_claims: Claims | None = None  # built from `admissions` when not given

    def claims(self) -> Claims:
        if self.firds_claims is None:
            self.firds_claims = load(firds.claims(self.admissions))
        return self.firds_claims


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
    claims, venues = inputs.claims(), Venues(inputs.venues)
    issuers = {isin: issuer_lei(claims, venues, isin) for isin in scoped}
    entities = gleif_fetch({lei for lei in issuers.values() if lei})

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
        lei = issuers[isin]
        issuer = _issuer(snap, entities, lei, record) if lei else None
        op = operating(inputs.venues, segment)
        venue = inputs.venues.get(segment) or inputs.venues.get(op or "")
        listing = Listing(
            listing_id=f"{segment}:{isin}", source="esma_firds", row_class=rules.firds_kind(record.cfi),
            security_id=f"isin:{isin}", issuer_id=issuer.issuer_id if issuer else None, mic=segment, operating_mic=op,
            country=venue.country if venue else None, currency=record.currency, name=record.full_name,
            valid_from=record.first_trade, valid_to=record.termination,
        )
        if row:
            _apply_figi(listing, row, record.short_name)
        listing.status, listing.status_reasons = rules.admission_status(
            as_of=as_of, termination=record.termination, full_name=record.full_name, cfi=record.cfi,
            entity_status=_entity_attr(entities, lei, "entity_status"),
            registration_status=_entity_attr(entities, lei, "registration_status"),
            venue_count=len(scoped[isin]),
            has_transparency=None if inputs.transparency is None else isin in inputs.transparency,
            has_figi=row is not None,
        )
        snap.listings[listing.listing_id] = listing

    by_security: dict[str, list[Listing]] = defaultdict(list)
    for listing in snap.listings.values():
        by_security[listing.security_id or ""].append(listing)
    for isin, records in scoped.items():
        _security(snap, inputs, isin, records, by_security[f"isin:{isin}"], fanout.get(isin, []), issuers[isin])
    return entities


def issuer_lei(claims: Claims, venues: Venues, isin: str) -> str | None:
    """RTS 23 field 5 names the issuer or the trading venue operator: its one LEI is the issuer unless ISO 10383
    lists it for a venue's operating entity. Then the issuer is unknown and a question is asked."""
    leis = claims.isins.get(isin, {}).get(Meaning.ISSUER_OR_VENUE_OPERATOR_LEI, set())
    return next(iter(leis)) if len(leis) == 1 and not venues.operated.get(next(iter(leis))) else None


def _entity_attr(entities: dict[str, GleifEntity], lei: str | None, name: str) -> str | None:
    entity = entities.get(lei or "")
    return getattr(entity, name) if entity else None


def _issuer(snap: Snapshot, entities: dict[str, GleifEntity], lei: str, record: FirdsRecord) -> Issuer:
    issuer_id = f"lei:{lei}"
    if issuer_id not in snap.issuers:
        entity = entities.get(lei)
        if entity:
            snap.issuers[issuer_id] = issuer_from_gleif(entity)
        else:
            snap.issuers[issuer_id] = Issuer(
                issuer_id=issuer_id, name=record.full_name or record.isin, source="esma_firds",
                lei=lei, name_rule="firds_full_name",
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
    ticker = rules.exchange_ticker(root, klass, listing.operating_mic) or ticker
    listing.ticker, listing.ticker_root, listing.ticker_class = ticker, root, klass
    listing.ticker_source = "openfigi"
    listing.figi = row.get("figi")
    listing.composite_figi = row.get("compositeFIGI")
    listing.share_class_figi = row.get("shareClassFIGI")
    listing.security_type = row.get("securityType2") or row.get("securityType")


def _security(snap, inputs, isin, records, listings, fanout, lei) -> None:
    head = next((r for r in records if r.mic == r.relevant_mic), records[0])
    share_class = next((l.share_class_figi for l in listings if l.share_class_figi), None)
    fitrs = (inputs.transparency or {}).get(isin)
    security = Security(
        security_id=f"isin:{isin}", kind=rules.firds_kind(head.cfi), source="esma_firds",
        issuer_id=f"lei:{lei}" if lei else None, isin=isin, share_class_figi=share_class, cfi=head.cfi,
        fisn=head.short_name, name=head.full_name, currency=head.currency,
        turnover_eur=fitrs.turnover_eur if fitrs else None, turnover_method=fitrs.methodology if fitrs else None,
    )
    snap.securities[security.security_id] = security
    if rules.also_us_listed(fanout, share_class):
        snap.flag(security.security_id, "also_us_listed")
    if head.cfi.startswith("ED") and head.underlying_isin and head.underlying_isin != isin:
        snap.relationships.append(Relationship(security.security_id, "depositary_receipt_of", f"isin:{head.underlying_isin}", "esma_firds", "firds_underlying_isin"))
    home = rules.home_row(isin, fanout)
    if home:  # a line outside FIRDS, in the ISIN's country: evidence for the primary, decided in `reconcile`
        mic, row = home
        listing = Listing(
            listing_id=f"{mic}:{row['ticker'].replace('/', '-')}", source="openfigi", row_class=security.kind,
            security_id=security.security_id, issuer_id=security.issuer_id, mic=mic, operating_mic=mic,
            country=isin[:2], name=row.get("name"),
        )
        _apply_figi(listing, row, security.fisn)
        listing.status_reasons = ["home_line_from_openfigi"]
        snap.listings.setdefault(listing.listing_id, listing)
    states = {l.status for l in listings}
    security.activity = "active" if "active" in states else ("suspect" if "suspect" in states else ("inactive" if states else "active"))
