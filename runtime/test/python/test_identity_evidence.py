"""Evidence counts by its kind, never by its origin or a level (ADR 0044 A1, A2 and its amendment of 2026-09-30; ADR
0037, amendment of 2026-09-30): a contested fact decides nothing until the user answers, and a later release that
contradicts the user's answer asks again."""
import contextlib
import json
import sqlite3

from test_identity_build_questions import (
    ISSUER, NAME, NASDAQ, NOTE, OPERATOR, OPERATOR_ISSUER, RECEIPT, RECEIPT_OF, REGISTRANT, SECURITY,
    BuildQuestionFixture, issuer_question,
)
from test_identity_contracts import PROVENANCE, assertion_row, identity, insert
from test_identity_page import ASML, plugin
from test_identity_queue import AS_OF, NOW, QueueFixture, answer
from pythia_identity_fixture import page  # noqa: E402

A, B = "NL0010273215", "NL0006034001"  # ASML's ISIN, and another company's
USER = {"user_turn": "desk:identity-verdict:test"}


def add(path, subject, scheme, value, source, authority="source_asserted"):
    """One more assertion in the reference at `path`, stored as a package writes it."""
    item = identity.IdentifierAssertion(subject_id=subject, scheme=scheme, value=value, authority=authority,
                                        provenance={**PROVENANCE, "plugin": source, "source": source})
    with contextlib.closing(sqlite3.connect(path)) as db, db:
        insert(db, "assertions", assertion_row(item))


class ContestedTest(QueueFixture):
    def test_two_sources_isins_that_disagree_block_both_answers_and_mark_the_fact_contested(self):
        add(self.path, SECURITY, "isin", B, "vendor")  # beside the build's own ISIN
        subject = page.load_subject(self.ref, ASML)
        self.assertEqual(subject["view"]["contested"], {"isin": [{"value": B, "sources": ["vendor"]},
                                                                 {"value": A, "sources": ["GLEIF"]}]})
        self.assertNotIn("isin", subject["view"]["identifiers"])  # neither value is applied
        self.assertIsNone(subject["view"]["security"]["isin"])
        for isin in (A, B):
            with self.subTest(isin=isin):
                item = self.ask(answer(("isin", isin), native_id=f"{isin}.AS"), subject=subject)  # never binds
                self.assertEqual((item.kind, item.reason), ("conflict", "binding"))
                agent = self.submit(item, "agent")
                self.assertEqual(agent["outcome"], "blocked")
                user = self.submit(item, "user", **USER)  # where evidence disagrees, the user decides
                self.assertEqual((user["outcome"], user["state"]), ("confirmed", "resolved"))

    def test_one_sources_two_composite_figis_are_not_a_contest(self):
        # OpenFIGI gives many German composites two composite FIGIs (the regional composite and Tradegate's).
        composite = "composite:isin:NL0010273215:NL"
        add(self.path, composite, "composite_figi", "BBG000K6MRN4", "openfigi")  # beside its BBG000C1HSN8
        subject = page.load_subject(self.ref, ASML)
        self.assertNotIn("contested", subject["view"])
        self.assertEqual((subject["contested"], subject["values"]["composite_figi"]), ({}, "BBG000C1HSN8"))  # its first
        add(self.path, composite, "composite_figi", "BBG000BDTBL9", "vendor")  # another source disagrees: contested
        self.assertEqual(page.load_subject(self.ref, ASML)["view"]["contested"], {"composite_figi": [
            {"value": "BBG000BDTBL9", "sources": ["vendor"]}, {"value": "BBG000C1HSN8", "sources": ["OpenFIGI"]},
            {"value": "BBG000K6MRN4", "sources": ["OpenFIGI"]}]})

    def test_a_user_answer_is_refused_only_under_unanimous_proof(self):
        item = self.ask(answer(("isin", B)))  # the record names another ISIN than every assertion
        self.assertEqual(self.submit(item, "user", **USER)["outcome"], "blocked")
        add(self.path, SECURITY, "isin", B, "vendor")  # a second contributor names the record's ISIN
        self.assertEqual(self.submit(item, "user", **USER)["outcome"], "confirmed")

    def test_none_is_refused_when_one_candidates_own_evidence_names_the_record(self):
        add(self.path, RECEIPT, "isin", "USN070592100", "vendor")  # the second candidate's ISIN, from another source too
        batch = answer(("isin", A), mic="XAMS")  # the record names ASML's ISIN on ASML's venue
        for claim in identity.batch_to_json(batch)["claims"]:
            self.identity.put_claim(batch.plugin, batch.provider, claim)
        item = identity.QueueItem(id="q-two", kind="residual", reason="ambiguous",
                                  subject_ids=("listing:provisional:eodhd:catalogue:ASML.AS",),
                                  candidate_ids=(ASML, NASDAQ), evidence_ids=(), state="open", opened_at=NOW,
                                  plugins=("eodhd",), provider_ref=batch.claims[0].native_ref)
        self.identity.put_queue_item(item)
        self.assertEqual(self.submit(item, "user", relation="none", chosen_id=None, **USER)["outcome"], "blocked")

    def test_the_same_evidence_under_other_contributors_decides_identically(self):
        """Who states a value changes nothing: the reference build's source and a vendor decide alike."""
        def decide(first, second):
            with contextlib.closing(sqlite3.connect(self.path)) as db, db:
                db.execute("DELETE FROM assertions WHERE subject_id = ? AND scheme = 'isin'", (SECURITY,))
            for value, (source, authority) in ((A, first), (B, second)):
                add(self.path, SECURITY, "isin", value, source, authority)
            subject = page.load_subject(self.ref, ASML)
            eodhd = plugin("eodhd")
            outcomes = []
            for isin in (A, B):
                binding, item, _ = page.apply_resolve(answer(("isin", isin)), eodhd, identity.Level.LISTING, subject,
                                                      {"isin": isin}, now=NOW, as_of=AS_OF)
                outcomes.append((binding and binding.status, item and (item.kind, item.reason)))
            contested = {scheme: [item["value"] for item in found]  # the values; each is shown with its own source
                         for scheme, found in subject["view"].get("contested", {}).items()}
            return contested, subject["values"].get("isin"), outcomes

        build, vendor = ("esma_firds", "source_asserted"), ("vendor", "source_asserted")
        decided = decide(build, vendor)
        self.assertEqual(decided, ({"isin": sorted([A, B])}, None, [(None, ("conflict", "binding"))] * 2))
        self.assertEqual(decide(vendor, build), decided)
        self.assertEqual(decide(("renamed", "source_asserted"), ("other", "source_asserted")), decided)


