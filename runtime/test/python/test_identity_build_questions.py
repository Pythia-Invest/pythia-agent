"""The reference build's questions (its package's `claims` file): queued only for instruments the investor or the
agent touches, and answered by the user as local overrides that every read applies (ADR 0044 A2; stage 0 Q1-Q3)."""
import contextvars
import hashlib
import json
import shutil
import sqlite3
import types
import unittest.mock
from pathlib import Path

from test_identity_contracts import identity, load_reference
from test_identity_page import ASML, CONTRACTS, LEI, plugin
from test_identity_queue import QueueFixture, load_core
from test_reference_package import make_package
from pythia_identity_fixture import reference_package  # noqa: E402

SECURITY, ISSUER = "security:isin:NL0010273215", f"issuer:lei:{LEI}"
RECEIPT, NASDAQ = "security:figi:BBG001SCG0R3", "listing:figi:BBG000K6N6G7"  # ASML's New York Registry Shares
REGISTRANT = "issuer:cik:0001234567"  # a CIK-only SEC registrant whose name matches ASML's
NOTE, INTERNALISED = "security:isin:NL0000000016", "listing:isin:NL0000000016:SIXX:EUR"  # trades only on an SI
OPERATOR = "529900VENUE0PERATR69"  # a trading-venue operator's LEI, which FIRDS field 5 names as the issuer
OPERATOR_ISSUER = f"issuer:lei:{OPERATOR}"
PROVENANCE = {"plugin": "sec", "source": "sec", "adapter_version": "fixture-1", "retrieved_at": "2026-09-25T00:00:00Z"}
EXTRA = {  # added to the ASML reference: the registrant, a venue operator, and a note only an internaliser trades
    "issuers": [{"id": REGISTRANT, "name": "ASML US Inc.", "country": "US"},
                {"id": OPERATOR_ISSUER, "name": "Venue Operator N.V.", "country": "NL"}],
    "securities": [{"id": NOTE, "name": "Internalised Note", "asset_class": "equity", "kind": "other"}],
    "listings": [{"id": INTERNALISED, "security_id": NOTE, "mic": "SIXX", "operating_mic": "SIXX", "currency": "EUR"}],
    "assertions": [{"subject_id": REGISTRANT, "scheme": "cik", "value": "1234567", "authority": "snapshot",
                    "provenance": PROVENANCE},
                   {"subject_id": OPERATOR_ISSUER, "scheme": "lei", "value": OPERATOR, "authority": "snapshot",
                    "provenance": {**PROVENANCE, "plugin": "gleif", "source": "gleif"}}],
}


def issuer_question(subject=RECEIPT):
    return {"question": "issuer_identity", "kind": "conflict", "reason": "identifier", "subject_ids": [subject],
            "candidate_ids": [ISSUER], "evidence_ids": ["record:0123456789abcdef"], "scheme": "lei",
            "values": [OPERATOR]}


RECEIPT_OF = {"question": "receipt_underlying", "kind": "residual", "reason": "no_key", "subject_ids": [RECEIPT],
              "candidate_ids": [SECURITY]}
SHARE_OR_RECEIPT = {"question": "receipt_conflict", "kind": "conflict", "reason": "relation", "subject_ids": [SECURITY],
                    "candidate_ids": [RECEIPT], "evidence_ids": ["record:fedcba9876543210"], "values": ["USN070592100"]}
SI_ONLY = {"question": "issuer_identity", "kind": "conflict", "reason": "identifier", "subject_ids": [NOTE],
           "candidate_ids": [ISSUER], "evidence_ids": ["record:00aa"], "scheme": "lei", "values": [OPERATOR]}
UNRELATED = {**SI_ONLY, "candidate_ids": [OPERATOR_ISSUER]}  # neither its subject nor its candidate is touched below
NAME = {"question": "issuer_identity_name_candidate", "kind": "residual", "reason": "ambiguous",
        "subject_ids": [REGISTRANT], "candidate_ids": [ISSUER]}
# W1-builder's link conflict: two LEIs claim one CIK, so the registrant is asked about with both as candidates.
CIK_CONFLICT = {"question": "issuer_identity", "kind": "conflict", "reason": "identifier", "subject_ids": [REGISTRANT],
                "candidate_ids": [ISSUER, OPERATOR_ISSUER], "evidence_ids": ["record:5ec0cafe00000001"], "scheme": "lei",
                "values": [LEI, OPERATOR]}
