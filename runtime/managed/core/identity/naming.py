"""A device subject's display name, chosen by a rule that arrival never changes (ADR 0044 A1: plugins extend the
universe on equal terms, so what a subject is called must not depend on which plugin synced first).

Every enabled plugin's record placed on a subject (joined or introduced) may name it. The name shown is the one from
the plugin first in the investor's `source_order` (`concepts.ranked`, the order core already ranks sources by), then
by plugin id, then by the record's native reference. `subjects.introduced_by` stays history: it is whoever arrived
first, and the name no longer follows it. Standard library only.
"""
from __future__ import annotations

from typing import Callable, Iterable

from .concepts import ranked

NAME_LENGTH = 512  # as a subject's label (`device.put_subject`)


def display_name(store, subject: str, plugins: Iterable, order: tuple[str, ...], counts: Callable[[str], bool]) -> str | None:
    """The name the records placed on a device subject give it, in the investor's source order (`order`: plugin keys or
    provider names, as `Identity.order` gives them); `counts` says which plugins' statements count. None where no
    counting record names it, so the subject keeps the label it has."""
    keys = {info.manifest.plugin: info.key for info in plugins}
    entries = [{"plugin": keys.get(plugin, plugin), "provider": provider, "name": name}
               for plugin, provider, name in store.select(
                   "SELECT plugin, provider, name FROM claims WHERE subject_id = ? AND state IN ('joined', 'introduced')"
                   " AND name IS NOT NULL AND name <> '' ORDER BY native_scope, native_id", (subject,)) if counts(plugin)]
    return ranked(entries, order, ())[0]["name"][:NAME_LENGTH] if entries else None
