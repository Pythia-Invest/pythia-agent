"""Which subjects a plugin record's identifiers name: the reads core's ingest joins by (ADR 0037, amendment "ingest").

An identifier names a subject the reference package asserts it for, one an enabled plugin (or the ingesting plugin
itself) states it for on the device, or the subject it keys (`schemes.subject_id`) where the reference or the device
holds that subject. A disabled plugin's statement names nothing: it neither proves nor blocks. A device subject's
parent is the one its counting records name and agree on (`settled_parent`). Reads only.
"""
from __future__ import annotations

import json
import sqlite3
from typing import Any, Iterable, Mapping

from . import device
from .claims import IdentifierValue, RecordAttributes, RecordClaim
from .model import ProviderRef
from .schemes import OPEN_KIND, SCHEME_LEVEL, Kind, Level, Scheme, subject_id, subject_kind
from .vocabulary import IdentifierRole

# The schemes each level joins by, in order: a listing's ISIN only with its operating MIC and currency (`lines`).
ORDER = {Level.LISTING: (Scheme.ISIN, Scheme.FIGI, Scheme.CAIP19),
         Level.SECURITY: (Scheme.ISIN, Scheme.SHARE_CLASS_FIGI, Scheme.CAIP19),
         Level.COMPOSITE: (Scheme.COMPOSITE_FIGI,), Level.ISSUER: (Scheme.LEI, Scheme.CIK)}


