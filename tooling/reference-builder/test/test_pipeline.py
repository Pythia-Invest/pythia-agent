"""End to end on hand-made rows: assembly, CIK links, primary venues, gates and files."""

import json
import sqlite3
import tempfile
import unittest
from collections import Counter
from datetime import date
from pathlib import Path
from unittest import mock

from reference_builder import firds, gleif, linking, manifest, mic, schema, sec, us_listed, writer
from reference_builder.assemble import Inputs
from reference_builder.config import Scope
from reference_builder.model import SecTicker, Snapshot
from reference_builder.pipeline import build_snapshot

from .fixtures import (
    ASML_ISIN,
    ASML_LEI,
    FUND_ISIN,
    FUND_LEI,
    MIC_CSV,
    NN_ISIN,
    NN_LEI,
    SHELL_ISIN,
    SHELL_LEI,
    FakeOpenFigi,
    figi_row,
    firds_record,
    fitrs,
    fulins,
    gleif_item,
    sec_json,
    stream,
    symbol_directory,
)

FIRDS = fulins([
    firds_record(ASML_ISIN, "XAMS", ASML_LEI, name="ASML HOLDING"),
    firds_record(ASML_ISIN, "XAMC", ASML_LEI, name="ASML HOLDING"),  # midpoint segment collapses onto XAMS
    firds_record(ASML_ISIN, "XETA", ASML_LEI, name="ASML HOLDING"),  # outside the scope venues
    firds_record(SHELL_ISIN, "XAMS", SHELL_LEI, name="SHELL PLC"),
    firds_record(NN_ISIN, "XAMS", NN_LEI, name="NN GROUP"),
    firds_record(FUND_ISIN, "XAMS", FUND_LEI, name="OLD FUND", term="2026-01-31"),
])
GLEIF = [
    gleif_item(ASML_LEI, "ASML Holding N.V.", "nl"),
    gleif_item(SHELL_LEI, "Shell plc"),
    gleif_item(NN_LEI, "NN Group N.V.", "nl"),
    gleif_item(FUND_LEI, "Old Fund N.V.", "nl"),
]
SEC = sec_json([
    (320193, "Apple Inc.", "AAPL", "Nasdaq"),
    (937966, "ASML HOLDING NV", "ASML", "Nasdaq"),
    (937966, "ASML HOLDING NV", "ASMLF", "OTC"),
    (918541, "NN INC", "NNBR", "Nasdaq"),
    (1306965, "Shell plc", "SHEL", "NYSE"),
    (1000001, "Example Listed Trust", "EXLT", "CBOE"),
])
OPENFIGI = {
    ("ID_ISIN", ASML_ISIN, "XAMS"): [figi_row("ASML", "NA", "BBGASMLNA001", "BBGASMLSC001")],
    ("ID_ISIN", ASML_ISIN, None): [figi_row("ASML", "NA", "BBGASMLNA001", "BBGASMLSC001"), figi_row("ASML", "UW", "BBGASMLUW001", "BBGASMLNY001")],
    ("ID_ISIN", SHELL_ISIN, "XAMS"): [figi_row("SHELL", "NA", "BBGSHELLNA01", "BBGSHELLSC01")],
    ("ID_ISIN", SHELL_ISIN, None): [figi_row("0QB8", "LN", "BBGSHELL0Q01", "BBGSHELLSC01"), figi_row("SHEL", "LN", "BBGSHELLLN01", "BBGSHELLSC01")],
    ("ID_ISIN", NN_ISIN, "XAMS"): [figi_row("NN", "NA", "BBGNNNA00001", "BBGNNSC00001")],
    ("TICKER", "AAPL", "US"): [figi_row("AAPL", "US", "BBGAAPL00001", "BBGAAPLSC001")],
    ("TICKER", "ASML", "US"): [figi_row("ASML", "US", "BBGASMLUS001", "BBGASMLNY001", sec_type2="Depositary Receipt")],
    ("TICKER", "ASMLF", "US"): [figi_row("ASMLF", "US", "BBGASMLOT001", "BBGASMLSC001")],
    ("TICKER", "NNBR", "US"): [figi_row("NNBR", "US", "BBGNNBR00001", "BBGNNBRSC001")],
    ("TICKER", "SHEL", "US"): [figi_row("SHEL", "US", "BBGSHELUS001", "BBGSHELADR01", sec_type2="Depositary Receipt")],
    ("TICKER", "EXLT", "US"): [figi_row("EXLT", "US", "BBGEXLTUS001", "BBGEXLTSC001")],
}


