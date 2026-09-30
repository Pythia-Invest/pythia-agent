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
from typing import Any, Iterable, Mapping

from . import build_questions, device, device_parents
from .build_questions import BUILD
from .claims import ClaimBatch, RecordClaim
from .model import Binding, ProviderRef, evidence_id
from .page import LABELS, RESOLVE_RULE, SAME, PluginInfo, apply_resolve, load_subject, resolve_input
from .resolution import RELATION_LEVEL, QueueItem, ResolverKind, Verdict, VerdictOutcome, decide
from .schemes import Level, subject_kind, subject_level
from .store import IdentityStore
from .vocabulary import Authority, InstrumentKind, VerdictRelation

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


def summary(store: IdentityStore, ref: sqlite3.Connection, item: dict, labels: Mapping[str, str] = {}) -> dict:
    """An item as the agent and Desk list it: what the provider's record says and which subjects it may be,
    so an answer never rests on the question text alone. `labels` name the installed plugins a question core asked
    is about (the source it shows)."""
    record = _raw(store, item)
    plugin = item["plugins"][0]
    native = item["provider_ref"]
    reason = "bound" if item["reason"] == "binding" and len(item["subject_ids"]) > 1 else item["reason"]
    label = LABELS.get(native["provider"] if native else plugin, plugin)  # labels are keyed by provider
    question = QUESTIONS[reason].format(label=label, ref=native["native_id"] if native else "")
    answers = [{"relation": relation, "chosen_id": candidate} for candidate in item["candidate_ids"]
               for relation in (*(relation for relation, level in RELATION_LEVEL.items()
                                  if level == subject_kind(candidate)), "unrelated")]
    built = build_questions.asked(item) if build_questions.is_build(item) else None
    if built:  # a reference build question: its own text, and one relation per candidate
        label, question = build_questions.label(item, labels), built[0]
        answers = [{"relation": str(built[1]), "chosen_id": candidate} for candidate in item["candidate_ids"]]
    return {key: item[key] for key in ("id", "kind", "reason", "state", "plugins", "provider_ref", "subject_ids",
                                       "candidate_ids", "opened_at", "updated_at")} | {
        # On an open question: the agent's suggestion, which waits for the user.
        "agent_answer": _suggestion(store, item) if item["state"] == "open" else None,
        "label": label, "question": question, "record": _record(record) if record else None,
        "subjects": [_describe(store, ref, subject) for subject in item["subject_ids"]],
        "candidates": [_describe(store, ref, subject) for subject in item["candidate_ids"]],
        "settled_by": item["settled"]["by"] if item["state"] != "open" and item["settled"] else None,
        "settled_answer": {key: item["settled"][key] for key in ("relation", "chosen_id")}
        if item["state"] != "open" and item["settled"] else None,
        "evidence": _evidence(store, ref, item["evidence_ids"]),
        "answers": answers + [{"relation": relation, "chosen_id": None} for relation in ("none", "ambiguous")
                              if relation != "none" or not (built and build_questions.itself(item))]}


def listing(store: IdentityStore, ref: sqlite3.Connection, *, subject_id: str | None, kind: str | None,
            plugins: set[str] | None, limit: int, notice: bool, settled: bool = False,
            labels: Mapping[str, str] = {}) -> dict:
    """Open items, newest first; apart and uncounted, with `settled` the ones rules or the user settled. With
    `notice`, says so when this process started a fresh store and kept an incompatible one aside."""
    filters = {"subject_ids": family(store, ref, subject_id) if subject_id else None, "kind": kind, "plugins": plugins}
    items, size = store.queue_items(**filters), max(1, min(50, limit))
    data: dict[str, Any] = {"items": [summary(store, ref, item, labels) for item in items[:size]], "total": len(items)}
    if settled:
        data["settled"] = [summary(store, ref, item, labels)
                           for item in store.queue_items(**filters, which="settled")[:size]]
    if notice and store.set_aside:
        data["notice"] = (f"The identity store was reset for a new format; the previous one is kept as "
                          f"{store.set_aside}. Confirmed matches and answers start over.")
    return data


def names(plugins: Iterable[PluginInfo]) -> dict[str, str]:
    """Each installed plugin's name with the label its questions show (`summary`)."""
    return {info.manifest.plugin: info.label for info in plugins}


def family(store: IdentityStore, ref: sqlite3.Connection, subject_id: str) -> list[str]:
    """The subject and its listing, security, issuer and composite, as the page groups its questions: the
    reference's, else a device subject's."""
    try:
        current = device.current_id(ref, store, subject_id)  # a saved ID reads as the subject it became
        subject = load_subject(ref, current) or device.load(ref, store, current)
    except ValueError:  # a malformed subject id
        return []
    return [subject_id, *(value for value in subject["ids"].values() if value)] if subject else [subject_id]


