"""What the FIRDS claims decide for each security, and the questions they leave (R2: never a guess stored as fact).

- Issuer: RTS 23 field 5 (`assemble.issuer_lei`). An LEI ISO 10383 lists for a venue's operating entity decides
  nothing: the issuer is unknown and `issuer_identity` is asked.
- Primary: field 8 names the EEA admissions the issuer requested; it decides only an EEA primary. When another
  source puts a line outside the EEA (an OpenFIGI home-exchange line, a SEC exchange line), the answer is unknown
  and `home_market` is asked. Among requested admissions, the most liquid EU market (the relevant venue) picks the
  line when it belongs to a requested venue's operating entity (Xetra for Frankfurt: Deutsche Börse AG). Field 8
  on `firds.FIELD8_VENUE_HABIT` segments decides nothing. With no request, a line outside the EEA decides as the
  SEC and OpenFIGI stages always have (to be onboarded next); with none, the relevant venue is only a liquidity
  measure, so the primary is unknown and asked.
- Receipt underlying: field 26 (`linking.link_receipts`); a share that states one is asked as `receipt_conflict`.
"""

from __future__ import annotations

from collections import Counter, defaultdict

from . import firds, rules
from .claims import Claims, Meaning, Venues, requested
from .linking import us_lines
from .model import Listing, Snapshot


def questions(snap: Snapshot, claims: Claims, venues: Venues, as_of: str) -> None:
    """Decide FIRDS securities' primaries and ask what the claims leave open."""
    audit = snap.audit.setdefault("reconcile", Counter())
    lines: dict[str, list[Listing]] = defaultdict(list)
    for listing in snap.listings.values():
        lines[listing.security_id or ""].append(listing)
    for security in snap.securities.values():
        isin = security.isin
        if security.source != firds.SOURCE or isin not in claims.isins:
            continue
        live, evidence = security.activity != "inactive", [f"record:{claims.digests[isin]}"]
        leis = claims.isins[isin].get(Meaning.ISSUER_OR_VENUE_OPERATOR_LEI, set())
        if security.issuer_id is None and live:
            others = {line.issuer_id for line in lines[security.security_id] if line.issuer_id}
            snap.ask("issuer_identity", security.security_id, sorted(others), evidence, sorted(leis))
        stated = claims.isins[isin].get(Meaning.UNDERLYING_ISIN, set()) - {isin}
        if security.kind != "dr" and stated and live:  # the CFI says share, field 26 says receipt
            targets = [f"isin:{target}" for target in sorted(stated) if f"isin:{target}" in snap.securities]
            snap.ask("receipt_conflict", security.security_id, targets, evidence, sorted(stated))
        rule, line = _primary(claims, venues, isin, lines[security.security_id], as_of)
        audit[f"primary_{rule}"] += 1
        for other in lines[security.security_id]:
            other.is_primary = other is line
        security.primary_mic, security.primary_rule = (line.operating_mic if line else None), rule
        if line is None and live:
            candidates = [l.listing_id for l in lines[security.security_id] if l.status != "inactive"]
            snap.ask("home_market", security.security_id, candidates[:20], evidence)


def _primary(claims: Claims, venues: Venues, isin: str, lines: list[Listing], as_of: str) -> tuple[str, Listing | None]:
    """(rule, primary line or None when the evidence does not decide)."""
    asked = requested(claims, isin, as_of) - firds.FIELD8_VENUE_HABIT
    outside = [line for line in lines if line.source == "openfigi"] + us_lines(lines)  # other sources' lines
    if asked and outside:
        return "requested_in_eea_listed_outside", None
    relevant = claims.one(isin, Meaning.MOST_LIQUID_EU_MARKET)
    if asked:
        entities, ops = {venues.entity(m) for m in asked}, {venues.op(m) for m in asked}
        if venues.entity(relevant) in entities and (line := _on(lines, venues.op(relevant), relevant)):
            return "issuer_requested_most_liquid", line
        if len(ops) == 1 and (line := _on(lines, next(iter(ops)), relevant)):
            return "issuer_requested", line
        return "issuer_requested_several", None
    if outside:  # no EEA request: a US ISIN's home is its US line; another ISIN's, its home-country line first
        home = [line for line in outside if line.source == "openfigi"]
        line = home[0] if home and not isin.startswith("US") else us_lines(lines)[0] if us_lines(lines) else home[0]
        return ("home_listing_evidence" if line.source == "openfigi" else "us_exchange_listing"), line
    return "most_liquid_only", None


def _on(lines: list[Listing], operating_mic: str | None, relevant: str | None) -> Listing | None:
    """A security's line on a venue: the relevant segment, then an active line, then by segment MIC."""
    found = [line for line in lines if line.operating_mic == operating_mic and line.source == firds.SOURCE]
    return min(found, key=lambda l: (l.mic != rules.lit_segment(relevant or ""), l.status != "active", l.mic or ""),
               default=None)
