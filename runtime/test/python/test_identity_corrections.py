"""The investor's corrections to the catalogue (ADR 0044, amendment "user catalogue corrections"): set or remove an
identifier, pin the price source. A correction is a local override above the reference, a plugin and the investor's own
answers to questions; the agent can only propose one; undo returns the data to what it was; a re-key carries it along.
The plugins are the fixtures core never names (Meridian and Atlas, sources of lines; Tidepool, a DeFi source)."""
import contextvars
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from test_identity_device_questions import ATLAS, BY_FIGI, FIGI_A, FIGI_B, FIGI_C, Questions, atlas_line
from test_identity_peers import APPLE_LINE, MERIDIAN, OTHER_FIGI, SAP_BY_FIGI, SAP_FIGI, TIDEPOOL
from pythia_identity_fixture import corrections, device, store  # noqa: E402

ASML_LINE, ASML = "listing:isin:NL0010273215:XAMS:EUR", "security:isin:NL0010273215"
ISSUER = "issuer:lei:724500Y6DUVHQD6OXN27"
APPLE_ISIN, APPLE_LEI = "US0378331005", "HWUPKR0MPOU8FGXBT394"
QUOTES = {"addressing": {"native": [{"native_scope": "symbol", "level": "listing"}], "mic_table": {"XAMS": ".AS"}}}


class CorrectionFixture(Questions):
    def send(self, function, arguments, *, user=True):
        """One call of core's operation as the Desk (`user`) or as a model tool call."""
        from pythia_core_queue_fixture.platform import request_context
        context = contextvars.copy_context()
        if user:
            context.run(request_context.usage.set, "dashboard")
        return json.loads(context.run(function, self.ops, arguments))["data"]

    def correct(self, *, user=True, **arguments):
        from pythia_core_queue_fixture import correction_ops
        return self.send(correction_ops.submit, arguments, user=user)

    def rows(self, *states):
        return self.ops.store.select("SELECT * FROM corrections" + (f" WHERE state IN ({','.join('?' * len(states))})"
                                                                     if states else "") + " ORDER BY rowid", states)

    def generation(self):
        return device.generation(self.ops.store)