def inspect(store: IdentityStore, ref: sqlite3.Connection, item_id: str, labels: Mapping[str, str] = {}) -> dict | None:
    """One item in full: the provider record, the candidates, the cited evidence and every verdict so far.

    `digest` hashes exactly this view; an agent verdict records it as its input digest."""
    item = store.queue_item(item_id)
    if item is None:
        return None
    view = {**summary(store, ref, item, labels), "scheme": item["scheme"], "values": item["values"],
            "history": [{key: entry[key] for key in ("resolver", "authority", "relation", "chosen_id", "confidence",
                                                     "rationale", "outcome", "created_at", "item_state")}
                        for entry in store.history(item)]}
    return {**view, "digest": _digest(view)}


def submit(store: IdentityStore, ref: sqlite3.Connection, *, item_id: str, resolver: ResolverKind, relation: str,
           chosen_id: str | None, now: str, as_of: str, rationale: str | None = None,
           user_turn: str | None = None, plugins: Iterable[PluginInfo] = ()) -> dict:
    """Decide and record one agent or user verdict.

    The user's confirmed answer binds the record to the chosen reference or device subject (whose device evidence
    counts as the enabled `plugins`' does), a "not a match" dismisses the question. An answer to a reference
    build question binds nothing: its resolved question is the local override reads apply (`build_questions`), in
    place of the user's earlier answer about the same fact. Only unanimous identifier evidence refuses the user
    (`decide`). The agent only suggests (ADR 0044 ruling 8): its answer is recorded, the question stays
    open, and nothing changes until the user confirms it."""
    resolver, plugins = ResolverKind(resolver), list(plugins)
    user = resolver is ResolverKind.USER
    view, row = inspect(store, ref, item_id, names(plugins)), store.queue_item(item_id)
    if view is None or row["state"] != "open":
        raise Refused("This question is not open.")
    raw = _raw(store, row)
    built = build_questions.asked(row) if build_questions.is_build(row) else None
    if raw is None and built is None:  # a plugin's conflict without a provider record: no answer has an effect yet
        raise Refused("This question has no provider record to bind, so no answer can take effect.")
    if built and relation not in (built[1], "none", "ambiguous"):
        raise Refused(f"This question takes {built[1]}, none or ambiguous as its answer.")
    item = _queue_item(row)
    authority = Authority.USER_ATTESTED if user else Authority.AGENT_CONFIRMED
    try:
        verdict = Verdict(item_id=item_id, resolver=resolver, authority=authority, relation=relation, chosen_id=chosen_id,
                          provenance={"plugin": CORE, "source": str(resolver), "adapter_version": "1", "retrieved_at": now},
                          model=None if user else AGENT_MODEL, prompt_version=None if user else PROMPT_VERSION,
                          input_digest=None if user else view["digest"], rationale=rationale, user_turn=user_turn)
    except ValueError as error:
        raise Refused(str(error)) from None
    record = _claim(raw) if raw else None
    subject = device.load_subject(ref, store, chosen_id, plugins) if chosen_id else None
    if chosen_id and subject is None and not (built and (build_questions.own_identifier(row)
                                                         or device_parents.level(row))):
        raise Refused("The chosen subject is not known on this device.")  # a contested value need not name one
    # Against "none", every candidate's evidence counts, each candidate's on its own (`pools`).
    subjects = [subject] if subject else [] if chosen_id else [
        found for other in item.candidate_ids if (found := device.load_subject(ref, store, other, plugins))]
    pools = [found["evidence"] for found in subjects] if not chosen_id and subjects else [
        [assertion for found in subjects for assertion in found["evidence"]]]
    prior = [] if user else [_verdict(entry, item_id) for entry in store.history(row)
                             if entry["item_id"] == item_id and entry["resolver"] != resolver
                             and entry["outcome"] == "suggested"]
    try:
        # A build question's own subject stands in for the record: its identifiers, and for a receipt answer its kind,
        # so a receipt is never chosen as the underlying.
        outcomes = [decide(verdict, item, claimed=record.identifiers if record else build_questions.claimed(ref, row),
                           as_of=as_of, record_kind=record.attributes.kind if record else InstrumentKind.DEPOSITARY_RECEIPT
                           if built[1] is VerdictRelation.DEPOSITARY_RECEIPT_OF else None,
                           evidence=pool, subject_kind=_kind(subject), prior=prior, same_venue=record is not None and (
                               _same_venue(record, subjects)
                               # A bound conflict is a resolve answer to this listing's identifiers: its venue is this one.
                               or (row["reason"] == "binding" and len(row["subject_ids"]) > 1))) for pool in pools]
        outcome = VerdictOutcome.BLOCKED if VerdictOutcome.BLOCKED in outcomes else outcomes[0]
    except ValueError as error:
        raise Refused(str(error)) from None
    if not user and outcome in (VerdictOutcome.CONFIRMED, VerdictOutcome.NO_MATCH):
        outcome = VerdictOutcome.SUGGESTED  # the agent proposes, the user confirms
    state, message = row["state"], (_BUILT if built else _MESSAGES).get(outcome, _MESSAGES[outcome])
    if outcome is VerdictOutcome.BLOCKED and verdict.relation in ("unrelated", "none"):
        message = _NAMED
    with store.transaction():
        current = store.queue_item(item_id)
        if current is None or current["state"] != "open":  # another resolver answered meanwhile
            raise Refused("This question is not open.")
        firm = store.bound_subject(item.provider_ref) if record else None
        if outcome is VerdictOutcome.CONFIRMED and firm not in (None, chosen_id):
            outcome, message = VerdictOutcome.BLOCKED, "Refused: the record is bound to another instrument."
        verdict_id = store.put_verdict(verdict, outcome)
        if outcome is VerdictOutcome.CONFIRMED and record:
            store.put_binding(Binding(provider_ref=item.provider_ref, subject_id=chosen_id, status="confirmed",
                                      authority=authority, plugin=item.plugins[0],
                                      evidence_ids=(evidence_id({"kind": "verdict", "verdict": verdict_id}),)),
                              verdict_id=verdict_id)
        if outcome in (VerdictOutcome.CONFIRMED, VerdictOutcome.NO_MATCH):
            state = "resolved" if outcome is VerdictOutcome.CONFIRMED else "dismissed"
            store.settle(item_id, state, verdict_id)
        if built and outcome is VerdictOutcome.CONFIRMED:
            build_questions.replace_answer(store, row, verdict.relation, now)
    return {"outcome": str(outcome), "state": state, "verdict_id": verdict_id, "authority": str(authority),
            "message": message}


