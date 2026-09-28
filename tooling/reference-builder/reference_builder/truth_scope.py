"""What a reference build claims to cover (its venues, US lines, home lines, FIRDS populations, crypto kinds),
read from the build itself, so the truth-set audit scores only what the build could contain."""

from __future__ import annotations

import json
import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from .rules import HOME

US_MICS = frozenset({"XNAS", "XNYS", "XCBO", "OTCM"})
HOME_MICS = frozenset({"XLON", "XSWX", "XTSE", "XASX", "XSES", "XTAE", "XJPX", "XTKS", "XHKG", "XJSE", "XTAI"})
HOME_COUNTRIES = frozenset(HOME) - {"US"}  # an ISIN from elsewhere (KY, BM, JE) may have its home on any of them
EEA = frozenset("AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO".split())


@dataclass
class Scope:
    """What a reference build claims to cover, read from the build itself."""

    us: bool = False
    eea: bool = False                            # every EEA venue (FIRDS)
    home: bool = False                           # non-EEA home lines of the securities it lists (OpenFIGI)
    mics: frozenset[str] = frozenset()           # otherwise these operating MICs
    cfi: tuple[str, ...] | None = None           # FIRDS populations (CFI prefixes); None: unknown, all
    crypto: frozenset[str] = frozenset()         # crypto kinds present (coin, token)
    label: str = ""

    def covers(self, entry: dict, listing: dict, venues: dict) -> bool:
        if "chain" in listing:
            return entry["kind"] in self.crypto
        mic = listing["mic"]
        if mic in US_MICS:
            return self.us
        # A home line is written for a security the build lists in the EEA (FIRDS, `cfi`), on its ISIN country's
        # venue, or on any home venue for an offshore ISIN.
        if mic in HOME_MICS:
            isin_country = entry["security"].get("isin", "")[:2]
            same = venues.get(mic, {}).get("country") == isin_country or (isin_country and isin_country not in HOME_COUNTRIES)
            in_firds = bool(entry.get("cfi")) and self.eea and (self.cfi is None or entry["cfi"].startswith(self.cfi))
            return self.home and same and (in_firds or any(
                self.covers(entry, other, venues) for other in entry["listings"] if other.get("mic") not in HOME_MICS))
        if venues.get(mic, {}).get("country") in EEA and (self.eea or mic in self.mics):
            return self.cfi is None or not entry.get("cfi") or entry["cfi"].startswith(self.cfi)
        return mic in self.mics


def read_scope(ref: sqlite3.Connection, reference: Path, cfi: tuple[str, ...] | None = None) -> Scope:
    label = (ref.execute("SELECT value FROM release WHERE key = 'scope'").fetchone() or [""])[0]
    tokens = {token.strip().upper() for token in label.split(",") if token.strip()}
    stored = (ref.execute("SELECT value FROM release WHERE key = 'cfi_prefixes'").fetchone() or [None])[0]
    if cfi is None and stored:
        cfi = tuple(stored.split(","))
    manifest = reference.parent / "manifest.json"  # builds before the release carried cfi_prefixes
    if cfi is None and manifest.exists():
        data = json.loads(manifest.read_text(encoding="utf-8"))
        if data.get("snapshot", {}).get("file") == reference.name:
            cfi = tuple(data.get("scope", {}).get("cfi_prefixes") or ()) or None
    crypto = frozenset(row[0] for row in ref.execute("SELECT DISTINCT kind FROM securities WHERE asset_class = 'crypto'"))
    return Scope(us=bool(tokens & {"SEC", "US"}), eea=bool(tokens & {"EEA", "ALL"}), home="HOME" in tokens,
                 mics=frozenset(t for t in tokens if re.fullmatch(r"[A-Z0-9]{4}", t) and t not in {"EEA"}),
                 cfi=cfi, crypto=crypto, label=label)