class IdentifierTest(CorrectionFixture):
    def test_a_set_identifier_beats_the_reference_search_follows_and_undo_restores_the_data(self):
        self.assertEqual(self.page(ASML_LINE)["identifiers"]["isin"], "NL0010273215")
        generation = self.generation()
        done = self.correct(kind="identifier", subject_id=ASML, scheme="isin", value=APPLE_ISIN.lower(), note="typo")
        self.assertEqual(done["outcome"], "set")
        self.assertGreater(self.generation(), generation)  # search renews
        for saved in (ASML_LINE, ASML):  # the listing's page and the security's alike
            view = self.page(saved)
            self.assertEqual((view["identifiers"]["isin"], view["security"]["isin"]), (APPLE_ISIN, APPLE_ISIN))
            self.assertEqual(view["provenance"]["isin"], {"source": "user", "plugin": "user",
                                                          "authority": "user_attested", "correction": done["id"]})
        self.assertEqual([(item["kind"], item["state"], item["value"]) for item in self.page(ASML_LINE)["corrections"]],
                         [("identifier", "active", APPLE_ISIN)])
        self.assertIn(ASML_LINE, self.found(APPLE_ISIN))  # the corrected value finds it,
        self.assertNotIn(ASML_LINE, self.found("NL0010273215"))  # and the old one no longer does
        [row] = self.rows()
        self.assertEqual((row["state"], row["proposed_by"], row["note"], row["replaces"]), ("active", None, "typo", None))
        self.assertTrue(row["user_turn"].startswith("desk:identity-correction:"))

        removed = self.correct(kind="identifier", subject_id=ASML, scheme="isin", value="")  # replaces it: removed
        self.assertNotIn("isin", self.page(ASML_LINE)["identifiers"])
        self.assertEqual([(item["state"], item["replaces"]) for item in self.rows()],
                         [("undone", None), ("active", done["id"])])
        self.assertEqual(self.correct(action="undo", id=removed["id"])["outcome"], "undone")
        view = self.page(ASML_LINE)
        self.assertEqual((view["identifiers"]["isin"], view["provenance"]["isin"]["plugin"], view["corrections"]),
                         ("NL0010273215", "reference", []))
        self.assertIn(ASML_LINE, self.found("NL0010273215"))
        self.assertEqual([item["state"] for item in self.rows()], ["undone", "undone"])  # history is kept
        self.assertEqual(self.correct(action="undo", id=removed["id"])["outcome"], "refused")  # once

    def test_it_beats_a_plugin_that_no_one_contradicts(self):
        key = self.meridian()
        self.sync(key)
        self.assertEqual(self.page(SAP_BY_FIGI)["identifiers"]["figi"], SAP_FIGI)
        self.correct(kind="identifier", subject_id=SAP_BY_FIGI, scheme="figi", value=OTHER_FIGI)
        self.assertEqual(self.page(SAP_BY_FIGI)["identifiers"]["figi"], OTHER_FIGI)
        self.sync(key)  # the source states its own value again: a sync cannot revive what the correction overrode
        self.assertEqual(self.page(SAP_BY_FIGI)["identifiers"]["figi"], OTHER_FIGI)
        self.correct(kind="identifier", subject_id=ASML, scheme="isin", value=APPLE_ISIN)  # search, with a plugin on
        self.assertEqual((ASML_LINE in self.found(APPLE_ISIN), ASML_LINE in self.found("NL0010273215")), (True, False))

    def test_it_beats_the_investors_answer_and_a_contest_and_undo_returns_to_them(self):
        self.contest(microsoft=False)
        self.page(APPLE_LINE)
        [item] = self.asked()
        self.answer(item["id"], "same_listing", f"listing:figi:{FIGI_B}")
        self.assertEqual(self.page(APPLE_LINE)["identifiers"]["figi"], FIGI_B)
        done = self.correct(kind="identifier", subject_id=APPLE_LINE, scheme="figi", value=FIGI_C)  # a saved, re-keyed ID
        view = self.page(BY_FIGI)
        self.assertEqual((view["identifiers"]["figi"], view["provenance"]["figi"]["correction"]), (FIGI_C, done["id"]))
        self.correct(action="undo", id=done["id"])
        self.assertEqual(self.page(BY_FIGI)["identifiers"]["figi"], FIGI_B)  # the investor's answer applies again
        self.assertEqual(self.answer(item["id"], "reopen")["outcome"], "reopened")
        self.assertNotIn("figi", self.page(BY_FIGI)["identifiers"])  # contested: neither value applies
        self.correct(kind="identifier", subject_id=BY_FIGI, scheme="figi", value=FIGI_A)  # a correction settles it too
        view = self.page(BY_FIGI)
        self.assertEqual((view["identifiers"]["figi"], "contested" in view), (FIGI_A, False))