def retire_build(store: IdentityStore, now: str) -> int:
    """A new release asks its own questions: the previous build's open ones are superseded, and answered ones are
    kept. The next touch of an instrument queues the new release's questions about it (`build_questions`)."""
    with store.transaction():
        store.db.execute("UPDATE queue SET state = 'superseded', updated_at = ? WHERE json_extract(plugins, '$[0]') = ?"
                         " AND provider_ref IS NULL AND state = 'open'", (now, BUILD))
        return store.db.execute("SELECT changes()").fetchone()[0]


def _suggestion(store: IdentityStore, item: dict) -> dict | None:
    """The agent's latest answer to this open question when it was kept as a suggestion."""
    latest = next((entry for entry in reversed(store.history(item))
                   if entry["item_id"] == item["id"] and entry["resolver"] == "agent"), None)
    return {"by": "agent", "relation": latest["relation"], "chosen_id": latest["chosen_id"]} \
        if latest and latest["outcome"] == "suggested" else None


def _same_venue(record: RecordClaim, subjects: list[dict]) -> bool:
    """The record states the candidate listing's venue, so its security's ISIN names that listing."""
    venue = record.attributes.operating_mic or record.attributes.mic
    return bool(venue) and any(found["listing"] is not None and venue in (found["listing"]["operating_mic"],
                                                                          found["listing"]["mic"]) for found in subjects)


def settle_by_rules(store: IdentityStore, ref: sqlite3.Connection, plugins: Iterable[PluginInfo], items: Iterable[dict],
                    *, now: str, as_of: str) -> list[str]:
    """Re-ask the join for open items with the evidence the device has now (rule `resolve_answer@1`).

    New identifier proof (a reference build, another plugin's binding) settles an item: its binding is
    written with a recorded rules verdict. A changed question supersedes the item. Returns settled ids."""
    plugins = list(plugins)
    usable = {info.manifest.plugin: info for info in plugins if info.enabled and not info.missing}
    settled = []
    for row in items:
        try:
            if _settle_one(store, ref, usable.get(row["plugins"][0]), row, now=now, as_of=as_of, plugins=plugins):
                settled.append(row["id"])
        except (ValueError, KeyError, TypeError):  # one unreadable stored claim never stops the rest
            continue
    return settled


# ---- internals -----------------------------------------------------------------------------------------------------

class _Unbound(Exception):
    """The reference is firmly bound elsewhere after all: roll the rules verdict back."""


