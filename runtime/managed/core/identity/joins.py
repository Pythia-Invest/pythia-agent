"""Which subjects a plugin record's identifiers name: the reads core's ingest joins by (ADR 0037, amendment "ingest").

An identifier names a subject the reference package asserts it for, one a confirm-level plugin (or the ingesting plugin
itself) states it for on the device, or the subject it keys (`schemes.subject_id`) where the reference or the device
holds that subject. Another display-level plugin's statement names nothing: it neither proves nor blocks. A device
subject's parent is the one its records name at the highest trust level among them (`settled_parent`). Reads only.
"""
from __future__ import annotations

import json
import sqlite3
from typing import Any, Iterable, Mapping

from . import device
from .claims import RecordAttributes, RecordClaim
from .schemes import SCHEME_LEVEL, Level, Scheme, subject_id, subject_kind
from .trust import CONFIRM, DISPLAY
from .vocabulary import IdentifierRole

# The schemes each level joins by, in order: a listing's ISIN only with its operating MIC and currency (`lines`).
ORDER = {Level.LISTING: (Scheme.ISIN, Scheme.FIGI, Scheme.CAIP19),
         Level.SECURITY: (Scheme.ISIN, Scheme.SHARE_CLASS_FIGI, Scheme.CAIP19),
         Level.COMPOSITE: (Scheme.COMPOSITE_FIGI,), Level.ISSUER: (Scheme.LEI, Scheme.CIK)}