HOME = {"question": "home_market", "kind": "residual", "reason": "ambiguous", "subject_ids": [SECURITY],
        "candidate_ids": [ASML]}  # a listing choice (ADR 0044 A5): never queued, even from an older package


class BuildQuestionFixture(QueueFixture):
    def setUp(self):
        super().setUp()
        self.core_module = load_core()
        from pythia_core_queue_fixture import agent_tools, identity_ops, queue_ops
        from pythia_core_queue_fixture.identity import build_questions
        self.agent_tools, self.identity_ops, self.queue_ops = agent_tools, identity_ops, queue_ops
        self.build_questions = build_questions
        self.data = Path(self.tmp.name) / "core"
        self.plugins = []
        self.enterContext(unittest.mock.patch.object(identity_ops, "installed", lambda: self.plugins))
        self.ops = identity_ops.Identity(types.SimpleNamespace(), data_dir=self.data)

    def tearDown(self):
        self.ops.store.db.close()
        super().tearDown()

    def world(self, name="world", *, issuer=True, sql=()):
        """The ASML reference plus EXTRA; the registry shares carry no `depositary_receipt_of`, and with `issuer`
        False no issuer either (FIRDS named a venue operator's LEI)."""
        path = Path(self.tmp.name) / f"{name}.sqlite3"
        shutil.copyfile(self.path, path)
        with sqlite3.connect(path) as db:
            load_reference(db, EXTRA)
            db.execute("INSERT INTO venues (mic, operating_mic, name, country, category) VALUES"
                       " ('SIXX', 'SIXX', 'A bank''s internaliser', 'NL', 'SINT')")
            db.execute("DELETE FROM relations WHERE from_id = ?", (RECEIPT,))
            if not issuer:
                db.execute("UPDATE securities SET issuer_id = NULL WHERE id = ?", (RECEIPT,))
            for statement in sql:
                db.execute(*statement)
        return path

    def install(self, questions, source, build="reference-20260926"):
        """A package whose `claims` file holds these questions, installed on the device."""
        out = make_package(Path(self.tmp.name) / build, build, source=source)
        data = json.dumps({"build_id": build, "questions": questions}).encode()
        (out / f"questions-{build[-8:]}.json").write_bytes(data)
        manifest = json.loads((out / "package.json").read_text())
        manifest["claims"] = {"file": f"questions-{build[-8:]}.json", "bytes": len(data),
                              "sha256": hashlib.sha256(data).hexdigest()}
        (out / "package.json").write_text(json.dumps(manifest))
        reference_package.install(out, self.data)

    def page(self, subject_id):
        """The subject as the Desk reads it (the instrument page, a markets card or a watchlist row)."""
        return json.loads(self.queue_ops.read_subject(self.ops, {"subject_id": subject_id}))["data"]

    def open(self):
        return self.ops.store.queue_items()

    def answer(self, item_id, relation, chosen_id=None, user=True):
        from pythia_core_queue_fixture.platform import request_context
        arguments = {"item_id": item_id, "relation": relation, **({"chosen_id": chosen_id} if chosen_id else {})}
        if not user:
            return json.loads(self.queue_ops.submit_verdict(self.ops, arguments))["data"]
        desk = contextvars.copy_context()
        desk.run(request_context.usage.set, "dashboard")
        return json.loads(desk.run(self.queue_ops.submit_verdict, self.ops, arguments))["data"]


