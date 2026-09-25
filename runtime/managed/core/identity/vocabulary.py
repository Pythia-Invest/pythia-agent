"""Closed vocabularies of the backbone: tiers, authorities, kinds, statuses, relations."""
from __future__ import annotations

from enum import StrEnum

from .schemes import Level


class EvidenceTier(StrEnum):
    T0 = "T0"  # equal source-asserted identifiers within their validity windows
    T1 = "T1"  # versioned deterministic rule measured at >=99.5% precision
    T2 = "T2"  # probabilistic score: ranks and rejects candidates, never asserts
    T3 = "T3"  # model verdict: typed relation + calibrated confidence
    T4 = "T4"  # attestation: a user statement (manual, or recorded by the agent), or curation


class Authority(StrEnum):
    SOURCE_ASSERTED = "source_asserted"  # the source's own record says so
    SNAPSHOT = "snapshot"                # carried from a verified reference build or release
    RULE_CONFIRMED = "rule_confirmed"    # a versioned T1 rule, named by rule_id
    MODEL_CONFIRMED = "model_confirmed"  # a model verdict at or above its calibrated threshold
    MODEL_SUGGESTED = "model_suggested"  # a model verdict below it: a candidate, never routable
    USER_ATTESTED = "user_attested"      # the user stated it, directly or through the agent
    CURATED = "curated"                  # a reviewed, Pythia-authored reference table
    QUERY_ONLY = "query_only"            # an echo of the caller's own query
    UNKNOWN = "unknown"                  # provenance not established


# None: not evidence at all.
AUTHORITY_TIER: dict[Authority, EvidenceTier | None] = {
    Authority.SOURCE_ASSERTED: EvidenceTier.T0,
    Authority.SNAPSHOT: EvidenceTier.T0,
    Authority.RULE_CONFIRMED: EvidenceTier.T1,
    Authority.MODEL_CONFIRMED: EvidenceTier.T3,
    Authority.MODEL_SUGGESTED: EvidenceTier.T3,
    Authority.USER_ATTESTED: EvidenceTier.T4,
    Authority.CURATED: EvidenceTier.T4,
    Authority.QUERY_ONLY: None,
    Authority.UNKNOWN: None,
}
# Authorities that may carry a binding to `confirmed`.
CONFIRMING = frozenset({Authority.SOURCE_ASSERTED, Authority.SNAPSHOT, Authority.RULE_CONFIRMED,
                        Authority.MODEL_CONFIRMED, Authority.USER_ATTESTED, Authority.CURATED})


class AssetClass(StrEnum):
    EQUITY = "equity"
    FUND = "fund"
    BOND = "bond"
    INDEX = "index"
    FX = "fx"
    COMMODITY = "commodity"
    CRYPTO = "crypto"


class InstrumentKind(StrEnum):
    ORDINARY = "ordinary"
    PREFERRED = "preferred"
    DEPOSITARY_RECEIPT = "depositary_receipt"
    ETF = "etf"
    FUND = "fund"
    BOND = "bond"
    INDEX = "index"
    FX = "fx"
    COIN = "coin"
    TOKEN = "token"
    OTHER = "other"


class SubjectStatus(StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    UNKNOWN = "unknown"


class BindingStatus(StrEnum):
    CANDIDATE = "candidate"
    CONFIRMED = "confirmed"
    CONFLICTING = "conflicting"
    REJECTED = "rejected"


class RelationType(StrEnum):
    DEPOSITARY_RECEIPT_OF = "depositary_receipt_of"  # receipt security -> underlying security
    SHARE_CLASS_OF = "share_class_of"                # sibling class -> sibling class (symmetric)
    PARENT_OF = "parent_of"                          # parent issuer -> child issuer
    WRAPS = "wraps"                                  # wrapped crypto asset -> underlying asset
    SUCCESSOR_OF = "successor_of"                    # new subject -> old one after a natural key changed
                                                     # (new ISIN after a corporate action, LEI merger)


# None: both ends at the same level, any level.
RELATION_LEVELS: dict[RelationType, tuple[Level, Level] | None] = {
    RelationType.DEPOSITARY_RECEIPT_OF: (Level.SECURITY, Level.SECURITY),
    RelationType.SHARE_CLASS_OF: (Level.SECURITY, Level.SECURITY),
    RelationType.PARENT_OF: (Level.ISSUER, Level.ISSUER),
    RelationType.WRAPS: (Level.SECURITY, Level.SECURITY),
    RelationType.SUCCESSOR_OF: None,
}


class IdentifierRole(StrEnum):
    """Whether a claimed identifier names the record itself or its underlying security.

    A depositary line that carries its underlying's ISIN (e.g. a CEDEAR) must say
    `underlying`; such a record never joins the underlying's security by ISIN.
    """

    SELF = "self"
    UNDERLYING = "underlying"


class JoinRule(StrEnum):
    """Ingest join order. The first match wins; a contradiction stops the chain."""

    ISIN_MIC = "isin_mic"      # 1. ISIN + operating MIC (+ currency where several lines exist)
    ISIN = "isin"              # 2. ISIN names a known security; a new venue listing is created under it
    FIGI_CUSIP = "figi_cusip"  # 3. share-class FIGI, composite FIGI or CUSIP agrees
    TICKER_MIC = "ticker_mic"  # 4. exact ticker@MIC with no contradicting identifier (weak; re-verified)
    RESIDUAL = "residual"      # 5. a local subject is created and queued for a resolver


JOIN_ORDER: tuple[JoinRule, ...] = tuple(JoinRule)


class VerdictRelation(StrEnum):
    """The closed answer set of a resolver verdict on a queue item."""

    SAME_LISTING = "same_listing"
    SAME_SECURITY = "same_security"
    SAME_ISSUER = "same_issuer"
    DEPOSITARY_RECEIPT_OF = "depositary_receipt_of"
    SHARE_CLASS_OF = "share_class_of"
    UNRELATED = "unrelated"
    NONE = "none"            # no candidate fits
    AMBIGUOUS = "ambiguous"  # several candidates fit; never guessed into a match
