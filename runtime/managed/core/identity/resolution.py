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

from .claims import DIGEST
from .model import Provenance, ProviderRef, _coerce, _require
from .schemes import INSTANT, Scheme, subject_level
from .vocabulary import Authority, VerdictRelation


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
NO_MATCH = frozenset({VerdictRelation.NONE, VerdictRelation.AMBIGUOUS, VerdictRelation.UNRELATED})


class VerdictOutcome(StrEnum):
    CONFIRMED = "confirmed"  # binding or relation confirmed with the verdict's authority
    SUGGESTED = "suggested"  # kept as a candidate; never routes a canonical read
    BLOCKED = "blocked"      # identifier proof or a mechanical guard contradicts it; a guard conflict opens
    NO_MATCH = "no_match"    # none / ambiguous / unrelated: the item stays unresolved or is dismissed


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
        if self.chosen_id is not None:
            subject_level(self.chosen_id)
        model = self.authority in MODEL_AUTHORITIES
        _require(model == all(value is not None for value in (self.confidence, self.model, self.prompt_version, self.input_digest)),
                 "verdict: confidence, model, prompt_version and input_digest are required exactly for model authorities")
        _require(self.confidence is None or 0.0 <= self.confidence <= 1.0, "verdict: confidence in [0, 1]")
        _require(self.input_digest is None or bool(DIGEST.match(self.input_digest)), "verdict: input_digest is sha256:<hex>")
        _require((self.authority is Authority.RULE_CONFIRMED) == (self.rule_id is not None),
                 "verdict: rule_id is required exactly for rule confirmations")
        _require(self.rationale is None or len(self.rationale) <= 400, "verdict: rationale at most 400 characters")


def decide(verdict: Verdict, item: QueueItem, *, contradicted: bool, guarded: bool,
           threshold: float | None) -> VerdictOutcome:
    """The authority rule, identical for every resolver.

    A verdict may confirm in the absence of identifier proof, never against it.
    `contradicted`: current identifier evidence at the same level contradicts the
    answer. `guarded`: a
    mechanical depositary-receipt or share-class guard forbids it. Both always
    win. A model verdict confirms only at or above the relation's gold-calibrated
    `threshold`; with no calibrated threshold it can only suggest.
    """
    if verdict.item_id != item.id:
        raise ValueError("verdict: answers a different queue item")
    if verdict.chosen_id is not None and verdict.chosen_id not in item.candidate_ids:
        raise ValueError("verdict: chosen_id must come from the item's candidates")
    if verdict.relation in NO_MATCH:
        return VerdictOutcome.NO_MATCH
    if contradicted or guarded:
        return VerdictOutcome.BLOCKED
    if verdict.authority is Authority.MODEL_SUGGESTED:
        return VerdictOutcome.SUGGESTED
    if verdict.authority is Authority.MODEL_CONFIRMED:
        calibrated = threshold is not None and verdict.confidence is not None and verdict.confidence >= threshold
        return VerdictOutcome.CONFIRMED if calibrated else VerdictOutcome.SUGGESTED
    return VerdictOutcome.CONFIRMED

