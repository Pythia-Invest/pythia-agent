"""The core resolution queue: one durable list of residuals and conflicts, any resolver.

The join puts every record it cannot place (a residual) and every contradiction
(a conflict) in one core-owned queue. Resolvers are interchangeable and chosen by
the user: built-in rules, the Hermes agent, a matcher plugin such as Jev, or the
user resolving by hand. Each reads an item and submits a Verdict with an
authority; `decide` applies the one authority rule the same way for all of them.
No resolver is required, and none runs on the search or page path.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Iterable, Sequence

from .claims import DIGEST, IdentifierValue
from .model import IdentifierAssertion, Provenance, ProviderRef, _coerce, _require
from .schemes import INSTANT, SINGLE_VALUED, Level, Scheme, subject_level
from .vocabulary import Authority, EvidenceTier, IdentifierRole, InstrumentKind, VerdictRelation


class QueueItemKind(StrEnum):
    RESIDUAL = "residual"  # the join could not place a record
    CONFLICT = "conflict"  # evidence contradicts other evidence; never merged


class QueueReason(StrEnum):
    NO_KEY = "no_key"                                # residual: no identifier the join can use
    UNDERLYING_IDENTIFIER = "underlying_identifier"  # residual: carries its underlying's ISIN
    AMBIGUOUS = "ambiguous"                          # residual: several candidates fit
    IDENTIFIER = "identifier"                        # conflict: one key claimed by two subjects, or two values
    BINDING = "binding"                              # conflict: new evidence contradicts a binding
    RELATION = "relation"                            # conflict: a typed edge contradicts identifiers
    GUARD = "guard"                                  # conflict: a verdict or rule tripped a DR/share-class guard


REASONS = {
    QueueItemKind.RESIDUAL: frozenset({QueueReason.NO_KEY, QueueReason.UNDERLYING_IDENTIFIER, QueueReason.AMBIGUOUS}),
    QueueItemKind.CONFLICT: frozenset({QueueReason.IDENTIFIER, QueueReason.BINDING, QueueReason.RELATION, QueueReason.GUARD}),
}


class QueueState(StrEnum):
    OPEN = "open"
    RESOLVED = "resolved"
    SUPERSEDED = "superseded"  # newer evidence settled or replaced it
    DISMISSED = "dismissed"


class ResolverKind(StrEnum):
    RULES = "rules"    # built-in deterministic rules shipped with core or plugin updates
    AGENT = "agent"    # the Hermes agent, the only hard prerequisite
    PLUGIN = "plugin"  # a resolver plugin declared in its manifest, e.g. Jev (optional, off by default)
    USER = "user"      # the user resolving by hand, if they choose to


MODEL_AUTHORITIES = frozenset({Authority.MODEL_CONFIRMED, Authority.MODEL_SUGGESTED})
# The level a definite answer's chosen subject must have (unrelated: any level).
RELATION_LEVEL = {
    VerdictRelation.SAME_LISTING: Level.LISTING,
    VerdictRelation.SAME_COMPOSITE: Level.COMPOSITE,
    VerdictRelation.SAME_SECURITY: Level.SECURITY,
    VerdictRelation.SAME_ISSUER: Level.ISSUER,
    VerdictRelation.DEPOSITARY_RECEIPT_OF: Level.SECURITY,
}
SAME_INSTRUMENT = frozenset({VerdictRelation.SAME_LISTING, VerdictRelation.SAME_COMPOSITE, VerdictRelation.SAME_SECURITY})


class VerdictOutcome(StrEnum):
    CONFIRMED = "confirmed"  # binding or relation confirmed with the verdict's authority
    SUGGESTED = "suggested"  # kept as a candidate; never routes a canonical read
    BLOCKED = "blocked"      # identifier proof or a mechanical guard contradicts it; a guard conflict opens
    AMBIGUOUS = "ambiguous"  # several candidates fit or resolvers disagree: the item stays open
    NO_MATCH = "no_match"    # none or unrelated: the item stays unresolved or is dismissed


@dataclass(frozen=True, slots=True)
class QueueItem:
    id: str
    kind: QueueItemKind
    reason: QueueReason
    subject_ids: tuple[str, ...]    # residual: the local subject; conflict: the subjects involved
    candidate_ids: tuple[str, ...]  # the closed set a verdict may choose from
    evidence_ids: tuple[str, ...]
    state: QueueState
    opened_at: str
    plugin: str | None = None       # whose claim opened it
    provider_ref: ProviderRef | None = None
    scheme: Scheme | None = None    # conflict: the contested scheme
    values: tuple[str, ...] = ()    # conflict: the contested values
    attempts: int = 0

    def __post_init__(self) -> None:
        _coerce(self, kind=QueueItemKind, reason=QueueReason, state=QueueState, provider_ref=ProviderRef, scheme=Scheme)
        for name in ("subject_ids", "candidate_ids", "evidence_ids", "values"):
            object.__setattr__(self, name, tuple(getattr(self, name)))
        _require(self.reason in REASONS[self.kind], f"queue item: {self.reason} is not a {self.kind} reason")
        for subject in (*self.subject_ids, *self.candidate_ids):
            subject_level(subject)
        _require(len(self.subject_ids) == 1 if self.kind is QueueItemKind.RESIDUAL else len(self.subject_ids) >= 1,
                 "queue item: a residual concerns one subject; a conflict at least one")
        _require(self.kind is QueueItemKind.RESIDUAL or bool(self.evidence_ids), "queue item: conflicts cite evidence")
        _require(bool(INSTANT.match(self.opened_at)), "queue item: opened_at is an ISO instant")


@dataclass(frozen=True, slots=True)
class Verdict:
    """A resolver's answer to one queue item, submitted as a typed claim with an authority."""

    item_id: str
    resolver: ResolverKind
    authority: Authority
    relation: VerdictRelation
    chosen_id: str | None
    provenance: Provenance
    confidence: float | None = None   # required for model authorities
    model: str | None = None
    prompt_version: str | None = None
    input_digest: str | None = None   # sha256:<hex> of exactly what the model saw
    rule_id: str | None = None        # required for rule_confirmed
    rationale: str | None = None

    def __post_init__(self) -> None:
        _coerce(self, resolver=ResolverKind, authority=Authority, relation=VerdictRelation, provenance=Provenance)
        # Only the user attests and only rules rule-confirm; the agent and resolver plugins give model verdicts.
        own = {ResolverKind.RULES: Authority.RULE_CONFIRMED, ResolverKind.USER: Authority.USER_ATTESTED}
        _require(self.authority is own[self.resolver] if self.resolver in own else self.authority in MODEL_AUTHORITIES,
                 f"verdict: a {self.resolver} resolver cannot claim {self.authority}")
        _require((self.chosen_id is None) == (self.relation in (VerdictRelation.NONE, VerdictRelation.AMBIGUOUS)),
                 "verdict: chosen_id is required exactly for a definite answer")
        if self.relation in RELATION_LEVEL:
            _require(subject_level(self.chosen_id) is RELATION_LEVEL[self.relation],
                     f"verdict: {self.relation} chooses a {RELATION_LEVEL[self.relation]}")
        elif self.chosen_id is not None:
            subject_level(self.chosen_id)
        model = self.authority in MODEL_AUTHORITIES
        _require(model == all(value is not None for value in (self.confidence, self.model, self.prompt_version, self.input_digest)),
                 "verdict: confidence, model, prompt_version and input_digest are required exactly for model authorities")
        _require(self.confidence is None or 0.0 <= self.confidence <= 1.0, "verdict: confidence in [0, 1]")
        _require(self.input_digest is None or bool(DIGEST.match(self.input_digest)), "verdict: input_digest is sha256:<hex>")
        _require((self.authority is Authority.RULE_CONFIRMED) == (self.rule_id is not None),
                 "verdict: rule_id is required exactly for rule confirmations")
        _require(self.rationale is None or len(self.rationale) <= 400, "verdict: rationale at most 400 characters")


