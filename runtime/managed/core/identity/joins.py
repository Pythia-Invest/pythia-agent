"""Which subjects a plugin record's identifiers name: the reads core's ingest joins by (ADR 0037, amendment "ingest").

An identifier names a subject the reference package asserts it for, one a confirm-level plugin states it for on the
device, or the subject it keys (`schemes.subject_id`) where the reference or the device holds that subject. A
display-level plugin's statement names nothing: it neither proves nor blocks. Reads only.
"""
from __future__ import annotations

import sqlite3
from typing import Mapping

from . import device
from .claims import RecordAttributes
from .schemes import Level, Scheme, subject_id, subject_kind
from .trust import CONFIRM

# The schemes each level joins by, in order: a listing's ISIN only with its operating MIC and currency (`lines`).
ORDER = {Level.LISTING: (Scheme.ISIN, Scheme.FIGI, Scheme.CAIP19),
         Level.SECURITY: (Scheme.ISIN, Scheme.SHARE_CLASS_FIGI, Scheme.CAIP19),
         Level.COMPOSITE: (Scheme.COMPOSITE_FIGI,), Level.ISSUER: (Scheme.LEI, Scheme.CIK)}


class Joins:
    def __init__(self, ref: sqlite3.Connection | None, store, granted: Mapping[str, str]):
        self.ref, self.store, self.granted = ref, store, granted

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
            " ORDER BY subject_id", (str(scheme), value)) if self.granted.get(row[1]) == CONFIRM]
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

    def venue_line(self, isin: str, figi: str | None, venue: str) -> list[str] | None:
        """For a line record that states no currency (OpenFIGI's): the ISIN's security's one active line on the
        record's exchange, when that line has no FIGI or the record's. None when there are several, or the one there
        has another FIGI: the record is then no line core may add. Empty when the exchange has none."""
        securities = self.holders(Scheme.ISIN, isin, Level.SECURITY)
        if len(securities) != 1:
            return []
        found = [row[0] for row in self.ref.execute(
            "SELECT id FROM listings WHERE security_id = ? AND coalesce(operating_mic, mic) = ? AND status <> 'inactive'"
            " ORDER BY id", (securities[0], venue))] if self.ref else []
        found += [row[0] for row in self.store.select(
            "SELECT id FROM subjects WHERE parent_id = ? AND kind = 'listing' AND status <> 'inactive' AND"
            " json_extract(attributes, '$.operating_mic') = ? ORDER BY id", (securities[0], venue))]
        found = list(dict.fromkeys(device.current_id(self.ref, self.store, item) for item in found))
        if not found:
            return []
        stated = self.figis(found[0])
        return None if len(found) > 1 or (stated and figi not in stated) else found

    def figis(self, line: str) -> set[str]:
        """The FIGIs the package or a confirm-level plugin states for a line."""
        found = {row[0] for row in self.ref.execute("SELECT value FROM assertions WHERE subject_id = ? AND"
                                                    " scheme = 'figi'", (line,))} if self.ref else set()
        return found | {row[0] for row in self.store.select(
            "SELECT value, plugin FROM device_assertions WHERE subject_id = ? AND scheme = 'figi' AND role = 'self'",
            (line,)) if self.granted.get(row[1]) == CONFIRM}

    def held(self, subject: str) -> bool:
        return bool(self.ref is not None and device.in_reference(self.ref, subject)) or \
            device.subject_row(self.store, subject) is not None