class ProposalTest(CorrectionFixture):
    def test_the_agent_only_proposes_and_the_investor_confirms_or_declines_in_desk(self):
        generation = self.generation()
        proposed = self.correct(user=False, kind="identifier", subject_id=ASML, scheme="isin", value=APPLE_ISIN,
                                note="the filing says so")
        self.assertEqual(proposed["outcome"], "proposed")
        [row] = self.rows()
        self.assertEqual((row["state"], row["proposed_by"], row["user_turn"], row["decided_at"]),
                         ("proposed", "agent", None, None))
        view = self.page(ASML_LINE)  # it applies to nothing, and the page lists it as waiting
        self.assertEqual((view["identifiers"]["isin"], [item["state"] for item in view["corrections"]]),
                         ("NL0010273215", ["proposed"]))
        self.assertEqual((self.generation(), ASML_LINE in self.found("NL0010273215")), (generation, True))
        for action in ("confirm", "decline", "undo"):  # none of these is the agent's
            with self.subTest(action=action):
                self.assertEqual(self.correct(user=False, action=action, id=proposed["id"])["outcome"], "refused")
        self.assertEqual(self.rows()[0]["state"], "proposed")
        with self.assertRaises(sqlite3.IntegrityError):  # the table refuses an active row without the user's turn
            self.ops.store.db.execute("UPDATE corrections SET state = 'active' WHERE id = ?", (proposed["id"],))

        again = self.correct(user=False, kind="identifier", subject_id=ASML, scheme="isin", value=APPLE_ISIN)
        self.assertEqual([item["state"] for item in self.rows()], ["undone", "proposed"])  # a newer one replaces it
        self.assertEqual(self.correct(action="confirm", id=again["id"], note="checked")["outcome"], "confirmed")
        [_, row] = self.rows()
        self.assertEqual((row["state"], row["proposed_by"], row["note"]), ("active", "agent", "checked"))
        self.assertTrue(row["user_turn"].startswith("desk:identity-correction:"))
        self.assertEqual(self.page(ASML_LINE)["identifiers"]["isin"], APPLE_ISIN)
        self.assertGreater(self.generation(), generation)

        third = self.correct(user=False, kind="identifier", subject_id=ASML, scheme="isin", value="")
        self.assertEqual(self.correct(action="decline", id=third["id"])["outcome"], "declined")
        self.assertEqual(self.page(ASML_LINE)["identifiers"]["isin"], APPLE_ISIN)  # declined: nothing changed
        self.assertEqual(self.correct(action="confirm", id=third["id"])["outcome"], "refused")  # no longer a proposal

    def test_a_correction_the_core_cannot_take_is_refused_and_writes_nothing(self):
        self.install("tidepool-community", TIDEPOOL)
        self.install("pythia-meridian", {**MERIDIAN, **QUOTES})
        for label, arguments, message in (
                ("a reserved kind", {"kind": "parent", "subject_id": ASML_LINE, "value": ASML}, "not available yet"),
                ("an unknown kind", {"kind": "rename", "subject_id": ASML}, "is one of"),
                ("no subject", {"kind": "identifier", "scheme": "isin"}, "Name the subject"),
                ("an unknown scheme", {"kind": "identifier", "subject_id": ASML, "scheme": "sedol", "value": "B0YBKJ7"},
                 "Unknown identifier scheme"),
                ("a ticker", {"kind": "identifier", "subject_id": ASML_LINE, "scheme": "ticker_mic", "value": "ASML@XAMS"},
                 "ticker is not corrected"),
                ("a scheme of another level", {"kind": "identifier", "subject_id": ASML_LINE, "scheme": "isin",
                                               "value": APPLE_ISIN}, "identifies a security"),
                ("an unknown subject", {"kind": "identifier", "subject_id": "security:isin:DE000BAY0017",
                                        "scheme": "isin", "value": APPLE_ISIN}, "Unknown subject"),
                ("a bad check digit", {"kind": "identifier", "subject_id": ASML, "scheme": "isin",
                                       "value": "US0378331006"}, "isin"),
                ("a price for a company", {"kind": "price_source", "subject_id": ISSUER, "value": "meridian"}, "no price"),
                ("a source not installed", {"kind": "price_source", "subject_id": ASML_LINE, "value": "nowhere"},
                 "installed source"),
                ("a source with no prices", {"kind": "price_source", "subject_id": ASML_LINE, "value": "tidepool"},
                 "does not serve prices")):
            with self.subTest(label):
                for user in (True, False):
                    result = self.correct(user=user, **arguments)
                    self.assertEqual(result["outcome"], "refused")
                    self.assertIn(message, result["message"])
        self.assertEqual(self.rows(), [])

    def test_an_identifier_another_subject_holds_is_a_warning_not_a_refusal(self):
        done = self.correct(kind="identifier", subject_id=ASML, scheme="isin", value="USN070592100")  # the receipt's
        self.assertEqual(done["outcome"], "set")
        self.assertIn("security:figi:BBG001SCG0R3", done["warning"])
        self.assertEqual(self.page(ASML_LINE)["identifiers"]["isin"], "USN070592100")

    def test_a_company_identifier_is_corrected_on_the_issuer(self):
        self.correct(kind="identifier", subject_id=ISSUER, scheme="lei", value=APPLE_LEI)
        view = self.page(ASML_LINE)
        self.assertEqual((view["identifiers"]["lei"], view["issuer"]["lei"]), (APPLE_LEI, APPLE_LEI))
        self.assertEqual(self.page(ASML)["identifiers"]["cik"], "0000937966")  # the company's other identifier stands


