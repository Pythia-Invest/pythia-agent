"""A format-5 package as this builder writes it, read by core: its `snapshot` and `curated` rows count as the kinds of
evidence they are, at the trust level the user installed the package at (ADR 0044 A1, A2; ADR 0037, amendment of
2026-09-30)."""

import contextlib
import importlib
import os
import unittest
from pathlib import Path
from unittest import mock

from reference_builder import schema

from . import test_package  # its build, not its tests

identity = schema.identity
installer = importlib.import_module("pythia_core_identity.reference_package")
store = importlib.import_module("pythia_core_identity.store")
subjects = importlib.import_module("pythia_core_identity.subject")
ASML = "listing:isin:NL0010273215:XAMS:EUR"
BTC = "listing:caip19:bip122:000000000019d6689c085ae165831e93/slip44:0"


class LegacyAuthorityTest(unittest.TestCase):
    setUp, build = test_package.PackageTest.setUp, test_package.PackageTest.build

    def open(self, level: str):
        """The built package installed at trust `level`, opened as core opens it: at the level its grant gives it."""
        data = Path(self.tmp.name) / level
        with mock.patch.dict(os.environ, {"PYTHIA_CONFIG_ROOT": str(data / "config")}):
            installer.install(self.out, data, level)
            return contextlib.closing(store.open_reference(store.reference_path(data)))

    def test_the_legacy_values_are_read_as_kinds_and_count_at_the_packages_level(self):
        self.assertEqual(self.build()["format_version"], 5)
        with self.open("confirm") as ref:
            written = {row[0] for row in ref.execute("SELECT authority FROM assertions UNION SELECT authority FROM relations")}
            self.assertEqual((ref.level, written), ("confirm", {"snapshot", "curated"}))  # what format 5 holds
            relations = {(row["type"], row["source_record"], identity.stored_authority(row["authority"],
                                                                                       row["source_record"]))
                         for row in ref.execute("SELECT * FROM relations")}
            self.assertIn(("depositary_receipt_of", "receipt_issuer_share@1", "rule_confirmed"), relations)  # a rule's
            self.assertIn(("wraps", "canonical_assets@1", "source_asserted"), relations)  # Pythia's own list
            for subject_id in (ASML, BTC):
                subject = subjects.load_subject(ref, subject_id)
                self.assertEqual(({item.authority for item in subject["evidence"]}, subject["shown"]),
                                 ({"source_asserted"}, []))
        with self.open("display") as ref:
            subject = subjects.load_subject(ref, ASML)
            self.assertEqual((ref.level, subject["evidence"], subject["values"]["isin"]), ("display", [], "NL0010273215"))
            self.assertEqual({item.authority for item in subject["shown"]}, {"source_asserted"})


if __name__ == "__main__":
    unittest.main()
