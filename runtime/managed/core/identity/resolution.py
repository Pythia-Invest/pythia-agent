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
from typing import Iterable, Mapping, Sequence

from .claims import DIGEST, IdentifierValue
from .evidence import disagree
from .model import IdentifierAssertion, Provenance, ProviderRef, _coerce, _require
from .schemes import INSTANT, NAMESPACE, SCHEME_LEVEL, SINGLE_VALUED, Level, Scheme, subject_kind, subject_level
from .vocabulary import KIND_OF_RECORD, Authority, EvidenceTier, IdentifierRole, InstrumentKind, VerdictRelation


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
    GUARD = "guard"                                  # conflict: a verdict or rule tripped the depositary-receipt guard


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
    AGENT = "agent"    # the Hermes agent, the only hard prerequisite; its answers are suggestions the user confirms
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
    plugins: tuple[str, ...]        # whose claims are involved; two plugins for a cross-plugin conflict
    provider_ref: ProviderRef | None = None
    scheme: Scheme | None = None    # conflict: the contested scheme
    values: tuple[str, ...] = ()    # conflict: the contested values

    def __post_init__(self) -> None:
        _coerce(self, kind=QueueItemKind, reason=QueueReason, state=QueueState, provider_ref=ProviderRef, scheme=Scheme)
        for name in ("subject_ids", "candidate_ids", "evidence_ids", "plugins", "values"):
            object.__setattr__(self, name, tuple(getattr(self, name)))
        _require(self.reason in REASONS[self.kind], f"queue item: {self.reason} is not a {self.kind} reason")
        for subject in (*self.subject_ids, *self.candidate_ids):
            subject_kind(subject)
        _require(len(self.subject_ids) == 1 if self.kind is QueueItemKind.RESIDUAL else len(self.subject_ids) >= 1,
                 "queue item: a residual concerns one subject; a conflict at least one")
        _require(self.kind is QueueItemKind.RESIDUAL or bool(self.evidence_ids), "queue item: conflicts cite evidence")
        _require(bool(INSTANT.match(self.opened_at)), "queue item: opened_at is an ISO instant")
        _require(bool(self.plugins) and all(NAMESPACE.match(plugin) for plugin in self.plugins),
                 "queue item: plugins names the claiming plugins")

    @property
    def key(self) -> str:
        return question_key(self.kind, self.reason, self.subject_ids, self.scheme, self.provider_ref)


def question_key(kind: str, reason: str, subject_ids: Iterable[str], scheme: str | None, ref: ProviderRef | None) -> str:
    """Dedupe key: at most one open item per question, however often ingest re-asks it."""
    return "|".join((kind, reason, ",".join(sorted(subject_ids)), scheme or "",
                     f"{ref.provider}.{ref.native_scope}:{ref.native_id}" if ref else ""))


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
    user_turn: str | None = None      # required for user_attested: the Desk user action that made it

    def __post_init__(self) -> None:
        _coerce(self, resolver=ResolverKind, authority=Authority, relation=VerdictRelation, provenance=Provenance)
        # Only the user attests and only rules rule-confirm; the agent has its own authority (no self-stated
        # confidence) and only suggests (queue.submit); resolver plugins give calibrated model verdicts.
        own = {ResolverKind.RULES: Authority.RULE_CONFIRMED, ResolverKind.USER: Authority.USER_ATTESTED,
               ResolverKind.AGENT: Authority.AGENT_CONFIRMED}
        _require(self.authority is own[self.resolver] if self.resolver in own else self.authority in MODEL_AUTHORITIES,
                 f"verdict: a {self.resolver} resolver cannot claim {self.authority}")
        _require((self.chosen_id is None) == (self.relation in (VerdictRelation.NONE, VerdictRelation.AMBIGUOUS)),
                 "verdict: chosen_id is required exactly for a definite answer")
        if self.relation in RELATION_LEVEL:
            _require(subject_kind(self.chosen_id) == RELATION_LEVEL[self.relation],
                     f"verdict: {self.relation} chooses a {RELATION_LEVEL[self.relation]}")
        elif self.chosen_id is not None:
            subject_kind(self.chosen_id)
        model = self.authority in MODEL_AUTHORITIES
        _require(model == (self.confidence is not None), "verdict: confidence is required exactly for model authorities")
        _require((model or self.authority is Authority.AGENT_CONFIRMED)
                 == all(value is not None for value in (self.model, self.prompt_version, self.input_digest)),
                 "verdict: model, prompt_version and input_digest are required exactly for model and agent authorities")
        _require(self.confidence is None or 0.0 <= self.confidence <= 1.0, "verdict: confidence in [0, 1]")
        _require(self.input_digest is None or bool(DIGEST.match(self.input_digest)), "verdict: input_digest is sha256:<hex>")
        _require((self.authority is Authority.RULE_CONFIRMED) == (self.rule_id is not None),
                 "verdict: rule_id is required exactly for rule confirmations")
        _require((self.authority is Authority.USER_ATTESTED) == bool(self.user_turn),
                 "verdict: user_turn is required exactly for user attestations")
        _require(self.rationale is None or len(self.rationale) <= 400, "verdict: rationale at most 400 characters")


