"""Read checks (ADR 0037): what a source's own read states about the reference it serves, against the reference."""
import json
import sqlite3
import types
import unittest
import unittest.mock
from pathlib import Path

from test_identity_contracts import identity
from test_identity_page import ASML, CONTRACTS, Fixture
from test_identity_queue import load_core
from pythia_identity_fixture import page, queue, store  # noqa: E402

YAHOO = {**CONTRACTS["yahoo"], "addressing": {**CONTRACTS["yahoo"]["addressing"],
                                              "venue_codes": {"AMS": "XAMS", "NMS": "XNAS"}}}
REF = {"provider": "yahoo", "native_id": "ASML.AS", "native_scope": "symbol"}


class ReadCheckTest(Fixture):
    def setUp(self):
        super().setUp()
        self.core = load_core()
        from pythia_core_queue_fixture import identity_ops, read_checks
        from pythia_core_queue_fixture.identity import page as core_page, validate_manifest
        self.checks = read_checks
        builds = Path(self.tmp.name) / "builds"
        builds.mkdir()
        (builds / self.path.name).write_bytes(self.path.read_bytes())
        with sqlite3.connect(builds / self.path.name) as db:
            db.execute("INSERT INTO release (key, value) VALUES ('schema_version', ?)", (store.REFERENCE_SCHEMA_VERSION,))
        # The plugin as the loaded core sees it (its enums are the core package's own).
        self.yahoo = core_page.PluginInfo(key="pythia-yahoo", manifest=validate_manifest(YAHOO))
        self.installed = unittest.mock.Mock(side_effect=lambda: [self.yahoo])
        for patch in (unittest.mock.patch.dict("os.environ", {store.REFERENCE_DIR_ENV: str(builds)}),
                      unittest.mock.patch.object(identity_ops, "installed", self.installed)):
            patch.start()
            self.addCleanup(patch.stop)
        self.ops = identity_ops.Identity(types.SimpleNamespace(state=types.SimpleNamespace(data_dir=Path(self.tmp.name) / "core")))
        self.addCleanup(lambda: self.ops.store.db.close())

    def check(self, **stated):
        return self.checks.check_read(self.ops, ASML, REF, stated)

    def quote(self):
        view = json.loads(self.ops.subject({"subject_id": ASML}))["data"]
        return next(section for section in view["sections"] if section["section"] == "quote")

    def row(self):
        return self.identity.binding_for(identity.ProviderRef(**REF))

    def open_items(self):
        return self.identity.queue_items(subject_ids=[ASML])

    def test_a_matching_read_verifies_the_derived_address(self):
        self.assertEqual(self.quote()["verified_at"], None)
        self.assertEqual(self.check(currency="EUR", venue="AMS"), "verified")
        row = self.row()
        self.assertEqual((row["subject_id"], row["status"], row["rule_id"]), (ASML, "candidate", page.READ_RULE))
        quote = self.quote()
        self.assertEqual((quote["status"], quote["binding_status"], quote["binding"]["native_id"], quote["verified_at"]),
                         ("ready", "derived", "ASML.AS", row["verified_at"]))
        self.assertEqual(self.open_items(), [])

    def test_an_isin_mismatch_opens_a_conflict_and_the_source_is_refused(self):
        # Yahoo's line would state the New York Registry Shares' ISIN: another security than ASML's share.
        self.assertEqual(self.check(isin="USN070592100", currency="EUR"), "refused")
        [item] = self.open_items()
        self.assertEqual((item["kind"], item["reason"], item["plugins"], item["provider_ref"]["native_id"]),
                         ("conflict", "binding", ["yahoo"], "ASML.AS"))
        record = queue.inspect(self.identity, self.ref, item["id"])["record"]
        self.assertEqual([entry["value"] for entry in record["identifiers"]], ["USN070592100"])
        self.assertEqual((self.row()["status"], self.quote()["status"]), ("conflicting", "conflict"))
        self.assertEqual(json.loads(json.dumps(self.ops.price_sources(ASML)))["refs"], [])
        # Identifier evidence contradicts the record: not even the user can confirm it.
        answer = queue.submit(self.identity, self.ref, item_id=item["id"], resolver="user", relation="same_listing",
                              chosen_id=ASML, now="2026-09-28T10:00:00Z", as_of="2026-09-28",
                              user_turn="desk:identity-verdict:test")
        self.assertEqual(answer["outcome"], "blocked")

    def test_a_currency_mismatch_is_refused_until_the_user_confirms_the_line(self):
        self.assertEqual(self.check(currency="USD"), "refused")
        self.assertEqual(self.quote()["status"], "conflict")
        [item] = self.open_items()
        # The rules resolver re-asks resolve answers; a read check is none, so it stays open.
        self.assertEqual(queue.settle_by_rules(self.identity, self.ref, [self.yahoo], [item], now="2026-09-28T10:00:00Z",
                                               as_of="2026-09-28"), [])
        self.assertEqual([entry["id"] for entry in self.open_items()], [item["id"]])
        answer = queue.submit(self.identity, self.ref, item_id=item["id"], resolver="user", relation="same_listing",
                              chosen_id=ASML, now="2026-09-28T10:00:00Z", as_of="2026-09-28",
                              user_turn="desk:identity-verdict:test")
        self.assertEqual(answer["outcome"], "confirmed")
        self.assertEqual((self.quote()["status"], self.quote()["binding_status"]), ("ready", "confirmed"))
        # The user answered this question: the same read no longer asks it or stops the binding (a refusal is
        # never kept for the window).
        self.assertEqual(self.check(currency="USD"), "questioned")
        self.assertEqual((self.open_items(), self.row()["status"]), ([], "confirmed"))

    def test_a_venue_where_the_security_has_no_line_is_refused(self):
        self.assertEqual(self.check(currency="EUR", venue="XYZ"), "verified")  # a code the contract does not map
        # NMS is Nasdaq: ASML's share has no Nasdaq line (its registry shares are another security).
        self.assertEqual(self.check(currency="EUR", venue="NMS"), "refused")
        # A refused reference no longer serves the subject, so nothing checks it again.
        self.assertEqual(self.check(currency="EUR", venue="AMS"), "unchecked")

    def test_a_name_variant_is_not_a_conflict(self):
        self.assertEqual(self.check(currency="EUR", name="ASML HOLDING NV"), "verified")
        self.assertEqual(self.check(name="ASML Hldg"), "unchecked")  # a name alone is never compared
        self.assertEqual(self.open_items(), [])

    def test_a_read_is_checked_once_per_window(self):
        with unittest.mock.patch.object(self.checks.time, "monotonic", return_value=1000.0):
            self.assertEqual([self.check(currency="EUR"), self.check(currency="EUR")], ["verified", "verified"])
        self.assertEqual(self.installed.call_count, 1)
        with unittest.mock.patch.object(self.checks.time, "monotonic", return_value=1000.0):
            self.assertEqual(self.check(currency="USD"), "refused")  # other stated values are checked at once
        self.assertEqual(self.installed.call_count, 2)
        with unittest.mock.patch.object(self.checks.time, "monotonic",
                                        return_value=1000.0 + self.checks.CHECK_EVERY + 1):
            self.check(currency="EUR")
        self.assertEqual(self.installed.call_count, 3)


if __name__ == "__main__":
    unittest.main()
