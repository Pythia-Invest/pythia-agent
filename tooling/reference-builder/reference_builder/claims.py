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

import functools
import json
import os
from collections import Counter, defaultdict
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import NamedTuple

from . import source_drift
from .model import Venue
from .schema import identity

Meaning = identity.SourceMeaning


class Claim(NamedTuple):
    subject_key: str  # a global identifier: isin:<ISIN>, or isin:<ISIN>@<segment MIC> for an admission
    value: str | None  # None only on a retraction (`corrected`)
    source: str
    source_field: str  # the element path in the source record
    meaning: Meaning
    as_of: str | None  # the source file's publication date
    record_digest: str | None  # of the source record's bytes
    correction: tuple[str, str] | None = None  # (original, reason) where the adapter corrected its source's error: `value` is the corrected one


def corrected(found: Iterable[Claim], table) -> Iterator[Claim]:
    """An adapter's claims with its source's own errors corrected: where `table` (a `source_corrections.Table`) holds a
    fix for a claim's record and field and the source still states the original, the claim states the corrected value
    and carries the original and the reason; a retraction (no corrected value) leaves a claim with no value, which
    `load` records and never decides from. The adapter itself reads the source as it is and patches nothing."""
    for claim in found:
        value, fix = table.apply(claim.source, claim.subject_key, claim.source_field, claim.value)
        yield claim._replace(value=value, correction=fix) if fix else claim


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


def drift(path: Path, fingerprint: dict, read=(), exact=()) -> dict:
    """A source's drift report for this build: its alarms against the last good build's fingerprint."""
    baseline = previous_good(path)
    alarms = source_drift.compare(baseline[1]["fingerprint"] if baseline else None, fingerprint, read, exact)
    return {"record": path.name, "baseline": baseline[0].name if baseline else None, "alarms": alarms,
            "broken": bool(source_drift.breaks(alarms))}


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
    corrected: dict[tuple[str, str], tuple] = field(default_factory=dict)  # (key, source field) -> source, original, value, reason
    corrections: dict = field(default_factory=dict)  # `source_corrections.Table.report`: applied, stale and absent entries
    count: int = 0

    def one(self, isin: str, meaning: str) -> str | None:
        values = self.isins.get(isin, {}).get(meaning)
        return sorted(values)[0] if values else None

    def name(self, isin: str) -> str:
        return f"{isin} {self.one(isin, Meaning.INSTRUMENT_FULL_NAME) or ''}".strip()

    @functools.cached_property
    def receipt_issuers(self) -> dict[str, set[str]]:
        """Share ISIN -> the other issuer LEIs its receipts claim. Field 5 on a receipt is its underlying issuer's LEI
        (ESMA Q&A 1503), so a receipt stating a share (field 26) under another LEI contradicts the share's own field 5
        (Nestlé S.A.'s CDRs on the share FIRDS files under Nestlé Capital Markets). Only LEIs that issue no share of
        their own count: a company's receipt stating another company's share (14 CDRs stating Thermo Fisher)
        contradicts its field 26 instead, which is the receipt's question."""
        issuer, cfi = Meaning.ISSUER_OR_VENUE_OPERATOR_LEI, Meaning.CFI
        shares = {isin for isin in self.isins if (self.one(isin, cfi) or "").startswith("ES")}
        issuing = {lei for isin in shares for lei in self.isins[isin].get(issuer, ())}
        found: dict[str, set[str]] = defaultdict(set)
        for isin, values in self.isins.items():
            if (self.one(isin, cfi) or "").startswith("ED"):
                for target in values.get(Meaning.UNDERLYING_ISIN, set()) & shares - {isin}:
                    found[target] |= values.get(issuer, set()) - self.isins[target].get(issuer, set()) - issuing
        return {isin: leis for isin, leis in found.items() if leis}


def load(claims: Iterable[Claim], table=None) -> Claims:
    """The claims the build decides from. `table` is the `source_corrections.Table` the adapter read them through: its
    report says which entries applied, which are stale and which found no record."""
    found = Claims()
    for claim in claims:
        found.count += 1
        if claim.correction:
            original, reason = claim.correction
            found.corrected[(claim.subject_key, claim.source_field)] = (claim.source, original, claim.value, reason)
        if claim.value is None:  # a retraction: the source's statement is wrong and the build states nothing instead
            continue
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
    found.corrections = table.report() if table is not None else {}
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