def _current(claimed: Iterable[IdentifierValue], evidence: Iterable[IdentifierAssertion],
             as_of: str) -> tuple[dict[str, str], dict[str, list[IdentifierAssertion]]]:
    """The record's own values by scheme, and the T0 evidence for those single-valued schemes valid at `as_of`."""
    claims = {item.scheme: item.value for item in claimed if item.role is IdentifierRole.SELF}
    found: dict[str, list[IdentifierAssertion]] = {}
    for item in evidence:
        if item.scheme in SINGLE_VALUED and item.scheme in claims and item.tier is EvidenceTier.T0 \
                and item.validity.contains(as_of):
            found.setdefault(item.scheme, []).append(item)
    return claims, found


def _against(claim: str, items: list[IdentifierAssertion], unanimous: bool) -> bool:
    """A source asserts only other values than `claim`; with `unanimous`, every source agrees on them (`disagree`)."""
    if unanimous:
        return not disagree(items) and all(item.value != claim for item in items)
    sources: dict[tuple[str, str], set[str]] = {}
    for item in items:
        sources.setdefault((item.provenance.plugin, item.provenance.source), set()).add(item.value)
    return any(claim not in values for values in sources.values())


def contradicts(claimed: Iterable[IdentifierValue], evidence: Iterable[IdentifierAssertion], as_of: str, *,
                unanimous: bool = False) -> bool:
    """Rule 2: identifier evidence contradicts an association.

    `claimed`: the record's identifiers; only those naming the record itself count.
    `evidence`: the counting assertions on the chosen subject and its ancestors (a disabled plugin's never block;
    callers leave them out). The T0 assertions of a single-valued scheme, valid at `as_of`, contradict when a
    source asserts only other values, whoever it is, so where sources disagree every answer is blocked.
    One source that asserts several values contradicts none of them. With `unanimous` (the user's answer), only
    evidence whose sources agree contradicts.
    """
    claims, found = _current(claimed, evidence, as_of)
    return any(_against(claims[scheme], items, unanimous) for scheme, items in found.items())


def corroborates(claimed: Iterable[IdentifierValue], evidence: Iterable[IdentifierAssertion], as_of: str,
                 level: Level, same_venue: bool = False, *, unanimous: bool = False) -> bool:
    """Identifier evidence names the question's own subject: one of the record's own single-valued identifiers at
    that `level` equals a valid T0 assertion (with `unanimous`, one whose sources agree). A listing is
    also named by its security's ISIN on the same venue (`same_venue`). A shared issuer LEI or a sibling venue's ISIN
    says nothing about which instrument this is."""
    claims, found = _current(claimed, evidence, as_of)
    named = {level} | ({Level.SECURITY} if level is Level.LISTING and same_venue else set())
    return any(SCHEME_LEVEL[scheme] in named and any(item.value == claims[scheme] for item in items)
               and not (unanimous and disagree(items)) for scheme, items in found.items())