class Joins:
    def __init__(self, ref: sqlite3.Connection | None, store, active: frozenset[str], plugin: str = "",
                 plugins: Iterable = ()):
        self.ref, self.store, self.active, self.plugin, self.plugins = ref, store, active, plugin, list(plugins)

    def counts(self, plugin: str) -> bool:
        """Whether a plugin's device statements name subjects in this join: an enabled one's, or its own."""
        return plugin in self.active or plugin == self.plugin

    def candidates(self, level: Level, own: Mapping[Scheme, str], attributes: RecordAttributes) -> list[str]:
        """The subjects at `level` a record's own identifiers name, in join order."""
        found: list[str] = []
        for scheme in ORDER[level]:
            if scheme in own:
                found += self.lines(own[scheme], attributes) if (level, scheme) == (Level.LISTING, Scheme.ISIN) \
                    else self.holders(scheme, own[scheme], level)
        return list(dict.fromkeys(found))

    def holders(self, scheme: Scheme, value: str, level: Level | Kind, *, settled: bool = False) -> list[str]:
        """The subjects at `level` an identifier names; `settled` leaves out what a record placed as a `conflict`
        states, which contests the subject it sits beside and names no other. An open identifier of a kind outside the
        hierarchy names the subject it keys, where one is held."""
        if scheme in OPEN_KIND:
            key = f"{OPEN_KIND[scheme]}:{scheme}:{value}"
            return [device.current_id(self.ref, self.store, key)] if self.held(key) else []
        found = [row[0] for row in self.ref.execute("SELECT subject_id FROM assertions WHERE scheme = ? AND value = ?"
                                                    " ORDER BY subject_id", (str(scheme), value))] if self.ref else []
        found += [row[0] for row in self.store.select(
            "SELECT subject_id, plugin FROM device_assertions a WHERE scheme = ? AND value = ? AND role = 'self' AND NOT"
            " (? AND EXISTS (SELECT 1 FROM claims c WHERE c.plugin = a.plugin AND c.native_scope = a.native_scope AND"
            " c.native_id = a.native_id AND c.state = 'conflict')) ORDER BY subject_id",
            (str(scheme), value, settled)) if self.counts(row[1])]
        key = subject_id(level, {scheme: value})
        found += [key] if key and self.held(key) else []
        current = (device.current_id(self.ref, self.store, item) for item in found)
        return list(dict.fromkeys(item for item in current if subject_kind(item) == level))

    def declared(self, native: ProviderRef, manifest) -> str | None:
        """The subject the plugin's contract addresses by this reference (`addressing.subjects`)."""
        return next((subject for subject, item in manifest.subjects.items()
                     if (item.native_scope, item.native_id) == (native.native_scope, native.native_id)), None)

    def end(self, key: IdentifierValue | ProviderRef, manifest) -> str | None:
        """The subject a relation end names: the one its plugin's record was placed on (or the contract addresses by
        that reference), or the one subject a global identifier names."""
        if isinstance(key, ProviderRef):
            rows = self.store.select("SELECT subject_id FROM claims WHERE plugin = ? AND native_scope = ? AND native_id = ?"
                                     " AND state IN ('joined', 'introduced')", (manifest.plugin, key.native_scope, key.native_id))
            found = rows[0][0] if rows else self.declared(key, manifest)
            return device.current_id(self.ref, self.store, found) if found else None
        named = self.holders(key.scheme, key.value, key.level, settled=True)
        return named[0] if len(named) == 1 else None

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
        then no line core may add. Empty when the exchange has none. A device line counts only if an enabled
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
        """The one parent a record's identifiers at the parent's scope name, whose evidence agrees with them; and
        whether they name two, or one that disagrees (a contest)."""
        found = self.candidates(up, own, attributes) if own else []
        if len(found) == 1 and not self.disagrees(found[0], own):
            return found[0], False
        return None, bool(found)

    def disagrees(self, subject: str, own: Mapping[Scheme, str]) -> bool:
        """Whether evidence about a subject states another value of one of these identifiers."""
        evidence = (device.load_subject(self.ref, self.store, subject, self.plugins) or {"evidence": []})["evidence"]
        stated: dict[str, set[str]] = {}
        for item in evidence:
            if item.subject_id == subject:
                stated.setdefault(str(item.scheme), set()).add(item.value)
        return any(value not in stated[str(scheme)] for scheme, value in own.items() if str(scheme) in stated)

    def settled_parent(self, subject: str) -> str | None:
        """A device subject's parent from the records placed on it: the one the counting records that name a parent
        agree on; none where they disagree, and the parent it has where none names one (a record that leaves an
        identifier out moves nothing). A record kept as a conflict whose own earlier statement named the current
        parent (a conflict keeps it) still names that parent, so a source contradicting itself never re-parents the
        subject, sync after sync, until it states the parent's value again."""
        up = device.PARENT[Level(subject_kind(subject))]
        current = (device.subject_row(self.store, subject) or {}).get("parent_id")
        named: set[str] = set()
        for plugin, scope, text, state, native_scope, native_id in self.store.select(
                "SELECT plugin, scope, claim, state, native_scope, native_id FROM claims WHERE subject_id = ? AND state"
                " IN ('joined', 'introduced', 'conflict')", (subject,)):
            if not self.counts(plugin):
                continue
            claim = RecordClaim(**json.loads(text))
            echoes = self._echoes(plugin) if scope is None else ()
            own = {item.scheme: item.value for item in claim.identifiers if item.role is IdentifierRole.SELF
                   and SCHEME_LEVEL[item.scheme] is up and item.scheme not in echoes}
            parent, contested = self.parent(up, own, claim.attributes)
            if state == "conflict" and current and parent != current and self.store.select(
                    "SELECT 1 FROM device_assertions WHERE subject_id = ? AND plugin = ? AND native_scope = ? AND"
                    " native_id = ? LIMIT 1", (current, plugin, native_scope, native_id)):
                parent, contested = current, False  # it contradicts its own earlier statement, kept on the parent
            if parent or contested:
                named.add("" if contested else parent)  # "": a contest
        if not named:
            return current
        return next(iter(named)) if len(named) == 1 and "" not in named else None

    def _echoes(self, plugin: str) -> Any:
        """The schemes a plugin's resolve answers only echo (a stored record with no catalogue scope is an answer)."""
        manifest = next((info.manifest for info in self.plugins if info.manifest.plugin == plugin), None)
        return manifest.resolve.echoes if manifest is not None and manifest.resolve else ()

    def held(self, subject: str) -> bool:
        return bool(self.ref is not None and device.in_reference(self.ref, subject)) or \
            device.subject_row(self.store, subject) is not None
