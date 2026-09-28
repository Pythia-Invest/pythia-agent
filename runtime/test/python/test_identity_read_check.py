"""Read checks (ADR 0037): what a source's own read states about the reference it serves, against the reference."""
import json
import types
import unittest
import unittest.mock
from pathlib import Path

from test_identity_contracts import identity
from test_identity_page import ASML, CONTRACTS, Fixture
from test_identity_queue import load_core
from test_reference_package import make_package
from pythia_identity_fixture import reference_package  # noqa: E402

YAHOO = {**CONTRACTS["yahoo"], "addressing": {**CONTRACTS["yahoo"]["addressing"],
                                              "venue_codes": {"AMS": "XAMS", "NMS": "XNAS"}}}
REF = {"provider": "yahoo", "native_id": "ASML.AS", "native_scope": "symbol"}


class ReadCheckTest(Fixture):
    def setUp(self):
        super().setUp()
        self.core = load_core()
        from pythia_core_queue_fixture import identity_ops, read_checks
        from pythia_core_queue_fixture.identity import page as core_page, validate_manifest
        self.checks, self.core_page = read_checks, core_page
        reference_package.install(make_package(Path(self.tmp.name) / "out", source=self.path), Path(self.tmp.name) / "core")
        # The plugin as the loaded core sees it (its enums are the core package's own).
        self.yahoo = core_page.PluginInfo(key="pythia-yahoo", manifest=validate_manifest(YAHOO))
        self.installed = unittest.mock.Mock(side_effect=lambda: [self.yahoo])
        patch = unittest.mock.patch.object(identity_ops, "installed", self.installed)
        patch.start()
        self.addCleanup(patch.stop)
        self.ops = identity_ops.Identity(types.SimpleNamespace(state=types.SimpleNamespace(data_dir=Path(self.tmp.name) / "core")))
        self.addCleanup(lambda: self.ops.store.db.close())

    def check(self, subject_id=ASML, **stated):
        return self.checks.check_read(self.ops, subject_id, REF, stated)["status"]

    def quote(self):
        view = json.loads(self.ops.subject({"subject_id": ASML}))["data"]
        return next(section for section in view["sections"] if section["section"] == "quote")

    def label(self):
        quote = self.quote()
        return quote["status"], quote["binding_status"], bool(quote["verified_at"]), quote["unverified"]

    def test_a_matching_read_verifies_the_derived_address(self):
        self.assertEqual(self.label(), ("ready", "derived", False, None))
        self.assertEqual(self.check(currency="EUR", venue="AMS"), "verified")
        self.assertEqual(self.label(), ("ready", "derived", True, None))
        # A derived address stays an address: the check is no binding.
        self.assertIsNone(self.identity.binding_for(identity.ProviderRef(**REF)))

    def test_an_explicit_read_is_checked_for_the_subject_the_page_served_it_for(self):
        self.assertEqual(self.check(None, currency="EUR"), "unchecked")  # no page has served it yet
        self.quote()
        self.assertEqual(self.check(None, currency="EUR"), "verified")

    def test_differences_label_the_source_and_never_refuse_it_or_open_repairs(self):
        self.assertEqual(self.check(currency="USD", venue="AMS"), "unverified")
        self.assertEqual(self.label(), ("ready", "derived", False, "currency differs"))
        # NMS is Nasdaq: ASML's share has no Nasdaq line (its registry shares are another security).
        self.assertEqual(self.check(currency="USD", venue="NMS"), "unverified")
        self.assertEqual(self.label(), ("ready", "derived", False, "venue and currency differ"))
        self.assertEqual(self.identity.queue_items(subject_ids=[ASML]), [])
        # A venue code the contract does not map is never compared, nor is a name.
        self.assertEqual(self.check(currency="EUR", venue="XYZ", name="ASML HOLDING NV"), "verified")

    def test_an_enforced_difference_refuses_until_a_read_agrees(self):
        patch = unittest.mock.patch.object(self.core_page, "ENFORCED", frozenset({"venue"}))
        patch.start()
        self.addCleanup(patch.stop)
        self.assertEqual(self.check(currency="EUR", venue="NMS"), "refused")
        self.assertEqual(self.quote()["status"], "conflict")
        self.assertEqual(self.ops.price_sources(ASML)["refs"], [])
        self.assertEqual(self.check(currency="EUR", venue="AMS"), "verified")
        self.assertEqual(self.quote()["status"], "ready")

    def test_an_unaudited_source_never_stamps_verified(self):
        patch = unittest.mock.patch.object(type(self.yahoo.manifest), "unaudited", True, create=True)
        patch.start()
        self.addCleanup(patch.stop)
        self.assertEqual(self.check(currency="EUR", venue="AMS"), "unverified")
        self.assertEqual(self.label(), ("ready", "derived", False, "source not audited"))

    def test_a_read_is_checked_once_per_window(self):
        with unittest.mock.patch.object(self.checks.time, "monotonic", return_value=1000.0):
            self.assertEqual([self.check(currency="EUR"), self.check(currency="EUR")], ["verified", "verified"])
            self.assertEqual(self.installed.call_count, 1)
            self.assertEqual(self.check(currency="USD"), "unverified")  # other stated values are checked at once
        self.assertEqual(self.installed.call_count, 2)
        with unittest.mock.patch.object(self.checks.time, "monotonic", return_value=1000.0 + self.checks.CHECK_EVERY + 1):
            self.check(currency="EUR")
        self.assertEqual(self.installed.call_count, 3)


if __name__ == "__main__":
    unittest.main()
