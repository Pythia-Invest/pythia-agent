"""Questions and overrides for plugin-introduced subjects (ADR 0044 A2; ADR 0037, amendment "questions on touch").

A subject only the device holds is asked about like a reference one. Two different plugins that state different values
of one identifier contest it, and so does one plugin that now states another value than it did. Each is queued once,
when the subject is opened (never at ingest), and the source names the plugins; the user's answer is a local override on
the subject's reads, through its device aliases, and Reopen undoes it. The agent's answer stays a suggestion. The
plugins are the acceptance test's fixtures (Meridian, a financial source, and Atlas, a second one), which core never
names.
"""
import contextvars
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from identity_world import AS_OF, NOW, World
from test_identity_ingest import ERIC_B_LINE, record as record_of, source
from test_identity_peers import (
    APPLE_LINE, MERIDIAN, OTHER_FIGI, SAP, SAP_BY_FIGI, SAP_BY_ISIN, SAP_FIGI, SAP_ISIN, PeersFixture, line, record)
from pythia_identity_fixture import build_questions, conflicts, device, reference_package, store  # noqa: E402

ATLAS = {**MERIDIAN, "plugin": "atlas", "provider": "atlas"}
MSFT_ISIN, MSFT_LINE = "US5949181045", "listing:cgs_isin:US5949181045:XNAS:USD"
FIGI_A, FIGI_B, FIGI_C, FIGI_D = "BBG000B9XRY4", "BBG000B9Y5X2", "BBG000BPH459", "BBG000BPHDD0"
BY_FIGI = f"listing:figi:{FIGI_A}"  # Apple's line once Atlas gives it a FIGI: a better key than its CGS-area ISIN
GSK_ISIN = "GB00BN7SWP63"  # in the reference world; SAP is in none
GSK = f"security:isin:{GSK_ISIN}"


def atlas_line(native_id, *identifiers, **attributes):
    return record("atlas", "line", native_id, "listing", *identifiers, operating_mic="XNAS", currency="USD", **attributes)


class Questions(PeersFixture):
    def answer(self, item_id, relation, chosen_id=None, *, user=True):
        from pythia_core_queue_fixture.platform import request_context
        arguments = {"item_id": item_id, "relation": relation, **({"chosen_id": chosen_id} if chosen_id else {})}
        desk = contextvars.copy_context()
        if user:
            desk.run(request_context.usage.set, "dashboard")
        return json.loads(desk.run(self.queue_ops.submit_verdict, self.ops, arguments))["data"]

    def asked(self, **arguments):
        return (json.loads(self.queue_ops.read_queue(self.ops, arguments))["data"] or {}).get("items", [])

    def contest(self, *, microsoft=True):
        """Apple's (and Microsoft's) line, introduced by Meridian and moved up by Atlas's FIGI, which Meridian's record
        then contradicts: the line's FIGI is contested between the two plugins."""
        key = self.meridian()
        self.install("atlas", ATLAS)
        lines = self.pages[("meridian", "lines")]
        if microsoft:
            lines.append(line("MSFT.OQ", ("isin", MSFT_ISIN), mic="XNAS", currency="USD", ticker="MSFT", name="Microsoft"))
        self.sync(key)
        self.pages[("atlas", "lines")] = [
            atlas_line("AAPL", ("isin", "US0378331005"), ("figi", FIGI_A), ticker="AAPL", name="Apple Inc."),
            *([atlas_line("MSFT", ("isin", MSFT_ISIN), ("figi", FIGI_C), ticker="MSFT", name="Microsoft")]
              if microsoft else [])]
        self.sync("atlas")
        lines[2] = line("AAPL.OQ", ("isin", "US0378331005"), ("figi", FIGI_B), mic="XNAS", currency="USD", ticker="AAPL",
                        name="Apple Inc.")
        if microsoft:
            lines[3] = line("MSFT.OQ", ("isin", MSFT_ISIN), ("figi", FIGI_D), mic="XNAS", currency="USD", ticker="MSFT",
                            name="Microsoft")
        self.assertEqual(self.sync(key)["conflicts"], 1 + microsoft)
        self.assertEqual(self.ops.store.queue_items(), [], "ingest queues nothing")