def inputs(scope=Scope(mics=("XAMS",), sec=True)):
    admissions = {}
    firds.apply(admissions, firds.full_records(stream(FIRDS), scope.cfi_prefixes), Counter())
    transparency = firds.select_transparency(firds.transparency_records(stream(fitrs([(ASML_ISIN, "2026-04-01", 5e8), (SHELL_ISIN, "2026-04-01", 1e8)]))), date(2026, 9, 25))
    return Inputs(date(2026, 9, 25), scope, mic.parse(MIC_CSV.encode()), admissions, transparency, sec.parse(SEC) if scope.sec else [], {"XAMS"})


def gleif_fetch(leis):
    entities = {e.lei: e for e in map(gleif.entity_from_api, GLEIF)}
    return {lei: entities[lei] for lei in leis if lei in entities}


class PipelineTest(unittest.TestCase):
    def setUp(self):
        # The assembly must never touch the network: every source is injected.
        patcher = mock.patch("urllib.request.urlopen", side_effect=AssertionError("network access in a test"))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.snap = build_snapshot(inputs(), gleif_fetch, FakeOpenFigi(OPENFIGI))

    def test_asml_resolves_on_xams_with_its_nasdaq_line_under_the_same_issuer(self):
        canaries = [c for c in manifest.default_canaries(Scope(mics=("XAMS",))) if c.get("ticker") != "TSLL"]  # no ETF in this fixture
        results = manifest.check_canaries(self.snap, canaries)
        self.assertTrue(all(r["ok"] for r in results), results)
        xams = self.snap.listings[f"XAMS:{ASML_ISIN}"]
        issuer = self.snap.issuers[xams.issuer_id]
        self.assertEqual((xams.ticker, xams.is_primary, issuer.lei, issuer.cik), ("ASML", True, ASML_LEI, "937966"))
        self.assertEqual(issuer.cik_rule, "share_class_figi", "identifier agreement outranks the name rule")
        self.assertEqual(self.snap.listings["XNAS:ASML"].issuer_id, issuer.issuer_id)
        self.assertEqual(self.snap.listings["OTCM:ASMLF"].security_id, f"isin:{ASML_ISIN}")
        self.assertNotIn(f"XAMC:{ASML_ISIN}", self.snap.listings)
        self.assertNotIn(f"XETA:{ASML_ISIN}", self.snap.listings)

    def test_similar_names_do_not_link_different_companies(self):
        self.assertIsNone(self.snap.issuers[f"lei:{NN_LEI}"].cik)
        self.assertEqual(self.snap.listings["XNAS:NNBR"].issuer_id, "cik:918541")

    def test_sec_cboe_line_sits_on_cboe_operating_mic_as_a_listed_primary(self):
        line = self.snap.listings["XCBO:EXLT"]
        self.assertEqual((line.mic, line.operating_mic, line.is_primary), ("XCBO", "XCBO", True))

    def test_uk_issuer_gets_its_home_line_as_primary(self):
        shell = self.snap.securities[f"isin:{SHELL_ISIN}"]
        self.assertEqual((shell.primary_mic, shell.primary_rule), ("XLON", "home_listing_evidence"))
        self.assertTrue(self.snap.listings["XLON:SHEL"].is_primary)
        self.assertFalse(self.snap.listings[f"XAMS:{SHELL_ISIN}"].is_primary)

    def test_terminated_line_stays_with_its_validity_window(self):
        fund = self.snap.listings[f"XAMS:{FUND_ISIN}"]
        self.assertEqual((fund.status, fund.valid_to), ("inactive", "2026-01-31"))
        self.assertEqual(self.snap.securities[f"isin:{FUND_ISIN}"].activity, "inactive")

    def test_written_snapshot_holds_only_used_venues_and_provenance(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "reference-test.sqlite3"
            sources = [{"source": "esma_firds", "url": "https://example.invalid/f", "retrieved_at": "2026-09-25T00:00:00Z", "licence": "x"},
                       {"source": "openfigi", "url": "https://example.invalid/o", "retrieved_at": "2026-09-25T00:00:00Z", "licence": "y"}]
            counts = writer.write(self.snap, path, {"build_id": "test"}, sources)
            with sqlite3.connect(path) as db:
                venues = {row[0] for row in db.execute("select mic from venues")}
                cik = db.execute("select source_record, authority from assertions where scheme='cik' and subject_id=?",
                                 (f"issuer:lei:{ASML_LEI}",)).fetchone()
                release = dict(db.execute("select key, value from release"))
                asml = db.execute("select security_id, is_primary from listings where id=?",
                                  (f"listing:isin:{ASML_ISIN}:XAMS:EUR",)).fetchone()
                btc = db.execute("select native_id from native_coins where provider='coinmarketcap' and caip19 like 'bip122:%/slip44:0'").fetchone()
            self.assertEqual(asml, (f"security:isin:{ASML_ISIN}", 1))
            self.assertEqual(venues, {"XAMS", "XLON", "XNAS", "XNYS", "OTCM", "XCBO"})
            self.assertEqual(cik, ("share_class_figi", "snapshot"))
            self.assertEqual({s["source"]: s["licence"] for s in json.loads(release["sources"])}, {"esma_firds": "x", "openfigi": "y"})
            self.assertEqual(btc, ("1",))
            self.assertGreater(counts["assertions"], counts["listings"])
            written = counts["listings"] + self.snap.audit["writer_ignored"].get("listings", 0)
            dropped = sum(n for key, n in self.snap.audit["schema"].items() if key.startswith("lines_without_"))
            self.assertEqual(written + dropped, len(self.snap.listings) + 6)  # every line is accounted for; +6 seeded coins
            json.dumps(self.snap.audit)  # the audit section must serialise into the manifest

    def test_eu_only_scope_makes_no_sec_lookups(self):
        figi = FakeOpenFigi(OPENFIGI)
        snap = build_snapshot(inputs(Scope(mics=("XAMS",), sec=False)), gleif_fetch, figi)
        self.assertFalse(any(job["idType"] == "TICKER" for job in figi.jobs))
        self.assertFalse(any(l.source == "sec" for l in snap.listings.values()))



APPLE_ISIN, APPLE_LEI = "US0378331005", "HWUPKR0MPOU8FGXBT394"
ETF_ISIN, ETF_LEI = "IE00B5BMR087", "549300AAAAAAAAAAAA03"
WIDE_FIRDS = fulins([
    firds_record(ASML_ISIN, "XAMS", ASML_LEI, name="ASML HOLDING"),
    firds_record(ASML_ISIN, "XETB", ASML_LEI, name="ASML HOLDING"),  # two Xetra segments: one Xetra line
    firds_record(ASML_ISIN, "XETA", ASML_LEI, name="ASML HOLDING"),
    firds_record(APPLE_ISIN, "FRAB", APPLE_LEI, name="APPLE INC", relevant="XFRA"),
    firds_record(ETF_ISIN, "XETA", ETF_LEI, cfi="CEOGES", name="CORE SP500 UCITS ETF", relevant="XETR"),
])
WIDE_SEC = sec_json([
    (320193, "Apple Inc.", "AAPL", "Nasdaq"),
    (937966, "ASML HOLDING NV", "ASML", "Nasdaq"),
    (884394, "SPDR S&P 500 ETF TRUST", "SPY", "NYSE"),
])
WIDE_DIRECTORY = symbol_directory(
    [("AAPL", "Apple Inc. - Common Stock", "N"), ("ASML", "ASML Holding N.V. - New York Registry Shares", "N"),
     ("TSLL", "Direxion Daily TSLA Bull 2X ETF", "Y")],
    [("SPY", "SPDR S&P 500 ETF Trust", "P", "Y")])
WIDE_OPENFIGI = OPENFIGI | {
    ("ID_ISIN", ASML_ISIN, "XETA"): [figi_row("ASME", "GY", "BBGASMLGY001", "BBGASMLSC001")],
    ("ID_ISIN", APPLE_ISIN, "FRAB"): [figi_row("APC", "GF", "BBGAAPLGF001", "BBGAAPLSC001")],
    ("ID_ISIN", APPLE_ISIN, "US"): [figi_row("AAPL", "US", "BBGAAPL00001", "BBGAAPLSC001")],
    ("ID_ISIN", ETF_ISIN, "XETA"): [figi_row("SXR8", "GY", "BBGETFGY0001", "BBGETFSC0001", sec_type2="ETP")],
    ("TICKER", "SPY", "US"): [figi_row("SPY", "US", "BBGSPY000001", "BBGSPYSC0001", sec_type2="Mutual Fund")],
    ("TICKER", "TSLL", "US"): [figi_row("TSLL", "US", "BBGTSLL00001", "BBGTSLLSC001", sec_type2="Mutual Fund")],
}


class AllVenuesTest(unittest.TestCase):
    """The default scope: every FIRDS venue, ETFs, and listed US ETFs."""

    def setUp(self):
        patcher = mock.patch("urllib.request.urlopen", side_effect=AssertionError("network access in a test"))
        patcher.start()
        self.addCleanup(patcher.stop)
        admissions = {}
        firds.apply(admissions, firds.full_records(stream(WIDE_FIRDS), Scope().cfi_prefixes), Counter())
        turnover = firds.select_transparency(firds.transparency_records(stream(fitrs([(ASML_ISIN, "2026-04-01", 5e8), (APPLE_ISIN, "2026-04-01", 1e6)]))), date(2026, 9, 25))
        self.snap = build_snapshot(
            Inputs(date(2026, 9, 25), Scope(), mic.parse(MIC_CSV.encode()), admissions, turnover, sec.parse(WIDE_SEC),
                   {"XAMS", "XETA", "FRAB"}, us_listed.parse(*WIDE_DIRECTORY)),
            gleif_fetch, FakeOpenFigi(WIDE_OPENFIGI))

    def test_one_line_per_venue_operator(self):
        asml = sorted(l.mic for l in self.snap.listings.values() if l.security_id == f"isin:{ASML_ISIN}" and l.source == "esma_firds")
        self.assertEqual(asml, ["XAMS", "XETA"], "the regulated Xetra segment stands for both Xetra segments")

    def test_us_share_traded_in_europe_keeps_its_us_home_line_and_rank(self):
        apple = self.snap.securities[f"isin:{APPLE_ISIN}"]
        self.assertEqual((apple.primary_mic, apple.primary_rule, apple.rank), ("XNAS", "us_exchange_listing", 1))
        self.assertEqual(self.snap.listings["XNAS:AAPL"].security_id, apple.security_id)
        self.assertTrue(self.snap.listings["XNAS:AAPL"].is_primary)
        self.assertFalse(self.snap.listings[f"FRAB:{APPLE_ISIN}"].is_primary)

    def test_etfs_from_firds_and_the_symbol_directory(self):
        self.assertEqual(self.snap.securities[f"isin:{ETF_ISIN}"].kind, "etf")
        tsll = self.snap.listings["XNAS:TSLL"]
        security = self.snap.securities[tsll.security_id]
        self.assertEqual((security.kind, security.issuer_id, security.name, tsll.is_primary), ("etf", None, "Direxion Daily TSLA Bull 2X ETF", True))
        spy = self.snap.listings["ARCX:SPY"]
        self.assertEqual((spy.operating_mic, spy.row_class, spy.issuer_id), ("XNYS", "etf", "cik:884394"))
        self.assertNotIn("XNYS:SPY", self.snap.listings)

    def test_eu_and_us_etf_canaries_apply_to_the_default_scope(self):
        names = {c["name"] for c in manifest.default_canaries(Scope())}
        self.assertTrue({"SAP on Xetra", "LVMH on Euronext Paris", "Nokia on Nasdaq Helsinki", "Direxion Daily TSLA Bull 2X ETF"} <= names)
        results = {r["name"]: r["ok"] for r in manifest.check_canaries(self.snap, manifest.default_canaries(Scope()))}
        self.assertTrue(results["Direxion Daily TSLA Bull 2X ETF"])

    def test_segment_venues_take_their_operator_label(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "reference-test.sqlite3"
            writer.write(self.snap, path, {"build_id": "test"}, [])
            with sqlite3.connect(path) as db:
                venues = dict(db.execute("select mic, name from venues"))
                kinds = dict(db.execute("select name, kind from securities where kind = 'etf'"))
        self.assertEqual((venues["FRAB"], venues["ARCX"], venues["XETA"]), ("Frankfurt", "NYSE Arca", "Xetra"))
        self.assertEqual(set(kinds), {"CORE SP500 UCITS ETF", "Direxion Daily TSLA Bull 2X ETF", "SPDR S&P 500 ETF TRUST"})


class CikLinkTest(unittest.TestCase):
    def test_identifier_link_wins_the_lei_over_an_earlier_name_link(self):
        snap = Snapshot(as_of="2026-09-25")
        tickers = [SecTicker("100", "Acme Holdings", "ACMH", "Nasdaq", 0), SecTicker("200", "Acme", "ACME", "NYSE", 1)]
        evidence = {"100": [("LEIX", "name_unique")], "200": [("LEIX", "share_class_figi")]}
        links = linking._decide(snap, tickers, evidence, Counter())
        self.assertEqual(links, {"200": ("LEIX", "share_class_figi")})
        self.assertEqual([(f.subject_id, f.flag) for f in snap.flags], [("cik:100", "lei_already_linked")])

if __name__ == "__main__":
    unittest.main()
