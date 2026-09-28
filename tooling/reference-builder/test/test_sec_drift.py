"""The SEC ticker files' drift fingerprint (docs/sources/sec.md, stage 2) and the gate a broken file trips.

Rows follow the published shape of `company_tickers_exchange.json` (`fields` cik, name, ticker, exchange and a
`data` array of rows) and `company_tickers_mf.json` (cik, seriesId, classId, symbol). Values are illustrative.
"""

import json
import tempfile
import unittest
from pathlib import Path

from reference_builder import claims, sec, source_drift, truth_report

from .fixtures import sec_json
from .test_claims import BuildTest

ROWS = [
    (320193, "Apple Inc.", "AAPL", "Nasdaq"),
    (1067983, "BERKSHIRE HATHAWAY INC", "BRK-B", "NYSE"),
    (1067983, "BERKSHIRE HATHAWAY INC", "BRK-A", "NYSE"),
    (937966, "ASML HOLDING NV", "ASMLF", "OTC"),
    (1347123, "Example Devices, Inc.", "NONE.", None),  # a placeholder ticker without an exchange, as SEC ships one
]


MANY = [(1000 + i, f"COMPANY {i}", f"TK{i}", ("Nasdaq", "NYSE", "OTC")[i % 3]) for i in range(300)]


def funds_json(rows) -> bytes:
    return json.dumps({"fields": ["cik", "seriesId", "classId", "symbol"], "data": [list(r) for r in rows]}).encode()


def observed(rows, source=sec.TICKERS) -> dict:
    data = sec_json(rows) if source == sec.TICKERS else funds_json(rows)
    return sec.observe(source, data).to_dict()


class SecFingerprintTest(unittest.TestCase):
    def test_the_fingerprint_counts_what_the_parse_would_absorb(self):
        found = observed(ROWS)
        self.assertEqual(found["records"], 5)
        self.assertEqual(found["fields"], {"cik": 5, "name": 5, "ticker": 5, "exchange": 4})
        self.assertEqual(found["vocab"], {"exchange": {"NYSE": 2, "Nasdaq": 1, "OTC": 1}})
        metrics = found["metrics"]
        self.assertEqual((metrics["exchange_missing"], metrics["malformed_ticker"], metrics["class_suffix_ticker"]), (1, 1, 2))
        self.assertEqual((metrics["ticker_on_several_rows"], metrics["cik_several_titles"]), (0, 0), "zero counts are reported")
        self.assertEqual(metrics["ciks_with_several_tickers"], 1)
        self.assertEqual(found["examples"]["metric:malformed_ticker"], ["ticker:NONE."])
        # The parse keeps the first of two rows naming one ticker; the fingerprint counts the second.
        twice = observed(ROWS + [(1, "OTHER CO", "AAPL", "NYSE"), (320193, "APPLE INC", "AAPL-W", "Nasdaq")])["metrics"]
        self.assertEqual((twice["ticker_on_several_rows"], twice["cik_several_titles"]), (1, 1))
        self.assertEqual([t.ticker for t in sec.parse(sec_json(ROWS + [(1, "OTHER CO", "AAPL", "NYSE")]))].count("AAPL"), 1)
        odd = observed([("320193", ["Apple Inc."], 42, "Nasdaq")])["metrics"]  # wrong types are counted, never read
        self.assertEqual((odd["malformed_cik"], odd["malformed_ticker"]), (1, 1))

    def test_fund_symbols_that_are_placeholders_or_lower_case_are_counted(self):
        found = observed([(2110, "S000009184", "C000024954", "LACAX"), (32339, "S000011821", "C000032303", "elfnx"),
                          (1660765, "S000052998", "C000166588", "n/a"), (844779, "S000051092", "C000160934", "")], sec.FUNDS)
        self.assertEqual((found["records"], found["fields"]["symbol"]), (4, 3))
        self.assertEqual((found["metrics"]["malformed_symbol"], found["metrics"]["symbol_missing"]), (2, 1))

    def test_a_changed_file_raises_alarms_and_a_dropped_read_column_breaks(self):
        before = observed(MANY)
        relabelled = observed([row[:3] + ("NYSE American" if row[3] == "NYSE" else row[3],) for row in MANY])
        kinds = {(a["kind"], a["key"]) for a in source_drift.compare(before, relabelled, sec.READ[sec.TICKERS])}
        self.assertIn(("new_value", "exchange=NYSE American"), kinds)
        self.assertIn(("value_gone", "exchange=NYSE"), kinds)
        dup = observed(MANY + [(1, "OTHER CO", "TK7", "NYSE")])
        self.assertIn(("metric_shift", "ticker_on_several_rows"),
                      {(a["kind"], a["key"]) for a in source_drift.compare(before, dup, sec.READ[sec.TICKERS])})
        no_exchange = json.dumps({"fields": ["cik", "name", "ticker"], "data": [list(r[:3]) for r in MANY]}).encode()
        alarms = source_drift.compare(before, sec.observe(sec.TICKERS, no_exchange).to_dict(), sec.READ[sec.TICKERS])
        self.assertEqual([(a["kind"], a["key"]) for a in source_drift.breaks(alarms)], [("field_missing", "exchange")])
        for bad in (b"<html>maintenance</html>", json.dumps({"data": []}).encode()):
            gone = sec.observe(sec.TICKERS, bad).to_dict()
            self.assertEqual(gone["metrics"], {"unexpected_shape": 1})
            self.assertEqual(source_drift.breaks(source_drift.compare(before, gone))[0]["kind"], "no_records")

    def test_a_broken_ticker_file_stops_the_build_and_never_becomes_the_baseline(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp, out = Path(tmp), Path(tmp) / "out"
            out.mkdir()
            good = observed(ROWS)
            baseline = claims.record_path(out, sec.TICKERS, "20260926")
            claims.write(baseline, {"good": True, "fingerprint": good, "report": claims.drift(baseline, good)})
            broken = tmp / "company_tickers_exchange.json"
            broken.write_text(json.dumps({"fields": ["cik", "name", "ticker"], "data": [list(r[:3]) for r in ROWS]}))
            build = BuildTest()
            self.assertEqual(build.run_build(tmp, "2026-10-03", BuildTest.RECORDS, sec_file=broken), 2)
            self.assertFalse((out / "reference-20261003.sqlite3").exists())
            self.assertFalse(claims.record_path(out, sec.TICKERS, "20261003").exists())
            # Written anyway for inspection: no SEC lines are parsed, the record is not good, and no package is made.
            self.assertEqual(build.run_build(tmp, "2026-10-03", BuildTest.RECORDS, gates=False, sec_file=broken), 1)
            record = claims.read(claims.record_path(out, sec.TICKERS, "20261003"))
            self.assertFalse(record["good"])
            self.assertEqual(record["report"]["baseline"], baseline.name)
            self.assertFalse((out / "package.json").exists())
            later = claims.record_path(out, sec.TICKERS, "20261010")
            self.assertEqual(claims.previous_good(later)[0].name, baseline.name)
            # `just reference-audit` shows the break beside that snapshot and fails on it.
            lines, broken = truth_report.sec_section(out / "reference-20261003.sqlite3")
            self.assertTrue(broken)
            self.assertIn("BREAK field_missing exchange", "\n".join(lines))
            self.assertEqual(truth_report.sec_section(out / "reference-20260926.sqlite3")[1], False)


if __name__ == "__main__":
    unittest.main()
