"""The reference build's own questions (its package's `claims` file) on the resolution queue: added only for a
subject the investor opens or watches or the agent asks about, never in bulk, and retired with their release."""
from __future__ import annotations

import hashlib
import json
from dataclasses import replace
from typing import Iterable

from .queue import BUILD
from .resolution import QueueItem
from .store import IdentityStore


def import_build(store: IdentityStore, items: Iterable[dict], now: str) -> int:
    """Put reference-build questions (the installed package's `claims`) on the queue, each once: never all of them,
    only those about a subject the investor opens or watches, or the agent asks about (`Identity.surface`). One
    already open or answered is not asked again. Returns how many were added."""
    known = {key for key, in store.db.execute("SELECT key FROM queue WHERE plugins = ? AND state <> 'superseded'",
                                              (json.dumps([BUILD]),))}
    added = 0
    with store.transaction():
        for raw in items:
            try:
                item = QueueItem(id="", kind=raw["kind"], reason=raw["reason"], subject_ids=raw["subject_ids"],
                                 candidate_ids=raw.get("candidate_ids") or (), evidence_ids=raw.get("evidence_ids") or (),
                                 state="open", opened_at=now, plugins=(BUILD,), scheme=raw.get("scheme"),
                                 values=raw.get("values") or ())
            except (KeyError, TypeError, ValueError):  # one malformed question never stops the rest
                continue
            if item.key in known:
                continue
            known.add(item.key)
            store.put_queue_item(replace(item, id="ref-" + hashlib.sha256(f"{item.key}|{now}".encode()).hexdigest()[:28]))
            added += 1
    return added


def retire_build(store: IdentityStore, now: str) -> int:
    """A new release asks its own questions: the previous build's open ones are superseded (answers are kept)."""
    with store.transaction():
        store.db.execute("UPDATE queue SET state = 'superseded', updated_at = ? WHERE plugins = ? AND state = 'open'",
                         (now, json.dumps([BUILD])))
        return store.db.execute("SELECT changes()").fetchone()[0]
