"""The identity truth set and its audit: data consistency, scope, core derivation and the regression gate."""

import copy
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from reference_builder import truth, writer
from reference_builder.pipeline import build_snapshot
from reference_builder.schema import identity

from .fixtures import ASML_ISIN, FakeOpenFigi
from .test_pipeline import OPENFIGI, gleif_fetch, inputs

VENUES = {"XAMS": {"country": "NL"}, "XNAS": {"country": "US"}, "XETR": {"country": "DE"}, "OTCM": {"country": "US"}}
TRUTH = {"version": "test", "venues": VENUES, "entries": [
    {"id": "asml", "kind": "ordinary", "status": "active", "cfi": "ES", "tags": ["eu_home"],
     "issuer": {"cik": "937966"}, "security": {"isin": ASML_ISIN}, "fold": "asml",
     "listings": [{"ticker": "ASML", "mic": "XAMS", "currency": "EUR", "primary": True,
                   "symbols": {"yahoo": "ASML.AS", "eodhd": "ASML.AS"}},
                  {"ticker": "ASML", "mic": "XETR", "currency": "EUR", "primary": False}]},
    {"id": "asml-nyrs", "kind": "depositary_receipt", "status": "active", "tags": ["ny_registry"],
     "issuer": {"cik": "937966"}, "security": {"share_class_figi": "BBGASMLNY001"}, "fold": "asml",
     "listings": [{"ticker": "ASML", "mic": "XNAS", "currency": "USD", "primary": True,
                   "symbols": {"yahoo": "ASML", "eodhd": "ASML.US"}}]},
    {"id": "sap", "kind": "ordinary", "status": "active", "tags": ["eu_home"], "issuer": {}, "cfi": "ES",
     "security": {"isin": "DE0007164600"}, "fold": "sap",
     "listings": [{"ticker": "SAP", "mic": "XETR", "currency": "EUR", "primary": True}]},
]}


class TruthSetTest(unittest.TestCase):
    def test_committed_truth_set_is_consistent(self):
        data = truth.load_truth()
        ids = [entry["id"] for entry in data["entries"]]
        self.assertEqual(len(ids), len(set(ids)))
        for entry in data["entries"]:
            with self.subTest(entry=entry["id"]):
                targets = [entry["fold"], *(relation["to"] for relation in entry.get("relations", []))]
                self.assertTrue(set(targets) <= set(ids))
                for scheme, value in [*entry["issuer"].items(), *entry["security"].items()]:
                    identity.normalize_identifier(scheme, value)  # a malformed identifier raises
                for listing in entry["listings"]:
                    self.assertTrue("chain" in listing or listing["mic"] in data["venues"])
                self.assertLessEqual(sum(listing.get("primary") is True for listing in entry["listings"]), 1)


class AuditTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch("urllib.request.urlopen", side_effect=AssertionError("network access in a test"))
        patcher.start()
        self.addCleanup(patcher.stop)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name) / "reference-test.sqlite3"
        snap = build_snapshot(inputs(), gleif_fetch, FakeOpenFigi(OPENFIGI))
        writer.write(snap, self.path, {"build_id": "test", "scope": "XAMS,SEC"}, [])

    def results(self, report):
        return {result.key: (result.status, result.reason) for result in report.results}

    def test_checks_run_core_derivation_within_the_build_scope(self):
        report = truth.audit(self.path, TRUTH, cfi=("ES",))
        results = self.results(report)
        self.assertEqual(report.in_scope, 2)  # SAP's only line is on Xetra, outside an XAMS build
        self.assertFalse(any(key.startswith("sap:") or "XETR" in key for key in results))
        self.assertEqual(results["asml:symbols:yahoo:ASML.AS"], ("pass", ""))
        self.assertEqual(results["asml-nyrs:symbols:eodhd:ASML.US"], ("pass", ""))
        self.assertEqual(results["asml-nyrs:fold:row"], ("pass", ""))  # the registry share folds into the company row
        self.assertEqual(results["asml:primary:home"], ("pass", ""))

    def test_wrong_expectations_and_merges_fail_with_a_reason(self):
        wrong = copy.deepcopy(TRUTH)
        wrong["entries"][0]["listings"][0]["symbols"]["yahoo"] = "ASML.XX"
        wrong["entries"][1]["security"] = {"isin": ASML_ISIN}  # claims the ordinary share: two entries, one security
        results = self.results(truth.audit(self.path, wrong, cfi=("ES",)))
        self.assertEqual(results["asml:symbols:yahoo:ASML.XX"], ("fail", "wrong:ASML.AS"))
        self.assertEqual(results["asml:separate:asml-nyrs"], ("fail", "merged"))

    def test_regressions_are_passes_that_now_fail_and_ids_that_move_without_an_alias(self):
        report = truth.audit(self.path, TRUTH, cfi=("ES",))
        baseline = truth.baseline_of(report)
        self.assertEqual(truth.regressions(report, baseline), [])
        worse = copy.deepcopy(TRUTH)
        worse["entries"][0]["listings"][0]["symbols"]["yahoo"] = "ASML.XX"
        baseline["results"]["asml:symbols:yahoo:ASML.XX"] = "pass"
        old = baseline["ids"]["asml"]["security"]
        baseline["ids"]["asml"]["security"] = "security:figi:BBGOLDKEY001"
        found = truth.regressions(truth.audit(self.path, worse, cfi=("ES",)), baseline)
        self.assertEqual(len(found), 2)
        aliased = truth.regressions(truth.audit(self.path, TRUTH, cfi=("ES",)), baseline, {"security:figi:BBGOLDKEY001": old})
        self.assertEqual(aliased, [])


if __name__ == "__main__":
    unittest.main()
