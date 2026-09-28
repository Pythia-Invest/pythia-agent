"""Systematic source errors the reference-data audit found, on hand-made rows: venue LEIs and financing
vehicles recorded as issuers, whole venue segments without tickers, foreign-composite tickers, debt rows typed
as equity, preference shares, OTC receipts and delisted or superseded ISINs left active."""

import unittest
from collections import Counter
from datetime import date
from unittest import mock

from reference_builder import firds, gleif, linking, mic, rules, sec
from reference_builder.assemble import Inputs
from reference_builder.config import Scope
from reference_builder.model import Issuer, Listing, Security, SecTicker, Snapshot
from reference_builder.pipeline import build_snapshot

from .fixtures import MIC_CSV, FakeOpenFigi, figi_row, firds_record, fulins, gleif_item, sec_json, stream

TP_ICAP = "213800R54EFFINMY1P02"
DB_AG, BAYER_LEI, NCM, NESTLE, SOFINA = "529900G3SW56SHYNPR95", "549300J4U55H3WP3K887", "549300PZN3NFSOUXLC42", "KY37LUS27QQX7BB93L28", "5493000GMVR38VUO5D39"
GRIFOLS, HAL, CDO = "549300Y0BTAQMZ8BPB59", "724500HALHALHALHAL01", "549300CDOCDOCDOCDO01"
QUALITY_MIC = MIC_CSV + (
    f"TPIC,TPIC,OPRT,TP ICAP EU MTF,TP ICAP (EUROPE),{TP_ICAP},MLTF,,FR,PARIS,,ACTIVE\n"
    f"TPIR,TPIC,SGMT,TP ICAP EU MTF - EQUITIES,TP ICAP (EUROPE),{TP_ICAP},MLTF,,FR,PARIS,,ACTIVE\n"
    f"XETA2,XETR,SGMT,XETRA SECOND,DEUTSCHE BOERSE AG,{DB_AG},RMKT,,DE,FRANKFURT,,ACTIVE\n"
    "XBER,XBER,OPRT,BOERSE BERLIN,,,NSPD,,DE,BERLIN,,ACTIVE\n"
    "EQTC,XBER,SGMT,BOERSE BERLIN EQUIDUCT TRADING - FREIVERKEHR,,,MLTF,,DE,BERLIN,,ACTIVE\n"
    "XSTU,XSTU,OPRT,BOERSE STUTTGART,,,RMKT,,DE,STUTTGART,,ACTIVE\n"
    "STUB,XSTU,SGMT,BOERSE STUTTGART - FREIVERKEHR,,,MLTF,,DE,STUTTGART,,ACTIVE\n"
    "BMEX,BMEX,OPRT,BME - BOLSAS Y MERCADOS ESPANOLES,,,NSPD,,ES,MADRID,,ACTIVE\n"
    "XMAD,BMEX,SGMT,BOLSA DE MADRID,,,RMKT,,ES,MADRID,,ACTIVE\n"
    "XWAR,XWAR,OPRT,WARSAW STOCK EXCHANGE,,,RMKT,,PL,WARSAW,,ACTIVE\n"
    "XMSM,XDUB,SGMT,EURONEXT DUBLIN,,,RMKT,,IE,DUBLIN,,ACTIVE\n"
    "XDUB,XDUB,OPRT,EURONEXT DUBLIN,,,RMKT,,IE,DUBLIN,,ACTIVE\n"
)
VALARIS, SOFINA_RIGHTS, SOFINA_SHARE, DB_SHARE = "BMG9460G1015", "BE0970189925", "BE0003717312", "DE0005810055"
NESTLE_SHARE, NESTLE_ADR, NOVA, SOCGEN, HAL_TRUST = "CH0038863350", "US6410694060", "AU000000NVA2", "FR0000130809", "BMG455841020"
GRIFOLS_B, CDO_PREF, OLD_ISIN, NEW_ISIN = "ES0171996095", "KYG015812095", "DE0005785604", "DE000FRE5EN2"
DELISTED_US, WARSAW_US, HEINEKEN_ADR = "US5658491064", "US44853H1086", "US4230123014"
FIRDS = fulins([
    firds_record(VALARIS, "TPIR", TP_ICAP, name="Valaris Ltd", relevant="TPIR"),
    firds_record(SOFINA_RIGHTS, "TPIR", TP_ICAP, name="SOFINA SA", relevant="TPIR"),
    firds_record(SOFINA_SHARE, "XAMS", SOFINA, name="SOFINA", relevant="XAMS"),
    firds_record(DB_SHARE, "XETA2", DB_AG, name="Deutsche Boerse AG", relevant="XETA2"),
    firds_record(NESTLE_SHARE, "FRAB", NCM, name="Nestle S.A.", relevant="FRAB"),
    firds_record(NESTLE_ADR, "FRAB", NESTLE, cfi="EDSXFR", name="Nestle S.A. (ADRs)", relevant="FRAB"),
    firds_record(NOVA, "FRAB", TP_ICAP, name="Nova Minerals Corp. Reg.Shs (CDI's) 1/12", relevant="FRAB"),
    firds_record(NOVA, "XDUS", TP_ICAP, name="Nova Minerals Corp. Reg.Shs (CDI's) 1/12", relevant="FRAB"),
    firds_record(SOCGEN, "XAMS", "969500QKPN3VNL7HBU11", name="SOCIETE GENERALE", relevant="XAMS"),
    firds_record(SOCGEN, "EQTC", "969500QKPN3VNL7HBU11", name="SOCIETE GENERALE", relevant="XAMS"),
    firds_record(SOCGEN, "XDUS", "969500QKPN3VNL7HBU11", name="SOCIETE GENERALE", relevant="XAMS"),
    firds_record(HAL_TRUST, "XAMS", HAL, name="HAL TRUST", relevant="XAMS"),
    firds_record(HAL_TRUST, "STUB", HAL, name="HAL TRUST", relevant="XAMS"),
    firds_record(GRIFOLS_B, "XMAD", GRIFOLS, cfi="EPNXXR", name="GRIFOLS SA CLASE B", relevant="XMAD"),
    firds_record(CDO_PREF, "XMSM", CDO, cfi="EPNXFR", name="ALESCO PREFERRED FUNDING IV LTD Preference Shares", relevant="XMSM"),
    firds_record(NEW_ISIN, "XETA", "529900FRESFRESFRES01", name="Fresenius SE &amp; Co. KGaA", relevant="XETA"),
    firds_record(OLD_ISIN, "EQTC", "529900FRESFRESFRES01", name="Fresenius SE &amp; Co. KGaA", relevant="EQTC"),
    firds_record(DELISTED_US, "FRAB", "549300MARATHONOIL001", name="Marathon Oil Corp.", relevant="FRAB"),
    firds_record(WARSAW_US, "XWAR", "549300HUUUGEHUUUGE01", name="Huuuge Inc", relevant="XWAR"),
    firds_record(HEINEKEN_ADR, "FRAB", "724500K5PTPSST86UQ23", cfi="EDSXFR", name="Heineken N.V. (ADRs)", relevant="FRAB"),
])
GLEIF = [
    gleif_item(TP_ICAP, "TP ICAP (EUROPE)"), gleif_item(SOFINA, "SOFINA"), gleif_item(DB_AG, "Deutsche Börse Aktiengesellschaft"),
    gleif_item(NCM, "NESTLÉ CAPITAL MARKETS SA"), gleif_item(NESTLE, "NESTLÉ S.A."), gleif_item(HAL, "HAL Trust"),
    gleif_item(GRIFOLS, "GRIFOLS, S.A."), gleif_item(CDO, "ALESCO PREFERRED FUNDING IV LTD"),
    gleif_item("969500QKPN3VNL7HBU11", "SOCIETE GENERALE"), gleif_item("529900FRESFRESFRES01", "Fresenius SE & Co. KGaA"),
    gleif_item("549300MARATHONOIL001", "Marathon Oil Corporation"), gleif_item("549300HUUUGEHUUUGE01", "Huuuge, Inc."),
    gleif_item("724500K5PTPSST86UQ23", "Heineken N.V."),
]
OPENFIGI = {
    ("ID_ISIN", DB_SHARE, "XETA2"): [figi_row("DB1", "GY", "BBGDB1GY0001", "BBGDB1SC0001")],
    ("ID_ISIN", SOFINA_SHARE, "XAMS"): [figi_row("SOF", "NA", "BBGSOFNA0001", "BBGSOFSC0001", name="SOFINA")],
    # Frankfurt's open market answers nothing for its segment code; the fan-out has the Frankfurt row.
    ("ID_ISIN", NOVA, "XDUS"): [figi_row("QM3", "GD", "BBGQM3GD0001", "BBGQM3SC0001", composite="BBGQM3GR0001")],
    ("ID_ISIN", NOVA, None): [figi_row("QM3", "GF", "BBGQM3GF0001", "BBGQM3SC0001", composite="BBGQM3GR0001"),
                              figi_row("NVA", "AU", "BBGNVAAU0001", "BBGQM3SC0001", name="NOVA MINERALS CORP-CDI")],
    # Berlin answers no job; Düsseldorf's row carries the German ticker.
    ("ID_ISIN", SOCGEN, "XAMS"): [figi_row("GLE", "NA", "BBGGLENA0001", "BBGGLESC0001")],
    ("ID_ISIN", SOCGEN, "XDUS"): [figi_row("SGE", "GD", "BBGSGEGD0001", "BBGGLESC0001", composite="BBGSGEGR0001")],
    # Stuttgart answers only its international row, which repeats the home ticker under another composite.
    ("ID_ISIN", HAL_TRUST, "XAMS"): [figi_row("HAL", "NA", "BBGHALNA0001", "BBGHALSC0001")],
    ("ID_ISIN", HAL_TRUST, "STUB"): [figi_row("HAL", "XS", "BBGHALXS0001", "BBGHALSC0001", composite="BBGHALEU0001")],
    ("ID_ISIN", HAL_TRUST, None): [figi_row("HA4", "GD", "BBGHA4GD0001", "BBGHALSC0001", composite="BBGHA4GR0001"),
                                   figi_row("HAL", "XS", "BBGHALXS0001", "BBGHALSC0001", composite="BBGHALEU0001")],
    ("ID_ISIN", GRIFOLS_B, "XMAD"): [figi_row("GRF/P", "SQ", "BBGGRFPSQ001", "BBGGRFPSC001", sec_type2="Preference")],
    ("ID_ISIN", CDO_PREF, "XMSM"): [dict(figi_row("ALESC V0 07/30/34 REGS", "NOT LISTED", "BBGCDO000001", "BBGCDOSC0001"), marketSector="Pfd")],
    ("ID_ISIN", NEW_ISIN, "XETA"): [figi_row("FRE", "GY", "BBGFREGY0001", "BBGFRESC0001")],
    ("ID_ISIN", OLD_ISIN, None): [figi_row("FREUSD", "X1", "BBGFREX10001", "BBGFREOLD001")],
    ("ID_ISIN", HEINEKEN_ADR, "PQ"): [figi_row("HEINY", "PQ", "BBG003PYKHL8", "BBG003PYKHX5", composite="BBG003PYKH56",
                                               sec_type="ADR", sec_type2="Depositary Receipt", name="HEINEKEN NV-SPN ADR")],
}


