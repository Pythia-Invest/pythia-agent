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
from .schema import identity

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
    rows_of: dict[str, list[dict]] = defaultdict(list)  # every OpenFIGI row of an ISIN: venue answers, then the fan-out
    for (isin, _segment, _record), answer in zip(plan, answers):
        rows_of[isin] += answer.get("data") or []
    for isin, rows in fanout.items():
        rows_of[isin] += rows
    debt = {isin for isin in scoped if rules.debt_like(rows_of.get(isin, []))}
    audit["debt_like_isins_left_out"] = len(debt)
    issuer_leis = choose_issuers(snap, inputs, scoped, entities, rows_of, audit)
    code_country = {code: inputs.venues[op].country for op, code in rules.MAIN_EXCH_CODE.items() if op in inputs.venues}

    as_of = inputs.as_of.isoformat()
    for (isin, segment, record), answer in zip(plan, answers):
        if isin in debt:
            continue
        op = operating(inputs.venues, segment)
        venue = inputs.venues.get(segment) or inputs.venues.get(op or "")
        rows = answer.get("data") or []
        row, pick = rules.pick_figi_row(rows, op or segment)
        country_row = None
        if row is None:  # the venue-qualified answer is empty (Frankfurt's open market, Berlin, Hanover)
            row, pick, country_row = _fallback_row(rows_of.get(isin, []), op or segment, venue, code_country)
        elif country_row := _foreign_row(row, rows_of.get(isin, []), op or segment, venue, code_country):
            row, pick = None, "country_ticker_over_foreign_row"
        audit[f"openfigi_{pick}"] += 1
        issuer = _issuer(snap, entities, issuer_leis.get(isin), record)
        listing = Listing(
            listing_id=f"{segment}:{isin}", source="esma_firds", row_class=rules.firds_kind(record.cfi),
            security_id=f"isin:{isin}", issuer_id=issuer.issuer_id if issuer else None, mic=segment, operating_mic=op,
            country=venue.country if venue else None, currency=record.currency, name=record.full_name,
            valid_from=record.first_trade, valid_to=record.termination,
        )
        if row:
            _apply_figi(listing, row, record.short_name, audit)
        elif country_row:
            _apply_country_ticker(listing, country_row, record.short_name, audit)
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
        if isin not in debt:
            _security(snap, inputs, isin, records, by_security[f"isin:{isin}"], fanout.get(isin, []), audit,
                      issuer_leis.get(isin))
            snap.securities[f"isin:{isin}"].exch_codes = frozenset(r["exchCode"] for r in rows_of.get(isin, []) if r.get("exchCode"))
    return entities


# Exchange codes of listing venues (not MTF or internaliser rows): a FIRDS ISIN that OpenFIGI shows on one of
# them is listed somewhere, even when none of its FIRDS venues answers.
LISTING_CODES = frozenset(rules.MAIN_EXCH_CODE.values()) | {c for codes, _ in rules.HOME.values() for c in codes}


def retire_superseded_isins(snap: Snapshot) -> None:
    """An old ISIN left active (Fresenius, Telecom Italia and Worldline after an ISIN change): an ordinary share
    with no ticker and no FIGI on any line, that OpenFIGI shows on no listing exchange, while a share of the
    same issuer with the same name has a live ticker line. Its lines become inactive. A US ISIN is left to the
    SEC evidence (`linking`), and a share class OpenFIGI still lists (Liberty Global B) stays."""
    audit = snap.audit.setdefault("eu", Counter())
    lines: dict[str, list[Listing]] = defaultdict(list)
    for listing in snap.listings.values():
        lines[listing.security_id or ""].append(listing)
    groups: dict[tuple, list[Security]] = defaultdict(list)
    for security in snap.securities.values():
        words = frozenset(rules.name_words(security.name))
        if security.kind == "share" and security.isin and security.issuer_id and words and security.activity != "inactive":
            groups[(security.issuer_id, words)].append(security)
    for members in groups.values():
        ticked = [s for s in members if any(l.ticker and l.status != "inactive" for l in lines[s.security_id])]
        if not ticked or len(members) < 2:
            continue
        for security in members:
            mine = lines[security.security_id]
            if (security.security_id in {t.security_id for t in ticked} or security.isin.startswith("US") or security.exch_codes & LISTING_CODES
                    or any(l.figi for l in mine)):
                continue
            for listing in mine:
                if listing.status != "inactive":
                    listing.status = "inactive"
                    listing.status_reasons.append("superseded_isin")
            security.activity = "inactive"
            snap.flag(security.security_id, "superseded_isin", ticked[0].security_id)
            audit["superseded_isins_retired"] += 1


