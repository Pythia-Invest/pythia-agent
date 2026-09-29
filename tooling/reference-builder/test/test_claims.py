"""FIRDS as typed claims (RTS 23 Annex Table 3), its drift fingerprint, the shadow comparison with today's
decisions, and the build: a FIRDS break stops it, and the claims never change the snapshot."""

import dataclasses
import json
import tempfile
import unittest
import zipfile
from collections import Counter
from datetime import date
from pathlib import Path
from unittest import mock

from reference_builder import assemble, claims, firds, gleif, main, mic, source_drift
from reference_builder.config import BuildConfig, Scope
from reference_builder.pipeline import build_snapshot
from reference_builder.schema import identity

from .fixtures import ASML_ISIN, ASML_LEI, MIC_CSV, NN_ISIN, NN_LEI, FakeOpenFigi, firds_record, fulins, gleif_item, stream
from .test_pipeline import OPENFIGI, SHELL_ISIN, SHELL_LEI, gleif_fetch

OPERATOR_LEI = "529900OPERATORLEI001"  # illustrative: the LEI ISO 10383 lists for the Frankfurt open market


def admissions(xml: bytes, fingerprint=None) -> dict:
    found = {}
    firds.apply(found, firds.full_records(stream(xml), ("ES", "ED", "CE"), "2026-09-26", fingerprint), Counter())
    return found


def fingerprint_of(xml: bytes) -> dict:
    found = source_drift.Fingerprint(firds.SOURCE)
    loaded = claims.load(firds.claims(admissions(xml, found)))
    firds.measure(found, loaded.isins)
    return found.to_dict()


class FirdsAdapterTest(unittest.TestCase):
    def test_every_read_field_is_one_core_meaning_and_placeholders_are_absence(self):
        self.assertEqual(len(set(firds.FIELDS.values())), len(firds.FIELDS), "no two fields share a meaning")
        self.assertTrue(all(isinstance(m, identity.SourceMeaning) for m in firds.FIELDS.values()))
        xml = fulins([
            # Field 8 false: the venue admitted the share on its own initiative. Field 12 9999: no date known.
            firds_record(ASML_ISIN, "FRAB", ASML_LEI, requested="false", term="9999-12-31", relevant="XAMS"),
            firds_record(ASML_ISIN, "XAMS", ASML_LEI, request_date="2012-11-20"),
            # Field 26 on a receipt; a NOISIN placeholder is no underlying.
            firds_record("US0000000001", "XFRA", ASML_LEI, cfi="EDSXFR", underlying=ASML_ISIN, requested=None),
            firds_record("US0000000002", "XFRA", ASML_LEI, cfi="EDSXFR", underlying="NOISINFOUND9"),
        ])
        fingerprint = source_drift.Fingerprint(firds.SOURCE)
        rows = {(c.subject_key, c.value, c.meaning) for c in firds.claims(admissions(xml, fingerprint))}
        meanings = {m for _s, _v, m in rows}
        self.assertIn((f"isin:{ASML_ISIN}", ASML_LEI, "issuer_or_venue_operator_lei"), rows)
        self.assertIn((f"isin:{ASML_ISIN}", "EUR", "notional_currency"), rows, "never a trading currency")
        self.assertIn((f"isin:{ASML_ISIN}@FRAB", "false", "issuer_requested_admission"), rows)
        self.assertIn((f"isin:{ASML_ISIN}@XAMS", "2012-11-20", "admission_request_date"), rows)
        self.assertIn(("isin:US0000000001", ASML_ISIN, "underlying_isin"), rows)
        self.assertNotIn("termination_date", meanings, "a 9999 placeholder is no termination date")
        self.assertFalse(any(s == "isin:US0000000002" and m == "underlying_isin" for s, _v, m in rows))
        self.assertFalse(any(s == "isin:US0000000001@XFRA" and m == "issuer_requested_admission" for s, _v, m in rows),
                         "a missing field 8 is absence, not false")
        self.assertEqual((fingerprint.metrics["termination_placeholder"], fingerprint.metrics["underlying_placeholder"]), (1, 1))

    def test_malformed_identifiers_and_withdrawn_currencies_are_counted_not_coerced(self):
        fingerprint = source_drift.Fingerprint(firds.SOURCE)
        found = admissions(fulins([
            firds_record("NL0000000002", "XAMS", "NOT-AN-LEI", currency="BGN"),  # check digit wrong; lev withdrawn in 2026
            firds_record(ASML_ISIN, "XAMS", ASML_LEI),
        ]), fingerprint)
        self.assertEqual(len(found), 2, "kept as reported")
        self.assertEqual({k: fingerprint.metrics[k] for k in ("malformed_isin", "malformed_issuer_lei", "withdrawn_notional_currency")},
                         {"malformed_isin": 1, "malformed_issuer_lei": 1, "withdrawn_notional_currency": 1})


