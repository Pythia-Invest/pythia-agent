"""FIRDS as typed claims (RTS 23 Annex Table 3), its drift fingerprint, the shadow comparison with today's
decisions, and the build: a FIRDS break stops it, and the claims never change the snapshot."""

import dataclasses
import sqlite3
import tempfile
import unittest
import zipfile
from collections import Counter
from datetime import date
from pathlib import Path
from unittest import mock

from reference_builder import claims, firds, firds_audit, main, mic, source_drift
from reference_builder.assemble import Inputs
from reference_builder.config import BuildConfig, Scope
from reference_builder.model import Issuer, Listing, Relationship, Security, Snapshot
from reference_builder.pipeline import build_snapshot
from reference_builder.schema import identity
from reference_builder.writer import write

from .fixtures import ASML_ISIN, ASML_LEI, MIC_CSV, FakeOpenFigi, firds_record, fulins, stream
from .test_pipeline import OPENFIGI, SHELL_ISIN, SHELL_LEI, gleif_fetch

OPERATOR_LEI = "529900OPERATORLEI001"  # illustrative: the LEI ISO 10383 lists for the Frankfurt open market


def admissions(xml: bytes, fingerprint=None) -> dict:
    found = {}
    firds.apply(found, firds.full_records(stream(xml), ("ES", "ED", "CE"), "2026-09-26", fingerprint), Counter())
    return found


def fingerprint_of(xml: bytes) -> dict:
    found = source_drift.Fingerprint(firds.SOURCE)
    loaded = firds_audit.load(firds.claims(admissions(xml, found)))
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


class ShadowComparisonTest(unittest.TestCase):
    def comparison(self, today: dict[str, str], issuer_lei: str = OPERATOR_LEI) -> dict:
        xml = fulins([
            # The issuer requested Amsterdam; Frankfurt's open market admitted it itself and is the most liquid market.
            # Warsaw GlobalConnect answers field 8 true for every share it carries: a venue habit, no evidence.
            firds_record(ASML_ISIN, "XAMS", issuer_lei, relevant="FRAB"),
            firds_record(ASML_ISIN, "XGLO", issuer_lei, relevant="FRAB"),
            firds_record(ASML_ISIN, "FRAB", issuer_lei, requested="false", relevant="FRAB"),
            firds_record("US0000000003", "XGLO", ASML_LEI, relevant="XGLO"),  # requested only through the habit
            firds_record("US0000000001", "XFRA", ASML_LEI, cfi="EDSXFR", underlying=ASML_ISIN, requested="false", currency="USD"),
            firds_record("AR0000000001", "XFRA", ASML_LEI, cfi="ESXXXX", underlying=ASML_ISIN, requested="false"),  # a CEDEAR
        ])
        venues = mic.parse(MIC_CSV.encode())
        venues["FRAB"] = dataclasses.replace(venues["FRAB"], lei=OPERATOR_LEI)
        venues["XGLO"] = dataclasses.replace(venues["XAMS"], mic="XGLO", operating_mic="XWAR", country="PL")
        snap = Snapshot(as_of="2026-09-26")
        snap.issuers = {f"lei:{lei}": Issuer(f"lei:{lei}", "X", "gleif", lei=lei) for lei in (OPERATOR_LEI, ASML_LEI)}
        for isin, kind in ((ASML_ISIN, "share"), ("US0000000003", "share"), ("US0000000001", "dr"), ("AR0000000001", "share")):
            snap.securities[f"isin:{isin}"] = Security(f"isin:{isin}", kind, "esma_firds", issuer_id=f"lei:{issuer_lei}",
                                                       isin=isin, primary_mic=today.get(isin))
        snap.listings["XFRA:US0000000001"] = Listing("XFRA:US0000000001", "esma_firds", "dr", security_id="isin:US0000000001",
                                                     mic="XFRA", country="DE", currency="USD")
        snap.relationships.append(Relationship("isin:X", "depositary_receipt_of", f"isin:{ASML_ISIN}", "esma_firds", "r"))
        return firds_audit.compare(firds_audit.load(firds.claims(admissions(xml))), snap, firds_audit.Venues(venues), "2026-09-26")

    def categories(self, summary: dict, name: str) -> set[str]:
        return set(summary[name])

    def test_outcomes_follow_the_claims_whatever_today_holds(self):
        on_xams = self.comparison({ASML_ISIN: "XAMS", "US0000000003": "XNAS"})
        on_floor = self.comparison({ASML_ISIN: "XFRA", "US0000000003": "XFRA"})
        self.assertIn("decided / agrees", self.categories(on_xams, "primary"), "XGLO's habit makes no co-primary")
        self.assertIn("decided / differs", self.categories(on_floor, "primary"))
        for summary in (on_xams, on_floor):
            self.assertIn("unknown + home_market / today_guess", self.categories(summary, "primary"), "only the habit")
            self.assertEqual(self.categories(summary, "issuer") & {"unknown + issuer_identity / today_guess"},
                             {"unknown + issuer_identity / today_guess"}, "an operator's LEI is no issuer")
            self.assertEqual(self.categories(summary, "currency"), {"outside_firds / today_is_the_notional"})
            self.assertIn("conflict + receipt_underlying / today_none", self.categories(summary, "receipt_underlying"),
                          "a share stating an underlying")
            self.assertIn("decided / today_none", self.categories(summary, "receipt_underlying"))
            self.assertEqual(summary["questions"]["home_market"]["count"], 1)
        own = self.comparison({ASML_ISIN: "XAMS"}, issuer_lei=ASML_LEI)
        self.assertIn("decided / agrees", self.categories(own, "issuer"))


