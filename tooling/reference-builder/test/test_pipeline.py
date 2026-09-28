"""End to end on hand-made rows: assembly, CIK links, primary venues, gates and files."""

import json
import sqlite3
import tempfile
import unittest
from collections import Counter
from datetime import date
from pathlib import Path
from unittest import mock

from reference_builder import assemble, firds, gleif, linking, manifest, mic, ncen, schema, sec, writer
from reference_builder.assemble import Inputs
from reference_builder.config import Scope
from reference_builder.model import Issuer, Listing, SecFund, SecTicker, Snapshot
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
            # Shell's London home line gets London's trading currency, so it is written as the primary.
            self.assertEqual(self.snap.audit["schema"]["securities_without_primary"], 0)
            with sqlite3.connect(path) as db:
                london = db.execute("select ticker, currency, is_primary from listings where operating_mic = 'XLON'").fetchall()
            self.assertEqual(london, [("SHEL", "GBP", 1)])

    def test_eu_only_scope_makes_no_sec_lookups(self):
        figi = FakeOpenFigi(OPENFIGI)
        snap = build_snapshot(inputs(Scope(mics=("XAMS",), sec=False)), gleif_fetch, figi)
        self.assertFalse(any(job["idType"] == "TICKER" for job in figi.jobs))
        self.assertFalse(any(l.source == "sec" for l in snap.listings.values()))



APPLE_ISIN, APPLE_LEI = "US0378331005", "HWUPKR0MPOU8FGXBT394"
ETF_ISIN, ETF_LEI = "IE00B5BMR087", "549300AAAAAAAAAAAA03"
DARK_ISIN = "NL0000000077"  # trades only on a trading-only venue
UNKNOWN_US_ISIN = "US5949181045"
WIDE_FIRDS = fulins([
    firds_record(ASML_ISIN, "XAMS", ASML_LEI, name="ASML HOLDING"),
    firds_record(ASML_ISIN, "XETB", ASML_LEI, name="ASML HOLDING"),  # two Xetra segments: one Xetra line
    firds_record(ASML_ISIN, "XETA", ASML_LEI, name="ASML HOLDING"),
    firds_record(ASML_ISIN, "CEUX", ASML_LEI, name="ASML HOLDING"),  # Cboe Europe trades it; it lists on XAMS
    firds_record(APPLE_ISIN, "FRAB", APPLE_LEI, name="APPLE INC", relevant="XFRA"),
    firds_record(ETF_ISIN, "XETA", ETF_LEI, cfi="CEOGES", name="CORE SP500 UCITS ETF", relevant="TWEM"),
    firds_record(ETF_ISIN, "TWEM", ETF_LEI, cfi="CEOGES", name="CORE SP500 UCITS ETF", relevant="TWEM"),
    firds_record(DARK_ISIN, "CEUX", NN_LEI, name="DARK ONLY", relevant="CEUX"),
    firds_record(UNKNOWN_US_ISIN, "FRAB", APPLE_LEI, name="NO FIGI YET", relevant="XFRA"),  # OpenFIGI has no line
])
WIDE_SEC = sec_json([
    (320193, "Apple Inc.", "AAPL", "Nasdaq"),
    (937966, "ASML HOLDING NV", "ASML", "Nasdaq"),
    (884394, "SPDR S&P 500 ETF TRUST", "SPY", "NYSE"),
])
WIDE_FUNDS = [SecFund("TSLL"), SecFund("VOO"), SecFund("LACAX")]
WIDE_OPENFIGI = OPENFIGI | {
    ("ID_ISIN", ASML_ISIN, "XETA"): [figi_row("ASME", "GY", "BBGASMLGY001", "BBGASMLSC001")],
    # Real Apple share-class and US FIGIs (valid check digits): core keys a US security by them.
    ("ID_ISIN", APPLE_ISIN, "FRAB"): [figi_row("APC", "GF", "BBG000BPCGF6", "BBG001S5N8V8")],
    ("ID_ISIN", APPLE_ISIN, "US"): [figi_row("AAPL", "US", "BBG000B9XRY4", "BBG001S5N8V8")],
    ("TICKER", "AAPL", "US"): [figi_row("AAPL", "US", "BBG000B9XRY4", "BBG001S5N8V8")],
    ("TICKER", "AAPL", "UW"): [figi_row("AAPL", "UW", "BBG000B9Y5X2", "BBG001S5N8V8", composite="BBG000B9XRY4")],
    ("ID_ISIN", ETF_ISIN, "XETA"): [figi_row("SXR8", "GY", "BBGETFGY0001", "BBGETFSC0001", sec_type="ETP")],
    ("TICKER", "SPY", "US"): [figi_row("SPY", "US", "BBGSPY000001", "BBGSPYSC0001", sec_type="ETP")],
    ("TICKER", "TSLL", "US"): [figi_row("TSLL", "US", "BBGTSLL00001", "BBGTSLLSC001", sec_type="ETP", name="DIRX DLY TSLA BUL 2X ETF")],
    ("TICKER", "TSLL", "UQ"): [figi_row("TSLL", "UQ", "BBGTSLLUQ001", "BBGTSLLSC001", sec_type="ETP")],
    ("TICKER", "VOO", "US"): [figi_row("VOO", "US", "BBGVOO000001", "BBGVOOSC0001", sec_type="ETP")],  # NYSE Arca: no UQ line
    ("TICKER", "LACAX", "US"): [figi_row("LACAX", "US", "BBGLACAX0001", "BBGLACAXSC01", sec_type="Open-End Fund")],
}