class DeviceQuestionTest(Questions):
    """Apple and Microsoft's lines, each contested between two plugins. Only Apple's is opened."""

    def setUp(self):
        super().setUp()
        self.contest()

    def test_the_contest_is_asked_once_when_the_subject_is_opened_and_names_its_plugins(self):
        self.assertEqual(self.page(APPLE_LINE)["contested"]["figi"][0]["sources"], ["atlas"])  # a saved, re-keyed ID
        [item] = self.asked()
        self.assertEqual((item["kind"], item["reason"], item["subject_ids"], item["candidate_ids"], item["label"]),
                         ("conflict", "identifier", [BY_FIGI], [BY_FIGI, f"listing:figi:{FIGI_B}"], "atlas and meridian"))
        self.assertEqual(item["plugins"], ["reference", "atlas", "meridian"])
        self.assertEqual({(entry["value"], entry["source"]) for entry in item["evidence"]},
                         {(FIGI_A, "atlas"), (FIGI_B, "meridian")})  # which plugin said which value
        self.assertEqual([entry["id"] for entry in self.asked(plugin="atlas")], [item["id"]])  # filtered by its plugins
        self.assertEqual({entry["relation"] for entry in item["answers"] if entry["chosen_id"]}, {"same_listing"})
        for _ in range(2):  # opening it again, or the agent reading it, asks nothing more
            self.page(BY_FIGI)
            self.assertEqual(len(self.asked(subject_id=APPLE_LINE)), 1)
        self.assertEqual(len(self.ops.store.queue_items()), 1, "Microsoft's line was never opened: nothing is asked")
        self.page(MSFT_LINE)
        self.assertEqual(len(self.ops.store.queue_items()), 2)

    def test_the_users_answer_is_a_local_override_the_agents_is_a_suggestion_and_reopen_undoes_it(self):
        self.page(APPLE_LINE)
        [item] = self.asked()
        second = f"listing:figi:{FIGI_B}"
        suggested = self.answer(item["id"], "same_listing", second, user=False)  # the agent's
        self.assertEqual((suggested["outcome"], suggested["state"]), ("suggested", "open"))
        view = self.page(APPLE_LINE)
        self.assertEqual(("figi" in view["identifiers"], len(view["contested"]["figi"])), (False, 2))
        self.assertEqual(self.asked()[0]["agent_answer"], {"by": "agent", "relation": "same_listing", "chosen_id": second})
        self.assertEqual(self.answer(item["id"], "reopen", user=False)["outcome"], "refused")  # the Desk's undo only
        done = self.answer(item["id"], "same_listing", second)  # the user's
        self.assertEqual((done["outcome"], done["state"], done["authority"]), ("confirmed", "resolved", "user_attested"))
        for saved in (APPLE_LINE, BY_FIGI):  # by the saved ID it was re-keyed from, and by its own
            view = self.page(saved)
            self.assertEqual((view["identifiers"]["figi"], "contested" in view, view["provenance"]["figi"]["authority"]),
                             (FIGI_B, False, "user_attested"))
            self.assertNotIn("conflicting_identifier", [flag["code"] for flag in view["flags"]])
        self.assertEqual((self.ops.store.queue_items(), self.asked()), ([], []), "answered: never asked again")
        self.assertEqual(self.answer(item["id"], "reopen")["outcome"], "reopened")
        view = self.page(APPLE_LINE)
        self.assertEqual(("figi" in view["identifiers"], len(view["contested"]["figi"])), (False, 2))
        [again] = self.asked()
        self.assertEqual((again["id"] != item["id"], again["label"]), (True, "atlas and meridian"))
        self.assertEqual(self.ops.store.queue_item(item["id"])["state"], "superseded")  # the answer kept as history


class NoPackageTest(Questions):
    """With no reference package installed, a device subject's plugin conflict is asked, answered and reopened too."""

    def test_a_plugin_conflict_is_asked_answered_and_reopened_with_no_package(self):
        reference_package.remove(self.ops.data_dir)
        self.contest(microsoft=False)
        body = json.loads(self.queue_ops.read_queue(self.ops, {}))
        self.assertEqual((body["outcome"], body["issues"][0]["message"]), ("empty", self.queue_ops.REMOVED))
        self.assertEqual(self.page(APPLE_LINE)["contested"]["figi"][0]["sources"], ["atlas"])
        [item] = self.asked()
        second = f"listing:figi:{FIGI_B}"
        self.assertEqual((item["label"], item["candidate_ids"]), ("atlas and meridian", [BY_FIGI, second]))
        self.assertEqual(self.answer(item["id"], "same_listing", second, user=False)["outcome"], "suggested")
        self.assertEqual(self.answer(item["id"], "same_listing", second)["state"], "resolved")
        self.assertEqual((self.page(BY_FIGI)["identifiers"]["figi"], self.asked()), (FIGI_B, []))
        self.assertEqual(self.answer(item["id"], "reopen")["outcome"], "reopened")
        self.assertEqual(("figi" in self.page(BY_FIGI)["identifiers"], len(self.asked())), (False, 1))