class DriftTest(unittest.TestCase):
    def test_a_changed_source_trips_alarms_and_a_dropped_read_field_breaks(self):
        records = [firds_record(f"NL00000000{i:02d}", "XAMS", ASML_LEI) for i in range(20)]
        before = fingerprint_of(fulins(records))
        changed = [r.replace("<IssrReq>true</IssrReq>", "").replace("</TradgVnRltdAttrbts>", "<FrstAdmssnVn>XAMS</FrstAdmssnVn></TradgVnRltdAttrbts>")
                   for r in records[:19]] + [firds_record("NL0000000099", "XNEW", ASML_LEI, currency="XXX")]
        found = {(a["severity"], a["kind"], a["key"]) for a in source_drift.compare(before, fingerprint_of(fulins(changed)), firds.READ_PATHS)}
        self.assertIn(("alarm", "field_added", "TradgVnRltdAttrbts/FrstAdmssnVn"), found)
        self.assertIn(("alarm", "new_value", "venue=XNEW"), found)
        self.assertIn(("alarm", "new_value", "notional_currency=XXX"), found)
        self.assertIn(("alarm", "presence_shift", "TradgVnRltdAttrbts/IssrReq"), found, "19 of 20 records lost field 8")
        self.assertEqual(source_drift.compare(before, fingerprint_of(fulins(records)), firds.READ_PATHS), [], "same data: quiet")
        gone = [r.replace("<IssrReq>true</IssrReq>", "") for r in records]
        broken = source_drift.compare(before, fingerprint_of(fulins(gone)), firds.READ_PATHS)
        self.assertIn(("break", "field_missing", "TradgVnRltdAttrbts/IssrReq"), {(a["severity"], a["kind"], a["key"]) for a in broken})

    def test_a_rare_field_that_empties_and_a_count_that_vanishes_raise_alarms(self):
        before = {"records": 10000, "fields": {"Issr": 10000, "DerivInstrmAttrbts/UndrlygInstrm/Sngl/ISIN": 120},
                  "metrics": {"termination_placeholder": 59, "underlying_placeholder": 203}}
        after = {"records": 10000, "fields": {"Issr": 10000, "DerivInstrmAttrbts/UndrlygInstrm/Sngl/ISIN": 1},
                 "metrics": {"termination_placeholder": 59}}
        found = {(a["kind"], a["key"]) for a in source_drift.compare(before, after)}
        self.assertIn(("presence_shift", "DerivInstrmAttrbts/UndrlygInstrm/Sngl/ISIN"), found, "1.2% to 0.01% is a shift")
        self.assertIn(("metric_gone", "underlying_placeholder"), found)

    def test_a_broken_build_never_becomes_the_baseline(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            claims.write(claims.record_path(out, "firds", "20260926"), {"good": True, "fingerprint": {"records": 5}})
            claims.write(claims.record_path(out, "firds", "20261003"), {"good": False, "fingerprint": {"records": 4}})
            found = claims.previous_good(claims.record_path(out, "firds", "20261010"))
        self.assertEqual(found[0].name, "firds-20260926.json")


class IssuerTest(unittest.TestCase):
    def test_field_5_decides_the_issuer_unless_it_names_a_venue_operator_abroad(self):
        found = claims.load(firds.claims(admissions(fulins([
            firds_record(ASML_ISIN, "XAMS", ASML_LEI),
            firds_record("US0000000003", "FRAB", OPERATOR_LEI),  # the operator's LEI on a foreign share
            firds_record("DE0000000004", "FRAB", OPERATOR_LEI),  # the operator's own share
            firds_record("US0000000001", "XFRA", OPERATOR_LEI, cfi="EDSXFR", underlying="DE0000000004"),  # its receipt
        ]))))
        venues = mic.parse(MIC_CSV.encode())
        venues["FRAB"] = dataclasses.replace(venues["FRAB"], lei=OPERATOR_LEI)
        entities = {OPERATOR_LEI: mock.Mock(country="DE")}
        decided = {isin: assemble.issuer_lei(found, claims.Venues(venues), entities, isin) for isin in found.isins}
        self.assertEqual(decided, {ASML_ISIN: ASML_LEI, "US0000000003": None, "DE0000000004": OPERATOR_LEI,
                                   "US0000000001": OPERATOR_LEI})

    def test_receipts_claiming_a_share_for_a_live_issuer_without_shares_leave_its_issuer_asked(self):
        # Field 5 on a receipt names its underlying's issuer (Q&A 1503): Nestlé S.A.'s CDR states the share FIRDS files
        # under Nestlé Capital Markets. Another company's CDR stating a share (Oracle's, stating Thermo Fisher)
        # contradicts its own field 26 instead: that company issues a share of its own. A retired LEI's claim (Merck
        # Sharp & Dohme Corp. on Merck & Co.) is stale.
        parent, vehicle, thermo, oracle = "KY37LUS27QQX7BB93L28", "549300PZN3NFSOUXLC42", "THERMOLEI00000000001", "ORACLELEI00000000001"
        merck, msd = "4YV9Y5M8S0BRK1RP0397", "MZK1AT00SJV4XB7WNL71"
        found = admissions(fulins([
            firds_record("CH0038863350", "XAMS", vehicle),
            firds_record("CA6410701073", "XAMS", parent, cfi="EDSXFR", underlying="CH0038863350"),
            firds_record("US6410694060", "XAMS", vehicle, cfi="EDSXFR", underlying="CH0038863350"),  # the ADR
            firds_record("US8835561023", "XAMS", thermo),
            firds_record("US68389X1054", "XAMS", oracle),
            firds_record("CA0000000001", "XAMS", oracle, cfi="EDSXFR", underlying="US8835561023"),
            firds_record("US58933Y1055", "XAMS", merck),
            firds_record("CA0000000002", "XAMS", msd, cfi="EDSXFR", underlying="US58933Y1055"),
        ]))
        loaded = claims.load(firds.claims(found))
        self.assertEqual(loaded.receipt_issuers, {"CH0038863350": {parent}, "US58933Y1055": {msd}})
        entities = {e.lei: e for e in map(gleif.entity_from_api, [
            gleif_item(parent, "NESTLÉ S.A."), gleif_item(vehicle, "NESTLÉ CAPITAL MARKETS SA"), gleif_item(oracle, "Oracle"),
            gleif_item(thermo, "Thermo"), gleif_item(merck, "MERCK & CO., INC."),
            gleif_item(msd, "MERCK SHARP & DOHME CORP.", status="INACTIVE", registration="RETIRED")])}
        snap = build_snapshot(assemble.Inputs(date(2026, 9, 26), Scope(mics=("XAMS",), sec=False), mic.parse(MIC_CSV.encode()),
                                              found, None, [], {"XAMS"}, firds_claims=loaded),
                              lambda leis: {lei: entities[lei] for lei in leis if lei in entities}, FakeOpenFigi({}))
        issuers = {isin: snap.securities[f"isin:{isin}"].issuer_id
                   for isin in ("CH0038863350", "US6410694060", "CA6410701073", "US8835561023", "US58933Y1055")}
        self.assertEqual(issuers, {"CH0038863350": None, "US6410694060": None, "CA6410701073": f"lei:{parent}",
                                   "US8835561023": f"lei:{thermo}", "US58933Y1055": f"lei:{merck}"})
        asked = [(q.subject_id, q.candidates) for q in snap.questions if q.question == "issuer_identity"]
        both = (f"lei:{parent}", f"lei:{vehicle}")  # the receipts' issuer first, then field 5: either can be the answer
        self.assertEqual(asked, [("isin:CH0038863350", both), ("isin:US6410694060", both)])
        self.assertLessEqual(set(both), set(snap.issuers))
        self.assertLessEqual({("isin:CA6410701073", "isin:CH0038863350"), ("isin:US6410694060", "isin:CH0038863350")},
                             {(r.from_id, r.to_id) for r in snap.relationships},
                             "field 26 still links receipts under an issuer claimed for the share")


class BuildTest(unittest.TestCase):
    """`main.run` on hand-made sources: the FIRDS record, its gate, and a snapshot the claims leave unchanged."""

    def run_build(self, tmp: Path, day: str, records: list[str], gates: bool = True, sec_file: Path | None = None) -> int:
        stamp = day.replace("-", "")
        archive = tmp / f"FULINS_E_{stamp}_01of01.zip"
        with zipfile.ZipFile(archive, "w") as zipped:
            zipped.writestr(archive.name.replace(".zip", ".xml"), fulins(records))

        class Figi:
            keyed = False

            def __init__(self, *args):
                self.map = FakeOpenFigi(OPENFIGI)

            def mic_codes(self):
                return {"XAMS"}

            def provenance(self):
                return {"answers_to": None}

        class Gleif:
            calls = 0

            def __init__(self, *args):
                self.fetch = gleif_fetch

            def provenance(self):
                return None

        config = BuildConfig(scope=Scope(mics=("XAMS",), sec=sec_file is not None), as_of=date.fromisoformat(day),
                             out_dir=tmp / "out", cache_dir=tmp / "cache", fitrs=False, gates=gates, sec_file=sec_file)
        with mock.patch.object(main.mic, "fetch", lambda *a: MIC_CSV.encode()), \
                mock.patch.object(main.firds, "firds_files", lambda *a: ([{"file_name": archive.name}], [])), \
                mock.patch.object(main.firds, "download", lambda *a: str(archive)), \
                mock.patch.object(main, "OpenFigi", Figi), mock.patch.object(main, "GleifClient", Gleif), \
                mock.patch.object(main, "load_openfigi_key", lambda: None), \
                mock.patch.object(main.truth_report, "build_report", lambda *a: {}), \
                mock.patch("urllib.request.urlopen", side_effect=AssertionError("network access in a test")):
            return main.run(config)

    # NN's share states ASML as its underlying (field 26): the build leaves that open as a question.
    RECORDS = [firds_record(ASML_ISIN, "XAMS", ASML_LEI, name="ASML HOLDING"), firds_record(SHELL_ISIN, "XAMS", SHELL_LEI),
               firds_record(NN_ISIN, "XAMS", NN_LEI, name="NN GROUP", underlying=ASML_ISIN)]

    def test_the_package_carries_the_questions_and_a_firds_break_stops_the_build(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            self.assertEqual(self.run_build(tmp, "2026-09-26", self.RECORDS), 0)
            out = tmp / "out"
            record = claims.read(out / "firds-20260926.json")
            self.assertTrue(record["good"])
            self.assertLess((out / "firds-20260926.json").stat().st_size, 100_000)
            self.assertEqual(sorted(p.name for p in out.iterdir()), ["firds-20260926.json", "manifest.json", "package.json",
                                                                      "questions-20260926.json", "reference-20260926.sqlite3"])
            package = json.loads((out / "package.json").read_text())
            questions = claims.read(out / package["claims"]["file"])["questions"]
            self.assertEqual([(q["question"], q["kind"], q["reason"], q["subject_ids"], q["candidate_ids"]) for q in questions],
                             [("receipt_conflict", "conflict", "relation", [f"security:isin:{NN_ISIN}"],
                               [f"security:isin:{ASML_ISIN}"])],
                             "Shell's unknown primary is no question (ADR 0044, A5)")

            gone = [r.replace("<IssrReq>true</IssrReq>", "") for r in self.RECORDS]  # ESMA stops sending field 8
            self.assertEqual(self.run_build(tmp, "2026-10-03", gone), 2)
            self.assertFalse((out / "reference-20261003.sqlite3").exists())
            self.assertFalse((out / "firds-20261003.json").exists())
            self.assertEqual(self.run_build(tmp, "2026-10-03", gone, gates=False), 1)
            self.assertFalse(claims.read(out / "firds-20261003.json")["good"])
            self.assertFalse((out / "package.json").exists(), "a broken build is no package")
            self.assertEqual(claims.previous_good(out / "firds-20261010.json")[0].name, "firds-20260926.json")



if __name__ == "__main__":
    unittest.main()
