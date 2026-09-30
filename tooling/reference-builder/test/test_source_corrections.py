"""A source adapter corrects its own source's error (ADR 0044, amendment "plugins fix their own source's data"): the claim
states the corrected value and carries the original and the reason, the build decides from the corrected value, the
package keeps the original in `source_corrections`, and an entry the source has since fixed is counted stale."""

import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from datetime import date
from pathlib import Path
from unittest import mock

from reference_builder import assemble, claims, firds, mic, schema, writer
from reference_builder.config import SOURCE_CORRECTIONS, Scope
from reference_builder.pipeline import build_snapshot

from .fixtures import ASML_ISIN, ASML_LEI, MIC_CSV, NN_LEI, FakeOpenFigi, firds_record, fulins
from .test_claims import admissions
from .test_pipeline import OPENFIGI, gleif_fetch

Table = schema.source_corrections.Table
REASON = "FIRDS states another company's LEI for this ISIN; the company's own filing names the right one (test)"
ENTRY = {"source": firds.SOURCE, "key": f"isin:{ASML_ISIN}", "field": "Issr", "original": NN_LEI, "value": ASML_LEI,
         "reason": REASON}


def read(stated_lei: str, entry=ENTRY):
    """FIRDS' record of the share stating `stated_lei` in field 5, read through a table holding `entry`."""
    table = Table([entry])
    found = admissions(fulins([firds_record(ASML_ISIN, "XAMS", stated_lei)]))
    return list(claims.corrected(firds.claims(found), table)), table


class AdapterTest(unittest.TestCase):
    def test_a_claim_states_the_corrected_value_and_carries_the_original_and_the_reason(self):
        found, table = read(NN_LEI)
        [issuer] = [c for c in found if c.source_field == "Issr"]
        self.assertEqual((issuer.value, issuer.correction), (ASML_LEI, (NN_LEI, REASON)))
        self.assertEqual([c.correction for c in found if c.source_field != "Issr"], [None] * (len(found) - 1))
        loaded = claims.load(found, table)
        self.assertEqual(loaded.one(ASML_ISIN, schema.identity.SourceMeaning.ISSUER_OR_VENUE_OPERATOR_LEI), ASML_LEI)
        self.assertEqual(loaded.corrected, {(f"isin:{ASML_ISIN}", "Issr"): (firds.SOURCE, NN_LEI, ASML_LEI, REASON)})
        self.assertEqual(loaded.corrections, {"entries": 1, "applied": 1, "stale": 0, "absent": 0, "retire": []})

    def test_a_correction_stops_applying_when_the_source_fixes_its_value(self):
        found, table = read(ASML_LEI)  # FIRDS now states the right LEI itself
        [issuer] = [c for c in found if c.source_field == "Issr"]
        self.assertEqual((issuer.value, issuer.correction), (ASML_LEI, None))
        self.assertEqual(claims.load(found, table).corrections,
                         {"entries": 1, "applied": 0, "stale": 1, "absent": 0, "retire": [f"esma_firds isin:{ASML_ISIN} Issr"]})
        other, table = read("724500AAAAAAAAAAAA01")  # or another value again: passed through, never overwritten
        self.assertEqual(([c.value for c in other if c.source_field == "Issr"], table.report()["stale"]),
                         (["724500AAAAAAAAAAAA01"], 1))

    def test_an_entry_for_a_record_the_build_did_not_read_is_counted_absent(self):
        table = Table([{**ENTRY, "key": "isin:NL0000000002"}])
        loaded = claims.load(claims.corrected(firds.claims(admissions(fulins([firds_record(ASML_ISIN, "XAMS", NN_LEI)]))), table), table)
        self.assertEqual((loaded.corrections["absent"], loaded.corrections["applied"], loaded.corrected), (1, 0, {}))

    def test_an_entry_the_table_cannot_state_once_is_refused(self):
        refused = {"a reason over 400 characters": {**ENTRY, "reason": "x" * 401}, "no reason": {**ENTRY, "reason": ""},
                   "a value equal to the original": {**ENTRY, "value": NN_LEI}}
        for label, entry in refused.items():
            with self.subTest(label), self.assertRaises(ValueError):
                Table([entry])
        with self.assertRaises(ValueError):  # one correction per record field
            Table([ENTRY, {**ENTRY, "original": "724500AAAAAAAAAAAA01"}])

    def test_the_shipped_entries_are_well_formed(self):
        Table.read(SOURCE_CORRECTIONS.read_text(encoding="utf-8"))


class BuildTest(unittest.TestCase):
    def test_the_build_decides_from_the_corrected_value_and_the_package_keeps_the_original(self):
        found, table = read(NN_LEI)
        firds_found = admissions(fulins([firds_record(ASML_ISIN, "XAMS", NN_LEI)]))
        inputs = assemble.Inputs(date(2026, 9, 25), Scope(mics=("XAMS",), sec=False), mic.parse(MIC_CSV.encode()),
                                 firds_found, None, [], {"XAMS"}, firds_claims=claims.load(found, table))
        with mock.patch("urllib.request.urlopen", side_effect=AssertionError("network access in a test")):
            snap = build_snapshot(inputs, gleif_fetch, FakeOpenFigi(OPENFIGI))
        self.assertEqual(snap.securities[f"isin:{ASML_ISIN}"].issuer_id, f"lei:{ASML_LEI}")
        self.assertEqual(snap.audit["source_corrections"]["applied"], 1)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "reference-20260925.sqlite3"
            counts = writer.write(snap, path, {"build_id": "reference-20260925"}, [])
            with closing(sqlite3.connect(path)) as db:
                [row] = db.execute("SELECT c.source, c.field, c.original, c.value, c.reason, s.issuer_id FROM source_corrections c"
                                   " JOIN securities s ON s.id = c.subject_id").fetchall()
        self.assertEqual(counts["source_corrections"], 1)
        self.assertEqual(row, (firds.SOURCE, "Issr", NN_LEI, ASML_LEI, REASON, f"issuer:lei:{ASML_LEI}"))


if __name__ == "__main__":
    unittest.main()
