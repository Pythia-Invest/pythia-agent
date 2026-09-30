"""What the FIRDS claims decide for each security, and the questions they leave (R2: never a guess stored as fact).

- Issuer: RTS 23 field 5 (`assemble.issuer_lei`). An LEI ISO 10383 lists for a venue's operating entity decides
  nothing, nor does a share's field 5 its receipts contradict (`Claims.receipt_issuers`): the issuer is unknown. Then
  the registrant a SEC line joins to the security by ISIN or share-class FIGI is its issuer when field 5 is only a
  venue operator's LEI (`registrant_join@1`); otherwise `issuer_identity` is asked, the receipts' issuer, field 5 and
  the lines' issuers as the candidates, and when there is no candidate to choose nothing is asked: the security is
  counted (`issuer_unknown_venue_lei`).
- Primary: field 8 names the EEA admissions the issuer requested; it decides only an EEA primary. When a listing
  directory or registrant filing puts a line outside the EEA (an OpenFIGI home-exchange line, a SEC exchange line),
  the primary is unknown. Among requested admissions, the most liquid EU market (the relevant venue) picks the line
  when it belongs to a requested venue's operating entity (Xetra for Frankfurt: Deutsche Börse AG). Field 8 on
  `firds.FIELD8_VENUE_HABIT` segments decides nothing. With no request, a line outside the EEA decides as the SEC
  and OpenFIGI stages always have (to be onboarded next); with none, the relevant venue is only a liquidity
  measure, so the primary is unknown. An unknown primary is a coverage count, never a question: which listing a
  view shows is a choice (ADR 0044, A5), and the line at the most liquid EU market is priced meanwhile.
- Receipt underlying: field 26 (`receipts.link_receipts`); a share that states one is asked as `receipt_conflict`.
"""

from __future__ import annotations

from collections import Counter, defaultdict

from . import firds, rules
from .claims import Claims, Meaning, Venues, requested
from .linking import us_lines
from .model import Evidence, Listing, Snapshot

# A venue attribute (Pythia-authored): Deutsche Börse runs the Frankfurt Stock Exchange's regulated market on two
# venues, the Frankfurt floor and Xetra, its main one. When the claims decide that market, the line is on Xetra.
MAIN_VENUE = {"XFRA": "XETR"}
REGISTRANT_JOIN = "registrant_join@1"


def questions(snap: Snapshot, claims: Claims, venues: Venues, as_of: str) -> None:
    """Decide admission-register (FIRDS) securities' primaries and ask what the claims leave open."""
    audit = snap.audit.setdefault("reconcile", Counter())
    lines: dict[str, list[Listing]] = defaultdict(list)
    for listing in snap.listings.values():
        lines[listing.security_id or ""].append(listing)
    for security in snap.securities.values():
        isin = security.isin
        if security.evidence != Evidence.ADMISSION_REGISTER or isin not in claims.isins:
            continue
        live, evidence = security.activity != "inactive", [f"record:{claims.digests[isin]}"]
        leis = claims.isins[isin].get(Meaning.ISSUER_OR_VENUE_OPERATOR_LEI, set())
        if security.issuer_id is None and live:
            _issuer_unknown(snap, claims, venues, security, lines[security.security_id], evidence, audit)
        stated = claims.isins[isin].get(Meaning.UNDERLYING_ISIN, set()) - {isin}
        if security.kind != "dr" and stated and live:  # the CFI says share, field 26 says receipt
            targets = [f"isin:{target}" for target in sorted(stated) if f"isin:{target}" in snap.securities]
            snap.ask("receipt_conflict", security.security_id, targets, evidence, sorted(stated))
        rule, line = _primary(claims, venues, isin, lines[security.security_id], as_of)
        audit[f"primary_{rule}"] += 1
        for other in lines[security.security_id]:
            other.is_primary = other is line
        security.primary_mic, security.primary_rule = (line.operating_mic if line else None), rule
        if line is None or not line.currency:  # no primary the package can write: priced on FIRDS' most liquid
            # EU market, never marked primary
            relevant = claims.one(isin, Meaning.MOST_LIQUID_EU_MARKET)
            liquid = _on(lines[security.security_id], venues.op(relevant), relevant)
            if liquid:
                liquid.most_liquid = True


