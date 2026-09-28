"""Run the assembly stages and summarise the result for the manifest."""

from __future__ import annotations

import bisect
from collections import Counter

from .assemble import FigiMap, GleifFetch, Inputs, build_eu
from .linking import build_sec
from .model import Snapshot, Venue


def build_snapshot(inputs: Inputs, gleif_fetch: GleifFetch, figi_map: FigiMap) -> Snapshot:
    snap = Snapshot(as_of=inputs.as_of.isoformat())
    entities = build_eu(snap, inputs, gleif_fetch, figi_map)
    if inputs.scope.sec:
        build_sec(snap, inputs, entities, figi_map)
    snap.venues = used_venues(snap, inputs.venues)
    rank(snap, inputs)
    snap.audit = summarise(snap)
    return snap


def rank(snap: Snapshot, inputs: Inputs) -> None:
    """Notability order per source, 1 = most notable; search turns it into a score.

    EU securities rank by FITRS turnover among every equity and ETF FITRS reports;
    SEC securities by their company's first position in the SEC file, which the SEC
    orders roughly by market value. A security with both keeps the more notable
    rank: a US share's small EU turnover must not bury its SEC position.
    """
    turnovers = sorted(t.turnover_eur for t in (inputs.transparency or {}).values() if t.turnover_eur)
    for security in snap.securities.values():
        if security.turnover_eur:
            security.rank = len(turnovers) - bisect.bisect_left(turnovers, security.turnover_eur)
    companies: dict[str, int] = {}
    for listing in sorted((l for l in snap.listings.values() if l.position is not None), key=lambda l: l.position):
        companies.setdefault(listing.issuer_id or listing.listing_id, len(companies) + 1)
        security = snap.securities.get(listing.security_id or "")
        if security:
            security.rank = min(filter(None, (security.rank, companies[listing.issuer_id or listing.listing_id])))


def used_venues(snap: Snapshot, venues: dict[str, Venue]) -> dict[str, Venue]:
    """Only MICs the snapshot references: the full ISO list is not republishable."""
    codes = {l.mic for l in snap.listings.values()} | {l.operating_mic for l in snap.listings.values()}
    codes |= {s.primary_mic for s in snap.securities.values()}
    return {mic: venues[mic] for mic in sorted(c for c in codes if c and c in venues)}


def summarise(snap: Snapshot) -> dict:
    """Numbers only: counts per rule outcome, no row data."""
    audit = {name: dict(sorted(counter.items())) for name, counter in snap.audit.items() if isinstance(counter, Counter)}
    listings = list(snap.listings.values())
    eu = [l for l in listings if l.source == "esma_firds"]
    audit["listings"] = {
        "by_source": dict(sorted(Counter(l.source for l in listings).items())),
        "by_status": dict(sorted(Counter(l.status for l in listings).items())),
        "by_row_class": dict(sorted(Counter(l.row_class for l in listings).items())),
        "status_reasons": dict(sorted(Counter(r for l in listings for r in l.status_reasons).items())),
        "primary": sum(1 for l in listings if l.is_primary),
    }
    audit["eu_resolution"] = {
        "rows": len(eu),
        "with_ticker": sum(1 for l in eu if l.ticker),
        "with_figi": sum(1 for l in eu if l.figi),
        "fully_resolved_active": sum(1 for l in eu if _resolved(snap, l) and l.status == "active"),
    }
    issuers = list(snap.issuers.values())
    audit["issuers"] = {
        "with_lei": sum(1 for i in issuers if i.lei),
        "with_cik": sum(1 for i in issuers if i.cik),
        "with_lei_and_cik": sum(1 for i in issuers if i.lei and i.cik),
        "by_name_rule": dict(sorted(Counter(i.name_rule or "none" for i in issuers).items())),
    }
    audit["securities"] = {
        "by_activity": dict(sorted(Counter(s.activity for s in snap.securities.values()).items())),
        "by_primary_rule": dict(sorted(Counter(s.primary_rule or "none" for s in snap.securities.values()).items())),
        "with_turnover": sum(1 for s in snap.securities.values() if s.turnover_eur is not None),
    }
    audit["flags"] = dict(sorted(Counter(f.flag for f in snap.flags).items()))
    return audit


def _resolved(snap: Snapshot, listing) -> bool:
    """Ticker, MIC, ISIN, issuer LEI with a usable name, and a primary venue decision."""
    security = snap.securities.get(listing.security_id or "")
    issuer = snap.issuers.get(listing.issuer_id or "")
    return bool(
        listing.ticker and listing.mic and security and security.isin and security.primary_mic
        and issuer and issuer.lei and issuer.name_rule not in (None, "legal_name_non_latin", "firds_full_name")
    )