class SurfaceTest(BuildQuestionFixture):
    def test_installing_queues_nothing_nor_do_search_prices_or_settling(self):
        self.install([issuer_question(), RECEIPT_OF, SHARE_OR_RECEIPT, SI_ONLY, NAME, HOME], self.world())
        before = json.loads(self.queue_ops.read_queue(self.ops, {}))
        self.ops.search({"query": "ASML"})
        self.ops.price_sources(NASDAQ)
        self.queue_ops.settle(self.ops, [])
        self.assertEqual((before["outcome"], self.open()), ("empty", []))

    def test_touched_instruments_queue_their_familys_questions_once_and_untouched_ones_none(self):
        self.install([issuer_question(), RECEIPT_OF, SHARE_OR_RECEIPT, UNRELATED, HOME], self.world())
        self.page(NASDAQ)  # A: the registry shares' page; its questions are about their security
        self.assertEqual({(item["reason"], *item["subject_ids"]) for item in self.open()},
                         {("identifier", RECEIPT), ("no_key", RECEIPT)})
        self.page(NASDAQ)
        self.assertEqual(len(self.open()), 2, "each question is asked once")
        self.page(ASML)  # B: a watchlist row the Desk reads; its home_market question is a listing choice
        self.assertEqual({item["reason"] for item in self.open()}, {"identifier", "no_key", "relation"})
        listed = json.loads(self.queue_ops.read_queue(self.ops, {}))["data"]
        self.assertNotIn(NOTE, {subject for item in listed["items"] for subject in item["subject_ids"]}, "C")
        self.assertNotIn("ambiguous", {item["reason"] for item in listed["items"]})

        # A new release supersedes the open questions; touching A again asks that release's questions about it.
        self.install([issuer_question(), RECEIPT_OF, SHARE_OR_RECEIPT], self.world("second"), "reference-20260927")
        self.page(NASDAQ)
        self.assertEqual({item["reason"] for item in self.open()}, {"identifier", "no_key"})
        superseded = self.ops.store.db.execute("SELECT count(*) FROM queue WHERE state = 'superseded'").fetchone()[0]
        self.assertEqual(superseded, 3)

    def test_an_instrument_trading_only_on_an_internaliser_is_queued_when_opened(self):
        self.install([SI_ONLY], self.world())
        self.page(INTERNALISED)
        self.assertEqual([item["subject_ids"] for item in self.open()], [[NOTE]])

    def test_the_agents_reads_queue_the_questions_about_what_it_uses(self):
        from pythia_core_queue_fixture.identity.page import Section
        self.install([issuer_question(), SHARE_OR_RECEIPT, NAME], self.world())
        with unittest.mock.patch.object(self.identity_ops, "CURRENT", self.ops), \
                unittest.mock.patch.object(self.agent_tools, "provider_tools_for", lambda _subject: []):
            self.agent_tools.find({"query": "ASML"})
            self.assertEqual(self.open(), [], "finding is not using")
            self.agent_tools.concept_sources(NASDAQ, Section.QUOTE, None, {})  # pythia_prices
            json.loads(self.agent_tools.instrument({"subject_id": ASML}))
            asked = json.loads(self.queue_ops.read_queue(self.ops, {"subject_id": REGISTRANT}))["data"]
        self.assertEqual({item["reason"] for item in self.open()}, {"identifier", "relation", "ambiguous"})
        self.assertEqual([item["label"] for item in asked["items"]], ["Pythia reference"])


    def test_a_cik_conflict_is_queued_when_a_candidates_page_opens_and_a_malformed_question_is_logged(self):
        self.install([CIK_CONFLICT, {**CIK_CONFLICT, "evidence_ids": []}], self.world())  # a conflict cites evidence
        with self.assertLogs(self.build_questions.logger, "WARNING") as logged:
            self.page(ASML)  # no page reaches the CIK-only registrant; ASML's issuer is one of its candidates
        self.assertIn("1 malformed", logged.output[0])
        [item] = json.loads(self.queue_ops.read_queue(self.ops, {}))["data"]["items"]
        self.assertTrue(item["question"].startswith("Which company is this?"))
        self.assertIn(f"LEI {OPERATOR}", item["question"])
        self.assertEqual([answer["chosen_id"] for answer in item["answers"] if answer["relation"] == "same_issuer"],
                         [ISSUER, OPERATOR_ISSUER])

    def test_a_question_without_candidates_waits_until_a_release_offers_some(self):
        self.install([{**RECEIPT_OF, "candidate_ids": []}], self.world())
        with self.assertLogs(self.build_questions.logger, "INFO") as logged:
            self.page(NASDAQ)
        self.assertEqual(self.open(), [], "only \"None of these\" to offer; the page already says it is unknown")
        self.assertIn("1 without candidates", logged.output[0])
        self.install([RECEIPT_OF], self.world("second"), "reference-20260927")
        self.page(NASDAQ)
        self.assertEqual([item["reason"] for item in self.open()], ["no_key"])

    def test_a_dismissed_question_returns_only_when_a_release_changes_its_candidates(self):
        self.install([issuer_question()], self.world(issuer=False))
        self.page(NASDAQ)
        [item] = self.open()
        self.answer(item["id"], "none")
        self.install([issuer_question()], self.world("second", issuer=False), "reference-20260927")
        self.page(NASDAQ)
        self.assertEqual(self.open(), [])
        self.install([{**issuer_question(), "candidate_ids": [ISSUER, OPERATOR_ISSUER]}],
                     self.world("third", issuer=False), "reference-20260928")
        self.page(NASDAQ)
        self.assertEqual([item["candidate_ids"] for item in self.open()], [[ISSUER, OPERATOR_ISSUER]])

    def test_a_repeat_touch_takes_no_write_lock(self):
        self.install([issuer_question()], self.world(issuer=False))
        self.page(NASDAQ)
        with unittest.mock.patch.object(self.ops.store, "transaction", wraps=self.ops.store.transaction) as lock:
            self.page(NASDAQ)
        self.assertEqual((lock.call_count, len(self.open())), (0, 1))

    def test_an_unreadable_claims_file_is_read_again_on_the_next_touch(self):
        self.install([issuer_question()], self.world(issuer=False))
        claims = next((self.data / "reference").rglob("questions-*.json"))
        saved = claims.read_bytes()
        claims.unlink()
        with self.assertLogs(self.build_questions.logger, "WARNING"):
            self.page(NASDAQ)
        with self.assertNoLogs(self.build_questions.logger, "WARNING"):  # warned once
            self.page(NASDAQ)
        self.assertEqual(self.open(), [])
        claims.write_bytes(saved)
        self.page(NASDAQ)
        self.assertEqual(len(self.open()), 1)

    def test_the_registered_subject_read_and_the_agents_filings_read_queue(self):
        from native_plugin_fixtures import keep_platform_binding
        from test_agent_tools import Context
        self.install([issuer_question(), SHARE_OR_RECEIPT], self.world())
        keep_platform_binding(self)  # registering this core copy publishes its own `pythia_platform`
        ctx = Context({})
        with unittest.mock.patch.object(self.identity_ops, "Identity", lambda _ctx: self.ops), \
                unittest.mock.patch.object(self.identity_ops, "CURRENT", None):
            self.core_module.register(ctx)
        from pythia_core_queue_fixture import agent_reads
        with unittest.mock.patch.object(self.identity_ops, "CURRENT", self.ops), \
                unittest.mock.patch.object(agent_reads, "run_tool", lambda *_args: {"outcome": "empty"}):
            ctx.tools["pythia_identity_subject"]["handler"]({"subject_id": NASDAQ})  # the Desk's identity-subject
            self.assertEqual({item["reason"] for item in self.open()}, {"identifier"})
            ctx.tools["pythia_filings"]["handler"]({"subject_id": ASML})
        self.assertEqual({item["reason"] for item in self.open()}, {"identifier", "relation"})