class SelfContradictionTest(Questions):
    """A line whose ID spells an identifier, and whose plugin's record later states another one (PR #119's walk-around
    closed: the conflict lasts). One plugin contradicting itself contests no fact, so the user would never be asked;
    opening the line queues one question, and the answer is a local override."""

    def setUp(self):
        super().setUp()
        self.key = self.meridian()
        self.sync(self.key)

    def saved(self, *identifiers):
        """Meridian's record for the SAP line as its source now states it, synced."""
        self.pages[("meridian", "lines")][1] = line("SAP.DE", *identifiers, ticker="SAP")
        self.sync(self.key)

    def test_a_line_whose_record_names_another_isin_asks_which_security_it_belongs_to(self):
        sap = (("figi", SAP_FIGI), ("isin", SAP_ISIN))
        self.saved(*sap)
        self.saved(*sap[:1], ("isin", GSK_ISIN))
        self.assertEqual((self.placed("SAP.DE"), self.ops.store.queue_items()), ((SAP_BY_ISIN, "conflict"), []))
        self.assertEqual(self.page(SAP_BY_FIGI)["security"]["id"], SAP, "the line stays under SAP's security")
        [item] = self.asked()
        self.assertEqual((item["reason"], item["subject_ids"], item["candidate_ids"], item["label"]),
                         ("identifier", [SAP_BY_ISIN], [SAP, GSK], "meridian"))
        self.assertEqual({entry["relation"] for entry in item["answers"] if entry["chosen_id"]}, {"same_security"})
        self.assertEqual(self.answer(item["id"], "same_security", GSK, user=False)["outcome"], "suggested")
        self.assertEqual(self.page(SAP_BY_FIGI)["security"]["id"], SAP)  # the agent's answer changes nothing
        self.assertEqual(self.answer(item["id"], "same_security", GSK)["state"], "resolved")
        for saved in (SAP_BY_FIGI, SAP_BY_ISIN):
            view = self.page(saved)
            self.assertEqual((view["security"]["id"], view["identifiers"]["isin"], view["provenance"]["isin"]["authority"]),
                             (GSK, GSK_ISIN, "user_attested"))
        self.assertEqual(self.asked(), [])
        self.saved(*sap[:1], ("isin", GSK_ISIN))  # the next sync changes nothing the user decided
        self.assertEqual((self.page(SAP_BY_FIGI)["security"]["id"], self.ops.store.queue_items()), (GSK, []))
        self.assertEqual(self.answer(item["id"], "reopen")["outcome"], "reopened")
        self.assertEqual((self.page(SAP_BY_FIGI)["security"]["id"], len(self.asked())), (SAP, 1))

    def test_keeping_the_first_isin_changes_nothing_and_is_not_asked_again(self):
        self.saved(("figi", SAP_FIGI), ("isin", SAP_ISIN))
        self.saved(("figi", SAP_FIGI), ("isin", GSK_ISIN))
        self.page(SAP_BY_ISIN)
        [item] = self.asked()
        self.assertEqual(self.answer(item["id"], "same_security", SAP)["state"], "resolved")
        self.assertEqual((self.page(SAP_BY_ISIN)["security"]["id"], self.asked()), (SAP, []))
        self.saved(("figi", SAP_FIGI), ("isin", SAP_ISIN))  # the source states it again: the conflict clears
        self.assertEqual((self.placed("SAP.DE"), self.page(SAP_BY_ISIN)["identifiers"]["isin"]),
                         ((SAP_BY_ISIN, "introduced"), SAP_ISIN))

    def test_a_line_whose_record_names_another_figi_asks_which_is_its_own_and_the_answer_survives_a_re_key(self):
        self.saved()
        self.saved(("figi", OTHER_FIGI))
        self.assertEqual((self.placed("SAP.DE"), self.page(SAP_BY_FIGI)["identifiers"]["figi"]),
                         ((SAP_BY_FIGI, "conflict"), SAP_FIGI))
        [item] = self.asked()
        other = f"listing:figi:{OTHER_FIGI}"
        self.assertEqual((item["subject_ids"], item["candidate_ids"]), ([SAP_BY_FIGI], [other, SAP_BY_FIGI]))  # by value
        self.assertEqual(self.answer(item["id"], "same_listing", other)["state"], "resolved")
        self.assertEqual(self.page(SAP_BY_FIGI)["identifiers"]["figi"], OTHER_FIGI)
        # The record then states the ISIN too, which re-keys the line: the saved ID is an alias, the question follows,
        # and the answer still applies; the source no longer states that FIGI, so its new statement is asked about.
        self.saved(("figi", SAP_FIGI), ("isin", SAP_ISIN))
        view = self.page(SAP_BY_FIGI)
        self.assertEqual((view["subject"]["id"], view["identifiers"]["figi"]), (SAP_BY_ISIN, OTHER_FIGI))
        self.assertEqual(self.ops.store.queue_item(item["id"])["subject_ids"], [SAP_BY_ISIN])
        self.assertEqual([entry["reason"] for entry in self.asked()], ["binding"])
        self.assertEqual(self.answer(item["id"], "reopen")["outcome"], "reopened")
        self.assertEqual(self.page(SAP_BY_FIGI)["identifiers"]["figi"], SAP_FIGI)


