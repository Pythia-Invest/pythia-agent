"""A package states the kind of evidence each row is, never where it came from (ADR 0044 A1, A2; package format 6):
a value read from a source is `source_asserted`, a relation a builder rule derives is `rule_confirmed` with the rule's
ID, and core's curated crypto table is Pythia's own list. Its rows count at the trust level the user installed the
package at."""

import contextlib
import importlib
import os
import unittest
from pathlib import Path
from unittest import mock

from reference_builder import schema
from reference_builder.model import Evidence, Relationship, Security, Snapshot

from . import test_package  # its build, not its tests
from .fixtures import ASML_ISIN, NN_ISIN

identity = schema.identity
installer = importlib.import_module("pythia_core_identity.reference_package")
store = importlib.import_module("pythia_core_identity.store")
subjects = importlib.import_module("pythia_core_identity.subject")
ASML = "listing:isin:NL0010273215:XAMS:EUR"
BTC = "listing:caip19:bip122:000000000019d6689c085ae165831e93/slip44:0"
RECEIPT = "USN070592100"  # ASML's New York registry shares


class AuthorityTest(unittest.TestCase):
    setUp, build = test_package.PackageTest.setUp, test_package.PackageTest.build

    def open(self, level: str):
        """The built package installed at trust `level`, opened as core opens it: at the level its grant gives it."""
        data = Path(self.tmp.name) / level
        with mock.patch.dict(os.environ, {"PYTHIA_CONFIG_ROOT": str(data / "config")}):
            installer.install(self.out, data, level)
            return contextlib.closing(store.open_reference(store.reference_path(data)))

    def test_rows_state_their_kind_of_evidence_and_count_at_the_packages_level(self):
        self.assertEqual(self.build()["format_version"], installer.FORMAT_VERSION)
        with self.open("confirm") as ref:
            asserted = {row[0] for row in ref.execute("SELECT DISTINCT authority FROM assertions")}
            relations = {tuple(row) for row in ref.execute("SELECT type, source, source_record, authority FROM relations")}
            self.assertEqual((ref.level, asserted), ("confirm", {"source_asserted"}))
            self.assertIn(("depositary_receipt_of", "pythia", "receipt_issuer_share@1", "rule_confirmed"), relations)
            self.assertIn(("wraps", "pythia", "canonical_assets@1", "source_asserted"), relations)  # Pythia's own list
            for subject_id in (ASML, BTC):
                subject = subjects.load_subject(ref, subject_id)
                self.assertEqual(({item.authority for item in subject["evidence"]}, subject["shown"]),
                                 ({"source_asserted"}, []))
        with self.open("display") as ref:
            subject = subjects.load_subject(ref, ASML)
            self.assertEqual((ref.level, subject["evidence"], subject["values"]["isin"]), ("display", [], "NL0010273215"))
            self.assertEqual({item.authority for item in subject["shown"]}, {"source_asserted"})

    def test_a_stated_relation_is_source_asserted_and_a_rule_derived_one_rule_confirmed(self):
        snap = Snapshot(as_of="2026-09-28")
        for isin, kind in ((ASML_ISIN, "share"), (RECEIPT, "dr"), (NN_ISIN, "dr")):
            snap.securities[f"isin:{isin}"] = Security(f"isin:{isin}", kind, "esma_firds", Evidence.ADMISSION_REGISTER,
                                                      isin=isin)
        snap.relationships += [  # FIRDS field 26 states one underlying; the receipt rule derives the other
            Relationship(f"isin:{RECEIPT}", "depositary_receipt_of", f"isin:{ASML_ISIN}", "esma_firds",
                         "firds_underlying_isin", Evidence.STATED_UNDERLYING),
            Relationship(f"isin:{NN_ISIN}", "depositary_receipt_of", f"isin:{ASML_ISIN}", "pythia", "receipt_issuer_share@1",
                         None)]
        written = {row["source_record"]: row["authority"] for row in schema.rows(snap, {"build_id": "t"}, [])["relations"]}
        self.assertEqual(written, {"firds_underlying_isin": "source_asserted", "receipt_issuer_share@1": "rule_confirmed",
                                   "canonical_assets@1": "source_asserted"})


if __name__ == "__main__":
    unittest.main()
