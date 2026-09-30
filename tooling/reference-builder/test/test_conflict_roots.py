"""The root causes of avoidable identity conflicts: a venue operator's LEI is no issuer claim, a registrant joined to a
security is its issuer, a receipt FIRDS states no underlying for has its issuer's one share, and a share stating its own
other ISIN is no receipt. Each rule leaves what the evidence does not decide asked."""

import dataclasses
import unittest
from collections import Counter
from datetime import date
from unittest import mock

from reference_builder import assemble, claims, firds, mic, reconcile, sec
from reference_builder.config import Scope
from reference_builder.model import Evidence, Listing, Security, Snapshot
from reference_builder.pipeline import build_snapshot
from reference_builder.receipts import link_receipts

from .fixtures import (ASML_ISIN, ASML_LEI, MIC_CSV, FakeOpenFigi, figi_row, firds_record, fulins, sec_json, stream)
from .test_claims import admissions
from .test_pipeline import OPENFIGI, gleif_fetch, inputs

VENUE_LEI = "213800R54EFFINMY1P02"  # illustrative: the LEI ISO 10383 lists for a pan-European trading venue's operator
VENUE_CSV = MIC_CSV + f"TPIC,TPIC,OPRT,TP ICAP EUROPE,TP ICAP (EUROPE),{VENUE_LEI},MLTF,,FR,PARIS,,ACTIVE\n"
WARBY_ISIN, WARBY_CIK = "US93403J1060", "1504776"


def sec_inputs(records: list[str], registrants: list) -> assemble.Inputs:
    found = admissions(fulins(records))
    return assemble.Inputs(date(2026, 9, 26), Scope(mics=("XAMS",), sec=True), mic.parse(VENUE_CSV.encode()), found, None,
                           sec.parse(sec_json(registrants)), {"XAMS"}, firds_claims=claims.load(firds.claims(found)))


def issuer_questions(snap: Snapshot) -> list[tuple[str, tuple[str, ...]]]:
    return [(q.subject_id, q.candidates) for q in snap.questions if q.question == "issuer_identity"]


class UnknownIssuerTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch("urllib.request.urlopen", side_effect=AssertionError("network access in a test"))
        patcher.start()
        self.addCleanup(patcher.stop)

    def build(self, records: list[str], registrants: list, answers: dict | None = None) -> Snapshot:
        return build_snapshot(sec_inputs(records, registrants), gleif_fetch, FakeOpenFigi(answers or {}))

    def test_a_venue_operators_lei_with_no_candidate_is_counted_and_asks_nothing(self):
        # FIRDS field 5 is "issuer or venue operator": where the issuer did not request admission, the venue writes
        # its own LEI. That names no issuer, and with no other claim there is nothing to choose between.
        snap = self.build([firds_record("CH1129677105", "XAMS", VENUE_LEI, name="MEDMIX AG", requested="false")], [])
        self.assertIsNone(snap.securities["isin:CH1129677105"].issuer_id)
        self.assertEqual(issuer_questions(snap), [])
        self.assertEqual(snap.audit["reconcile"]["issuer_unknown_venue_lei"], 1)
        self.assertEqual(snap.audit["questions"], {})

    def test_two_field_5_claims_with_no_candidate_are_counted_apart_from_a_venue_operators(self):
        other = "724500AAAAAAAAAAAA77"
        snap = self.build([firds_record("CH1129677105", "XAMS", VENUE_LEI, name="MEDMIX AG"),
                           firds_record("CH1129677105", "XETA", other, name="MEDMIX AG")], [])
        self.assertEqual(issuer_questions(snap), [])
        self.assertEqual(snap.audit["reconcile"]["issuer_unknown_no_candidate"], 1)
        self.assertNotIn("issuer_unknown_venue_lei", snap.audit["reconcile"])

    def test_the_registrant_joined_to_the_security_is_its_issuer_when_field_5_is_a_venue_operators(self):
        # Warby Parker: FIRDS names TP ICAP, the SEC line joined by ISIN names the registrant. The rule is
        # `registrant_join@1`; nothing is asked, and the lines take the same issuer.
        answers = {("ID_ISIN", WARBY_ISIN, "US"): [figi_row("WRBY", "US", "BBGWRBY00001", "BBGWRBYSC001")],
                   ("TICKER", "WRBY", "US"): [figi_row("WRBY", "US", "BBGWRBY00001", "BBGWRBYSC001")]}
        snap = self.build([firds_record(WARBY_ISIN, "XAMS", VENUE_LEI, name="WARBY PARKER INC", requested="false")],
                          [(int(WARBY_CIK), "Warby Parker Inc.", "WRBY", "NYSE")], answers)
        security = snap.securities[f"isin:{WARBY_ISIN}"]
        self.assertEqual(security.issuer_id, f"cik:{WARBY_CIK}")
        self.assertEqual({line.issuer_id for line in snap.listings.values() if line.security_id == security.security_id},
                         {f"cik:{WARBY_CIK}"})
        self.assertEqual(issuer_questions(snap), [])
        self.assertEqual(snap.audit["reconcile"][reconcile.REGISTRANT_JOIN], 1)
        self.assertNotIn("issuer_unknown_venue_lei", snap.audit["reconcile"])

    def test_the_join_takes_the_issuer_the_sec_line_has_when_a_lei_link_upgrades_it(self):
        # A SEC line whose CIK GLEIF registers at EDGAR has the LEI issuer: the security takes that one.
        isin = "US0000000001"
        found = claims.load(firds.claims(admissions(fulins([firds_record(isin, "XAMS", VENUE_LEI)]))))
        security = Security(f"isin:{isin}", "share", "esma_firds", Evidence.ADMISSION_REGISTER, isin=isin)
        lines = [Listing("XNYS:WRBY", "sec", Evidence.REGISTRANT_FILING, "share", security_id=security.security_id,
                         issuer_id="lei:UPGRADED"),
                 Listing(f"XAMS:{isin}", "esma_firds", Evidence.ADMISSION_REGISTER, "share", security_id=security.security_id)]
        reconcile._issuer_unknown(Snapshot(as_of="2026-09-26"), found, claims.Venues(mic.parse(VENUE_CSV.encode())), security,
                                  lines, [], Counter())
        self.assertEqual((security.issuer_id, lines[1].issuer_id), ("lei:UPGRADED", "lei:UPGRADED"))

    def test_a_venue_operators_lei_beside_another_field_5_claim_is_no_join(self):
        answers = {("ID_ISIN", WARBY_ISIN, "US"): [figi_row("WRBY", "US", "BBGWRBY00001", "BBGWRBYSC001")],
                   ("TICKER", "WRBY", "US"): [figi_row("WRBY", "US", "BBGWRBY00001", "BBGWRBYSC001")]}
        two = "724500AAAAAAAAAAAA77"
        snap = self.build([firds_record(WARBY_ISIN, "XAMS", VENUE_LEI, name="WARBY PARKER INC"),
                           firds_record(WARBY_ISIN, "XETA", two, name="WARBY PARKER INC")],
                          [(int(WARBY_CIK), "Warby Parker Inc.", "WRBY", "NYSE")], answers)
        # Field 5 states two LEIs and only one is a venue operator's: it is asked, the registrant as the candidate.
        self.assertEqual(issuer_questions(snap), [(f"isin:{WARBY_ISIN}", (f"cik:{WARBY_CIK}",))])
        self.assertIsNone(snap.securities[f"isin:{WARBY_ISIN}"].issuer_id)
        self.assertNotIn(reconcile.REGISTRANT_JOIN, snap.audit["reconcile"])


class ReceiptRootsTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch("urllib.request.urlopen", side_effect=AssertionError("network access in a test"))
        patcher.start()
        self.addCleanup(patcher.stop)

    def build(self, records: list[str]) -> Snapshot:
        given = inputs(Scope(mics=("XAMS",), sec=False))
        firds.apply(given.admissions, firds.full_records(stream(fulins(records)), given.scope.cfi_prefixes), Counter())
        return build_snapshot(given, gleif_fetch, FakeOpenFigi(OPENFIGI))

    def edges(self, snap: Snapshot) -> set[tuple[str, str, str]]:
        return {(r.from_id, r.to_id, r.rule_id) for r in snap.relationships if r.relation == "depositary_receipt_of"}

    def test_a_firds_receipt_stating_no_underlying_takes_its_issuers_one_live_share(self):
        # `NOISINFOUND9` is FIRDS' "no underlying" placeholder (no claim), and so is an empty field 26.
        for stated in ("NOISINFOUND9", None):
            with self.subTest(stated=stated):
                snap = self.build([firds_record("US0000000002", "XAMS", ASML_LEI, cfi="EDSXFR", underlying=stated)])
                self.assertIn(("isin:US0000000002", f"isin:{ASML_ISIN}", "receipt_issuer_share@1"), self.edges(snap))
                self.assertNotIn("isin:US0000000002", {q.subject_id for q in snap.questions})

    def test_a_firds_receipt_stating_no_underlying_beside_two_share_classes_is_still_asked(self):
        both = [firds_record("NL0000000002", "XAMS", ASML_LEI, name="ASML HOLDING B")]
        answers = {("ID_ISIN", "NL0000000002", "XAMS"): [figi_row("ASMB", "NA", "BBGASMBNA001", "BBGASMBSC001")]}
        given = inputs(Scope(mics=("XAMS",), sec=False))
        firds.apply(given.admissions, firds.full_records(stream(fulins(
            both + [firds_record("US0000000002", "XAMS", ASML_LEI, cfi="EDSXFR")])), given.scope.cfi_prefixes), Counter())
        snap = build_snapshot(given, gleif_fetch, FakeOpenFigi(OPENFIGI | answers))
        self.assertNotIn("isin:US0000000002", {from_id for from_id, _to, _rule in self.edges(snap)})
        asked = [q.candidates for q in snap.questions if q.question == "receipt_underlying" and q.subject_id == "isin:US0000000002"]
        self.assertEqual([sorted(found) for found in asked], [["isin:NL0000000002", f"isin:{ASML_ISIN}"]])

    def test_a_firds_receipt_whose_issuer_is_unknown_stays_asked(self):
        snap = Snapshot(as_of="2026-09-26")
        snap.securities["isin:US9"] = Security("isin:US9", "dr", "esma_firds", Evidence.ADMISSION_REGISTER, isin="US9")
        link_receipts(snap, frozenset({"US9"}))
        self.assertEqual([(q.question, q.subject_id, q.candidates) for q in snap.questions],
                         [("receipt_underlying", "isin:US9", ())])

    def test_a_share_stating_its_own_other_isin_is_a_same_security_and_asks_nothing(self):
        for name, same in (("ASML HOLDING", True), ("ASML HOLD", True), ("ASML HOLDING B", True), ("OTHER NAME", False)):
            with self.subTest(name=name):
                snap = self.build([firds_record("NL0000000003", "XAMS", ASML_LEI, name=name, underlying=ASML_ISIN)])
                asked = [q.subject_id for q in snap.questions if q.question == "receipt_conflict"]
                self.assertEqual(asked, [] if same else ["isin:NL0000000003"])
                self.assertEqual(snap.audit["reconcile"].get("same_security", 0), 1 if same else 0)

    def test_a_share_stating_another_issuers_security_is_still_a_conflict(self):
        other = "724500AAAAAAAAAAAA77"
        snap = self.build([firds_record("NL0000000004", "XAMS", other, name="ASML HOLDING", underlying=ASML_ISIN)])
        self.assertEqual([(q.subject_id, q.candidates, q.values) for q in snap.questions if q.question == "receipt_conflict"],
                         [("isin:NL0000000004", (f"isin:{ASML_ISIN}",), (ASML_ISIN,))])
        self.assertNotIn("same_security", snap.audit["reconcile"])

    def test_the_stated_security_must_be_the_shares_own_not_only_the_same_issuers(self):
        ours = Security("a", "share", "esma_firds", Evidence.ADMISSION_REGISTER, issuer_id="lei:X", name="Liberty SiriusXM")
        for stated, expected in ((dataclasses.replace(ours, security_id="b"), True),
                                 (dataclasses.replace(ours, security_id="b", name="Liberty Formula One"), False),
                                 (dataclasses.replace(ours, security_id="b", issuer_id="lei:Y"), False),
                                 (dataclasses.replace(ours, security_id="b", issuer_id=None), False),
                                 (None, False)):
            self.assertEqual(reconcile._same_security(ours, stated), expected)
        self.assertFalse(reconcile._same_security(dataclasses.replace(ours, issuer_id=None), ours))


if __name__ == "__main__":
    unittest.main()
