"""Closed vocabularies of the backbone: tiers, authorities, kinds, statuses, relations."""
from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from .schemes import Kind


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
    AGENT_CONFIRMED = "agent_confirmed"  # the Hermes agent's answer: routes provisionally; a user attestation or
                                         # identifier evidence supersedes and re-points it
    USER_ATTESTED = "user_attested"      # the user stated it, directly or through the agent
    CURATED = "curated"                  # a reviewed, Pythia-authored reference table


# An echo of the caller's own query or unestablished provenance is not evidence and has no authority.
AUTHORITY_TIER: dict[Authority, EvidenceTier] = {
    Authority.SOURCE_ASSERTED: EvidenceTier.T0,
    Authority.SNAPSHOT: EvidenceTier.T0,
    Authority.RULE_CONFIRMED: EvidenceTier.T1,
    Authority.MODEL_CONFIRMED: EvidenceTier.T3,
    Authority.MODEL_SUGGESTED: EvidenceTier.T3,
    Authority.AGENT_CONFIRMED: EvidenceTier.T3,
    Authority.USER_ATTESTED: EvidenceTier.T4,
    Authority.CURATED: EvidenceTier.T4,
}
# Authorities that may carry a binding to `confirmed`.
CONFIRMING = frozenset(Authority) - {Authority.MODEL_SUGGESTED}
# Confirming, but only until a stronger answer (user attestation, identifier evidence or a rule) replaces it.
PROVISIONAL = frozenset({Authority.AGENT_CONFIRMED})


# Closed sets grow when a connector emits a new class or kind, with its store CHECKs.
class AssetClass(StrEnum):
    EQUITY = "equity"
    CRYPTO = "crypto"


class InstrumentKind(StrEnum):
    """Instrument kinds; the names match the search contract (packages/market-data/src/search.ts)."""

    ORDINARY = "ordinary"
    PREFERRED = "preferred"
    DEPOSITARY_RECEIPT = "depositary_receipt"
    ETF = "etf"
    FUND = "fund"
    OTHER = "other"  # warrants, rights, units and lines no source classifies
    COIN = "coin"
    TOKEN = "token"
    INDEX = "index"  # a provider record of an index or FX pair names a subject of that kind, never a security
    FX = "fx"


# Record kinds that name a subject outside the instrument hierarchy (schemes.Kind).
KIND_OF_RECORD: dict[InstrumentKind, Kind] = {InstrumentKind.INDEX: Kind.INDEX, InstrumentKind.FX: Kind.FX}


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
    DEPOSITARY_RECEIPT_OF = "depositary_receipt_of"  # receipt or registry share -> underlying security
    SHARE_CLASS_OF = "share_class_of"                # another class of a company's shares -> its main class
    WRAPS = "wraps"                                  # wrapped crypto asset -> underlying asset
    BRIDGED_FROM = "bridged_from"                    # lock-and-mint bridged token -> the asset it bridges
    STAKED_AS = "staked_as"                          # staked asset -> its liquid staking token
    TRACKS = "tracks"                                # fund, ETC or ETN -> the index or asset it tracks
    DERIVATIVE_ON = "derivative_on"                  # leveraged, inverse or structured product, or a perp market
                                                     # -> its underlying
    TOKENIZED_FROM = "tokenized_from"                # tokenized security -> the security it represents
    SUCCESSOR_OF = "successor_of"                    # new subject -> old one after a natural key changed
                                                     # (new ISIN after a corporate action, LEI merger)


class Grouping(StrEnum):
    """How a relation presents its two subjects. Neither ever merges them."""

    FOLD = "fold"        # sameness across subjects: one instrument, its lines listed together (the page's listings)
    RELATED = "related"  # related but different: each its own instrument (a share class stays one within its
                         # company's search group)


@dataclass(frozen=True, slots=True)
class RelationRule:
    """The kinds each end may name (None: both ends of one kind, any kind) and how the relation groups."""

    ends: tuple[frozenset[str], frozenset[str]] | None
    grouping: Grouping


_SECURITY = frozenset({Kind.SECURITY})
_UNDERLYING = frozenset({Kind.SECURITY, Kind.INDEX, Kind.SERIES})
# The relation vocabulary: a new relation type is one entry here, no store change.
RELATIONS: dict[RelationType, RelationRule] = {
    RelationType.DEPOSITARY_RECEIPT_OF: RelationRule((_SECURITY, _SECURITY), Grouping.FOLD),
    RelationType.SHARE_CLASS_OF: RelationRule((_SECURITY, _SECURITY), Grouping.RELATED),
    RelationType.WRAPS: RelationRule((_SECURITY, _SECURITY), Grouping.RELATED),
    RelationType.BRIDGED_FROM: RelationRule((_SECURITY, _SECURITY), Grouping.RELATED),
    RelationType.STAKED_AS: RelationRule((_SECURITY, _SECURITY), Grouping.RELATED),
    RelationType.TRACKS: RelationRule((_SECURITY, _UNDERLYING), Grouping.RELATED),
    RelationType.DERIVATIVE_ON: RelationRule((frozenset({Kind.SECURITY, Kind.MARKET}), _UNDERLYING), Grouping.RELATED),
    RelationType.TOKENIZED_FROM: RelationRule((_SECURITY, _SECURITY), Grouping.RELATED),
    RelationType.SUCCESSOR_OF: RelationRule(None, Grouping.RELATED),
}
FOLD = frozenset(type for type, rule in RELATIONS.items() if rule.grouping is Grouping.FOLD)
# The search group is the investable entity: the company for its equity (these kinds group under their issuer), the
# product itself for funds, ETFs, ETNs and ETCs, the asset for crypto.
ISSUER_INTERESTS = frozenset({InstrumentKind.ORDINARY, InstrumentKind.PREFERRED, InstrumentKind.DEPOSITARY_RECEIPT,
                              InstrumentKind.OTHER})


class IdentifierRole(StrEnum):
    """Whether a claimed identifier names the record itself or its underlying security.

    A depositary line that carries its underlying's ISIN (e.g. a CEDEAR) says
    `underlying`; a source that cannot tell (EODHD's ISIN field) says
    `unqualified`. Only `self` values join by ISIN; the others become an
    `underlying_identifier` residual. The plugin marks the role; core cannot
    verify it mechanically.
    """

    SELF = "self"
    UNDERLYING = "underlying"
    UNQUALIFIED = "unqualified"


class VerdictRelation(StrEnum):
    """The closed answer set of a resolver verdict on a queue item."""

    SAME_LISTING = "same_listing"
    SAME_COMPOSITE = "same_composite"
    SAME_SECURITY = "same_security"
    SAME_ISSUER = "same_issuer"
    DEPOSITARY_RECEIPT_OF = "depositary_receipt_of"
    UNRELATED = "unrelated"
    NONE = "none"            # no candidate fits
    AMBIGUOUS = "ambiguous"  # several candidates fit; never guessed into a match
