"""A plugin corrects its own source's error (ADR 0044, amendment "a source adapter corrects its own source"): the record
states the corrected value and keeps what the source said and why that is wrong, and a subject's view lists each one with
the original beside it. Staleness is the plugin's to enforce; the builder's rule is tested in the builder."""
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from identity_world import World, record, vendor
from test_identity_contracts import PROVENANCE, identity

ASML_LINE, ASML_ISIN = "listing:isin:NL0010273215:XAMS:EUR", "NL0010273215"
ASML_SECURITY = "security:isin:NL0010273215"
WRONG = "ASML HLDG NV (TESTDATA)"
REASON = "the provider lists the line under a test name; the company's filings name it ASML Holding N.V."


def corrected(plugin, *, source_corrections=None, name="ASML Holding N.V."):
    """A line record of ASML as the plugin emits it."""
    found = record(plugin, "ASML.AS", ("isin", ASML_ISIN))
    found["attributes"] = {"name": name, "operating_mic": "XAMS", "currency": "EUR"}
    if source_corrections is not None:
        found["attributes"]["source_corrections"] = source_corrections
    return found


class ClaimTest(unittest.TestCase):
    """The contract check: a correction names a field the record states, once, with an original that differs."""

    def claim(self, corrections, **attributes):
        plugin = vendor("isin")
        found = corrected(plugin, source_corrections=corrections)
        found["attributes"].update(attributes)
        return identity.RecordClaim(**found)

    def test_a_correction_round_trips_the_wire_keeping_the_original_and_the_reason(self):
        fixes = [{"field": "name", "original": WRONG, "reason": REASON}, {"field": "isin", "original": "NL0010273216",
                                                                          "reason": "a transposed digit; GLEIF has it"}]
        batch = identity.ClaimBatch(plugin="vendor", provider="vendor", adapter_version="1", origin="resolve",
                                    claims=(self.claim(fixes),))
        wire = identity.batch_to_json(batch)
        self.assertEqual(wire["claims"][0]["attributes"]["source_corrections"], fixes)
        [again] = identity.batch_from_json(wire).claims
        self.assertEqual(again.attributes.source_corrections, (identity.SourceCorrection(**fixes[0]), identity.SourceCorrection(**fixes[1])))

    def test_a_correction_the_record_does_not_back_is_refused(self):
        name = {"field": "name", "original": WRONG, "reason": REASON}
        refused = {
            "a field the record does not state": [{**name, "field": "country"}],
            "an original equal to the corrected value": [{**name, "original": "ASML Holding N.V."}],
            "a field that is neither scheme nor attribute": [{**name, "field": "colour"}],
            "two corrections of one field": [name, {**name, "original": "ASML"}],
            "a reason beyond 400 characters": [{**name, "reason": "x" * 401}],
            "no reason": [{**name, "reason": ""}],
        }
        for label, corrections in refused.items():
            with self.subTest(label):
                with self.assertRaises(ValueError):
                    self.claim(corrections)
        with self.assertRaises(ValueError):  # the identifier it corrects is the record's own, never its underlying
            identity.RecordClaim(**{**corrected(vendor("isin")), "identifiers": [
                {"scheme": "isin", "value": ASML_ISIN, "role": "underlying"}], "attributes": {
                    "source_corrections": [{"field": "isin", "original": "NL0010273216", "reason": REASON}]}})


class ViewTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.world = World(Path(tmp.name))
        self.addCleanup(self.world.close)
        self.plugin = vendor("isin")
        self.world.plugins = [self.plugin]

    def listed(self, subject=ASML_LINE):
        return self.world.read(subject)["view"]["source_corrected"]

    def test_a_plugins_correction_of_its_own_source_shows_with_what_the_source_said(self):
        self.assertEqual(self.listed(), [])
        fix = [{"field": "name", "original": WRONG, "reason": REASON}]
        self.world.ingest(self.plugin, corrected(self.plugin, source_corrections=fix))
        self.assertEqual(self.listed(), [{
            "plugin": "vendor", "subject_id": ASML_LINE, "source": "vendor", "field": "name", "original": WRONG,
            "value": "ASML Holding N.V.", "reason": REASON}])
        [row] = self.world.identity.select("SELECT json_extract(claim, '$.attributes.source_corrections[0].original') FROM claims")
        self.assertEqual(row[0], WRONG)  # raw data answers "what did the source originally say?"

    def test_the_reference_builds_corrections_show_beside_the_plugins(self):
        row = (ASML_SECURITY, "esma_firds", "Issr", "529900Z57DVJXUBLHX66", "724500Y6DUVHQD6OXN27", REASON)
        self.assertEqual(self.listed(ASML_SECURITY), [])
        with closing(sqlite3.connect(self.world.path)) as db, db:
            db.execute("INSERT INTO source_corrections VALUES (?, ?, ?, ?, ?, ?)", row)
        [found] = self.listed(ASML_SECURITY)
        self.assertEqual((found["plugin"], found["source"], found["field"], found["original"], found["value"]),
                         ("reference", "esma_firds", "Issr", "529900Z57DVJXUBLHX66", "724500Y6DUVHQD6OXN27"))
        with closing(sqlite3.connect(self.world.path)) as db, db:  # a package built before the table: nothing fails
            db.execute("DROP TABLE source_corrections")
        self.assertEqual(self.listed(ASML_SECURITY), [])


if __name__ == "__main__":
    unittest.main()
