"""Whole-build invariants: a clean fixture build passes, and each planted systematic error is counted."""

import dataclasses
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from reference_builder import invariant_names, invariants, truth_report, writer
from reference_builder.pipeline import build_snapshot

from .fixtures import FakeOpenFigi
from .test_pipeline import OPENFIGI, gleif_fetch, inputs


def counts(path: Path, *names: str) -> dict[str, int]:
    return {r.name: r.count for r in invariants.run(path) if r.name in names}


class InvariantTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch("urllib.request.urlopen", side_effect=AssertionError("network access in a test"))
        patcher.start()
        self.addCleanup(patcher.stop)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name) / "reference-test.sqlite3"
        snap = build_snapshot(inputs(), gleif_fetch, FakeOpenFigi(OPENFIGI))
        writer.write(snap, self.path, {"build_id": "test", "scope": "XAMS,SEC", "as_of": "2026-09-28"}, [])

    def plant(self, sql: str, *args) -> None:
        with sqlite3.connect(self.path) as db:
            db.execute(sql, args)

    def test_the_fixture_build_has_no_error(self):
        failed = [(r.name, r.count, r.examples) for r in invariants.run(self.path) if r.severity == "error" and r.count]
        self.assertEqual(failed, [])

    def test_growth_past_a_ratchet_limit_fails_the_audit(self):
        self.plant("INSERT OR REPLACE INTO venues VALUES ('XETR', 'XETR', 'Xetra', 'DE', 'NSPD')")
        self.plant("UPDATE listings SET mic = 'XETR', operating_mic = 'XETR', currency = 'USD' WHERE id = "
                   "(SELECT id FROM listings WHERE operating_mic = 'XAMS' LIMIT 1)")
        # A fix lowered the currency limit to 0; one notional-currency line on Xetra is growth and fails.
        lowered = tuple(dataclasses.replace(i, limit=0) if i.name == "currency_single_currency_venue" else i
                        for i in invariants.INVARIANTS)
        result = next(r for r in invariants.run(self.path, lowered) if r.name == "currency_single_currency_venue")
        self.assertEqual((result.count, result.failed), (1, True))
        with mock.patch("sys.stdout"), mock.patch("sys.stderr"), \
                mock.patch.object(truth_report, "load_baseline", return_value=None), \
                mock.patch.object(invariants, "INVARIANTS", lowered):
            self.assertEqual(truth_report.main(["--reference", str(self.path)]), 1)

    def test_every_limit_is_a_count_not_a_tolerance(self):
        # The ratchet: limits are exact measured counts, so none is negative and the zero rules stay zero.
        limits = {i.name: i.limit for i in invariants.INVARIANTS}
        self.assertTrue(all(limit >= 0 for limit in limits.values()))
        self.assertEqual((limits["name_casing"], limits["primary_more_than_one"]), (0, 0))

    def test_a_toronto_home_primary_beside_an_nyse_line_is_not_open_market(self):
        # ISO 10383 leaves Toronto's market category unspecified; only EEA venues declare regulated vs open market.
        self.plant("INSERT OR REPLACE INTO venues VALUES ('XTSE', 'XTSE', 'Toronto Stock Exchange', 'CA', 'NSPD')")
        self.plant("INSERT OR REPLACE INTO venues VALUES ('XNYS', 'XNYS', 'NYSE', 'US', 'NSPD')")
        self.plant("INSERT OR REPLACE INTO venues VALUES ('XMUN', 'XMUN', 'Munich', 'DE', 'NSPD')")
        with sqlite3.connect(self.path) as db:
            security, primary = db.execute("SELECT security_id, id FROM listings WHERE is_primary = 1 AND operating_mic = 'XAMS' "
                                           "LIMIT 1").fetchone()
            other = db.execute("SELECT id FROM listings WHERE security_id = ? AND id <> ? LIMIT 1", (security, primary)).fetchone()
            if other is None:
                db.execute("INSERT INTO listings (id, security_id, mic, operating_mic, ticker, currency, is_primary, status) "
                           "VALUES ('listing:test:nyse', ?, 'XNYS', 'XNYS', 'TSTX', 'USD', 0, 'active')", (security,))
            else:
                db.execute("UPDATE listings SET mic = 'XNYS', operating_mic = 'XNYS', ticker = 'TSTX', currency = 'USD', "
                           "is_primary = 0, status = 'active' WHERE id = ?", (other[0],))
            db.execute("UPDATE listings SET mic = 'XTSE', operating_mic = 'XTSE', currency = 'CAD' WHERE id = ?", (primary,))
        name = "primary_open_market_beside_us_exchange"
        self.assertEqual(counts(self.path, name), {name: 0})
        self.plant("UPDATE listings SET mic = 'XMUN', operating_mic = 'XMUN', currency = 'EUR' WHERE operating_mic = 'XTSE'")
        self.assertEqual(counts(self.path, name), {name: 1})  # the same line on Munich's open market is flagged

    def test_withdrawn_currencies_follow_the_build_date(self):
        self.plant("INSERT OR REPLACE INTO venues VALUES ('XBUL', 'XBUL', 'Bulgarian Stock Exchange', 'BG', 'RMKT')")
        self.plant("UPDATE listings SET mic = 'XBUL', operating_mic = 'XBUL', currency = 'BGN' WHERE id = "
                   "(SELECT id FROM listings WHERE operating_mic = 'XAMS' LIMIT 1)")
        self.assertEqual(counts(self.path, "currency_withdrawn"), {"currency_withdrawn": 1})
        self.plant("UPDATE release SET value = '2025-06-30' WHERE key = 'as_of'")
        self.assertEqual(counts(self.path, "currency_withdrawn"), {"currency_withdrawn": 0})

    def test_tickers_that_collide_or_name_another_currency(self):
        self.plant("UPDATE listings SET ticker = 'ASMLUSD' WHERE ticker = 'ASML' AND operating_mic = 'XAMS'")
        self.assertEqual(counts(self.path, "ticker_currency_suffix"), {"ticker_currency_suffix": 1})
        with sqlite3.connect(self.path) as db:
            two = db.execute("SELECT id FROM listings WHERE operating_mic = 'XAMS' AND ticker IS NOT NULL "
                             "AND ticker <> 'ASMLUSD' LIMIT 1").fetchone()[0]
            db.execute("UPDATE listings SET ticker = 'ASMLUSD', currency = 'USD' WHERE id = ?", (two,))
        self.assertEqual(counts(self.path, "ticker_two_securities"), {"ticker_two_securities": 1})

    def test_a_venue_operator_as_issuer(self):
        self.plant("UPDATE issuers SET name = 'TP Icap (Europe)' WHERE id = "
                   "(SELECT issuer_id FROM securities WHERE kind = 'ordinary' AND issuer_id LIKE 'issuer:lei:%' LIMIT 1)")
        self.plant("DELETE FROM names WHERE subject_id LIKE 'issuer:%'")
        self.assertGreaterEqual(counts(self.path, "issuer_is_market_operator")["issuer_is_market_operator"], 1)

    def test_casing_and_encoding(self):
        self.assertTrue(invariant_names._bad_casing("NestlÉ S.A."))
        self.assertTrue(invariant_names._bad_casing("A.P. MØLler - Mærsk"))
        for good in ("Nestlé S.A.", "Grupa Kęty Spółka Akcyjna", "Rīgas kuģu būvētava", "iShares", "McDonald's", "FuturAqua"):
            self.assertFalse(invariant_names._bad_casing(good), good)
        self.assertTrue(invariant_names.MOJIBAKE.search("Vanguard S&amp;P 500"))
        self.assertTrue(invariant_names.MOJIBAKE.search("NestlÃ© S.A."))
        self.assertFalse(invariant_names.MOJIBAKE.search("Nestlé S.A."))


if __name__ == "__main__":
    unittest.main()