def contradicts(claimed: Iterable[IdentifierValue], evidence: Iterable[IdentifierAssertion], as_of: str) -> bool:
    """Rule 2: identifier evidence contradicts an association.

    `claimed`: the record's identifiers; only those naming the record itself count.
    `evidence`: the assertions on the chosen subject and its ancestors. A T0
    assertion of a single-valued scheme, valid at `as_of`, contradicts when its
    value differs. Open reference evidence (snapshot) prevails; a provider's own
    assertion (source_asserted) counts only where no open evidence has that scheme.
    """
    claims = {item.scheme: item.value for item in claimed if item.role is IdentifierRole.SELF}
    current = [item for item in evidence if item.scheme in SINGLE_VALUED and item.scheme in claims
               and item.tier is EvidenceTier.T0 and item.validity.contains(as_of)]
    open_schemes = {item.scheme for item in current if item.authority is Authority.SNAPSHOT}
    return any(item.value != claims[item.scheme] for item in current
               if item.authority is Authority.SNAPSHOT or item.scheme not in open_schemes)


def guarded(relation: VerdictRelation, record_kind: InstrumentKind | None, subject_kind: InstrumentKind | None) -> bool:
    """The depositary-receipt guard: a receipt and a share are never the same instrument,
    and only a receipt is a receipt of a share. Unknown kinds trip nothing."""
    if record_kind is None or subject_kind is None:
        return False
    receipt = (InstrumentKind(record_kind) is InstrumentKind.DEPOSITARY_RECEIPT,
               InstrumentKind(subject_kind) is InstrumentKind.DEPOSITARY_RECEIPT)
    if relation in SAME_INSTRUMENT:
        return receipt[0] != receipt[1]
    return relation is VerdictRelation.DEPOSITARY_RECEIPT_OF and receipt != (True, False)


