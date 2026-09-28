"""Evidence for the listing-currency rework: the currencies sources stated on a device against the reference.

Core checks what a price source's own read states about the address it served (ADR 0037, rule
`read_check@1`) and keeps the read as that plugin's claim. While the reference's listing
currency is not a signed-off fact, another currency only leaves the address unverified. This
counts those agreements and differences per venue from one device's `identity.sqlite3`, so a
currency rule can be judged on them. It prints counts and reference listing IDs only, never a
provider value beyond the stated currency code.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path

READ_RULE = "read_check@1"
MINOR_UNITS = {"GBX": "GBP", "ILA": "ILS", "ZAC": "ZAR"}  # core's read_checks: minor units count as the major


def tally(identity: Path, reference: Path) -> dict[str, dict]:
    """Per operating MIC: lines checked with a stated currency, agreements, and differences by stated -> reference."""
    db = sqlite3.connect(f"{identity.resolve().as_uri()}?mode=ro", uri=True)
    try:
        db.execute("ATTACH DATABASE ? AS ref", (f"{reference.resolve().as_uri()}?mode=ro",))
        rows = db.execute(
            "SELECT l.id, COALESCE(l.operating_mic, l.mic), l.currency, c.claim FROM bindings b"
            " JOIN claims c ON c.plugin = b.plugin AND c.native_scope = b.native_scope AND c.native_id = b.native_id"
            " JOIN ref.listings l ON l.id = b.subject_id WHERE b.rule_id = ?", (READ_RULE,)).fetchall()
    finally:
        db.close()
    venues: dict[str, dict] = defaultdict(lambda: {"checked": 0, "agrees": 0, "differs": Counter(), "examples": []})
    for listing, venue, currency, claim in rows:
        stated = (json.loads(claim).get("attributes") or {}).get("currency")
        if not stated or not currency:
            continue
        entry = venues[venue or "?"]
        entry["checked"] += 1
        if MINOR_UNITS.get(stated, stated) == MINOR_UNITS.get(currency, currency):
            entry["agrees"] += 1
        else:
            entry["differs"][f"{stated}->{currency}"] += 1
            entry["examples"].append(listing)
    return dict(sorted(venues.items()))


def format_tally(venues: dict[str, dict], examples: int = 3) -> list[str]:
    lines = ["Stated trading currency (read checks) against the reference listing currency, per venue",
             f"  {'venue':<8}{'checked':>8}{'agrees':>8}{'differs':>8}  stated->reference"]
    for venue, entry in venues.items():
        differs = sum(entry["differs"].values())
        pairs = " · ".join(f"{pair} {count}" for pair, count in entry["differs"].most_common())
        lines.append(f"  {venue:<8}{entry['checked']:>8}{entry['agrees']:>8}{differs:>8}  {pairs}")
        lines += [f"      {listing}" for listing in entry["examples"][:examples]]
    return lines


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--identity", type=Path, required=True, help="a device's identity.sqlite3 (read only)")
    parser.add_argument("--reference", type=Path, required=True, help="the reference the device used")
    args = parser.parse_args(argv)
    print("\n".join(format_tally(tally(args.identity, args.reference))))
    return 0
