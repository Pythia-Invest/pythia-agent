"""Typed claims and the per-build source record.

An adapter turns source records into `Claim`s and nothing else: it never picks a
winner, never reads another source, and records "no answer" (an empty element, a
placeholder) as the absence of a claim. A claim's meaning comes from core's
vocabulary (`SourceMeaning`), so each source field lands in the one meaning its
specification gives it.

Claims live in memory during the build. What persists is small: per source, a
`<source>-<date>.json` beside the snapshot with the drift fingerprint, the audit
report and whether the build was good. The next build compares its fingerprint
with the newest older good one; a build whose source broke (written with
`--no-gates`) never becomes that baseline.
"""

from __future__ import annotations

import json
import os
from collections import Counter, defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import NamedTuple

from .model import Venue
from .schema import identity

Meaning = identity.SourceMeaning


class Claim(NamedTuple):
    subject_key: str  # a global identifier: isin:<ISIN>, or isin:<ISIN>@<segment MIC> for an admission
    value: str
    source: str
    source_field: str  # the element path in the source record
    meaning: Meaning
    as_of: str | None  # the source file's publication date
    record_digest: str | None  # of the source record's bytes


def record_path(out_dir: Path, source: str, stamp: str) -> Path:
    return out_dir / f"{source}-{stamp}.json"


def for_reference(reference: Path, source: str) -> Path:
    """The source record beside a `reference-<date>.sqlite3` snapshot."""
    return reference.with_name(f"{source}-{reference.stem.removeprefix('reference-')}.json")


def write(path: Path, record: dict) -> None:
    staging = path.with_name(f".{path.name}.part")
    staging.write_text(json.dumps(record) + "\n", encoding="utf-8")
    os.replace(staging, path)


def read(path: Path | None) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path else None
    except (OSError, ValueError):
        return None


def previous_good(path: Path) -> tuple[Path, dict] | None:
    """The newest older record of the same source whose build was good: the drift baseline."""
    source = path.name.rsplit("-", 1)[0]
    for older in sorted(path.parent.glob(f"{source}-*.json"), reverse=True):
        found = read(older) if older.name < path.name else None
        if found and found.get("good") and found.get("fingerprint", {}).get("records"):
            return older, found
    return None


# ---- claims in memory: what reconciliation and the audit read ------------------------------------------------

ADMISSION = (Meaning.ISSUER_REQUESTED_ADMISSION, Meaning.TERMINATION_DATE)
KEPT = (Meaning.INSTRUMENT_FULL_NAME, Meaning.CFI, Meaning.ISSUER_OR_VENUE_OPERATOR_LEI, Meaning.NOTIONAL_CURRENCY,
        Meaning.UNDERLYING_ISIN, Meaning.MOST_LIQUID_EU_MARKET, *ADMISSION)
# Segments with at least this many records that answer field 8 true on every one are listed as an odd case.
CONVENTION_MIN = 20


@dataclass
class Claims:
    """The build's FIRDS claims per ISIN: what reconciliation and the audit read."""

    isins: dict[str, dict[str, set[str]]] = field(default_factory=lambda: defaultdict(lambda: defaultdict(set)))
    admissions: dict[str, dict[str, dict[str, str]]] = field(default_factory=lambda: defaultdict(lambda: defaultdict(dict)))
    convention: set[str] = field(default_factory=set)  # segments whose field 8 is true on every record
    digests: dict[str, str] = field(default_factory=dict)  # ISIN -> a source record's digest, cited as evidence
    count: int = 0

    def one(self, isin: str, meaning: str) -> str | None:
        values = self.isins.get(isin, {}).get(meaning)
        return sorted(values)[0] if values else None

    def name(self, isin: str) -> str:
        return f"{isin} {self.one(isin, Meaning.INSTRUMENT_FULL_NAME) or ''}".strip()


def load(claims: Iterable[Claim]) -> Claims:
    found = Claims()
    for claim in claims:
        found.count += 1
        if claim.meaning not in KEPT:
            continue
        isin, _, segment = claim.subject_key.removeprefix("isin:").partition("@")
        found.digests.setdefault(isin, claim.record_digest)
        if segment:
            found.admissions[isin][segment][claim.meaning] = claim.value
        else:
            found.isins[isin][claim.meaning].add(claim.value)
    answers: dict[str, Counter] = defaultdict(Counter)
    for segments in found.admissions.values():
        for segment, admission in segments.items():
            answers[segment][admission.get(Meaning.ISSUER_REQUESTED_ADMISSION, "missing")] += 1
    found.convention = {segment for segment, c in answers.items() if set(c) == {"true"} and c["true"] >= CONVENTION_MIN}
    return found


class Venues:
    def __init__(self, venues: dict[str, Venue]):
        self.venues = venues
        self.operated: dict[str, set[str]] = defaultdict(set)  # LEI -> MICs whose operating entity it is
        for venue in venues.values():
            if venue.lei:
                self.operated[venue.lei].add(venue.mic)

    def op(self, mic: str | None) -> str | None:
        venue = self.venues.get(mic or "")
        return venue.operating_mic if venue else mic

    def entity(self, mic: str | None) -> str | None:
        """The operating entity of a venue's operating MIC, by its ISO 10383 LEI (Xetra and Frankfurt: Deutsche
        Börse AG), else the operating MIC itself."""
        venue = self.venues.get(self.op(mic) or "")
        return (venue.lei if venue else None) or self.op(mic)

    def country(self, mic: str | None) -> str | None:
        venue = self.venues.get(mic or "")
        return venue.country if venue else None


def _live(admission: dict[str, str], as_of: str) -> bool:
    end = admission.get(Meaning.TERMINATION_DATE)
    return not end or end > as_of


def requested(claims: Claims, isin: str, as_of: str) -> set[str]:
    """Segment MICs of the live EEA admissions the issuer requested (field 8)."""
    return {segment for segment, a in claims.admissions.get(isin, {}).items()
            if a.get(Meaning.ISSUER_REQUESTED_ADMISSION) == "true" and _live(a, as_of)}
