"""What disabling a plugin would take away, shown before it happens (ADR 0044 A3).

`identity-plugin-effect {plugin}` is a local read. It answers the device subjects only that plugin supplies, by search's
own rule: an offered record of no other enabled plugin is placed on them or states their identifiers, they are not
inactive, and no reference package holds them. While the plugin is off they leave search and keep only their label
(ADR 0037, amendment "device subjects"). It also answers the saved entries of
the markets overview (`markets_watchlist`, `markets_cards`) that name them, through their aliases, each as a count with
a short sample. Without `plugin`, it answers every enabled plugin that declares a bulk catalogue or a resolve, with its
trust level, as the Desk's Data sources settings list them. It calls no provider and writes nothing. A Desk operation:
the agent's tool list has no room for it (test_agent_surface.py's budget).
"""
from __future__ import annotations

import json
import logging
import sqlite3
from functools import partial
from typing import TYPE_CHECKING, Any

from .identity import CatalogueMode, device, location
from .identity.search_device import OFFERED
from .identity.trust import CONFIRM, DISPLAY

if TYPE_CHECKING:
    from .identity_ops import Identity

logger = logging.getLogger(__name__)
SAMPLE = 5
SCHEMA = {
    "name": "pythia_identity_plugin_effect",
    "description": "What disabling one plugin would take away: the subjects only it supplies and the saved watchlist "
                   "and card entries naming them, as counts with a short sample. Without plugin, every enabled plugin "
                   "that declares a catalogue or a resolve. Local only.",
    "parameters": {"type": "object", "properties": {"plugin": {"type": "string", "minLength": 1, "maxLength": 128}},
                   "additionalProperties": False},
}
# The device subjects each plugin supplies as search counts them (`search_device.additions`): a record of it still
# offered is placed on them, or states an identifier about them. A subject nobody offers any more is not supplied.
_SUPPLIED = ("WITH offered AS (SELECT subject_id, plugin FROM claims WHERE subject_id IS NOT NULL AND state IN (SELECT"
             " value FROM json_each(?1)) UNION SELECT a.subject_id, a.plugin FROM device_assertions a JOIN claims c ON"
             " c.plugin = a.plugin AND c.native_scope = a.native_scope AND c.native_id = a.native_id WHERE c.state IN"
             " (SELECT value FROM json_each(?1))) SELECT id, name FROM subjects WHERE status <> 'inactive' AND id IN"
             " (SELECT subject_id FROM offered WHERE plugin = ?2) AND id NOT IN (SELECT subject_id FROM offered WHERE"
             " plugin IN (SELECT value FROM json_each(?3))) ORDER BY name IS NULL, name, id")


def register(ctx: Any, identity: Identity) -> None:
    from .identity_ops import PLUGIN, TOOLSET
    from .platform.operations import declare_operation
    handler = partial(effect, identity)
    declare_operation(SCHEMA, plugin=PLUGIN, operation="identity-plugin-effect", handler=handler, read_only=True)
    ctx.register_tool(name=SCHEMA["name"], toolset=TOOLSET, schema=SCHEMA, handler=handler,
                      description=SCHEMA["description"])


def effect(identity: Identity, arguments: dict, **_context: Any) -> str:
    """identity-plugin-effect: one plugin's effect, or every enabled source plugin's."""
    from .identity_ops import _envelope, installed
    from .markets_ops import MarketReads
    plugins, wanted = installed(), arguments.get("plugin")
    chosen = [info for info in plugins if wanted in (info.key, info.manifest.plugin)] if wanted else [
        info for info in plugins if info.enabled and (info.manifest.catalogue is CatalogueMode.BULK
                                                      or info.manifest.resolve is not None)]
    if wanted and not chosen:
        return _envelope("empty", None, issue="Unknown plugin.")
    try:
        saved = MarketReads(identity).saved()
        _path, ref = identity.reference()
        try:
            found = [_effect(identity.store, ref, info, plugins, saved) for info in chosen]
        finally:
            if ref is not None:
                ref.close()
    except (sqlite3.Error, OSError) as error:  # a store that cannot be read says why, never "no effect"
        logger.warning("plugin effect unavailable", exc_info=True)
        return _envelope("empty", None, issue=f"The effect could not be read. {location.reason(error)}")
    return _envelope("ok", {"plugins": found})


def _effect(store, ref, info, plugins: list, saved: dict[str, list[str]]) -> dict[str, Any]:
    """One plugin's sole subjects and the saved entries that name them."""
    plugin = info.manifest.plugin
    others = sorted({item.manifest.plugin for item in plugins if item.enabled} - {plugin})
    sole = {row["id"]: row["name"] for row in store.select(_SUPPLIED, (OFFERED, plugin, json.dumps(others)))
            if ref is None or not device.in_reference(ref, row["id"])}
    named = [{"id": item, "name": sole[current], "setting": setting} for setting, items in saved.items()
             for item in items if (current := device.current_id(ref, store, item)) in sole]
    return {"plugin": info.key, "label": info.label, "enabled": info.enabled,
            "level": DISPLAY if info.manifest.unaudited else CONFIRM,
            "catalogue": info.manifest.catalogue is CatalogueMode.BULK, "resolve": info.manifest.resolve is not None,
            "sole": {"count": len(sole), "sample": [{"id": key, "name": sole[key]} for key in list(sole)[:SAMPLE]]},
            "saved": {"count": len(named), "sample": named[:SAMPLE]}}
