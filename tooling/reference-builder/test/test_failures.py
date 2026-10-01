"""Consequential failures the builder leaves unresolved rather than guessing (roadmap stage 0, ADR 0037): an alias
two subjects could claim, and a receipt whose stated underlying is superseded."""

import unittest
from collections import Counter
from unittest import mock

from reference_builder import firds, schema
from reference_builder.config import Scope
from reference_builder.model import Evidence, Security, Snapshot
from reference_builder.pipeline import build_snapshot

from .fixtures import ASML_ISIN, ASML_LEI, NN_ISIN, FakeOpenFigi, firds_record, fulins, stream
from .test_pipeline import OPENFIGI, gleif_fetch, inputs

OLD_ASML = "NL0006034001"  # ASML's ISIN before its 2012 capital return
RECEIPT = "USN070592100"   # ASML's New York registry shares


class AmbiguousAliasTest(unittest.TestCase):
    def test_an_alias_two_subjects_could_claim_is_dropped(self):
        # Two ISINs that OpenFIGI maps to one share class (a re-ISIN FIRDS still lists): the FIGI key could name either.
        snap = Snapshot(as_of="2026-09-28")
        for isin in (ASML_ISIN, NN_ISIN):
            snap.securities[f"isin:{isin}"] = Security(f"isin:{isin}", "share", "esma_firds", Evidence.ADMISSION_REGISTER,
                                                      isin=isin, share_class_figi="BBG001S5N8V8")
        tables = schema.rows(snap, {"build_id": "test"}, [])
        aliases = {row["old_id"]: row["new_id"] for row in tables["id_aliases"]}
        self.assertNotIn("security:figi:BBG001S5N8V8", aliases)
        self.assertEqual({row["id"] for row in tables["securities"] if row["asset_class"] == "equity"},
                         {f"security:isin:{ASML_ISIN}", f"security:isin:{NN_ISIN}"})
        self.assertEqual(snap.audit["schema"]["aliases_dropped"], 1)


class StaleUnderlyingTest(unittest.TestCase):
    def test_a_receipt_stating_a_superseded_share_stays_a_question_in_the_package(self):
        given = inputs(Scope(mics=("XAMS",), sec=False))
        records = [firds_record(OLD_ASML, "XAMS", ASML_LEI, name="ASML HOLDING", term="2012-11-23"),
                   firds_record(RECEIPT, "XAMS", ASML_LEI, cfi="EDSXFR", name="ASML NY REGISTRY", underlying=OLD_ASML)]
        firds.apply(given.admissions, firds.full_records(stream(fulins(records)), given.scope.cfi_prefixes), Counter())
        with mock.patch("urllib.request.urlopen", side_effect=AssertionError("network access in a test")):
            snap = build_snapshot(given, gleif_fetch, FakeOpenFigi(OPENFIGI))
        self.assertEqual(snap.securities[f"isin:{OLD_ASML}"].activity, "inactive")
        self.assertNotIn(f"isin:{RECEIPT}", {item.from_id for item in snap.relationships},
                         "neither the stated share nor the issuer's one live share is guessed")
        asked = [(q["question"], q["subject_ids"], q["candidate_ids"]) for q in schema.questions(snap)
                 if q["question"] == "receipt_underlying"]
        self.assertEqual(asked, [("receipt_underlying", [f"security:cgs_isin:{RECEIPT}"], [f"security:isin:{ASML_ISIN}"])])


if __name__ == "__main__":
    unittest.main()