def _settle_one(store: IdentityStore, ref: sqlite3.Connection, info: PluginInfo | None, row: dict, *, now: str,
                as_of: str, plugins: list[PluginInfo]) -> bool:
    raw = _raw(store, row)
    if row["state"] != "open" or info is None or raw is None or len(row["candidate_ids"]) != 1:
        return False
    target = row["candidate_ids"][0]
    subject = device.load_subject(ref, store, target, plugins)  # a reference or a device subject
    if subject is None:
        return False
    record = _claim(raw)
    batch = ClaimBatch(plugin=record.provenance.plugin, provider=record.native_ref.provider,
                       adapter_version=record.provenance.adapter_version, origin="resolve", claims=(record,))
    level = subject_level(target)
    binding, item, _records = apply_resolve(batch, info, level, subject, resolve_input(info, subject), now=now,
                                            as_of=as_of, bound_to=store.bound_subject)
    if binding is not None:
        verdict = Verdict(item_id=row["id"], resolver="rules", authority="rule_confirmed", relation=SAME[level],
                          chosen_id=target, rule_id=RESOLVE_RULE,
                          provenance={"plugin": CORE, "source": CORE, "adapter_version": "1", "retrieved_at": now})
        try:
            with store.transaction():
                verdict_id = store.put_verdict(verdict, VerdictOutcome.CONFIRMED)
                if not (store.put_binding(binding, verdict_id=verdict_id) and store.settle(row["id"], "resolved", verdict_id)):
                    raise _Unbound
        except _Unbound:
            return False
        return True
    if item is not None and item.key != row["key"]:
        with store.transaction():
            if store.settle(row["id"], "superseded", None):
                store.put_queue_item(item)
                return True
    return False


_NAMED = "Refused: the record's own identifier names this instrument, so it cannot be dismissed."
_MESSAGES = {
    VerdictOutcome.CONFIRMED: "Confirmed: the record is bound to the chosen instrument.",
    VerdictOutcome.SUGGESTED: "Kept as a suggestion: nothing changes until the user confirms it in Repairs.",
    VerdictOutcome.BLOCKED: "Refused: identifier evidence or the depositary-receipt guard contradicts this answer.",
    VerdictOutcome.AMBIGUOUS: "Left open: the answers disagree or several candidates fit.",
    VerdictOutcome.NO_MATCH: "Recorded: the record is not this instrument.",
}
_BUILT = {  # answers to a reference build question
    VerdictOutcome.CONFIRMED: "Recorded: your answer applies on this device; the reference data is unchanged.",
    VerdictOutcome.NO_MATCH: "Recorded: none of these; the answer stays unknown.",
}


def _evidence(store: IdentityStore, ref: sqlite3.Connection, cited: list[str]) -> list[dict]:
    """The assertions an item cites, each with its source and the kind of evidence it is: the reference's, and what a
    plugin stated on the device, whose source is that plugin."""
    marks = ",".join("?" * len(cited))
    found = ref.execute(f"SELECT * FROM assertions WHERE evidence_id IN ({marks})", cited).fetchall() if cited else []
    stated = store.select(f"SELECT * FROM device_assertions WHERE evidence_id IN ({marks})", cited) if cited else []
    return [{key: row[key] for key in ("evidence_id", "subject_id", "scheme", "value", "source", "retrieved_at", "authority")}
            for row in found] + [{**{key: row[key] for key in ("evidence_id", "subject_id", "scheme", "value", "retrieved_at")},
                                  "source": row["plugin"], "authority": str(Authority.SOURCE_ASSERTED)} for row in stated]


def _raw(store: IdentityStore, item: dict) -> dict | None:
    return store.claim(item["plugins"][0], ProviderRef(**item["provider_ref"])) if item["provider_ref"] else None


def _claim(raw: dict) -> RecordClaim:
    return RecordClaim(**raw)


def _record(raw: dict) -> dict:
    attributes = raw.get("attributes") or {}
    return {"native_ref": raw.get("native_ref"), "level": raw.get("level"),
            "identifiers": raw.get("identifiers") or [],
            **{key: attributes.get(key) for key in ("name", "ticker", "mic", "currency", "kind")}}


def _describe(store: IdentityStore, ref: sqlite3.Connection, subject_id: str) -> dict:
    subject = device.load_subject(ref, store, subject_id)
    if subject is None:
        return {"id": subject_id, "level": subject_kind(subject_id), "known": False}
    view = subject["view"]
    identifiers = view["identifiers"]
    if subject["level"] is Level.ISSUER:  # a company's own identifiers, never those of a security it issued
        identifiers = {scheme: view["issuer"][scheme] for scheme in ("lei", "cik") if view["issuer"][scheme]}
    return {"id": subject_id, "level": str(subject["level"]), "known": True, "name": view["subject"]["name"],
            "kind": subject["kind"], "identifiers": identifiers}


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
