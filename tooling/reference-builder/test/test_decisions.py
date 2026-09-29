"""Decisions rest on kinds of evidence, never on a source's name, and leave what the evidence does not decide open
(ADR 0044, A2 and A3): a renamed source deciding alike, ticker reuse and a receipt's share class."""

import copy
import dataclasses
import unittest
from datetime import date
from unittest import mock

from reference_builder import assemble, linking, mic, reconcile, schema, sec
from reference_builder.assemble import Inputs
from reference_builder.claims import Venues
from reference_builder.config import Scope
from reference_builder.model import Evidence, Listing, Relationship, Security, Snapshot
from reference_builder.pipeline import build_snapshot
from reference_builder.receipts import link_receipts

from .fixtures import MIC_CSV, FakeOpenFigi, sec_json
from .test_pipeline import OPENFIGI, SHELL_ISIN, WIDE_OPENFIGI, gleif_fetch, inputs, wide_inputs


def decisions(snap: Snapshot, given: Inputs) -> tuple:
    """Re-run every decision on assembled rows: primaries, most-liquid lines, questions, receipt edges and the names
    written (SEC titles are re-cased apart)."""
    for listing in snap.listings.values():
        listing.is_primary = listing.most_liquid = False
    for security in snap.securities.values():
        security.primary_mic = security.primary_rule = None
    linking._mark_us_primaries(snap)
    claims = given.claims()
    reconcile.questions(snap, claims, Venues(given.venues), given.as_of.isoformat())
    link_receipts(snap, frozenset(claims.isins))
    tables = schema.rows(snap, {"build_id": "test"}, [])  # a provisional ID keeps its source's namespace
    return ({key: (s.primary_mic, s.primary_rule) for key, s in snap.securities.items()},
            sorted(key for key, line in snap.listings.items() if line.is_primary),
            sorted(key for key, line in snap.listings.items() if line.most_liquid),
            [(q.question, q.subject_id, q.candidates, q.values) for q in snap.questions],
            sorted((r.from_id, r.relation, r.to_id, r.rule_id) for r in snap.relationships),
            sorted(row["name"] for name in ("issuers", "securities") for row in tables[name]))


class RenamedSourceTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch("urllib.request.urlopen", side_effect=AssertionError("network access in a test"))
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_a_renamed_source_of_the_same_kind_decides_alike(self):
        for name, given, answers in (("XAMS and SEC", inputs(), OPENFIGI), ("every venue", wide_inputs(), WIDE_OPENFIGI)):
            with self.subTest(name):
                figi = FakeOpenFigi(answers)
                snap = Snapshot(as_of=given.as_of.isoformat())
                linking.build_sec(snap, given, assemble.build_eu(snap, given, gleif_fetch, figi), figi)
                if name == "XAMS and SEC":  # a stated underlying of another issuer: a question, never an edge
                    receipt = snap.listings["XNAS:ASML"].security_id
                    snap.relationships.append(Relationship(receipt, "depositary_receipt_of", f"isin:{SHELL_ISIN}",
                                                           "esma_firds", "firds_underlying_isin", Evidence.STATED_UNDERLYING))
                    snap.issuers["cik:918541"].name = "NN INC /DE/"  # a SEC title's state marker, dropped for display
                renamed = copy.deepcopy(snap)
                for row in (*renamed.issuers.values(), *renamed.securities.values(), *renamed.listings.values()):
                    row.source = f"another_{row.source}"
                renamed.relationships[:] = [dataclasses.replace(r, source="another") for r in renamed.relationships]
                expected = decisions(snap, given)
                self.assertTrue(expected[1] and expected[3], "the fixture decides primaries and asks questions")
                self.assertEqual(decisions(renamed, given), expected)


class TickerReuseTest(unittest.TestCase):
    def test_a_ticker_only_sec_subject_is_keyed_by_cik_and_ticker_with_no_alias_from_the_ticker(self):
        # US Steel's X was delisted; a ticker reused by another registrant must never name the old subject.
        def build(cik: int) -> tuple[set[str], set[str]]:
            tickers = sec.parse(sec_json([(cik, "Example Steel Corp", "XREUSE", "NYSE")]))
            given = Inputs(date(2026, 9, 25), Scope(), mic.parse(MIC_CSV.encode()), {}, None, tickers, set())
            tables = schema.rows(build_snapshot(given, gleif_fetch, FakeOpenFigi({})), {"build_id": "test"}, [])
            ids = {row["id"] for name in ("securities", "listings") for row in tables[name] if "XREUSE" in row["id"]}
            return ids, {row["old_id"] for row in tables["id_aliases"]}

        first, first_aliases = build(1163302)
        second, second_aliases = build(2000001)
        self.assertEqual(first, {"security:provisional:sec:id:1163302.XREUSE",
                                 "listing:provisional:sec:ticker:XNYS.1163302.XREUSE"})
        self.assertFalse(first & second, "another registrant's ticker is another subject")
        self.assertFalse({"security:provisional:sec:id:XREUSE", "listing:provisional:sec:ticker:XNYS.XREUSE"}
                         & (first_aliases | second_aliases), "no alias from the ticker-only form")


class ReceiptClassTest(unittest.TestCase):
    def test_a_receipt_beside_another_share_of_its_issuer_gets_no_edge(self):
        # Ericsson: a FIRDS class A beside a SEC-only class B. The issuer names no class, so the ADR gets no edge,
        # whether or not the other share has an active ticker line.
        for lined, activity in ((True, "active"), (False, "active"), (True, "suspect")):
            with self.subTest(lined=lined, activity=activity):
                snap = build_snapshot(inputs(), gleif_fetch, FakeOpenFigi(OPENFIGI))
                receipt = snap.listings["XNAS:ASML"].security_id
                self.assertIn(receipt, {item.from_id for item in snap.relationships}, "the issuer's one share: linked")
                without = snap.audit["relations"]["receipt_without_underlying"]
                other = "sec:937966.ASMLB"
                snap.securities[other] = Security(other, "share", "sec", Evidence.REGISTRANT_FILING,
                                                  issuer_id=snap.securities[receipt].issuer_id, activity=activity)
                if lined:
                    snap.listings["XNYS:ASMLB"] = Listing("XNYS:ASMLB", "sec", Evidence.REGISTRANT_FILING, "share",
                                                          security_id=other, ticker="ASMLB")
                snap.relationships.clear()
                snap.audit.clear()
                link_receipts(snap)
                self.assertNotIn(receipt, {item.from_id for item in snap.relationships})
                self.assertEqual(snap.audit["relations"]["receipt_without_underlying"], without + 1)


if __name__ == "__main__":
    unittest.main()
