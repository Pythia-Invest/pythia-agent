"""A package of an older format stays installed when Pythia is updated, and this core reads none of it: the reference
status, search, pages and Repairs say plainly that it is too old and must be rebuilt, never "no reference data"."""
import json
import types
import unittest
from unittest import mock

from test_identity_trust import TrustCase, identity_ops, reference_package, trust
from test_reference_package import make_package
from pythia_core_queue_fixture import queue_ops  # noqa: E402  (the core test_identity_trust loaded)


class OlderFormatTest(TrustCase):
    def test_status_search_pages_and_repairs_say_an_older_package_must_be_rebuilt(self):
        data, older = self.root / "data", reference_package.FORMAT_VERSION - 1
        with mock.patch.object(reference_package, "FORMAT_VERSION", older):  # installed by the Pythia before this one
            reference_package.install(make_package(self.root / "package", format_version=older), data, trust.CONFIRM)
        ops = identity_ops.Identity(types.SimpleNamespace(), data_dir=data)
        self.enterContext(mock.patch.object(identity_ops, "installed", list))  # no plugins: pages read the store alone
        self.addCleanup(lambda: ops._store and ops._store.db.close())
        status = json.loads(ops.reference_status({}))
        problem = status["data"]["installed"]["problem"]
        self.assertEqual((status["outcome"], status["data"]["installed"]["compatible"]), ("ok", False))
        self.assertIn(f"is format {older}, too old for this Pythia", problem)
        self.assertIn("Rebuild it with this checkout's builder", problem)
        reads = {"status": status, "search": json.loads(ops.search({"query": "ASML"})),
                 "page": json.loads(ops.subject({"subject_id": "listing:isin:NL0010273215:XAMS:EUR"})),
                 "repairs": json.loads(queue_ops.read_queue(ops, {}))}
        for name, read in reads.items():
            with self.subTest(read=name):
                self.assertEqual(read["issues"][0]["message"], problem)

    def test_a_newer_package_says_to_update_pythia_and_none_says_none_is_installed(self):
        data, newer = self.root / "data", reference_package.FORMAT_VERSION + 1
        ops = identity_ops.Identity(types.SimpleNamespace(), data_dir=data)
        self.assertEqual(json.loads(ops.search({"query": "ASML"}))["issues"][0]["message"], queue_ops.NO_REFERENCE)
        with mock.patch.object(reference_package, "FORMAT_VERSION", newer):  # installed by a later Pythia
            reference_package.install(make_package(self.root / "package", format_version=newer), data, trust.CONFIRM)
        self.assertIn("Update Pythia to read it.", json.loads(ops.search({"query": "ASML"}))["issues"][0]["message"])


if __name__ == "__main__":
    unittest.main()