class PinTest(CorrectionFixture):
    def setUp(self):
        super().setUp()
        for name in ("alpha", "beta"):
            self.install(f"pythia-{name}", {**MERIDIAN, **QUOTES, "plugin": name, "provider": name})

    def order(self, subject=ASML_LINE):
        return [ref["provider"] for ref in self.ops.price_sources(subject)["refs"]]

    def quote(self, subject=ASML_LINE):
        return next(section for section in self.page(subject)["sections"] if section["section"] == "quote")

    def test_a_pinned_source_leads_the_price_and_undo_returns_the_order(self):
        self.assertEqual(self.order(), ["alpha", "beta"])  # the default order: by plugin id
        done = self.correct(kind="price_source", subject_id=ASML_LINE, value="pythia-beta")  # named by its key
        self.assertEqual(self.rows()[0]["value"], "beta")  # stored by the contract's name
        self.assertEqual(self.order(), ["beta", "alpha"])
        lead = self.quote()
        self.assertEqual((lead["plugin"], lead["notice"]), ("pythia-beta", None))  # pinned and serving: no amber
        self.assertEqual([(item["kind"], item["state"]) for item in self.page(ASML_LINE)["corrections"]],
                         [("price_source", "active")])
        self.correct(action="undo", id=done["id"])
        self.assertEqual((self.order(), self.quote()["plugin"]), (["alpha", "beta"], "pythia-alpha"))

    def test_a_pin_on_the_security_covers_its_lines_and_one_on_a_line_beats_it(self):
        self.correct(kind="price_source", subject_id=ASML, value="beta")
        self.assertEqual((self.order(ASML_LINE), self.order(ASML)), (["beta", "alpha"], ["beta", "alpha"]))
        line = self.correct(kind="price_source", subject_id=ASML_LINE, value="alpha")
        self.assertEqual((self.order(ASML_LINE), self.order(ASML)), (["alpha", "beta"], ["alpha", "beta"]))  # its line
        self.correct(action="undo", id=line["id"])
        self.assertEqual(self.order(ASML_LINE), ["beta", "alpha"])

    def test_a_pinned_source_that_cannot_serve_is_passed_over_with_the_amber_notice(self):
        self.disabled.add("pythia-beta")
        self.assertIsNone(self.quote()["notice"])  # a source that is off and unnamed is setup, not a warning
        self.correct(kind="price_source", subject_id=ASML_LINE, value="beta")
        lead = self.quote()
        self.assertEqual((lead["plugin"], lead["notice"]["plugin"], lead["notice"]["code"]),
                         ("pythia-alpha", "pythia-beta", "disabled"))
        self.assertEqual(self.order(), ["alpha"])  # prices still come from the next source


class RekeyTest(CorrectionFixture):
    def test_a_correction_follows_its_device_subject_when_a_better_key_re_keys_it(self):
        key = self.meridian()
        self.sync(key)
        done = self.correct(kind="price_source", subject_id=APPLE_LINE, value="meridian")
        self.assertEqual(self.rows()[0]["subject_id"], APPLE_LINE)
        self.install("atlas", ATLAS)  # Atlas gives the line a FIGI: a better key than its CGS-area ISIN
        self.pages[("atlas", "lines")] = [atlas_line("AAPL", ("isin", APPLE_ISIN), ("figi", FIGI_A), ticker="AAPL",
                                                      name="Apple Inc.")]
        self.sync("atlas")
        self.assertEqual(self.page(BY_FIGI)["subject"]["id"], BY_FIGI)
        self.assertEqual([(item["id"], item["subject_id"]) for item in self.rows("active")], [(done["id"], BY_FIGI)])
        self.assertEqual([item["id"] for item in self.page(APPLE_LINE)["corrections"]], [done["id"]])  # by the saved ID


class StoreTest(unittest.TestCase):
    def test_a_store_made_before_corrections_gains_the_table_and_keeps_its_rows(self):
        directory = Path(self.enterContext(tempfile.TemporaryDirectory()))
        first = store.IdentityStore(directory)
        first.set_metadata("generation", "7")
        first.db.execute("DROP TABLE corrections")  # a schema 6 store from before the table
        first.db.close()
        reopened = store.IdentityStore(directory)
        self.addCleanup(reopened.db.close)
        self.assertEqual((reopened.set_aside, reopened.metadata("generation"), reopened.select("SELECT * FROM corrections")),
                         (None, "7", []))
        corrections.put(reopened, {"kind": "price_source", "subject_id": ASML_LINE, "scheme": None, "value": "meridian"},
                        now="2026-09-30T10:00:00Z", user_turn="desk:identity-correction:test", note=None)
        reopened.db.close()
        again = store.IdentityStore(directory)
        self.addCleanup(again.db.close)
        self.assertEqual([row["state"] for row in again.select("SELECT state FROM corrections")], ["active"])


if __name__ == "__main__":
    unittest.main()