class AnswerTest(BuildQuestionFixture):
    def test_a_later_release_contradicting_an_answer_raises_one_conflict_question_on_touch(self):
        self.install([issuer_question()], self.world(issuer=False))
        self.page(NASDAQ)
        [asked] = self.open()
        self.answer(asked["id"], "same_issuer", ISSUER)
        # The next release names the venue operator as the registry shares' issuer, and asks nothing.
        named = [("UPDATE securities SET issuer_id = ? WHERE id = ?", (OPERATOR_ISSUER, RECEIPT))]
        self.install([], self.world("second", sql=named), "reference-20260927")
        self.assertEqual(self.page(NASDAQ)["issuer"]["id"], ISSUER, "the answer stays applied until the user decides")
        self.page(NASDAQ)
        [conflict] = json.loads(self.queue_ops.read_queue(self.ops, {}))["data"]["items"]
        self.assertEqual((conflict["kind"], conflict["reason"], conflict["candidate_ids"]),
                         ("conflict", "binding", [ISSUER, OPERATOR_ISSUER]))
        self.assertEqual({answer["relation"] for answer in conflict["answers"] if answer["chosen_id"]}, {"same_issuer"})
        self.assertEqual(self.answer(conflict["id"], "same_issuer", OPERATOR_ISSUER)["state"], "resolved")
        self.assertEqual(self.page(NASDAQ)["issuer"]["id"], OPERATOR_ISSUER)
        self.assertEqual(self.open(), [], "the new answer agrees with the release: nothing more to ask")
        self.assertEqual(self.ops.store.queue_item(asked["id"])["state"], "superseded")  # kept as history

    def test_a_later_release_contradicting_a_receipt_answer_asks_too(self):
        self.install([RECEIPT_OF], self.world())
        self.page(NASDAQ)
        [asked] = self.open()
        self.answer(asked["id"], "depositary_receipt_of", SECURITY)
        self.page(NASDAQ)
        self.assertEqual(self.open(), [], "a release silent on the underlying contradicts nothing")
        stated = [("INSERT INTO relations (evidence_id, type, from_id, to_id, authority, source, plugin, adapter_version,"
                   " retrieved_at) VALUES ('ev:receipt', 'depositary_receipt_of', ?, ?, 'source_asserted', 'esma_firds',"
                   " 'esma_firds', '1', ?)", (RECEIPT, NOTE, NOW))]
        self.install([], self.world("second", sql=stated), "reference-20260927")
        self.page(ASML)  # the share's page shows the answer too, so touching it is relevant
        [conflict] = self.open()
        self.assertEqual((conflict["reason"], conflict["candidate_ids"]), ("binding", [SECURITY, NOTE]))

    def test_a_later_release_contradicting_a_same_company_answer_asks_too(self):
        no_cik = [("DELETE FROM assertions WHERE subject_id = ? AND scheme = 'cik'", (ISSUER,))]
        self.install([NAME], self.world(sql=no_cik))
        self.queue_ops.read_queue(self.ops, {"subject_id": REGISTRANT})
        [asked] = self.open()
        self.assertEqual(self.answer(asked["id"], "same_issuer", ISSUER)["state"], "resolved")
        self.page(REGISTRANT)
        self.assertEqual(self.open(), [], "the registrant has no identifier of its own that ASML's contradicts")
        second = self.world("second", sql=no_cik)
        add(second, REGISTRANT, "lei", OPERATOR, "gleif")  # the next release gives the registrant an LEI of its own
        self.install([], second, "reference-20260927")
        self.assertEqual(self.page(REGISTRANT)["issuer"]["id"], ISSUER, "the answer stays applied until the user decides")
        [conflict] = self.open()
        # The registrant's own LEI refuses the company it was matched to and "none" alike (unanimous proof, ruling
        # 2.6), so the question offers the registrant alone and says why (#109 re-review).
        self.assertEqual((conflict["reason"], conflict["candidate_ids"]), ("binding", [REGISTRANT]))
        [asked] = json.loads(self.queue_ops.read_queue(self.ops, {}))["data"]["items"]
        self.assertEqual([(answer["relation"], answer["chosen_id"]) for answer in asked["answers"]],
                         [("same_issuer", REGISTRANT), ("ambiguous", None)])
        self.assertIn("rules out the company you matched it to", asked["question"])
        self.assertEqual(self.answer(conflict["id"], "same_issuer", REGISTRANT)["state"], "resolved")
        view = self.page(REGISTRANT)
        self.assertEqual((view["issuer"]["id"], view["issuer"]["lei"], self.open()), (REGISTRANT, OPERATOR, []))

    def test_a_contested_identifier_is_asked_on_touch_and_the_users_answer_decides_it(self):
        contested = self.world("contested")
        add(contested, SECURITY, "isin", B, "vendor")  # beside the build's own ISIN
        self.install([], contested)
        self.assertNotIn("isin", self.page(ASML)["identifiers"])
        [item] = json.loads(self.queue_ops.read_queue(self.ops, {}))["data"]["items"]
        self.assertEqual((item["reason"], item["subject_ids"], item["candidate_ids"]),
                         ("identifier", [SECURITY], [f"security:isin:{B}", SECURITY]))
        self.assertEqual({(entry["value"], entry["source"]) for entry in item["evidence"]}, {(A, "gleif"), (B, "vendor")})
        self.assertEqual(self.answer(item["id"], "same_security", SECURITY)["state"], "resolved")
        view = self.page(ASML)
        self.assertEqual((view["identifiers"]["isin"], "contested" in view), (A, False))
        self.assertEqual(view["provenance"]["isin"]["authority"], "user_attested")  # the user decided it

    def test_a_contested_identifier_does_not_refuse_the_users_answer_to_a_company_question(self):
        self.install([NAME], self.world())  # the registrant's CIK differs from the one ASML's issuer has: refused
        self.queue_ops.read_queue(self.ops, {"subject_id": REGISTRANT})
        [item] = self.open()
        self.assertEqual(self.answer(item["id"], "same_issuer", ISSUER)["outcome"], "blocked")
        contested = self.world("contested")
        add(contested, ISSUER, "cik", "1234567", "vendor")  # another contributor gives it the registrant's
        self.install([NAME], contested, "reference-20260927")
        self.queue_ops.read_queue(self.ops, {"subject_id": REGISTRANT})
        [item] = [entry for entry in self.open() if entry["reason"] == "ambiguous"]
        self.assertEqual(self.answer(item["id"], "same_issuer", ISSUER)["outcome"], "confirmed")
