"""The identity truth set and its audit: data consistency, scope, core derivation and the regression gate."""

import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from reference_builder import truth, truth_report, writer
from reference_builder.pipeline import build_snapshot
from reference_builder.schema import identity

from .fixtures import ASML_ISIN, FakeOpenFigi
from .test_pipeline import OPENFIGI, gleif_fetch, inputs

VENUES = {"XAMS": {"country": "NL"}, "XNAS": {"country": "US"}, "XETR": {"country": "DE"}, "OTCM": {"country": "US"}}
TRUTH = {"version": "test", "venues": VENUES, "entries": [
    {"id": "asml", "kind": "ordinary", "status": "active", "cfi": "ES", "tags": ["eu_home"],
     "issuer": {"cik": "937966"}, "security": {"isin": ASML_ISIN}, "fold": "asml",
     "search": {"query": "asml", "rows": ["ASML@XLON", "ASML@XAMS"]},  # the first line the build has
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
        data = truth_report.load_truth()
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
        self.assertEqual(results["asml:fold:row_line:asml"], ("pass", ""))

    def test_wrong_expectations_and_merges_fail_with_a_reason(self):
        wrong = copy.deepcopy(TRUTH)
        wrong["entries"][0]["listings"][0]["symbols"]["yahoo"] = "ASML.XX"
        wrong["entries"][1]["security"] = {"isin": ASML_ISIN}  # claims the ordinary share: two entries, one security
        results = self.results(truth.audit(self.path, wrong, cfi=("ES",)))
        self.assertEqual(results["asml:symbols:yahoo:ASML.XX"], ("fail", "wrong:ASML.AS"))
        self.assertEqual(results["asml:separate:asml-nyrs"], ("fail", "merged"))

    def test_regressions_are_passes_that_now_fail_and_ids_that_move_without_an_alias(self):
        report = truth.audit(self.path, TRUTH, cfi=("ES",))
        baseline = truth_report.baseline_of(report)
        self.assertEqual(truth_report.regressions(report, baseline), [])
        worse = copy.deepcopy(TRUTH)
        worse["entries"][0]["listings"][0]["symbols"]["yahoo"] = "ASML.XX"
        baseline["passed"].append("asml:symbols:yahoo:ASML.XX")
        old = baseline["ids"]["asml"]["security"]
        baseline["ids"]["asml"]["security"] = "security:figi:BBGOLDKEY001"
        found = truth_report.regressions(truth.audit(self.path, worse, cfi=("ES",)), baseline)
        self.assertEqual(len(found), 2)
        aliased = truth_report.regressions(truth.audit(self.path, TRUTH, cfi=("ES",)), baseline, {"security:figi:BBGOLDKEY001": old})
        self.assertEqual(aliased, [])

    def test_a_baseline_retake_lists_id_changes_and_needs_them_accepted(self):
        path = Path(self.path.parent) / "baseline.json"
        baseline = truth_report.baseline_of(truth.audit(self.path, TRUTH, cfi=("ES",)))
        baseline["ids"]["asml"]["security"] = "security:figi:BBGOLDKEY001"
        path.write_text(json.dumps(baseline))
        args = ["--reference", str(self.path), "--baseline", str(path), "--write-baseline"]
        with mock.patch("sys.stdout"), mock.patch("sys.stderr"):
            self.assertEqual(truth_report.main(args), 1)
            self.assertEqual(json.loads(path.read_text())["ids"]["asml"]["security"], "security:figi:BBGOLDKEY001")
            truth_report.main([*args, "--accept-id-changes"])
        written = json.loads(path.read_text())
        self.assertEqual(len(written["accepted_id_changes"]), 1)
        with mock.patch("sys.stdout"), mock.patch("sys.stderr"):
            truth_report.main(args)  # a later re-take keeps the record
        self.assertEqual(json.loads(path.read_text())["accepted_id_changes"], written["accepted_id_changes"])
        self.assertEqual(len(written["passed"]), len(set(written["passed"])))

    def test_the_build_report_and_the_audit_list_the_build_counts_to_review(self):
        audit = {"securities": {"by_primary_rule": {"us_exchange_no_home_line": 3}},
                 "schema": {"securities_without_primary": 2, "skipped_ticker_mic": 5}, "flags": {"cik_link_suspect": 1}}
        logged = []
        result = truth_report.build_report(self.path, ("ES",), logged.append, audit)
        self.assertEqual(result["attention"], {"us_exchange_no_home_line": 3, "securities_without_primary": 2,
                                               "issuer_split_lei_cik": 0, "cik_link_suspect": 1,
                                           "issuer_identity_name_candidate": 0, "skipped_ticker_mic": 5})
        self.assertIn("       5  rejected by the schema: ticker_mic", logged)
        self.assertIn("       3  US primary: a US exchange line and no line in the ISIN's country", logged)
        self.assertIsNone(truth_report.manifest_audit(self.path))  # no manifest beside this reference
        (self.path.parent / "manifest.json").write_text(json.dumps({"snapshot": {"file": self.path.name}, "audit": audit}))
        self.assertEqual(truth_report.manifest_audit(self.path), audit)


if __name__ == "__main__":
    unittest.main()
