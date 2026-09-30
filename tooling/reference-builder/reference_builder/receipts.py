"""Receipts: each depositary receipt's `depositary_receipt_of` edge, from its stated underlying or the issuer rule."""

from __future__ import annotations

from collections import Counter, defaultdict

from . import rules
from .model import Evidence, Issuer, Relationship, Security, Snapshot

RECEIPT_RULE = "receipt_issuer_share@2"


def link_receipts(snap: Snapshot, firds_isins: frozenset[str] = frozenset()) -> None:
    """Every receipt's `depositary_receipt_of` names a security of this build, or the receipt has none.

    A stated underlying ISIN (FIRDS field 26) is kept when an active security of the build carries it; FIRDS often
    names a superseded ISIN (GSK, ArcelorMittal, Tenaris) or one outside the scope, so such an edge is dropped,
    flagged and counted. A receipt no source links (SEC ADRs and New York registry shares; OpenFIGI names no
    underlying) is linked to its issuer's one ordinary share that is not inactive, when that share has an active
    ticker line. An issuer with a preferred share or several such shares, searchable or not, gets no edge: a shared
    issuer never picks a class (ADR 0044, A3), so a receipt of a preferred or of another class is never guessed.
    Every drop is counted in the build report."""
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
        # Every share of the issuer that is not inactive could be the receipt's class; only a searchable one is a
        # candidate to show.
        live = [item for item in siblings if item.kind == "share" and item.activity != "inactive"]
        shares = [item for item in live if item.activity == "active" and item.security_id in lined]
        unique = (security.issuer_id and security.security_id not in asked and len(live) == 1 and shares == live
                  and not any(item.kind == "preferred" for item in siblings))
        if unique and _names_disagree(security, shares[0], snap.issuers.get(security.issuer_id or "")):
            # Name only vetoes, never links: FIRDS field 5 on a receipt with no admission its issuer requested can be a
            # venue's guess (Concord Medical's ADR under China Medical System). The question stays.
            snap.flag(security.security_id, "receipt_name_disagrees", shares[0].security_id)
            audit["receipt_name_disagrees"] += 1
            unique = False
        if unique:
            snap.relationships.append(Relationship(security.security_id, "depositary_receipt_of", shares[0].security_id,
                                                   "pythia", RECEIPT_RULE, None))
            audit[RECEIPT_RULE] += 1
        elif security.security_id in asked or security.isin in firds_isins:
            # FIRDS states receipts' underlyings (field 26): where it names none this build holds, or none at all,
            # and the issuer rule does not decide, the underlying is a question. The issuer's shares are its candidates.
            if security.activity != "inactive":
                named = [stated_targets[security.security_id]] if security.security_id in stated_targets else []
                snap.ask("receipt_underlying", security.security_id, named + [item.security_id for item in shares])
            audit["receipt_underlying_question"] += 1
        elif security.issuer_id:
            audit["receipt_without_underlying"] += 1


def _names_disagree(receipt: Security, share: Security, issuer: Issuer | None) -> bool:
    """The receipt's own name and the names of its share and issuer share no leading word: Concord Medical Services
    against China Medical System Holdings. A side without a name says nothing, and a rename (Huazhu, now H World) only
    costs the edge: the receipt is asked instead. Legal forms and punctuation do not count (`rules.normalized_name`)."""
    def first(text: str) -> str:
        return (rules.normalized_name(text).split() or [""])[0]

    names = [share.name, *([issuer.name, *(name for name, *_ in issuer.names)] if issuer else [])]
    known = {first(name) for name in names if name}
    return bool(receipt.name and known) and first(receipt.name) not in known


def _issuers(security: Security) -> set[str]:
    """Its issuer, or while FIRDS disagrees (`assemble.contested`), every issuer claimed for it."""
    return {security.issuer_id} if security.issuer_id else set(security.issuer_candidates)