class ReKeyTest(unittest.TestCase):
    """The override survives a release that now holds the contested line: the device alias it writes re-points the
    question, and the answer still applies to the reference's subject (Lifecycle A, `lifecycle.covered`)."""

    def test_an_answer_follows_the_subject_through_a_release_that_holds_it_and_reopen_undoes_it(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        world = World(Path(tmp.name))
        self.addCleanup(world.close)
        introduces = {"listing": ["figi", "isin", "cgs_isin"], "security": ["isin", "cgs_isin"]}
        atlas, meridian = source("atlas", introduces=introduces), source("meridian", introduces=introduces)
        world.plugins = [atlas, meridian]

        def state(info, figi=None):
            identifiers = (("isin", "US0378331005"), *((("figi", figi),) if figi else ()))
            world.ingest(info, record_of(info, "AAPL", *identifiers, operating_mic="XNAS", currency="USD"), scope="all")

        state(meridian)
        state(atlas, FIGI_A)  # a FIGI is a better key than a CGS-area ISIN: the line is re-keyed
        state(meridian, FIGI_B)  # and its own record now contradicts Atlas's
        self.assertEqual(device.current_id(world.ref, world.identity, APPLE_LINE), BY_FIGI)
        self.assertEqual((world.touch(APPLE_LINE), world.touch(BY_FIGI)), (1, 0))
        [asked] = world.identity.queue_items()
        self.assertEqual((asked["subject_ids"], asked["plugins"]), ([BY_FIGI], ["reference", "atlas", "meridian"]))

        self.assertEqual(world.answer(asked["id"], "same_listing", f"listing:figi:{FIGI_B}")["state"], "resolved")
        self.assertEqual(world.read(APPLE_LINE)["values"]["figi"], FIGI_B)
        # The next release holds that FIGI on Ericsson's B line: the device line is aliased to it, and its rows follow.
        path = world.release("holds-the-line")
        with closing(sqlite3.connect(path)) as db, db:
            db.execute("UPDATE assertions SET value = ? WHERE subject_id = ? AND scheme = 'figi'", (FIGI_A, ERIC_B_LINE))
        done = world.rekey(path)
        self.assertEqual(done["moved"], 1)  # the FIGI-keyed line, which its question and verdict named
        with closing(store.open_reference(path)) as ref:
            self.assertEqual(device.current_id(ref, world.identity, APPLE_LINE), ERIC_B_LINE)
            [moved] = world.identity.queue_items(which="settled")
            self.assertEqual(moved["subject_ids"], [ERIC_B_LINE])
            for saved in (APPLE_LINE, BY_FIGI, ERIC_B_LINE):
                view = world.read(saved, ref)
                self.assertEqual((view["id"], view["values"]["figi"], view["contested"]), (ERIC_B_LINE, FIGI_B, {}))
            raised = conflicts.raised(ref, world.identity, [ERIC_B_LINE], world.plugins)
            self.assertEqual(build_questions.import_build(world.identity, raised, NOW), 0, "answered: not asked again")
            self.assertTrue(build_questions.reopen(world.identity, asked["id"], NOW, None))
            self.assertEqual(sorted(world.read(APPLE_LINE, ref)["contested"]), ["figi"])
            self.assertEqual([item["subject_ids"] for item in world.identity.queue_items()], [[ERIC_B_LINE]])
