"""Working the resolution queue (ADR 0037): read it, settle it by rule, and record every verdict.

Three resolvers use one path. `settle_by_rules` re-asks the join with current
evidence, `submit` takes the Hermes agent's or the user's verdict, and both go
through `decide`, so a verdict may confirm without identifier proof but never
against it. Every verdict is recorded with its outcome; a confirmed one writes
its binding in the same transaction. Nothing here calls a provider.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
from typing import Any, Iterable

from .claims import ClaimBatch, RecordClaim
from .model import Binding, ProviderRef, evidence_id
from .page import LABELS, RESOLVE_RULE, SAME, PluginInfo, apply_resolve, load_subject, resolve_input
from .resolution import RELATION_LEVEL, QueueItem, ResolverKind, Verdict, VerdictOutcome, decide
from .schemes import subject_level
from .store import IdentityStore
from .vocabulary import Authority, InstrumentKind, VerdictRelation

# Provisional: an agent verdict at or above this confidence is model_confirmed. The truth set replaces it with a
# gold-calibrated threshold per relation (ADR 0037); below it the verdict is kept as a suggestion.
AGENT_THRESHOLD = 0.9
AGENT_MODEL = "hermes-agent"
PROMPT_VERSION = "pythia_identity_verdict@1"
CORE = "pythia"

QUESTIONS = {
    "no_key": "{label}'s record {ref} has no identifier that proves which instrument it is.",
    "underlying_identifier": "{label}'s record {ref} quotes its underlying's ISIN; it may be a depositary receipt.",
    "ambiguous": "{label} answered with several records for one instrument.",
    "identifier": "Two records claim one identifier, or one record claims two values.",
    "binding": "{label}'s record {ref} contradicts the reference identifiers.",
    "bound": "{label}'s record {ref} is already bound to another instrument.",
    "relation": "A typed relation contradicts the identifiers.",
    "guard": "A verdict would make a depositary receipt and its share the same instrument.",
}


class Refused(ValueError):
    """The verdict cannot be taken: the item is not open, or the answer does not fit it."""


def summary(item: dict) -> dict:
    """An open item as the agent and Desk list it."""
    plugin = item["plugins"][0]
    ref = item["provider_ref"]
    reason = "bound" if item["reason"] == "binding" and len(item["subject_ids"]) > 1 else item["reason"]
    question = QUESTIONS[reason].format(label=LABELS.get(plugin, plugin), ref=ref["native_id"] if ref else "")
    answers = [{"relation": relation, "chosen_id": candidate} for candidate in item["candidate_ids"]
               for relation in (*(relation for relation, level in RELATION_LEVEL.items()
                                  if level is subject_level(candidate)), "unrelated")]
    return {key: item[key] for key in ("id", "kind", "reason", "plugins", "provider_ref", "subject_ids", "candidate_ids",
                                       "opened_at", "updated_at")} | {
        "label": LABELS.get(plugin, plugin), "question": question,
        "answers": answers + [{"relation": relation, "chosen_id": None} for relation in ("none", "ambiguous")]}


def inspect(store: IdentityStore, ref: sqlite3.Connection, item_id: str) -> dict | None:
    """One item in full: the provider record, the candidates, the cited evidence and every verdict so far.

    `digest` hashes exactly this view; an agent verdict records it as its input digest."""
    item = store.queue_item(item_id)
    if item is None:
        return None
    record = store.claim(item["plugins"][0], ProviderRef(**item["provider_ref"])) if item["provider_ref"] else None
    cited = item["evidence_ids"]
    rows = ref.execute(f"SELECT * FROM assertions WHERE evidence_id IN ({','.join('?' * len(cited))})", cited).fetchall() \
        if cited else []
    view = {**summary(item), "state": item["state"], "scheme": item["scheme"], "values": item["values"],
            "record": _record(record) if record else None,
            "subjects": [_describe(ref, subject) for subject in item["subject_ids"]],
            "candidates": [_describe(ref, subject) for subject in item["candidate_ids"]],
            "evidence": [{key: row[key] for key in ("evidence_id", "subject_id", "scheme", "value", "authority", "source",
                                                    "retrieved_at")} for row in rows],
            "history": [{key: entry[key] for key in ("resolver", "authority", "relation", "chosen_id", "confidence",
                                                     "rationale", "outcome", "created_at", "item_state")}
                        for entry in store.history(item)]}
    return {**view, "digest": _digest(view)}


def submit(store: IdentityStore, ref: sqlite3.Connection, *, item_id: str, resolver: ResolverKind, relation: str,
           chosen_id: str | None, now: str, as_of: str, confidence: float | None = None, rationale: str | None = None,
           user_turn: str | None = None, threshold: float = AGENT_THRESHOLD) -> dict:
    """Decide and record one agent or user verdict; a confirmed one binds, a "not a match" dismisses the item."""
    view, row = inspect(store, ref, item_id), store.queue_item(item_id)
    if view is None or row["state"] != "open":
        raise Refused("This question is not open.")
    item = _queue_item(row)
    agent = ResolverKind(resolver) is ResolverKind.AGENT
    if agent and confidence is None:
        raise Refused("An agent verdict states its confidence.")
    authority = (Authority.USER_ATTESTED if not agent else
                 Authority.MODEL_CONFIRMED if confidence >= threshold else Authority.MODEL_SUGGESTED)
    try:
        verdict = Verdict(item_id=item_id, resolver=resolver, authority=authority, relation=relation, chosen_id=chosen_id,
                          provenance={"plugin": CORE, "source": str(resolver), "adapter_version": "1", "retrieved_at": now},
                          confidence=confidence if agent else None, model=AGENT_MODEL if agent else None,
                          prompt_version=PROMPT_VERSION if agent else None,
                          input_digest=view["digest"] if agent else None, rationale=rationale, user_turn=user_turn)
    except ValueError as error:
        raise Refused(str(error)) from None
    raw = _raw(store, row)
    record = _claim(raw) if raw else None
    subject = load_subject(ref, chosen_id) if chosen_id else None
    if chosen_id and subject is None:
        raise Refused("The chosen subject is not in the reference data.")
    # The user's attestation is the last word; an agent answer that differs from another resolver's is ambiguous.
    prior = [] if not agent else [_verdict(entry, item_id) for entry in store.history(row)
                                  if entry["item_id"] == item_id and entry["resolver"] != resolver
                                  and entry["outcome"] == "suggested"]
    try:
        outcome = decide(verdict, item, claimed=record.identifiers if record else (), as_of=as_of,
                         evidence=subject["evidence"] if subject else (),
                         record_kind=record.attributes.kind if record else None,
                         subject_kind=_kind(subject), prior=prior, threshold=threshold)
    except ValueError as error:
        raise Refused(str(error)) from None
    state, message = "open", _MESSAGES[outcome]
    with store.transaction():
        if store.queue_item(item_id)["state"] != "open":  # another resolver answered meanwhile
            raise Refused("This question is not open.")
        bound = store.binding_for(item.provider_ref) if item.provider_ref else None
        if outcome is VerdictOutcome.CONFIRMED and bound is not None and bound["status"] == "confirmed" \
                and bound["subject_id"] != chosen_id:
            outcome, message = VerdictOutcome.BLOCKED, "Refused: the record is bound to another instrument; a binding is never re-pointed."
        verdict_id = store.put_verdict(verdict, outcome)
        if outcome is VerdictOutcome.CONFIRMED:
            if item.provider_ref:
                store.put_binding(Binding(provider_ref=item.provider_ref, subject_id=chosen_id, status="confirmed",
                                          authority=authority, plugin=item.plugins[0],
                                          evidence_ids=(evidence_id({"kind": "verdict", "verdict": verdict_id}),)),
                                  verdict_id=verdict_id)
            state = "resolved"
        elif outcome is VerdictOutcome.NO_MATCH and authority is not Authority.MODEL_SUGGESTED:
            state = "dismissed"
        if state != "open":
            store.settle(item_id, state, verdict_id)
    return {"outcome": str(outcome), "state": state, "verdict_id": verdict_id, "authority": str(authority),
            "message": message}


def settle_by_rules(store: IdentityStore, ref: sqlite3.Connection, plugins: Iterable[PluginInfo], items: Iterable[dict],
                    *, now: str, as_of: str) -> list[str]:
    """Re-ask the join for open items with the evidence the device has now (rule `resolve_answer@1`).

    New identifier proof (a reference build, another plugin's binding) settles an item: its binding is
    written with a recorded rules verdict. A changed question supersedes the item. Returns settled ids."""
    usable = {info.manifest.plugin: info for info in plugins if info.enabled and not info.missing}
    settled = []
    for row in items:
        info = usable.get(row["plugins"][0])
        raw = _raw(store, row)
        if row["state"] != "open" or info is None or raw is None or len(row["candidate_ids"]) != 1:
            continue
        target = row["candidate_ids"][0]
        subject = load_subject(ref, target)
        if subject is None:
            continue
        record = _claim(raw)
        batch = ClaimBatch(plugin=record.provenance.plugin, provider=record.native_ref.provider,
                           adapter_version=record.provenance.adapter_version, origin="resolve", claims=(record,))

        def bound_to(provider_ref):
            found = store.binding_for(provider_ref)
            return found["subject_id"] if found is not None and found["status"] == "confirmed" else None

        level = subject_level(target)
        binding, item, _records = apply_resolve(batch, info, level, subject, resolve_input(info, subject), now=now,
                                                as_of=as_of, bound_to=bound_to)
        if binding is not None:
            verdict = Verdict(item_id=row["id"], resolver="rules", authority="rule_confirmed", relation=SAME[level],
                              chosen_id=target, rule_id=RESOLVE_RULE,
                              provenance={"plugin": CORE, "source": CORE, "adapter_version": "1", "retrieved_at": now})
            with store.transaction():
                verdict_id = store.put_verdict(verdict, VerdictOutcome.CONFIRMED)
                if store.put_binding(binding, verdict_id=verdict_id) and store.settle(row["id"], "resolved", verdict_id):
                    settled.append(row["id"])
        elif item is not None and item.key != row["key"]:
            with store.transaction():
                if store.settle(row["id"], "superseded", None):
                    store.put_queue_item(item)
                    settled.append(row["id"])
    return settled


# ---- internals -----------------------------------------------------------------------------------------------------

_MESSAGES = {
    VerdictOutcome.CONFIRMED: "Confirmed: the record is bound to the chosen instrument.",
    VerdictOutcome.SUGGESTED: "Kept as a suggestion: it does not route reads until a confirming verdict.",
    VerdictOutcome.BLOCKED: "Refused: identifier evidence or the depositary-receipt guard contradicts this answer.",
    VerdictOutcome.AMBIGUOUS: "Left open: the answers disagree or several candidates fit.",
    VerdictOutcome.NO_MATCH: "Recorded: the record is not this instrument.",
}


def _raw(store: IdentityStore, item: dict) -> dict | None:
    return store.claim(item["plugins"][0], ProviderRef(**item["provider_ref"])) if item["provider_ref"] else None


def _claim(raw: dict) -> RecordClaim:
    return RecordClaim(**raw)


def _record(raw: dict) -> dict:
    attributes = raw.get("attributes") or {}
    return {"native_ref": raw.get("native_ref"), "level": raw.get("level"),
            "identifiers": raw.get("identifiers") or [],
            **{key: attributes.get(key) for key in ("name", "ticker", "mic", "currency", "kind")}}


def _describe(ref: sqlite3.Connection, subject_id: str) -> dict:
    subject = load_subject(ref, subject_id)
    if subject is None:
        return {"id": subject_id, "level": str(subject_level(subject_id)), "known": False}
    view = subject["view"]
    return {"id": subject_id, "level": str(subject["level"]), "known": True, "name": view["subject"]["name"],
            "kind": subject["kind"], "identifiers": view["identifiers"]}


def _kind(subject: dict | None) -> InstrumentKind | None:
    kind = subject and subject["kind"]
    return InstrumentKind(kind) if kind in set(InstrumentKind) else None


def _queue_item(row: dict) -> QueueItem:
    return QueueItem(id=row["id"], kind=row["kind"], reason=row["reason"], subject_ids=row["subject_ids"],
                     candidate_ids=row["candidate_ids"], evidence_ids=row["evidence_ids"], state=row["state"],
                     opened_at=row["opened_at"], plugins=row["plugins"], provider_ref=row["provider_ref"],
                     scheme=row["scheme"], values=row["values"])


def _verdict(entry: dict, item_id: str) -> Verdict:
    fields = ("resolver", "authority", "relation", "chosen_id", "confidence", "model", "prompt_version", "input_digest",
              "rule_id", "rationale", "user_turn")
    return Verdict(item_id=item_id, provenance={"plugin": entry["plugin"], "source": entry["resolver"],
                                                "adapter_version": "1", "retrieved_at": entry["created_at"]},
                   **{name: entry[name] for name in fields})


def _digest(view: dict[str, Any]) -> str:
    canonical = json.dumps(view, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return "sha256:" + hashlib.sha256(canonical.encode()).hexdigest()
