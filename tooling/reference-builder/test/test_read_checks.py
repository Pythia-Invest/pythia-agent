"""Read-check evidence: what a device's price sources stated is counted per reference venue."""

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from reference_builder import read_checks


class ReadCheckTallyTest(unittest.TestCase):
    def test_venue_and_currency_differences_are_counted_per_venue(self):
        with tempfile.TemporaryDirectory() as tmp:
            reference, identity = Path(tmp) / "reference.sqlite3", Path(tmp) / "identity.sqlite3"
            with sqlite3.connect(reference) as db:
                db.execute("CREATE TABLE listings (id TEXT, mic TEXT, operating_mic TEXT, currency TEXT)")
                db.executemany("INSERT INTO listings VALUES (?, ?, ?, ?)", [
                    ("listing:a", "XAMS", "XAMS", "EUR"), ("listing:b", "XAMS", "XAMS", "EUR"),
                    ("listing:c", "XMUN", "XMUN", "USD"), ("listing:d", "XNAS", "XNAS", "USD")])
            with sqlite3.connect(identity) as db:
                db.execute("CREATE TABLE read_checks (subject_id, stated, differs)")
                db.executemany("INSERT INTO read_checks VALUES (?, ?, ?)", [
                    ("listing:a", json.dumps({"currency": "USD", "operating_mic": "XAMS"}), '["currency"]'),
                    ("listing:b", json.dumps({"currency": "EUR", "operating_mic": "XAMS"}), "[]"),
                    ("listing:c", json.dumps({"currency": "EUR", "operating_mic": "XMUN"}), '["currency"]'),
                    ("listing:d", json.dumps({"currency": "USD", "operating_mic": "XNYS"}), '["venue"]')])
            venues = read_checks.tally(identity, reference)
        self.assertEqual({venue: (entry["checked"], dict(entry["venue"]), dict(entry["currency"]))
                          for venue, entry in venues.items()},
                         {"XAMS": (2, {}, {"USD->EUR": 1}), "XMUN": (1, {}, {"EUR->USD": 1}),
                          "XNAS": (1, {"XNYS->XNAS": 1}, {})})
        self.assertIn("      listing:d", read_checks.format_tally(venues))


if __name__ == "__main__":
    unittest.main()
