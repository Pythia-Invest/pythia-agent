"""Evidence for the reference's venue and currency rework: what price sources stated on a device, per venue.

Core checks what a price source's own read states about the reference it served (ADR 0037, rule
`read_check@1`) and keeps it per subject in `identity.sqlite3` `read_checks`. While a reference
field is not signed off, a difference only labels the source. This counts, per reference venue,
the lines checked and where the stated venue or currency differs, so a rule can be judged on them
before it is enforced. It prints counts and reference listing IDs only; provider values appear
only as venue and currency codes.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path


def tally(identity: Path, reference: Path) -> dict[str, dict]:
    """Per reference operating MIC: lines checked, and the differences by attribute and stated -> reference value."""
    db = sqlite3.connect(f"{identity.resolve().as_uri()}?mode=ro", uri=True)
    try:
        db.execute("ATTACH DATABASE ? AS ref", (f"{reference.resolve().as_uri()}?mode=ro",))
        rows = db.execute("SELECT l.id, COALESCE(l.operating_mic, l.mic), l.currency, c.stated, c.differs"
                          " FROM read_checks c JOIN ref.listings l ON l.id = c.subject_id").fetchall()
    finally:
        db.close()
    venues: dict[str, dict] = defaultdict(lambda: {"checked": 0, "venue": Counter(), "currency": Counter(), "examples": []})
    for listing, venue, currency, stated, differs in rows:
        entry, said, differs = venues[venue or "?"], json.loads(stated), json.loads(differs)
        entry["checked"] += 1
        if "venue" in differs:
            entry["venue"][f"{said.get('operating_mic')}->{venue}"] += 1
        if "currency" in differs:
            entry["currency"][f"{said.get('currency')}->{currency}"] += 1
        if differs:
            entry["examples"].append(listing)
    return dict(sorted(venues.items()))


def format_tally(venues: dict[str, dict], examples: int = 3) -> list[str]:
    lines = ["Read checks: what price sources stated against the reference, per reference venue",
             f"  {'venue':<8}{'checked':>8}{'venue≠':>8}{'ccy≠':>8}  stated->reference"]
    for venue, entry in venues.items():
        pairs = " · ".join(f"{pair} {count}" for kind in ("venue", "currency") for pair, count in entry[kind].most_common())
        lines.append(f"  {venue:<8}{entry['checked']:>8}{sum(entry['venue'].values()):>8}"
                     f"{sum(entry['currency'].values()):>8}  {pairs}")
        lines += [f"      {listing}" for listing in entry["examples"][:examples]]
    return lines


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--identity", type=Path, required=True, help="a device's identity.sqlite3 (read only)")
    parser.add_argument("--reference", type=Path, required=True, help="the reference database the device used")
    args = parser.parse_args(argv)
    print("\n".join(format_tally(tally(args.identity, args.reference))))
    return 0
