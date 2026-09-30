"""The investor's corrections to the catalogue on the native tool registry (ADR 0044, amendment "user catalogue
corrections").

`identity-correction` records one: from the Desk it is the investor's own and applies at once; from a model tool call
it is the agent's proposal, which applies to nothing until the investor confirms it in Repairs. The transport decides
which, never an argument, as for verdicts. Confirming, declining and undoing are the Desk's alone. `identity-corrections`
lists them for Repairs, with the names it shows. A write bumps the store's generation, so search and pages renew.
"""
from __future__ import annotations

import logging
import sqlite3
from functools import partial
from typing import TYPE_CHECKING, Any

from .identity import corrections, device, queue, store
from .queue_ops import SUBJECT_ID

if TYPE_CHECKING:
    from .identity_ops import Identity

logger = logging.getLogger(__name__)
SET, CONFIRM, DECLINE, UNDO = "set", "confirm", "decline", "undo"
DONE = {CONFIRM: ("confirmed", "Confirmed: the correction applies on this device until you undo it."),
        DECLINE: ("declined", "Declined: the proposal stays in the history and changes nothing."),
        UNDO: ("undone", "Undone: the data reads as it did before.")}

CORRECTION_SCHEMA = {
    "name": "pythia_identity_correction",
    "description": "Correct the catalogue for one subject: set or remove one of its identifiers, or pin the source that "
                   "prices it. From the Desk the investor's correction applies at once; from a model it is a proposal "
                   "that applies to nothing until the investor confirms it in Repairs. Confirm, decline and undo are "
                   "the Desk's alone.",
    "parameters": {"type": "object", "properties": {
        "action": {"type": "string", "enum": [SET, CONFIRM, DECLINE, UNDO]},
        "kind": {"type": "string", "enum": list(corrections.KINDS)},
        "subject_id": SUBJECT_ID,
        "scheme": {"type": "string", "maxLength": 32},
        "value": {"type": "string", "maxLength": 256},
        "id": {"type": "string", "minLength": 1, "maxLength": 64},
        "note": {"type": "string", "maxLength": 400}},
        "additionalProperties": False},
}
LIST_SCHEMA = {
    "name": "pythia_identity_corrections",
    "description": "List the investor's corrections and the agent's proposals, proposed, active and undone, newest "
                   "first, with each subject's name. Local only.",
    "parameters": {"type": "object", "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 50}},
                   "additionalProperties": False},
}


def submit(identity: Identity, arguments: dict, **_context: Any) -> str:
    """identity-correction: one write, attributed to the investor or the agent by the transport."""
    from .identity_ops import _envelope
    from .platform.request_context import usage
    desk = usage.get() == "dashboard"  # trusted transport scope: the Desk's own HTTP call, never a model tool call
    action, now = arguments.get("action") or SET, store.now()
    try:
        if action == SET:
            result = _set(identity, arguments, now, f"desk:identity-correction:{now}" if desk else None)
        elif desk:
            result = _decide(identity, action, str(arguments.get("id") or ""), arguments.get("note"), now)
        else:
            raise corrections.Refused("Only the investor confirms, declines or undoes a correction, in Desk.")
    except corrections.Refused as refused:
        result = {"outcome": "refused", "message": str(refused)}
    except (sqlite3.Error, OSError):
        logger.warning("identity correction not recorded", exc_info=True)
        return _envelope("empty", None, issue="The identity store could not be written.")
    return _envelope("ok", result)


def read(identity: Identity, arguments: dict, **_context: Any) -> str:
    """identity-corrections: the corrections of every state, newest first, each with its subject's name and, for a pin,
    the source's label."""
    from .identity_ops import _envelope, installed
    limit = arguments.get("limit") if isinstance(arguments.get("limit"), int) else 50
    try:
        _path, ref = identity.reference()
        try:
            labels = queue.names(installed())
            found = corrections.rows(identity.store, states=("proposed", "active", "undone"))[:max(1, min(50, limit))]
            items = [{**{key: row[key] for key in ("id", "kind", "subject_id", "scheme", "value", "state", "proposed_by",
                                                   "note", "created_at", "decided_at", "ended_at")},
                      "name": device._name(ref, identity.store, row["subject_id"]),
                      "label": labels.get(row["value"], row["value"]) if row["kind"] == "price_source" else None}
                     for row in found]
        finally:
            if ref is not None:
                ref.close()
    except (sqlite3.Error, OSError):
        logger.warning("identity corrections unavailable", exc_info=True)
        return _envelope("empty", None, issue="The identity store could not be read.")
    return _envelope("ok", {"items": items})


def register(ctx: Any, identity: Identity) -> None:
    """The Desk's two operations on core's hidden toolset (the agent proposes through `agent_tools`)."""
    from .identity_ops import PLUGIN, TOOLSET
    from .platform.operations import declare_operation
    for schema, handler, operation, read_only in (
            (CORRECTION_SCHEMA, partial(submit, identity), "identity-correction", False),
            (LIST_SCHEMA, partial(read, identity), "identity-corrections", True)):
        declare_operation(schema, plugin=PLUGIN, operation=operation, handler=handler, read_only=read_only)
        ctx.register_tool(name=schema["name"], toolset=TOOLSET, schema=schema, handler=handler,
                          description=schema["description"])


def _set(identity: Identity, arguments: dict, now: str, turn: str | None) -> dict:
    """Validate and write one correction: the investor's (`turn`) or, without one, the agent's proposal."""
    from .identity_ops import installed
    _path, ref = identity.reference()
    try:
        row = corrections.validate(identity.store, ref, installed(), kind=arguments.get("kind"),
                                   subject_id=arguments.get("subject_id"), scheme=arguments.get("scheme"),
                                   value=arguments.get("value"))
    finally:
        if ref is not None:
            ref.close()
    made = corrections.put(identity.store, row, now=now, user_turn=turn, note=arguments.get("note"))
    return {"outcome": "set" if turn else "proposed", "id": made, **({"warning": row["warning"]} if "warning" in row else {}),
            "message": "Saved: your correction applies on this device until you undo it." if turn else
            "Proposed: nothing changes until the investor confirms it in Repairs."}


def _decide(identity: Identity, action: str, target: str, note: Any, now: str) -> dict:
    """The investor confirms or declines a proposal, or undoes a correction that applies."""
    turn = f"desk:identity-correction:{now}"
    if action == CONFIRM:
        done = corrections.confirm(identity.store, target, now=now, user_turn=turn, note=note)
    else:
        done = corrections.end(identity.store, target, expect="proposed" if action == DECLINE else "active", now=now,
                               user_turn=turn)
    if not done:
        raise corrections.Refused("That correction is not in a state that allows this.")
    outcome, message = DONE[action]
    return {"outcome": outcome, "id": target, "message": message}