class AnswerTest(BuildQuestionFixture):
    def test_the_users_issuer_answer_applies_and_the_agents_stays_a_suggestion(self):
        self.plugins = [plugin("gleif", operations={"profile": "pythia_gleif_profile"})]
        self.install([issuer_question()], self.world(issuer=False))
        self.assertIsNone(self.page(NASDAQ)["issuer"])
        [item] = json.loads(self.queue_ops.read_queue(self.ops, {}))["data"]["items"]
        self.assertEqual((item["label"], item["record"], item["answers"][0]),
                         ("Pythia reference", None, {"relation": "same_issuer", "chosen_id": ISSUER}))
        self.assertIn(OPERATOR, item["question"])

        agent = self.answer(item["id"], "same_issuer", ISSUER, user=False)
        self.assertEqual((agent["outcome"], agent["state"]), ("suggested", "open"))
        self.assertIsNone(self.page(NASDAQ)["issuer"], "a suggestion changes nothing")
        user = self.answer(item["id"], "same_issuer", ISSUER)
        self.assertEqual((user["outcome"], user["state"], user["authority"]), ("confirmed", "resolved", "user_attested"))

        view = self.page(NASDAQ)
        self.assertEqual(view["issuer"], {"id": ISSUER, "name": "ASML Holding N.V.", "lei": LEI, "cik": "0000937966",
                                          "authority": "user_attested"})
        profile = next(section for section in view["sections"] if section["section"] == "profile")
        self.assertEqual((profile["status"], profile["binding"]["native_id"]), ("ready", LEI))
        self.assertEqual((self.queue_ops.surface(self.ops, [NASDAQ]), self.open()), (0, []), "never asked again")

    def test_none_of_these_dismisses_and_the_issuer_stays_unknown(self):
        self.install([issuer_question()], self.world(issuer=False))
        self.page(NASDAQ)
        [item] = self.open()
        self.assertEqual(self.answer(item["id"], "same_security", SECURITY)["outcome"], "refused")
        self.assertEqual(self.answer(item["id"], "none")["state"], "dismissed")
        self.assertIsNone(self.page(NASDAQ)["issuer"])

    def test_a_receipt_answer_is_a_related_entry_on_both_pages(self):
        self.install([RECEIPT_OF], self.world())
        self.page(NASDAQ)
        [item] = self.open()
        self.assertEqual(self.answer(item["id"], "depositary_receipt_of", SECURITY)["state"], "resolved")
        # The company's other securities list both; the user's answer is still shown as the relation.
        receipt, share = self.page(NASDAQ), self.page(ASML)
        self.assertIn({"id": SECURITY, "type": "depositary_receipt_of", "direction": "to", "kind": "security",
                       "name": "ASML Holding N.V.", "authority": "user_attested"}, receipt["related"])
        self.assertIn(RECEIPT, [entry["id"] for entry in share["related"] if entry["direction"] == "from"])

    def test_no_plugin_can_take_the_build_questions_tag(self):
        with self.assertRaisesRegex(identity.ManifestError, "reserved"):
            identity.validate_manifest({**CONTRACTS["gleif"], "plugin": self.build_questions.BUILD})

    def test_a_receipt_is_never_chosen_as_the_underlying(self):
        self.install([SHARE_OR_RECEIPT], self.world())
        self.page(ASML)
        [item] = self.open()
        self.assertEqual(self.answer(item["id"], "depositary_receipt_of", RECEIPT)["outcome"], "blocked")

    def test_an_answer_against_identifier_proof_is_refused(self):
        # ASML's issuer has CIK 937966; the registrant's is 1234567, so no answer makes them one company.
        self.install([NAME], self.world())
        self.queue_ops.read_queue(self.ops, {"subject_id": REGISTRANT})
        [item] = self.open()
        self.assertEqual(self.answer(item["id"], "same_issuer", ISSUER)["outcome"], "blocked")
        self.assertEqual(self.ops.store.queue_item(item["id"])["state"], "open")

    def test_a_name_match_joins_both_issuers_identifiers_on_both_pages(self):
        self.install([NAME], self.world(sql=[("DELETE FROM assertions WHERE subject_id = ? AND scheme = 'cik'",
                                               (ISSUER,))]))
        self.queue_ops.read_queue(self.ops, {"subject_id": REGISTRANT})
        [item] = self.open()
        self.assertEqual(self.answer(item["id"], "same_issuer", ISSUER)["state"], "resolved")
        for subject in (REGISTRANT, ASML):  # SEC filings route by the CIK, ESEF filings and GLEIF by the LEI
            self.assertEqual({key: self.page(subject)["issuer"][key] for key in ("id", "lei", "cik")},
                             {"id": ISSUER, "lei": LEI, "cik": "0001234567"})

    def test_the_answer_survives_a_rekey_and_reopening_undoes_it(self):
        self.install([issuer_question()], self.world(issuer=False))
        self.page(NASDAQ)
        [item] = self.open()
        self.answer(item["id"], "same_issuer", ISSUER)
        # The next release keys the registry shares by an ISIN it learned, and asks the question under that ID.
        moved = "security:isin:NL0099999995"
        rekey = [(f"UPDATE {table} SET {column} = ? WHERE {column} = ?", (moved, RECEIPT))
                 for table, column in (("securities", "id"), ("listings", "security_id"),
                                       ("composites", "security_id"), ("assertions", "subject_id"))]
        rekey.append(("INSERT INTO id_aliases (old_id, new_id, release) VALUES (?, ?, 'reference-20260927')",
                      (RECEIPT, moved)))
        self.install([{**issuer_question(moved), "candidate_ids": [ISSUER, OPERATOR_ISSUER]}],
                     self.world("second", issuer=False, sql=rekey), "reference-20260927")
        view = self.page(NASDAQ)
        self.assertEqual((view["security"]["id"], view["issuer"]["id"]), (moved, ISSUER))
        self.assertEqual(self.open(), [], "the answered question is not asked again")

        self.assertEqual(self.answer(item["id"], "reopen", user=False)["outcome"], "refused", "only the user undoes it")
        self.assertEqual(self.answer(item["id"], "reopen")["outcome"], "reopened")
        self.assertIsNone(self.page(NASDAQ)["issuer"])
        [again] = self.open()
        self.assertEqual(again["candidate_ids"], [ISSUER, OPERATOR_ISSUER], "asked as the installed release asks it")
        history = json.loads(self.queue_ops.read_queue(self.ops, {"item_id": again["id"]}))["data"]["history"]
        self.assertEqual([(entry["resolver"], entry["outcome"]) for entry in history], [("user", "confirmed")])


if __name__ == "__main__":
    unittest.main()