class Joins:
    def __init__(self, ref: sqlite3.Connection | None, store, granted: Mapping[str, str], plugin: str = "",
                 plugins: Iterable = ()):
        self.ref, self.store, self.granted, self.plugin, self.plugins = ref, store, granted, plugin, list(plugins)

    def counts(self, plugin: str) -> bool:
        """Whether a plugin's device statements name subjects in this join: a confirm-level one's, or its own."""
        return self.granted.get(plugin) == CONFIRM or plugin == self.plugin

    def candidates(self, level: Level, own: Mapping[Scheme, str], attributes: RecordAttributes) -> list[str]:
        """The subjects at `level` a record's own identifiers name, in join order."""
        found: list[str] = []
        for scheme in ORDER[level]:
            if scheme in own:
                found += self.lines(own[scheme], attributes) if (level, scheme) == (Level.LISTING, Scheme.ISIN) \
                    else self.holders(scheme, own[scheme], level)
        return list(dict.fromkeys(found))

    def holders(self, scheme: Scheme, value: str, level: Level) -> list[str]:
        """The subjects at `level` an identifier names."""
        found = [row[0] for row in self.ref.execute("SELECT subject_id FROM assertions WHERE scheme = ? AND value = ?"
                                                    " ORDER BY subject_id", (str(scheme), value))] if self.ref else []
        found += [row[0] for row in self.store.select(
            "SELECT subject_id, plugin FROM device_assertions WHERE scheme = ? AND value = ? AND role = 'self'"
            " ORDER BY subject_id", (str(scheme), value)) if self.counts(row[1])]
        key = subject_id(level, {scheme: value})
        found += [key] if key and self.held(key) else []
        current = (device.current_id(self.ref, self.store, item) for item in found)
        return list(dict.fromkeys(item for item in current if subject_kind(item) == level))

    def lines(self, isin: str, attributes: RecordAttributes) -> list[str]:
        """The lines an ISIN names at the record's operating MIC and currency."""
        venue, currency = attributes.operating_mic, attributes.currency
        if not (venue and currency):
            return []
        key = subject_id(Level.LISTING, {Scheme.ISIN: isin}, operating_mic=venue, currency=currency)
        found = [key] if key and self.held(key) else []
        if self.ref is not None:  # a line keyed otherwise (a US line by its FIGI)
            found += [row[0] for row in self.ref.execute(
                "SELECT l.id FROM listings l JOIN assertions a ON a.subject_id = l.security_id AND a.scheme = 'isin'"
                " WHERE a.value = ? AND coalesce(l.operating_mic, l.mic) = ? AND l.trading_currency = ? ORDER BY l.id",
                (isin, venue, currency))]
        return [device.current_id(self.ref, self.store, item) for item in found]

    def venue_line(self, isin: str, figi: str | None, ticker: str | None, venue: str) -> list[str] | None:
        """For a line record that states no currency (OpenFIGI's): the ISIN's security's one active line on the
        record's exchange, when that line has no FIGI or the record's, and no ticker or the record's. None when there
        are several, or the one there has another FIGI or ticker, or the ISIN names several securities: the record is
        then no line core may add. Empty when the exchange has none. A device line counts only if a confirm-level
        plugin (or this one) introduced it."""
        securities = self.holders(Scheme.ISIN, isin, Level.SECURITY)
        if len(securities) != 1:
            return None if securities else []
        found = [tuple(row) for row in self.ref.execute(
            "SELECT id, ticker FROM listings WHERE security_id = ? AND coalesce(operating_mic, mic) = ? AND"
            " status <> 'inactive' ORDER BY id", (securities[0], venue))] if self.ref else []
        found += [(row[0], row[1]) for row in self.store.select(
            "SELECT id, json_extract(attributes, '$.ticker'), introduced_by FROM subjects WHERE parent_id = ? AND"
            " kind = 'listing' AND status <> 'inactive' AND json_extract(attributes, '$.operating_mic') = ? ORDER BY id",
            (securities[0], venue)) if self.counts(row[2])]
        lines = dict((device.current_id(self.ref, self.store, line), stated) for line, stated in found)
        if not lines:
            return []
        [(line, stated)] = list(lines.items())[:1]
        figis = self.figis(line)
        if len(lines) > 1 or (figis and figi not in figis) or (stated and ticker and stated != ticker):
            return None
        return [line]

    def figis(self, line: str) -> set[str]:
        """The FIGIs the package or a plugin that counts states for a line."""
        found = {row[0] for row in self.ref.execute("SELECT value FROM assertions WHERE subject_id = ? AND"
                                                    " scheme = 'figi'", (line,))} if self.ref else set()
        return found | {row[0] for row in self.store.select(
            "SELECT value, plugin FROM device_assertions WHERE subject_id = ? AND scheme = 'figi' AND role = 'self'",
            (line,)) if self.counts(row[1])}

    def parent(self, up: Level, own: Mapping[Scheme, str], attributes: RecordAttributes) -> tuple[str | None, bool]:
        """The one parent a record's identifiers at the parent's scope name, whose confirm-level evidence agrees with
        them; and whether they name two, or one that disagrees (a contest)."""
        found = self.candidates(up, own, attributes) if own else []
        if len(found) == 1 and not self.disagrees(found[0], own):
            return found[0], False
        return None, bool(found)

    def disagrees(self, subject: str, own: Mapping[Scheme, str]) -> bool:
        """Whether confirm-level evidence about a subject states another value of one of these identifiers."""
        evidence = (device.load_subject(self.ref, self.store, subject, self.plugins) or {"evidence": []})["evidence"]
        stated: dict[str, set[str]] = {}
        for item in evidence:
            if item.subject_id == subject:
                stated.setdefault(str(item.scheme), set()).add(item.value)
        return any(value not in stated[str(scheme)] for scheme, value in own.items() if str(scheme) in stated)

    def settled_parent(self, subject: str, introducer: str) -> str | None:
        """A device subject's parent from the records placed on it: the one those at the highest trust level among the
        ones naming a parent agree on, never counting a level below its introducer's; none where they disagree. A
        record kept as a conflict that now names another parent than the one its own earlier statement named (which
        keeps that statement) contests it, so a source contradicting itself never re-parents the subject."""
        up, floor = device.PARENT[Level(subject_kind(subject))], self.granted.get(introducer, DISPLAY)
        current = (device.subject_row(self.store, subject) or {}).get("parent_id")
        named: dict[str, set[str]] = {}
        for plugin, scope, text, state, native_scope, native_id in self.store.select(
                "SELECT plugin, scope, claim, state, native_scope, native_id FROM claims WHERE subject_id = ? AND state"
                " IN ('joined', 'introduced', 'conflict')", (subject,)):
            level = self.granted.get(plugin, DISPLAY)
            if floor == CONFIRM and level != CONFIRM:
                continue
            claim = RecordClaim(**json.loads(text))
            echoes = self._echoes(plugin) if scope is None else ()
            own = {item.scheme: item.value for item in claim.identifiers if item.role is IdentifierRole.SELF
                   and SCHEME_LEVEL[item.scheme] is up and item.scheme not in echoes}
            parent, contested = self.parent(up, own, claim.attributes)
            contested = contested or bool(state == "conflict" and parent != current and self.store.select(
                "SELECT 1 FROM device_assertions WHERE subject_id = ? AND plugin = ? AND native_scope = ? AND"
                " native_id = ? LIMIT 1", (current, plugin, native_scope, native_id)))
            if parent or contested:
                named.setdefault(level, set()).add("" if contested else parent)  # "": a contest
        top = named.get(CONFIRM) or named.get(DISPLAY) or set()
        return next(iter(top)) if len(top) == 1 and "" not in top else None

    def _echoes(self, plugin: str) -> Any:
        """The schemes a plugin's resolve answers only echo (a stored record with no catalogue scope is an answer)."""
        manifest = next((info.manifest for info in self.plugins if info.manifest.plugin == plugin), None)
        return manifest.resolve.echoes if manifest is not None and manifest.resolve else ()

    def held(self, subject: str) -> bool:
        return bool(self.ref is not None and device.in_reference(self.ref, subject)) or \
            device.subject_row(self.store, subject) is not None