def _issuer_unknown(snap: Snapshot, claims: Claims, venues: Venues, security, lines: list[Listing], evidence: list[str],
                    audit: Counter) -> None:
    """A live security whose field 5 decided no issuer. A registrant joined to it by ISIN or share-class FIGI (a SEC line)
    is its issuer when field 5 is only a venue operator's LEI, which says nothing about the issuer and is no claim that
    could contradict it (`registrant_join@1`, `rule_confirmed`); a LEI from GLEIF's EDGAR registration upgrades the
    CIK issuer as for any SEC line. Otherwise the issuer is asked, the candidates being the receipts' issuer, field 5
    and the lines' issuers; with none, nothing is asked and the security is counted."""
    leis = claims.isins[security.isin].get(Meaning.ISSUER_OR_VENUE_OPERATOR_LEI, set())
    venue_only = bool(leis) and all(venues.operated.get(lei) for lei in leis)
    registrants = {line.issuer_id for line in lines if line.issuer_id and line.evidence == Evidence.REGISTRANT_FILING}
    if venue_only and not security.issuer_candidates and len(registrants) == 1:
        security.issuer_id = next(iter(registrants))
        for line in lines:
            line.issuer_id = security.issuer_id
        audit[REGISTRANT_JOIN] += 1
        return
    candidates = [*security.issuer_candidates, *sorted({line.issuer_id for line in lines if line.issuer_id})]
    if candidates:
        snap.ask("issuer_identity", security.security_id, candidates, evidence, sorted(leis))
    else:  # nothing to choose: FIRDS names a venue operator's LEI where the issuer did not request the admission
        audit["issuer_unknown_venue_lei" if venue_only else "issuer_unknown_no_candidate"] += 1


def _primary(claims: Claims, venues: Venues, isin: str, lines: list[Listing], as_of: str) -> tuple[str, Listing | None]:
    """(rule, primary line or None when the evidence does not decide)."""
    asked = requested(claims, isin, as_of) - firds.FIELD8_VENUE_HABIT
    # Lines outside FIRDS: a listing directory's home-exchange line, a registrant's US exchange line.
    outside = [line for line in lines if line.evidence == Evidence.LISTING_DIRECTORY] + us_lines(lines)
    if asked and outside:
        return "requested_in_eea_listed_outside", None
    relevant = claims.one(isin, Meaning.MOST_LIQUID_EU_MARKET)
    if asked:
        entities, ops = {venues.entity(m) for m in asked}, {venues.op(m) for m in asked}
        if venues.entity(relevant) in entities:
            main = MAIN_VENUE.get(venues.op(relevant))
            line = (_on(lines, main, relevant) if main in ops else None) or _on(lines, venues.op(relevant), relevant)
            if line:
                return "issuer_requested_most_liquid", line
        if len(ops) == 1 and (line := _on(lines, next(iter(ops)), relevant)):
            return "issuer_requested", line
        return "issuer_requested_several", None
    if outside:  # no EEA request: a US ISIN's home is its US line; another ISIN's, its home-country line first
        home = [line for line in outside if line.evidence == Evidence.LISTING_DIRECTORY]
        line = home[0] if home and not isin.startswith("US") else us_lines(lines)[0] if us_lines(lines) else home[0]
        return ("home_listing_evidence" if line.evidence == Evidence.LISTING_DIRECTORY else "us_exchange_listing"), line
    return "most_liquid_only", None


def _on(lines: list[Listing], operating_mic: str | None, relevant: str | None) -> Listing | None:
    """A security's line on a venue: the relevant segment, then an active line, then by segment MIC."""
    found = [line for line in lines if line.operating_mic == operating_mic and line.evidence == Evidence.ADMISSION_REGISTER]
    return min(found, key=lambda l: (l.mic != rules.lit_segment(relevant or ""), l.status != "active", l.mic or ""),
               default=None)