def gleif_fetch(leis):
    entities = {e.lei: e for e in map(gleif.entity_from_api, GLEIF)}
    return {lei: entities[lei] for lei in leis if lei in entities}


def build(scope=Scope(), sec_rows=b'{"fields": ["cik", "name", "ticker", "exchange"], "data": []}'):
    admissions = {}
    firds.apply(admissions, firds.full_records(stream(FIRDS), scope.cfi_prefixes), Counter())
    inputs = Inputs(date(2026, 9, 28), scope, mic.parse(QUALITY_MIC.encode()), admissions, None, sec.parse(sec_rows) if scope.sec else [],
                    {"XAMS", "XETA", "XETA2", "FRAB", "XDUS", "STUB", "XMAD", "XMSM", "EQTC", "TPIR", "XWAR"})
    return build_snapshot(inputs, gleif_fetch, FakeOpenFigi(OPENFIGI))


class QualityTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch("urllib.request.urlopen", side_effect=AssertionError("network access in a test"))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.snap = build()

    def issuer(self, isin):
        return self.snap.securities[f"isin:{isin}"].issuer_id

    def line(self, segment, isin):
        return self.snap.listings[f"{segment}:{isin}"]

    def test_a_venue_lei_is_no_issuer(self):
        self.assertIsNone(self.issuer(VALARIS), "TP ICAP reported its own LEI for Valaris: unknown, not TP ICAP")
        self.assertNotIn(f"lei:{TP_ICAP}", self.snap.issuers)
        self.assertIn(("isin:" + VALARIS, "issuer_venue_lei", TP_ICAP), {(f.subject_id, f.flag, f.detail) for f in self.snap.flags})
        self.assertEqual(self.issuer(SOFINA_RIGHTS), f"lei:{SOFINA}", "the one GLEIF entity named like the security")
        self.assertEqual(self.issuer(DB_SHARE), f"lei:{DB_AG}", "an operator's own share keeps its issuer")
        self.assertEqual(self.snap.audit["eu"]["issuer_unknown"], 2)  # Valaris and Nova Minerals

    def test_a_financing_vehicle_gives_way_to_the_parent_named_like_the_share(self):
        self.assertEqual(self.issuer(NESTLE_SHARE), f"lei:{NESTLE}")
        self.assertTrue(rules.financing_vehicle_of("Brambles Finance Limited", ["Brambles Ltd. Registered Shares o.N."]))
        self.assertFalse(rules.financing_vehicle_of("Enterprise Financial Services Corp", ["Enterprise Finl Services Corp."]))

    def test_a_segment_without_answers_takes_the_venue_row_or_the_country_ticker(self):
        frab = self.line("FRAB", NOVA)
        self.assertEqual((frab.ticker, frab.figi, frab.status), ("QM3", "BBGQM3GF0001", "active"))
        berlin = self.line("EQTC", SOCGEN)
        self.assertEqual((berlin.ticker, berlin.figi, berlin.ticker_source), ("SGE", None, "openfigi_country"))

    def test_a_foreign_composite_row_does_not_give_a_german_line_the_home_ticker(self):
        self.assertEqual(self.line("STUB", HAL_TRUST).ticker, "HA4")
        self.assertEqual(rules.pick_figi_row([figi_row("GLE", "XS", "A", "S"), figi_row("SGE", "GS", "B", "S")], "XSTU")[0]["ticker"], "SGE")

    def test_preference_shares_are_typed_and_debt_rows_are_left_out(self):
        grifols = self.snap.securities[f"isin:{GRIFOLS_B}"]
        self.assertEqual((grifols.kind, self.line("XMAD", GRIFOLS_B).ticker), ("preferred", "GRF-P"))
        self.assertNotIn(f"isin:{CDO_PREF}", self.snap.securities, "a CDO 'preference share' OpenFIGI shows as debt")
        self.assertEqual(rules.slash_class("BA/"), "BA")

    def test_an_old_isin_beside_its_live_twin_is_retired(self):
        self.assertEqual(self.snap.securities[f"isin:{OLD_ISIN}"].activity, "inactive")
        self.assertEqual(self.line("EQTC", OLD_ISIN).status_reasons[-1], "superseded_isin")
        self.assertEqual(self.snap.securities[f"isin:{NEW_ISIN}"].activity, "active")


class UsEvidenceTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch("urllib.request.urlopen", side_effect=AssertionError("network access in a test"))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.snap = build(Scope(sec=True))

    def test_an_unsponsored_receipt_gets_its_otc_line(self):
        line = self.snap.listings["OTCM:HEINY"]
        self.assertEqual((line.security_id, line.figi, line.composite_figi, line.is_primary),
                         (f"isin:{HEINEKEN_ADR}", "BBG003PYKHL8", "BBG003PYKH56", False))
        self.assertEqual(self.snap.securities[f"isin:{HEINEKEN_ADR}"].share_class_figi, "BBG003PYKHX5")

    def test_a_us_share_openfigi_knows_on_no_us_exchange_is_retired_unless_regulated_in_the_eea(self):
        self.assertEqual(self.snap.securities[f"isin:{DELISTED_US}"].activity, "inactive")
        self.assertEqual(self.snap.securities[f"isin:{WARSAW_US}"].activity, "active", "a Warsaw-listed US company stays")

    def test_a_sec_line_replaces_a_contradicted_or_missing_issuer(self):
        snap = Snapshot(as_of="2026-09-28")
        snap.issuers["lei:BRK"] = Issuer("lei:BRK", "Berkshire Hathaway Inc.", "gleif", lei="BRK")
        snap.issuers["cik:58361"] = Issuer("cik:58361", "LEE ENTERPRISES, Inc", "sec", cik="58361")
        snap.securities["isin:US5237684064"] = Security("isin:US5237684064", "share", "esma_firds", issuer_id="lei:BRK",
                                                        isin="US5237684064", name="Lee Enterprises Inc. Registered Shares DL 2")
        snap.listings["FRAB:US5237684064"] = Listing("FRAB:US5237684064", "esma_firds", "share", security_id="isin:US5237684064", issuer_id="lei:BRK")
        snap.listings["XNAS:LEE"] = Listing("XNAS:LEE", "sec", "share", security_id="isin:US5237684064", issuer_id="cik:58361")
        audit = Counter()
        linking._adopt_sec_issuers(snap, [SecTicker("58361", "LEE ENTERPRISES, Inc", "LEE", "Nasdaq", 0)], audit)
        self.assertEqual((snap.securities["isin:US5237684064"].issuer_id, snap.listings["FRAB:US5237684064"].issuer_id), ("cik:58361", "cik:58361"))
        self.assertEqual(audit["issuer_contradicted_by_sec_line"], 1)


if __name__ == "__main__":
    unittest.main()