class AllVenuesTest(unittest.TestCase):
    """The default scope: every FIRDS venue under the venue policy, ETFs, and SEC fund ETFs."""

    def setUp(self):
        patcher = mock.patch("urllib.request.urlopen", side_effect=AssertionError("network access in a test"))
        patcher.start()
        self.addCleanup(patcher.stop)
        admissions = {}
        firds.apply(admissions, firds.full_records(stream(WIDE_FIRDS), Scope().cfi_prefixes), Counter())
        turnover = firds.select_transparency(firds.transparency_records(stream(fitrs([(ASML_ISIN, "2026-04-01", 5e8), (APPLE_ISIN, "2026-04-01", 1e6)]))), date(2026, 9, 25))
        self.snap = build_snapshot(
            Inputs(date(2026, 9, 25), Scope(), mic.parse(MIC_CSV.encode()), admissions, turnover, sec.parse(WIDE_SEC),
                   {"XAMS", "XETA", "FRAB"}, WIDE_FUNDS),
            gleif_fetch, FakeOpenFigi(WIDE_OPENFIGI))

    def lines(self, isin):
        return sorted(l.mic for l in self.snap.listings.values() if l.security_id == f"isin:{isin}" and l.source == "esma_firds")

    def test_one_line_per_listing_venue_operator(self):
        self.assertEqual(self.lines(ASML_ISIN), ["XAMS", "XETA"], "one Xetra line; no Cboe Europe line")

    def test_trading_only_venue_is_kept_only_as_the_only_market(self):
        self.assertEqual(self.lines(DARK_ISIN), ["CEUX"])
        etf = self.snap.securities[f"isin:{ETF_ISIN}"]
        self.assertEqual((self.lines(ETF_ISIN), etf.primary_mic, etf.primary_rule, etf.kind),
                         (["XETA"], "XETR", "trading_venue_to_listing_venue", "etf"))
        self.assertTrue(self.snap.listings[f"XETA:{ETF_ISIN}"].is_primary)

    def test_us_share_traded_in_europe_keeps_its_us_home_line_and_rank(self):
        apple = self.snap.securities[f"isin:{APPLE_ISIN}"]
        self.assertEqual((apple.primary_mic, apple.primary_rule, apple.rank), ("XNAS", "us_exchange_listing", 1))
        self.assertTrue(self.snap.listings["XNAS:AAPL"].is_primary)
        self.assertFalse(self.snap.listings[f"FRAB:{APPLE_ISIN}"].is_primary)

    def test_fund_etfs_are_placed_only_when_openfigi_shows_the_nasdaq_line(self):
        tsll = self.snap.listings["XNAS:TSLL"]
        security = self.snap.securities[tsll.security_id]
        self.assertEqual((security.kind, security.issuer_id, security.name, tsll.is_primary), ("etf", None, "DIRX DLY TSLA BUL 2X ETF", True))
        self.assertFalse(any(l.ticker in ("VOO", "LACAX") for l in self.snap.listings.values()))
        audit = self.snap.audit["us_etfs"]
        self.assertEqual((audit["placed_nasdaq"], audit["unplaced_not_in_ncen"]), (1, 1))
        self.assertEqual(self.snap.listings["XNYS:SPY"].row_class, "etf")

    def test_a_fund_etf_off_nasdaq_is_placed_on_the_exchange_n_cen_names(self):
        admissions = {}
        firds.apply(admissions, firds.full_records(stream(WIDE_FIRDS), Scope().cfi_prefixes), Counter())
        listed = {"VOO": ncen.NcenListing("VOO", "ARCX", "XNYS", "Vanguard S&P 500 ETF", "S000002839", None, "2026q1")}
        answers = WIDE_OPENFIGI | {("TICKER", "VOO", "UP"): [figi_row("VOO", "UP", "BBGVOOUP0001", "BBGVOOSC0001", sec_type="ETP")]}
        snap = build_snapshot(Inputs(date(2026, 9, 25), Scope(), mic.parse(MIC_CSV.encode()), admissions, None,
                                     sec.parse(WIDE_SEC), {"XAMS"}, WIDE_FUNDS, listed), gleif_fetch, FakeOpenFigi(answers))
        line = snap.listings["ARCX:VOO"]
        self.assertEqual((line.mic, line.operating_mic, line.figi, line.name, line.is_primary),
                         ("ARCX", "XNYS", "BBGVOOUP0001", "Vanguard S&P 500 ETF", True))
        self.assertEqual(snap.audit["us_etfs"]["placed_ncen"], 1)

    def test_a_us_etf_firds_lists_in_europe_joins_the_fund_file_etf(self):
        isin = "US9229087443"
        admissions = {}
        records = [firds_record(isin, "FRAB", APPLE_LEI, cfi="CEOGES", name="VANGUARD VALUE ETF", relevant="XFRA")]
        firds.apply(admissions, firds.full_records(stream(fulins(records)), Scope().cfi_prefixes), Counter())
        answers = {("ID_ISIN", isin, "US"): [figi_row("VTV", "US", "BBGVTVUS0001", "BBGVTVSC0001", sec_type="ETP")],
                   ("TICKER", "VTV", "US"): [figi_row("VTV", "US", "BBGVTVUS0001", "BBGVTVSC0001", sec_type="ETP")],
                   ("TICKER", "VTV", "UP"): [figi_row("VTV", "UP", "BBGVTVUP0001", "BBGVTVSC0001", sec_type="ETP")]}
        listed = {"VTV": ncen.NcenListing("VTV", "ARCX", "XNYS", "Vanguard Value ETF", None, None, "2026q1")}
        snap = build_snapshot(Inputs(date(2026, 9, 25), Scope(), mic.parse(MIC_CSV.encode()), admissions, None, [], set(),
                                     [SecFund("VTV")], listed), gleif_fetch, FakeOpenFigi(answers))
        self.assertEqual(snap.listings["ARCX:VTV"].security_id, f"isin:{isin}")
        self.assertTrue(snap.listings["ARCX:VTV"].is_primary)
        self.assertEqual(snap.securities[f"isin:{isin}"].share_class_figi, "BBGVTVSC0001")

    def test_a_ucits_etf_gets_its_london_and_six_lines_one_per_trading_currency(self):
        admissions = {}
        firds.apply(admissions, firds.full_records(stream(WIDE_FIRDS), Scope().cfi_prefixes), Counter())
        answers = WIDE_OPENFIGI | {
            ("ID_ISIN", ETF_ISIN, None): [figi_row("CSPX", "LN", "BBGCSPXLN001", "BBGETFSC0001"),
                                          figi_row("CSSPX", "SW", "BBGCSPXSW001", "BBGETFSC0001")],
            ("ID_ISIN", ETF_ISIN, "LN", "USD"): [figi_row("CSPX", "LN", "BBGCSPXLN001", "BBGETFSC0001")],
            ("ID_ISIN", ETF_ISIN, "LN", "GBp"): [figi_row("CSP1", "LN", "BBGCSPXLN002", "BBGETFSC0001")],
            ("ID_ISIN", ETF_ISIN, "SW", "USD"): [figi_row("CSSPX", "SW", "BBGCSPXSW001", "BBGETFSC0001")]}
        snap = build_snapshot(Inputs(date(2026, 9, 25), Scope(sec=False), mic.parse(MIC_CSV.encode()), admissions, None, [],
                                     {"XETA"}), gleif_fetch, FakeOpenFigi(answers))
        lines = sorted((l.ticker, l.operating_mic, l.currency, l.is_primary) for l in snap.listings.values()
                       if l.security_id == f"isin:{ETF_ISIN}" and l.source == "openfigi")
        self.assertEqual(lines, [("CSP1", "XLON", "GBP", False), ("CSPX", "XLON", "USD", False), ("CSSPX", "XSWX", "USD", False)])

    def test_eu_and_us_etf_canaries_apply_to_the_default_scope(self):
        names = {c["name"] for c in manifest.default_canaries(Scope())}
        self.assertTrue({"SAP on Xetra", "LVMH on Euronext Paris", "Nokia on Nasdaq Helsinki", "Direxion Daily TSLA Bull 2X ETF"} <= names)
        results = {r["name"]: r["ok"] for r in manifest.check_canaries(self.snap, manifest.default_canaries(Scope()))}
        self.assertTrue(results["Direxion Daily TSLA Bull 2X ETF"])
        offline = {c["name"] for c in manifest.default_canaries(Scope(), funds=False)}  # --sec-file loads no fund file
        self.assertNotIn("Direxion Daily TSLA Bull 2X ETF", offline)

    def test_us_security_is_keyed_by_share_class_figi_with_aliases_from_its_isin(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "reference-test.sqlite3"
            writer.write(self.snap, path, {"build_id": "test"}, [])
            with sqlite3.connect(path) as db:
                rule = db.execute("select value from release where key = 'subject_key'").fetchone()
                isin = db.execute("select subject_id from assertions where scheme = 'isin' and value = ?", (APPLE_ISIN,)).fetchone()
                aliases = dict(db.execute("select old_id, new_id from id_aliases"))
                ids = {row[0] for row in db.execute("select id from securities union select id from listings")}
        self.assertEqual((rule, isin), (("subject_key@1",), ("security:figi:BBG001S5N8V8",)))
        self.assertEqual(aliases[f"security:isin:{APPLE_ISIN}"], "security:figi:BBG001S5N8V8")
        self.assertEqual(aliases[f"listing:isin:{APPLE_ISIN}:XNAS:USD"], "listing:figi:BBG000B9Y5X2", "the Nasdaq line's FIGI, not the composite's")
        self.assertEqual(aliases["listing:figi:BBG000B9XRY4"], "listing:figi:BBG000B9Y5X2", "the old composite-keyed ID")
        self.assertFalse(set(aliases) & ids, "an alias never shadows a subject")
        # A US-area security with no share-class FIGI keeps its lines under a local, non-portable ID,
        # which a later build that finds the FIGI aliases to the FIGI key.
        local = schema.local_security(UNKNOWN_US_ISIN)
        self.assertEqual(local, f"security:provisional:esma_firds:isin:{UNKNOWN_US_ISIN}")
        self.assertIn(local, ids)
        self.assertIn(local, schema.aliases("security", "security:figi:BBG001S5N8V8", {"isin": UNKNOWN_US_ISIN, "share_class_figi": "BBG001S5N8V8"}))
        self.assertTrue(all(new in ids or new.startswith(("issuer:", "composite:")) for new in aliases.values()))

    def test_segment_venues_take_their_operator_label(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "reference-test.sqlite3"
            writer.write(self.snap, path, {"build_id": "test"}, [])
            with sqlite3.connect(path) as db:
                venues = dict(db.execute("select mic, name from venues"))
        self.assertEqual((venues["FRAB"], venues["XETA"], venues["CEUX"]), ("Frankfurt", "Xetra", "Cboe Europe"))


SAP_ISIN, SAP_LEI = "DE0007164600", "529900D6BF99LW9R2E68"
WORLD_ISIN, WORLD_LEI = "IE00B4L5Y983", "549300AAAAAAAAAAAA04"  # iShares Core MSCI World UCITS ETF


class FallbackPrimaryTest(unittest.TestCase):
    """Truth set: when FIRDS names a trading-only venue, the primary is the venue an investor knows."""

    def primaries(self, records):
        admissions = {}
        firds.apply(admissions, firds.full_records(stream(fulins(records)), Scope().cfi_prefixes), Counter())
        inputs = Inputs(date(2026, 9, 25), Scope(sec=False), mic.parse(MIC_CSV.encode()), admissions, None, [], set())
        snap = build_snapshot(inputs, gleif_fetch, FakeOpenFigi({}))
        return {s.isin: (s.primary_mic, next((l.mic for l in snap.listings.values() if l.security_id == s.security_id and l.is_primary), None))
                for s in snap.securities.values() if s.isin}

    def test_sap_goes_to_xetra_and_a_ucits_etf_to_frankfurt_not_the_first_regional_by_mic(self):
        german = (("DUSB", "2003-01-02"), ("HAMB", "2001-01-02"), ("XGAT", "2010-01-04"), ("FRAB", "2005-01-03"), ("CEUX", "2009-01-02"))
        records = [firds_record(SAP_ISIN, segment, SAP_LEI, name="SAP SE", relevant="CEUX", first=first) for segment, first in (*german, ("XETB", "2008-01-02"))]
        records += [firds_record(WORLD_ISIN, segment, WORLD_LEI, cfi="CEOGES", relevant="CEUX", first=first) for segment, first in german]
        self.assertEqual(self.primaries(records), {SAP_ISIN: ("XETR", "XETB"), WORLD_ISIN: ("XFRA", "FRAB")})

    def test_a_regional_regulated_admission_moves_only_to_a_regulated_xetra_line(self):
        on_mtf = [firds_record(SAP_ISIN, segment, SAP_LEI, relevant="DUSA") for segment in ("DUSA", "XETB")]
        on_regulated = [firds_record(WORLD_ISIN, segment, WORLD_LEI, relevant="DUSA") for segment in ("DUSA", "XETA")]
        self.assertEqual(self.primaries(on_mtf + on_regulated), {SAP_ISIN: ("XDUS", "DUSA"), WORLD_ISIN: ("XETR", "XETA")})

    def test_without_a_preferred_venue_the_earliest_listing_wins(self):
        records = [firds_record(WORLD_ISIN, segment, WORLD_LEI, cfi="CEOGES", relevant="CEUX", first=first)
                   for segment, first in (("DUSB", "2012-01-02"), ("HAMB", "2011-01-03"), ("CEUX", "2009-01-02"))]
        self.assertEqual(self.primaries(records), {WORLD_ISIN: ("XHAM", "HAMB")})


LINDE_ISIN, LINDE_LEI = "IE000S9YS762", "5299003QR1WT0EF88V51"
STLA_ISIN, STLA_LEI = "NL00150001Q9", "549300LKT9PW7ZIBDF31"


class UsHomeTest(unittest.TestCase):
    """A non-US share whose only lines are European secondary ones and a US exchange line is at home in the US."""

    def test_the_us_line_is_primary_unless_the_eea_primary_is_a_regulated_market(self):
        records = [firds_record(LINDE_ISIN, "MUNB", LINDE_LEI, name="LINDE PLC", relevant="MUNB"),
                   firds_record(LINDE_ISIN, "XGAT", LINDE_LEI, name="LINDE PLC", relevant="MUNB"),
                   firds_record(STLA_ISIN, "MTAA", STLA_LEI, name="STELLANTIS", relevant="MTAA"),
                   firds_record(STLA_ISIN, "XGAT", STLA_LEI, name="STELLANTIS", relevant="MTAA")]
        answers = {("ID_ISIN", LINDE_ISIN, "MUNB"): [figi_row("LIN", "GM", "BBGLINDEGM01", "BBGLINDESC01")],
                   ("TICKER", "LIN", "US"): [figi_row("LIN", "US", "BBGLINDEUS01", "BBGLINDESC01")],
                   ("ID_ISIN", STLA_ISIN, "MTAA"): [figi_row("STLAM", "IM", "BBGSTLAIM001", "BBGSTLASC001")],
                   ("TICKER", "STLA", "US"): [figi_row("STLA", "US", "BBGSTLAUS001", "BBGSTLASC001")]}
        admissions = {}
        firds.apply(admissions, firds.full_records(stream(fulins(records)), Scope().cfi_prefixes), Counter())
        tickers = sec.parse(sec_json([(1707925, "Linde plc", "LIN", "Nasdaq"), (1605484, "Stellantis N.V.", "STLA", "NYSE")]))
        snap = build_snapshot(Inputs(date(2026, 9, 25), Scope(), mic.parse(MIC_CSV.encode()), admissions, None, tickers,
                                     {"MUNB", "MTAA"}), gleif_fetch, FakeOpenFigi(answers))
        linde, stellantis = snap.securities[f"isin:{LINDE_ISIN}"], snap.securities[f"isin:{STLA_ISIN}"]
        self.assertEqual((linde.primary_mic, linde.primary_rule), ("XNAS", "us_exchange_no_home_line"))
        self.assertEqual([l.listing_id for l in snap.listings.values() if l.security_id == linde.security_id and l.is_primary],
                         ["XNAS:LIN"])
        self.assertEqual((stellantis.primary_mic, stellantis.primary_rule), ("XMIL", "firds_relevant_venue"))
        self.assertFalse(snap.listings["XNYS:STLA"].is_primary)
        self.assertEqual(snap.audit["securities"]["by_primary_rule"]["us_exchange_no_home_line"], 1)


class CikLinkTest(unittest.TestCase):
    def test_identifier_link_wins_the_lei_over_an_earlier_name_link(self):
        snap = Snapshot(as_of="2026-09-25")
        tickers = [SecTicker("100", "Acme Holdings", "ACMH", "Nasdaq", 0), SecTicker("200", "Acme", "ACME", "NYSE", 1)]
        evidence = {"100": [("LEIX", "name_unique")], "200": [("LEIX", "share_class_figi")]}
        links = linking._decide(snap, tickers, evidence, Counter())
        self.assertEqual(links, {"200": ("LEIX", "share_class_figi")})
        self.assertEqual([(f.subject_id, f.flag) for f in snap.flags], [("cik:100", "lei_already_linked")])

    def test_among_identifier_links_to_one_lei_the_cik_whose_name_matches_wins(self):
        snap = Snapshot(as_of="2026-09-25")
        snap.issuers["lei:BRK"] = Issuer("lei:BRK", "Berkshire Hathaway Inc.", "gleif", lei="BRK")
        tickers = [SecTicker("58361", "LEE ENTERPRISES, Inc", "LEE", "NYSE", 0),
                   SecTicker("1067983", "BERKSHIRE HATHAWAY INC", "BRK-B", "NYSE", 1)]
        evidence = {"58361": [("BRK", "isin_exch_us")], "1067983": [("BRK", "share_class_figi")]}
        self.assertEqual(linking._decide(snap, tickers, evidence, Counter()), {"1067983": ("BRK", "share_class_figi")})

    def test_a_lei_several_ciks_claim_and_none_names_links_to_none(self):
        snap = Snapshot(as_of="2026-09-25")
        snap.issuers["lei:TPI"] = Issuer("lei:TPI", "TP ICAP (Europe)", "gleif", lei="TPI")
        tickers = [SecTicker("10329", "BASSETT FURNITURE INDUSTRIES INC", "BSET", "Nasdaq", 0),
                   SecTicker("23795", "CTO Realty Growth, Inc.", "CTO", "NYSE", 1)]
        evidence = {"10329": [("TPI", "isin_exch_us")], "23795": [("TPI", "isin_exch_us")]}
        self.assertEqual(linking._decide(snap, tickers, evidence, Counter()), {})
        self.assertEqual({f.flag for f in snap.flags}, {"lei_contested_unnamed"})

    def test_links_that_share_no_name_word_and_split_issuers_are_flagged_not_changed(self):
        snap = Snapshot(as_of="2026-09-25")
        snap.issuers["lei:BRK"] = Issuer("lei:BRK", "Berkshire Hathaway Inc.", "gleif", lei="BRK")
        snap.issuers["lei:ACME"] = Issuer("lei:ACME", "Acme N.V.", "gleif", lei="ACME", names=[("Acme Group", "OTHER", None, "gleif")])
        tickers = [SecTicker("58361", "LEE ENTERPRISES, Inc", "LEE", "NYSE", 0), SecTicker("300", "ACME GROUP INC", "ACM", "NYSE", 1)]
        linking._flag_suspect_links(snap, tickers, {"58361": ("BRK", "isin_exch_us"), "300": ("ACME", "share_class_figi")})
        snap.issuers["cik:1067983"] = Issuer("cik:1067983", "BERKSHIRE HATHAWAY INC", "sec", cik="1067983")
        linking._flag_split_issuers(snap)
        self.assertEqual([(f.subject_id, f.flag, f.detail) for f in snap.flags],
                         [("lei:BRK", "cik_link_suspect", "cik:58361"), ("cik:1067983", "issuer_split_lei_cik", "lei:BRK")])
        self.assertEqual(snap.issuers["lei:BRK"].name, "Berkshire Hathaway Inc.")


class NordicTickerTest(unittest.TestCase):
    def test_a_glued_stockholm_class_is_stored_in_the_exchange_form_and_keeps_its_ticker_mic(self):
        isin, lei = "SE0000115446", "549300HGV012CNC8JD22"
        admissions = {}
        records = [firds_record(isin, "XSTO", lei, name="VOLVO AB", relevant="XSTO", short="VOLVO/SH B")]
        firds.apply(admissions, firds.full_records(stream(fulins(records)), Scope().cfi_prefixes), Counter())
        answers = {("ID_ISIN", isin, "XSTO"): [figi_row("VOLVB", "SS", "BBG000BLNXL5", "BBG001S5PMW7")]}
        snap = build_snapshot(Inputs(date(2026, 9, 25), Scope(sec=False), mic.parse(MIC_CSV.encode()), admissions, None, [],
                                     {"XSTO"}), gleif_fetch, FakeOpenFigi(answers))
        line = snap.listings[f"XSTO:{isin}"]
        self.assertEqual((line.ticker, line.ticker_root, line.ticker_class), ("VOLV B", "VOLV", "B"))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "reference-test.sqlite3"
            writer.write(snap, path, {"build_id": "test"}, [])
            with sqlite3.connect(path) as db:
                found = db.execute("select value from assertions where scheme = 'ticker_mic'").fetchall()
        self.assertEqual(found, [("VOLV B@XSTO",)])
        self.assertNotIn("skipped_ticker_mic", snap.audit["schema"])


if __name__ == "__main__":
    unittest.main()