def _fallback_row(rows: list[dict], op: str, venue: Venue | None, code_country: dict[str, str]) -> tuple:
    """A line whose venue-qualified OpenFIGI answer is empty: the ISIN's row on the venue's main exchange code
    from its other answers (the fan-out has Frankfurt's `GF` row when a `FRAB` job answers nothing), else the
    ticker the rows on the venue country's other exchanges agree on (see `rules.country_rows`).

    Returns (row, pick label, country row).
    """
    main = rules.MAIN_EXCH_CODE.get(op)
    own = [r for r in rows if main and r.get("exchCode") == main]
    if own:
        row, _ = rules.pick_figi_row(own, op)
        return row, "venue_row_from_other_answer", None
    same = rules.country_rows(rows, venue.country if venue else None, code_country)
    if same and len({r["ticker"] for r in same}) == 1:
        return None, "country_ticker", same[0]
    return None, "no_match", None


def _foreign_row(row: dict, rows: list[dict], op: str, venue: Venue | None, code_country: dict[str, str]) -> dict | None:
    """The country row to use instead of a picked row that is not on the venue's main exchange code and belongs to
    another composite than the country's lines: Stuttgart's `XS` rows repeat the home ticker (`HAL` for HAL Trust,
    `PRS` for PRISA) while every German venue writes `HA4` and `PRS1`; that `HAL` also names Halliburton there."""
    main = rules.MAIN_EXCH_CODE.get(op)
    if not main or row.get("exchCode") == main:
        return None
    same = rules.country_rows(rows, venue.country if venue else None, code_country)
    if same and len({r["ticker"] for r in same}) == 1 and row.get("compositeFIGI") not in {r.get("compositeFIGI") for r in same}:
        return same[0]
    return None


def choose_issuers(snap: Snapshot, inputs: Inputs, scoped: dict[str, list[FirdsRecord]], entities: dict[str, GleifEntity],
                   rows_of: dict[str, list[dict]], audit: Counter) -> dict[str, str | None]:
    """The issuer LEI of each ISIN, from its FIRDS records, never a trading venue's or a financing vehicle's.

    FIRDS carries the reporting venue's own LEI when an issuer gave none (TP ICAP on Valaris, Frankfurter
    Wertpapierbörse on Canadian juniors), and sometimes a financing subsidiary's (Nestlé Capital Markets on
    Nestlé). A record's LEI is refused when it is a venue operator's (ISO 10383 `LEI`) and no name of the
    security shares a word with the operator's GLEIF names; for a systematic internaliser's operator, a bank
    that also issues shares, only when its own venue reported the record. It is refused as a financing vehicle
    when its name is the security's company plus a financing word (`rules.financing_vehicle_of`). Another
    record's LEI is then used, else the one GLEIF entity of the build whose legal name is the security's
    company name (`rules.company_key`), else none: the issuer stays unknown and is counted.
    """
    operators: dict[str, dict] = {}
    for venue in inputs.venues.values():
        if venue.lei:
            entry = operators.setdefault(venue.lei, {"mics": set(), "dealer_only": True})
            entry["mics"] |= {venue.mic, venue.operating_mic}
            entry["dealer_only"] &= venue.category == "SINT"
    by_key: dict[str, set[str]] = defaultdict(set)
    for entity in entities.values():
        if entity.entity_status == "INACTIVE" or rules.FINANCING_VEHICLE.search(rules.ascii_upper(entity.legal_name)):
            continue
        for name in (entity.legal_name, *(n for n, kind, _ in entity.names if kind != "PREVIOUS_LEGAL_NAME")):
            key = rules.normalized_name(name)
            if len(key) >= rules.MIN_NAME_KEY:
                by_key[key].add(entity.lei)
    chosen: dict[str, str | None] = {}
    for isin, records in scoped.items():
        head = next((r for r in records if r.mic == r.relevant_mic), records[0])
        names = {r.full_name for r in records if r.full_name} | {r.short_name for r in records if r.short_name}
        names |= {row["name"] for row in rows_of.get(isin, []) if row.get("name")}
        candidates = Counter(r.issuer_lei for r in records if r.issuer_lei)
        order = sorted(candidates, key=lambda lei: (lei != head.issuer_lei, -candidates[lei], lei))
        refused = {}
        for lei in order:
            entity = entities.get(lei)
            entity_names = [entity.legal_name, *(n for n, *_ in entity.names)] if entity else []
            operator = operators.get(lei)
            if operator and not rules.names_share_word(names, entity_names) and (
                    not operator["dealer_only"]
                    or any(r.issuer_lei == lei and (r.mic in operator["mics"] or operating(inputs.venues, r.mic) in operator["mics"])
                           for r in records)):
                refused[lei] = "issuer_venue_lei"
            elif entity and rules.financing_vehicle_of(entity.legal_name, names):
                refused[lei] = "issuer_financing_vehicle"
            else:
                break
        else:
            lei = None
        if not refused:
            chosen[isin] = lei
            continue
        for bad, reason in refused.items():
            audit[f"{reason}_refused"] += 1
            snap.flag(f"isin:{isin}", reason, bad)
        if lei:
            audit["issuer_from_other_record"] += 1
        else:
            matches = set().union(*(by_key.get(rules.company_key(n), set()) for n in names)) - set(refused)
            lei = next(iter(matches)) if len(matches) == 1 else None
            audit["issuer_from_company_name" if lei else "issuer_unknown"] += 1
        chosen[isin] = lei
    return chosen


