"""Closed vocabularies of the backbone: tiers, authorities, kinds, statuses, relations."""
from __future__ import annotations

from enum import StrEnum

from .schemes import Level


class EvidenceTier(StrEnum):
    T0 = "T0"  # equal source-asserted identifiers within their validity windows
    T1 = "T1"  # versioned deterministic rule measured at >=99.5% precision
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


# An echo of the caller's own query or unestablished provenance is not evidence and has no authority.
AUTHORITY_TIER: dict[Authority, EvidenceTier] = {
    Authority.SOURCE_ASSERTED: EvidenceTier.T0,
    Authority.SNAPSHOT: EvidenceTier.T0,
    Authority.RULE_CONFIRMED: EvidenceTier.T1,
    Authority.MODEL_CONFIRMED: EvidenceTier.T3,
    Authority.MODEL_SUGGESTED: EvidenceTier.T3,
    Authority.USER_ATTESTED: EvidenceTier.T4,
    Authority.CURATED: EvidenceTier.T4,
}
# Authorities that may carry a binding to `confirmed`.
CONFIRMING = frozenset(Authority) - {Authority.MODEL_SUGGESTED}


# Closed sets grow when a connector emits a new class or kind, with its store CHECKs.
class AssetClass(StrEnum):
    EQUITY = "equity"
    CRYPTO = "crypto"


class InstrumentKind(StrEnum):
    ORDINARY = "ordinary"
    DEPOSITARY_RECEIPT = "depositary_receipt"
    COIN = "coin"
    TOKEN = "token"


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
    WRAPS = "wraps"                                  # wrapped crypto asset -> underlying asset
    SUCCESSOR_OF = "successor_of"                    # new subject -> old one after a natural key changed
                                                     # (new ISIN after a corporate action, LEI merger)


# None: both ends at the same level, any level.
RELATION_LEVELS: dict[RelationType, tuple[Level, Level] | None] = {
    RelationType.DEPOSITARY_RECEIPT_OF: (Level.SECURITY, Level.SECURITY),
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


class VerdictRelation(StrEnum):
    """The closed answer set of a resolver verdict on a queue item."""

    SAME_LISTING = "same_listing"
    SAME_SECURITY = "same_security"
    SAME_ISSUER = "same_issuer"
    DEPOSITARY_RECEIPT_OF = "depositary_receipt_of"
    UNRELATED = "unrelated"
    NONE = "none"            # no candidate fits
    AMBIGUOUS = "ambiguous"  # several candidates fit; never guessed into a match