def decide(verdict: Verdict, item: QueueItem, *, claimed: Iterable[IdentifierValue],
           evidence: Iterable[IdentifierAssertion], as_of: str, record_kind: InstrumentKind | None,
           subject_kind: InstrumentKind | None, prior: Sequence[Verdict] = (),
           threshold: float | None = None) -> VerdictOutcome:
    """The authority rule (ADR 0037), identical for every resolver.

    A verdict may confirm in the absence of identifier proof, never against it:
    contradicting identifier evidence and the receipt guard always block. If the
    resolver found several candidates, or a standing `prior` verdict on the item
    gives a different answer, nothing is confirmed. A model verdict confirms only
    at or above the relation's gold-calibrated `threshold`; without one it suggests.
    """
    if verdict.item_id != item.id or any(other.item_id != item.id for other in prior):
        raise ValueError("verdict: answers a different queue item")
    if verdict.chosen_id is not None and verdict.chosen_id not in item.candidate_ids:
        raise ValueError("verdict: chosen_id must come from the item's candidates")
    if verdict.relation is VerdictRelation.AMBIGUOUS:
        return VerdictOutcome.AMBIGUOUS
    if verdict.relation in (VerdictRelation.NONE, VerdictRelation.UNRELATED):
        return VerdictOutcome.NO_MATCH
    if contradicts(claimed, evidence, as_of) or guarded(verdict.relation, record_kind, subject_kind):
        return VerdictOutcome.BLOCKED
    answer = (verdict.relation, verdict.chosen_id)
    if any(other.chosen_id is not None and (other.relation, other.chosen_id) != answer for other in prior):
        return VerdictOutcome.AMBIGUOUS
    if verdict.authority is Authority.MODEL_SUGGESTED:
        return VerdictOutcome.SUGGESTED
    if verdict.authority is Authority.MODEL_CONFIRMED:
        calibrated = threshold is not None and verdict.confidence is not None and verdict.confidence >= threshold
        return VerdictOutcome.CONFIRMED if calibrated else VerdictOutcome.SUGGESTED
    return VerdictOutcome.CONFIRMED