def resolve_evidence(evidence: Iterable[IdentifierAssertion], sent: Mapping[str, str], level: Level) -> tuple[str, ...]:
    """The evidence a resolve answer at `level` rests on: the subject's assertions of the identifiers core sent. An
    issuer's LEI or CIK names the company, never which of its share classes, receipts or lines a record is (ADR 0044,
    A3), so it confirms only an issuer."""
    return tuple(item.evidence_id for item in evidence if sent.get(item.scheme) == item.value
                 and (level is Level.ISSUER or SCHEME_LEVEL[item.scheme] is not Level.ISSUER))


def quotes_underlying(claimed: Iterable[IdentifierValue], sent: Mapping[str, str]) -> bool:
    """The record quotes an identifier core sent as its underlying's: a receipt answering for its share, never that
    instrument. Only `self` values name the record itself (ADR 0037, "Assertions and roles")."""
    return any(item.role is IdentifierRole.UNDERLYING and sent.get(item.scheme) == item.value for item in claimed)


def guarded(relation: VerdictRelation, record_kind: InstrumentKind | None, subject_kind: InstrumentKind | None) -> bool:
    """The kind guards: an index or FX record is never an instrument (its subject has its own kind); a receipt and
    a share are never the same instrument, and only a receipt is a receipt of a share. Unknown kinds trip nothing."""
    if record_kind in KIND_OF_RECORD:
        return True  # every verdict relation names an instrument
    if record_kind is None or subject_kind is None:
        return False
    receipt = (InstrumentKind(record_kind) is InstrumentKind.DEPOSITARY_RECEIPT,
               InstrumentKind(subject_kind) is InstrumentKind.DEPOSITARY_RECEIPT)
    if relation in SAME_INSTRUMENT:
        return receipt[0] != receipt[1]
    return relation is VerdictRelation.DEPOSITARY_RECEIPT_OF and receipt != (True, False)


def decide(verdict: Verdict, item: QueueItem, *, claimed: Iterable[IdentifierValue],
           evidence: Iterable[IdentifierAssertion], as_of: str, record_kind: InstrumentKind | None,
           subject_kind: InstrumentKind | None, prior: Sequence[Verdict] = (), same_venue: bool = False,
           threshold: float | None = None) -> VerdictOutcome:
    """The authority rule (ADR 0037), identical for every resolver.

    A verdict may confirm in the absence of identifier proof, never against it:
    contradicting identifier evidence and the receipt guard always block. Likewise
    "not a match" is blocked when the record's own identifiers name the candidate. The user's
    answer is refused only by unanimous identifier proof: where contributors disagree, the user decides. If the resolver found several candidates, or a standing `prior`
    verdict on the item gives a different answer, nothing is confirmed. A model verdict confirms
    only at or above the relation's gold-calibrated `threshold`; without one it suggests.
    The queue keeps an agent answer that would take effect as a suggestion.
    """
    if verdict.item_id != item.id or any(other.item_id != item.id for other in prior):
        raise ValueError("verdict: answers a different queue item")
    if verdict.chosen_id is not None and verdict.chosen_id not in item.candidate_ids:
        raise ValueError("verdict: chosen_id must come from the item's candidates")
    if verdict.relation is VerdictRelation.AMBIGUOUS:
        return VerdictOutcome.AMBIGUOUS
    user = verdict.authority is Authority.USER_ATTESTED
    if verdict.relation in (VerdictRelation.NONE, VerdictRelation.UNRELATED):
        named = verdict.chosen_id or next(iter(item.candidate_ids), None)
        proven = named is not None and corroborates(claimed, evidence, as_of, subject_level(named), same_venue,
                                                    unanimous=user)
        return VerdictOutcome.BLOCKED if proven else VerdictOutcome.NO_MATCH
    if contradicts(claimed, evidence, as_of, unanimous=user) or guarded(verdict.relation, record_kind, subject_kind):
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
