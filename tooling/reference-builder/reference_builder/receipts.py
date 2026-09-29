"""Receipts: each depositary receipt's `depositary_receipt_of` edge, from its stated underlying or the issuer rule."""

from __future__ import annotations

from collections import Counter, defaultdict

from .model import Evidence, Relationship, Security, Snapshot

RECEIPT_RULE = "receipt_issuer_share@1"


def link_receipts(snap: Snapshot, firds_isins: frozenset[str] = frozenset()) -> None:
    """Every receipt's `depositary_receipt_of` names a security of this build, or the receipt has none.

    A stated underlying ISIN (FIRDS field 26) is kept when an active security of the build carries it; FIRDS often
    names a superseded ISIN (GSK, ArcelorMittal, Tenaris) or one outside the scope, so such an edge is dropped,
    flagged and counted. A receipt no source links (SEC ADRs and New York registry shares; OpenFIGI names no
    underlying) is linked to its issuer's one active ordinary share. An issuer with a preferred share or several
    candidate shares gets no edge: a shared issuer never picks a class (ADR 0044, A3), so a receipt of a preferred
    or of another class is never guessed. Every drop is counted in the build report."""
    audit = snap.audit.setdefault("relations", Counter())
    by_isin = {security.isin: key for key, security in snap.securities.items() if security.isin}
    kept, asked, stated_targets = [], set(), {}
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
            receipt = snap.securities.get(item.from_id)
            if item.evidence == Evidence.STATED_UNDERLYING and not (
                    receipt and _issuers(receipt) & _issuers(snap.securities[target])):
                # Field 5 on a receipt is the underlying issuer's LEI (ESMA Q&A 1503): field 26 decides only when the
                # stated security is that issuer's, or both are open with that LEI among the candidates (Nestlé's ADR
                # and CDRs). Otherwise (14 CDRs stating Thermo Fisher) it is a question.
                audit["firds_underlying_other_issuer"] += 1
                asked.add(item.from_id)
                stated_targets[item.from_id] = target
                continue
            item = Relationship(item.from_id, item.relation, target, item.source, item.rule_id, item.evidence)
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
                named = [stated_targets[security.security_id]] if security.security_id in stated_targets else []
                snap.ask("receipt_underlying", security.security_id, named + [item.security_id for item in shares])
            audit["receipt_underlying_question"] += 1
            continue
        if not security.issuer_id:
            continue
        if len(shares) != 1 or any(item.kind == "preferred" for item in siblings):
            audit["receipt_without_underlying"] += 1
            continue
        snap.relationships.append(Relationship(security.security_id, "depositary_receipt_of", shares[0].security_id,
                                               "pythia", RECEIPT_RULE, None))
        audit[RECEIPT_RULE] += 1


def _issuers(security: Security) -> set[str]:
    """Its issuer, or while FIRDS disagrees (`assemble.contested`), every issuer claimed for it."""
    return {security.issuer_id} if security.issuer_id else set(security.issuer_candidates)