class BuildTest(unittest.TestCase):
    """`main.run` on hand-made sources: the FIRDS record, its gate, and a snapshot the claims leave unchanged."""

    def run_build(self, tmp: Path, day: str, records: list[str], gates: bool = True) -> int:
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

        config = BuildConfig(scope=Scope(mics=("XAMS",), sec=False), as_of=date.fromisoformat(day), out_dir=tmp / "out",
                             cache_dir=tmp / "cache", fitrs=False, gates=gates)
        with mock.patch.object(main.mic, "fetch", lambda *a: MIC_CSV.encode()), \
                mock.patch.object(main.firds, "firds_files", lambda *a: ([{"file_name": archive.name}], [])), \
                mock.patch.object(main.firds, "download", lambda *a: str(archive)), \
                mock.patch.object(main, "OpenFigi", Figi), mock.patch.object(main, "GleifClient", Gleif), \
                mock.patch.object(main, "load_openfigi_key", lambda: None), \
                mock.patch.object(main.truth_report, "build_report", lambda *a: {}), \
                mock.patch("urllib.request.urlopen", side_effect=AssertionError("network access in a test")):
            return main.run(config)

    RECORDS = [firds_record(ASML_ISIN, "XAMS", ASML_LEI, name="ASML HOLDING"), firds_record(SHELL_ISIN, "XAMS", SHELL_LEI)]

    def test_the_claims_leave_the_snapshot_unchanged_and_a_firds_break_stops_the_build(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            self.assertEqual(self.run_build(tmp, "2026-09-26", self.RECORDS), 0)
            out = tmp / "out"
            record = claims.read(out / "firds-20260926.json")
            self.assertTrue(record["good"])
            self.assertLess((out / "firds-20260926.json").stat().st_size, 100_000)
            self.assertEqual(sorted(p.name for p in out.iterdir()),
                             ["firds-20260926.json", "manifest.json", "package.json", "reference-20260926.sqlite3"])
            # The same inputs assembled and written without any claims step.
            found = {}
            firds.apply(found, firds.full_records(stream(fulins(self.RECORDS)), Scope().cfi_prefixes), Counter())
            inputs = Inputs(date(2026, 9, 26), Scope(mics=("XAMS",), sec=False), mic.parse(MIC_CSV.encode()), found, None, [], {"XAMS"})
            write(build_snapshot(inputs, gleif_fetch, FakeOpenFigi(OPENFIGI)), tmp / "plain.sqlite3", {"created_at": "2026-09-26T00:00:00Z"}, [])
            self.assertEqual(tables(out / "reference-20260926.sqlite3"), tables(tmp / "plain.sqlite3"))

            gone = [r.replace("<IssrReq>true</IssrReq>", "") for r in self.RECORDS]  # ESMA stops sending field 8
            self.assertEqual(self.run_build(tmp, "2026-10-03", gone), 2)
            self.assertFalse((out / "reference-20261003.sqlite3").exists())
            self.assertFalse((out / "firds-20261003.json").exists())
            self.assertEqual(self.run_build(tmp, "2026-10-03", gone, gates=False), 1)
            self.assertFalse(claims.read(out / "firds-20261003.json")["good"])
            self.assertFalse((out / "package.json").exists(), "a broken build is no package")
            self.assertEqual(claims.previous_good(out / "firds-20261010.json")[0].name, "firds-20260926.json")


def tables(path: Path) -> dict:
    """Every table's rows, without the build time a write stamps on them."""
    with sqlite3.connect(path) as db:
        found = {}
        for (table,) in db.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'release'"):
            columns = [row[1] for row in db.execute(f"PRAGMA table_info({table})") if row[1] not in ("retrieved_at", "evidence_id")]
            found[table] = sorted(db.execute(f"SELECT {','.join(columns)} FROM {table}"), key=repr)
    return found


if __name__ == "__main__":
    unittest.main()
