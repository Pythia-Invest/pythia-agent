"""Resolution-queue operations on the native tool registry (ADR 0037).

`identity-queue` is a local read of open, agent-answered and settled questions.
`identity-verdict` records one answer to a question: from the Desk it is the
user's attestation, from a model tool call the agent's verdict; the transport
decides which, never an argument. `settle` lets the rules resolver re-ask the
join inside write operations, never on search or page reads.
"""
from __future__ import annotations

import logging
import sqlite3
from datetime import date
from typing import TYPE_CHECKING, Any

from .identity import queue as questions
from .identity import reference_package, schemes, store

if TYPE_CHECKING:
    from .identity_ops import Identity

logger = logging.getLogger(__name__)
RELEASE = "reference_release"  # identity.sqlite3 metadata: the reference build the rules last settled against
NO_REFERENCE = "No reference data on this device yet."
# Any well-formed subject ID, of any kind: a residual may name an `index:` or `fx:` subject.
SUBJECT_ID = {"type": "string", "minLength": 5, "maxLength": 370, "pattern": schemes.SUBJECT_ID.pattern.replace(r"\Z", "$")}

QUEUE_SCHEMA = {
    "name": "pythia_identity_queue",
    "description": "List open identity questions: provider records the device could not place on a subject "
                   "(residuals) and records that contradict the reference identifiers (conflicts). Filter by "
                   "subject, plugin or kind. On an open question, agent_answer is the agent's suggestion awaiting "
                   "the user. With answered, also lists questions only the agent answered: they route "
                   "provisionally until the user confirms or overrides them. With settled, also lists questions "
                   "rules or the user settled. With item_id, returns one question in full: its record, "
                   "candidates, evidence and earlier verdicts. Local only.",
    "parameters": {"type": "object", "properties": {
        "item_id": {"type": "string", "minLength": 1, "maxLength": 64},
        "subject_id": SUBJECT_ID,
        "plugin": {"type": "string", "minLength": 1, "maxLength": 128},
        "kind": {"type": "string", "enum": ["residual", "conflict"]},
        "answered": {"type": "boolean"},
        "settled": {"type": "boolean"},
        "limit": {"type": "integer", "minimum": 1, "maximum": 50}},
        "additionalProperties": False},
}
VERDICT_SCHEMA = {
    "name": "pythia_identity_verdict",
    "description": "Answer one open identity question after reading it in full. A match names the relation and one of "
                   "the question's candidates; 'unrelated' says the record is a different instrument than that "
                   "candidate; 'none' that it is none of them; 'ambiguous' leaves the question open. Core applies the "
                   "identity authority rule: a match that contradicts identifier evidence, or a 'not a match' that the "
                   "record's own identifiers disprove, is refused. An accepted answer takes effect provisionally: a "
                   "match routes the record to the subject until the user or identifier evidence overrides it. "
                   "Accepted and refused answers are recorded.",
    "parameters": {"type": "object", "properties": {
        "item_id": {"type": "string", "minLength": 1, "maxLength": 64},
        "relation": {"type": "string", "enum": ["same_listing", "same_composite", "same_security", "same_issuer",
                                                "depositary_receipt_of", "unrelated", "none", "ambiguous"]},
        "chosen_id": SUBJECT_ID,
        "rationale": {"type": "string", "maxLength": 400}},
        "required": ["item_id", "relation"], "additionalProperties": False},
}


def read_queue(identity: Identity, arguments: dict, **_context: Any) -> str:
    """identity-queue: open questions (and on request answered and settled ones), or one in full."""
    from .identity_ops import _envelope, installed
    limit = arguments.get("limit") if isinstance(arguments.get("limit"), int) else 20
    try:
        _path, ref = identity.reference()
        if ref is None:
            return _envelope("empty", None, issue=NO_REFERENCE)
        try:
            if arguments.get("item_id"):
                view = questions.inspect(identity.store, ref, str(arguments["item_id"]))
                return _envelope("ok", view) if view else _envelope("empty", None, issue="Unknown queue item.")
            plugin = arguments.get("plugin")
            data = questions.listing(identity.store, ref, subject_id=arguments.get("subject_id"), kind=arguments.get("kind"),
                                 plugins={plugin, *(info.manifest.plugin for info in installed() if info.key == plugin)}
                                 if plugin else None, limit=limit, notice=not identity.reset_told,
                                 **{name: arguments.get(name) is True for name in ("answered", "settled")})
            identity.reset_told = identity.reset_told or "notice" in data
        finally:
            ref.close()
    except (sqlite3.Error, OSError):
        logger.warning("identity queue unavailable", exc_info=True)
        return _envelope("empty", None, issue="The identity store could not be read.")
    found = any(data.get(name) for name in ("items", "answered", "settled", "notice"))
    return _envelope("ok" if found else "empty", data)

def submit_verdict(identity: Identity, arguments: dict, **_context: Any) -> str:
    """identity-verdict: one answer, attributed to the user or the agent by the transport."""
    from .identity_ops import _envelope, installed
    from .platform.request_context import usage
    desk = usage.get() == "dashboard"  # trusted transport scope: the Desk's own HTTP call, never a model tool call
    now = store.now()
    settle(identity, [])
    path, ref = identity.reference()
    if ref is None:
        return _envelope("empty", None, issue=NO_REFERENCE)
    try:
        result = questions.submit(
            identity.store, ref, item_id=str(arguments.get("item_id") or ""), relation=arguments.get("relation"),
            chosen_id=arguments.get("chosen_id"), now=now, as_of=date.today().isoformat(),
            resolver=questions.ResolverKind.USER if desk else questions.ResolverKind.AGENT,
            rationale=arguments.get("rationale"),
            user_turn=f"desk:identity-verdict:{now}" if desk else None,
            unaudited={info.manifest.plugin for info in installed() if info.manifest.unaudited})
    except questions.Refused as refused:
        result = {"outcome": "refused", "message": str(refused)}
    except (sqlite3.Error, OSError):
        logger.warning("identity verdict not recorded", exc_info=True)
        return _envelope("empty", None, issue="The identity store could not be written.")
    finally:
        ref.close()
    return _envelope("ok", result)


def settle(identity: Identity, subject_ids: list[str]) -> None:
    """Rules settle what current evidence decides: after a resolve, the subject's open items; once after the
    reference build changed, every open item. Runs only inside write operations, never on search or page reads."""
    from .identity_ops import installed
    path, ref = identity.reference()
    if ref is None:
        return
    try:
        identity_store = identity.store
        release = reference_package.release_key(path)  # the installed package: a same-day rebuild is new too
        fresh = identity_store.metadata(RELEASE) != release
        items = identity_store.queue_items(subject_ids=None if fresh else subject_ids)
        if items:
            questions.settle_by_rules(identity_store, ref, installed(), items, now=store.now(),
                                  as_of=date.today().isoformat())
        if fresh:
            identity_store.set_metadata(RELEASE, release)
    except (sqlite3.Error, OSError, ValueError):
        logger.warning("rules could not settle the identity queue", exc_info=True)
    finally:
        ref.close()