def _entity_attr(entities: dict[str, GleifEntity], lei: str | None, name: str) -> str | None:
    entity = entities.get(lei or "")
    return getattr(entity, name) if entity else None


def _issuer(snap: Snapshot, entities: dict[str, GleifEntity], lei: str | None, record: FirdsRecord) -> Issuer | None:
    if not lei:
        return None
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


def _venue_ticker(ticker: str | None, root: str | None, klass: str | None, fisn: str | None, operating_mic: str | None,
                  audit: Counter | None) -> tuple[str | None, str | None, str | None]:
    """The ticker as core keys it, or none: OpenFIGI's `/` class written with `-` (`GRF/P` -> `GRF-P`), and a
    debt description or other value core's ticker grammar refuses (`BNP 0 PERP u`) dropped and counted."""
    if ticker and klass is None:
        glued = rules.split_glued_class(ticker, fisn)
        if glued:
            root, klass = glued
    if ticker and (klass or ticker.endswith("/")):  # `BRK/B`, `BA/`; not `CRD/AUSD` (a class and a currency)
        ticker = rules.exchange_ticker(root, klass, operating_mic) or rules.slash_class(ticker)
    if ticker:
        try:
            identity.normalize_identifier("ticker_mic", f"{ticker}@{operating_mic or 'XXXX'}")
        except ValueError:
            if audit is not None:
                audit["ticker_refused_grammar"] += 1
            return None, None, None
    return ticker, root, klass


def _apply_figi(listing: Listing, row: dict, fisn: str | None, audit: Counter | None = None) -> None:
    ticker = row.get("ticker")
    root, klass = rules.split_ticker(ticker)
    listing.ticker, listing.ticker_root, listing.ticker_class = _venue_ticker(ticker, root, klass, fisn, listing.operating_mic, audit)
    listing.ticker_source = "openfigi"
    listing.figi = row.get("figi")
    listing.composite_figi = row.get("compositeFIGI")
    listing.share_class_figi = row.get("shareClassFIGI")
    listing.security_type = row.get("securityType2") or row.get("securityType")


def _apply_country_ticker(listing: Listing, row: dict, fisn: str | None, audit: Counter) -> None:
    """The country's ticker without the venue's own OpenFIGI line: no FIGI, so the line's status is unchanged."""
    root, klass = rules.split_ticker(row["ticker"])
    listing.ticker, listing.ticker_root, listing.ticker_class = _venue_ticker(row["ticker"], root, klass, fisn, listing.operating_mic, audit)
    listing.ticker_source = "openfigi_country"
    listing.share_class_figi = row.get("shareClassFIGI")


def _security(snap, inputs, isin, records, listings, fanout, audit, issuer_lei=None) -> None:
    head = next((r for r in records if r.mic == r.relevant_mic), records[0])
    relevant = next((r.relevant_mic for r in records if r.relevant_mic), None)
    moved = operating(inputs.venues, relevant) in rules.TRADING_ONLY_VENUES and _listing_venue(isin, listings)
    if moved:
        relevant = moved.mic
    share_class = next((l.share_class_figi for l in listings if l.share_class_figi), None)
    xetra = [r for r in records if r.mic in XETRA_SEGMENTS and not (r.termination and r.termination <= inputs.as_of.isoformat())]
    # A regional regulated-market admission is the listing: it moves only to a regulated Xetra line.
    xetra_live = bool(xetra) and (not _regulated(inputs, relevant) or any(_regulated(inputs, r.mic) for r in xetra))
    primary_mic, rule, home_row = rules.primary_venue(isin, operating(inputs.venues, relevant), xetra_live, fanout)
    if moved and rule == "firds_relevant_venue":
        rule = "trading_venue_to_listing_venue"
    audit[f"primary_{rule}"] += 1
    fitrs = (inputs.transparency or {}).get(isin)
    security = Security(
        security_id=f"isin:{isin}", kind=rules.firds_kind(head.cfi), source="esma_firds",
        issuer_id=f"lei:{issuer_lei}" if issuer_lei else None, isin=isin, share_class_figi=share_class, cfi=head.cfi, fisn=head.short_name,
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


def _regulated(inputs: Inputs, mic: str | None) -> bool:
    venue = inputs.venues.get(mic or "")
    return bool(venue and venue.category == "RMKT")


def _listing_venue(isin: str, listings: list[Listing]) -> Listing | None:
    """The primary line when FIRDS names a trading-only venue (see `rules.PRIMARY_FALLBACK`)."""
    def order(line: Listing) -> tuple:
        preferred = rules.PRIMARY_FALLBACK.index(line.operating_mic) if line.operating_mic in rules.PRIMARY_FALLBACK else len(rules.PRIMARY_FALLBACK)
        return (line.country != isin[:2], preferred, line.valid_from or "9999", line.mic or "")

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
