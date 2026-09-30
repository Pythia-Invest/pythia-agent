"""A fact an open question holds back is named on the subject read, with that question, so the Desk shows an open data
conflict in place of nothing and links to its repair (ADR 0044 A2; Settings → Repairs)."""
import unittest

from test_identity_build_questions import (
    ASML, ISSUER, NAME, NASDAQ, REGISTRANT, RECEIPT_OF, SECURITY, BuildQuestionFixture, issuer_question, plugin,
)
from test_identity_evidence import add


class WithheldTest(BuildQuestionFixture):
    def test_an_undecided_issuer_names_its_question_on_the_read_and_on_the_company_sections(self):
        self.plugins = [plugin("gleif", operations={"profile": "pythia_gleif_profile"})]
        self.install([issuer_question(), RECEIPT_OF], self.world(issuer=False))
        view = self.page(NASDAQ)
        asked = {item["reason"]: item["id"] for item in self.open()}
        self.assertEqual(view["withheld"], [{"fact": "issuer", "question": asked["identifier"], "options": 1},
                                            {"fact": "underlying", "question": asked["no_key"], "options": 1}])
        profile = next(section for section in view["sections"] if section["section"] == "profile")
        self.assertEqual((profile["status"], profile["question"]), ("not_addressable", asked["identifier"]))

        self.answer(asked["identifier"], "same_issuer", ISSUER)  # decided: the fact shows and nothing is withheld for it
        view = self.page(NASDAQ)
        self.assertEqual([entry["fact"] for entry in view["withheld"]], ["underlying"])
        self.assertEqual(next(section for section in view["sections"] if section["section"] == "profile")["question"], None)

    def test_a_contested_identifier_names_its_question(self):
        world = self.world()
        add(world, SECURITY, "isin", "NL0006034001", "vendor")  # beside GLEIF's
        self.install([], world)
        view = self.page(ASML)
        [item] = self.open()
        self.assertEqual(view["withheld"], [{"fact": "isin", "question": item["id"], "options": 2}])
        self.assertIn("isin", view["contested"])

    def test_a_question_about_another_subject_holds_nothing_back_here(self):
        self.install([issuer_question(), NAME], self.world(issuer=False))
        self.page(NASDAQ)
        self.queue_ops.read_queue(self.ops, {"subject_id": REGISTRANT})
        page = self.page(ASML)  # both questions offer ASML's issuer as a candidate, but are about other subjects
        self.assertEqual(({"identifier", "ambiguous"}, page["withheld"]), ({item["reason"] for item in self.open()}, []))
        self.assertEqual(len(page["queue"]), 2)


if __name__ == "__main__":
    unittest.main()
