"""FIRDS as typed claims (RTS 23 Annex Table 3), its drift fingerprint, and the shadow comparison with today's decisions."""

import dataclasses
import tempfile
import unittest
from collections import Counter
from pathlib import Path

from reference_builder import claims, drift, firds, firds_audit, mic
from reference_builder.model import Issuer, Listing, Relationship, Security, Snapshot

from .fixtures import ASML_ISIN, ASML_LEI, MIC_CSV, firds_record, fulins, stream

OPERATOR_LEI = "529900OPERATORLEI001"  # illustrative: the LEI ISO 10383 lists for the Frankfurt open market


def admissions(xml: bytes, fingerprint=None) -> dict:
    found = {}
    firds.apply(found, firds.full_records(stream(xml), ("ES", "ED", "CE"), "2026-09-26", fingerprint), Counter())
    return found


def store_of(tmp: str, found: dict) -> claims.ClaimStore:
    store = claims.ClaimStore(Path(tmp) / "claims-20260926.sqlite3")
    store.add(firds.claims(found))
    return store


class FirdsAdapterTest(unittest.TestCase):
    def test_every_read_field_is_one_claim_meaning_and_placeholders_are_absence(self):
        xml = fulins([
            # Field 8 false: the venue admitted the share on its own initiative. Field 12 9999: no date known.
            firds_record(ASML_ISIN, "FRAB", ASML_LEI, requested="false", term="9999-12-31", relevant="XAMS"),
            firds_record(ASML_ISIN, "XAMS", ASML_LEI, request_date="2012-11-20"),
            # Field 26 on a receipt; a NOISIN placeholder is no underlying.
            firds_record("US0000000001", "XFRA", ASML_LEI, cfi="EDSXFR", underlying=ASML_ISIN, requested=None),
            firds_record("US0000000002", "XFRA", ASML_LEI, cfi="EDSXFR", underlying="NOISINFOUND9"),
        ])
        fingerprint = drift.Fingerprint(firds.SOURCE)
        with tempfile.TemporaryDirectory() as tmp:
            store = store_of(tmp, admissions(xml, fingerprint))
            rows = set(store.db.execute("SELECT subject_key, field, value, meaning FROM claims"))
            meanings = {m for (m,) in store.db.execute("SELECT DISTINCT meaning FROM claims")}
            store.close()
        self.assertTrue({meaning for _slot, meaning in firds.FIELDS.values()} <= set(claims.MEANINGS))
        self.assertIn((f"isin:{ASML_ISIN}", "issuer", ASML_LEI, "issuer_or_venue_operator_lei"), rows)
        self.assertIn((f"isin:{ASML_ISIN}", "currency", "EUR", "notional_currency"), rows, "never a trading currency")
        self.assertIn((f"isin:{ASML_ISIN}@FRAB", "listing", "false", "issuer_requested_admission"), rows)
        self.assertIn((f"isin:{ASML_ISIN}@XAMS", "listing", "2012-11-20", "admission_request_date"), rows)
        self.assertIn(("isin:US0000000001", "underlying", ASML_ISIN, "underlying_isin"), rows)
        self.assertNotIn("termination_date", meanings, "a 9999 placeholder is no termination date")
        self.assertFalse(any(s == "isin:US0000000002" and m == "underlying_isin" for s, _f, _v, m in rows))
        self.assertFalse(any(s == "isin:US0000000001@XFRA" and m == "issuer_requested_admission" for s, _f, _v, m in rows),
                         "a missing field 8 is absence, not false")
        self.assertEqual((fingerprint.metrics["termination_placeholder"], fingerprint.metrics["underlying_placeholder"]), (1, 1))

    def test_store_refuses_an_unknown_meaning_or_a_field_read_two_ways(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = claims.ClaimStore(Path(tmp) / "claims-x.sqlite3")
            claim = ("isin:X", "currency", "USD", "esma_firds", "FinInstrmGnlAttrbts/NtnlCcy")
            store.add([claim + ("notional_currency", None, None)])
            with self.assertRaises(ValueError):
                store.add([claim + ("trading_currency", None, None)])
            with self.assertRaises(ValueError):
                store.add([claim[:4] + ("FinInstrmGnlAttrbts/NtnlCcy", "cfi", None, None)])
            store.close(keep=False)


class DriftTest(unittest.TestCase):
    def fingerprint(self, xml: bytes) -> dict:
        found = drift.Fingerprint(firds.SOURCE)
        admissions(xml, found)
        return found.to_dict()

    def test_a_changed_source_trips_alarms_and_a_dropped_read_field_breaks(self):
        records = [firds_record(f"NL00000000{i:02d}", "XAMS", ASML_LEI) for i in range(20)]
        before = self.fingerprint(fulins(records))
        changed = [r.replace("<IssrReq>true</IssrReq>", "").replace("</TradgVnRltdAttrbts>", "<FrstAdmssnVn>XAMS</FrstAdmssnVn></TradgVnRltdAttrbts>")
                   for r in records[:19]] + [firds_record("NL0000000099", "XNEW", ASML_LEI, currency="XXX")]
        alarms = drift.compare(before, self.fingerprint(fulins(changed)), firds.READ_PATHS)
        found = {(a["severity"], a["kind"], a["key"]) for a in alarms}
        self.assertIn(("alarm", "field_added", "TradgVnRltdAttrbts/FrstAdmssnVn"), found)
        self.assertIn(("alarm", "new_value", "venue=XNEW"), found)
        self.assertIn(("alarm", "new_value", "notional_currency=XXX"), found)
        self.assertIn(("alarm", "presence_shift", "TradgVnRltdAttrbts/IssrReq"), found, "19 of 20 records lost field 8")
        self.assertEqual(drift.compare(before, self.fingerprint(fulins(records)), firds.READ_PATHS), [], "same data: quiet")
        gone = [r.replace("<IssrReq>true</IssrReq>", "") for r in records]
        broken = drift.compare(before, self.fingerprint(fulins(gone)), firds.READ_PATHS)
        self.assertIn(("break", "field_missing", "TradgVnRltdAttrbts/IssrReq"), {(a["severity"], a["kind"], a["key"]) for a in broken})


class ShadowComparisonTest(unittest.TestCase):
    def test_today_against_firds_claims(self):
        xml = fulins([
            # The issuer requested Amsterdam; Frankfurt's open market admitted it itself and is the most liquid market.
            firds_record(ASML_ISIN, "XAMS", OPERATOR_LEI, relevant="FRAB"),
            firds_record(ASML_ISIN, "FRAB", OPERATOR_LEI, requested="false", relevant="FRAB", currency="EUR"),
            firds_record("CH0000000001", "XAMS", ASML_LEI, relevant="XAMS"),  # home market outside FIRDS
            firds_record("US0000000001", "XFRA", ASML_LEI, cfi="EDSXFR", underlying=ASML_ISIN, requested="false", currency="USD"),
        ])
        venues = mic.parse(MIC_CSV.encode())
        venues["FRAB"] = dataclasses.replace(venues["FRAB"], lei=OPERATOR_LEI)
        snap = Snapshot(as_of="2026-09-26")
        snap.issuers = {f"lei:{lei}": Issuer(f"lei:{lei}", "X", "gleif", lei=lei) for lei in (OPERATOR_LEI, ASML_LEI)}
        for isin, lei, kind, primary in ((ASML_ISIN, OPERATOR_LEI, "share", "XFRA"), ("CH0000000001", ASML_LEI, "share", "XSWX"),
                                         ("US0000000001", ASML_LEI, "dr", "XFRA")):
            snap.securities[f"isin:{isin}"] = Security(f"isin:{isin}", kind, "esma_firds", issuer_id=f"lei:{lei}", isin=isin,
                                                       primary_mic=primary, primary_rule="firds_relevant_venue")
        snap.listings["XFRA:US0000000001"] = Listing("XFRA:US0000000001", "esma_firds", "dr", security_id="isin:US0000000001",
                                                     mic="XFRA", country="DE", currency="USD")
        snap.relationships.append(Relationship("isin:X", "depositary_receipt_of", f"isin:{ASML_ISIN}", "esma_firds", "r"))
        with tempfile.TemporaryDirectory() as tmp:
            store = store_of(tmp, admissions(xml))
            rows, summary = firds_audit.compare(firds_audit.load(store.db), snap, firds_audit.Venues(venues), "2026-09-26")
            store.close()
        found = {(field, category, subject) for field, category, _outcome, _question, subject, *_ in rows}
        outcomes = {(field, subject): (outcome, question) for field, _category, outcome, question, subject, *_ in rows}
        self.assertEqual(outcomes[("issuer", f"isin:{ASML_ISIN}")], ("unknown", "issuer_identity"), "an operator's LEI is no issuer")
        self.assertEqual(outcomes[("currency", "isin:US0000000001@XFRA")], ("unknown", "trading_currency"))
        self.assertIn(("issuer", "venue_operator_lei_of_reporting_venue", f"isin:{ASML_ISIN}"), found)
        self.assertIn(("primary", "contradicted_issuer_requested_another", f"isin:{ASML_ISIN}"), found)
        self.assertIn(("primary", "outside_eea_while_issuer_requested_eea", "isin:CH0000000001"), found)
        self.assertIn(("receipt_underlying", "today_missing", "isin:US0000000001"), found)
        self.assertIn(("currency", "notional_as_trading_currency", "isin:US0000000001@XFRA"), found)
        self.assertEqual(summary["currency_by_venue_country"], [["DE USD", 1]])
        self.assertFalse(any(f == "issuer" and s == "isin:CH0000000001" for f, _c, s in found), "an issuer's own LEI agrees")


if __name__ == "__main__":
    unittest.main()
