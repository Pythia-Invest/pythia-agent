"""Read-check currency evidence: a device's stated currencies are counted per venue against the reference."""

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from reference_builder import read_checks


def claim(currency):
    return json.dumps({"attributes": {"currency": currency}})


class ReadCheckTallyTest(unittest.TestCase):
    def test_agreements_and_differences_are_counted_per_venue(self):
        with tempfile.TemporaryDirectory() as tmp:
            reference, identity = Path(tmp) / "reference.sqlite3", Path(tmp) / "identity.sqlite3"
            with sqlite3.connect(reference) as db:
                db.execute("CREATE TABLE listings (id TEXT, mic TEXT, operating_mic TEXT, currency TEXT)")
                db.executemany("INSERT INTO listings VALUES (?, ?, ?, ?)", [
                    ("listing:a", "XAMS", "XAMS", "EUR"), ("listing:b", "XAMS", "XAMS", "EUR"),
                    ("listing:c", "XMUN", "XMUN", "USD"), ("listing:d", "XLON", "XLON", "GBP")])
            with sqlite3.connect(identity) as db:
                db.execute("CREATE TABLE bindings (plugin, provider, native_scope, native_id, subject_id, rule_id)")
                db.execute("CREATE TABLE claims (plugin, native_scope, native_id, claim)")
                for index, (listing, stated, rule) in enumerate([
                        ("listing:a", "USD", "read_check@1"), ("listing:b", "EUR", "read_check@1"),
                        ("listing:c", "EUR", "read_check@1"), ("listing:d", "GBX", "read_check@1"),
                        ("listing:a", "USD", "resolve_answer@1")]):
                    db.execute("INSERT INTO bindings VALUES ('p', 'x', 's', ?, ?, ?)", (str(index), listing, rule))
                    db.execute("INSERT INTO claims VALUES ('p', 's', ?, ?)", (str(index), claim(stated)))
            venues = read_checks.tally(identity, reference)
        self.assertEqual({venue: (entry["checked"], entry["agrees"], dict(entry["differs"]))
                          for venue, entry in venues.items()},
                         {"XAMS": (2, 1, {"USD->EUR": 1}), "XMUN": (1, 0, {"EUR->USD": 1}), "XLON": (1, 1, {})})
        self.assertIn("  XAMS           2       1       1  USD->EUR 1", read_checks.format_tally(venues))


if __name__ == "__main__":
    unittest.main()
