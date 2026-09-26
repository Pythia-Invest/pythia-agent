"""Source parsing: FIRDS full and delta records, FITRS, GLEIF typed names, SEC, MIC."""

import json
import tempfile
import unittest
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

from reference_builder import config, firds, gleif, mic, sec, us_listed
from reference_builder.fetch import Downloader
from reference_builder.rules import display_name

from .fixtures import (
    ASML_ISIN,
    ASML_LEI,
    MIC_CSV,
    dltins,
    firds_record,
    fitrs,
    fulins,
    gleif_item,
    sec_json,
    stream,
    symbol_directory,
    write_zip,
)


class FirdsTest(unittest.TestCase):
    def test_full_file_keeps_only_requested_cfi_and_reads_venue_fields(self):
        xml = fulins([
            firds_record(ASML_ISIN, "XAMS", ASML_LEI, name="ASML HOLDING"),
            firds_record("NL0000000099", "XAMS", ASML_LEI, cfi="EYXXXX"),  # structured product: not an equity
            firds_record("NL0000000098", "XAMS", ASML_LEI, cfi="EDSXFR", underlying="NOISINFOUND9"),
            firds_record("IE0000000097", "XAMS", ASML_LEI, cfi="CEOGES"),  # exchange-traded fund
            firds_record("IE0000000096", "XAMS", ASML_LEI, cfi="CIOGES"),  # open-ended fund: not exchange-traded
        ])
        records = list(firds.full_records(stream(xml), ("ES", "ED", "CE")))
        self.assertEqual([r.isin for r in records], [ASML_ISIN, "NL0000000098", "IE0000000097"])
        self.assertEqual(firds.file_types(("ES", "ED", "CE")), ["C", "E"])
        asml = records[0]
        self.assertEqual((asml.mic, asml.issuer_lei, asml.relevant_mic, asml.first_trade), ("XAMS", ASML_LEI, "XAMS", "2012-11-26"))
        self.assertIsNone(records[1].underlying_isin, "FIRDS placeholder ISINs are not underlyings")

    def test_scan_handles_records_split_across_read_blocks(self):
        xml = fulins([firds_record(f"NL00000000{i:02d}", "XAMS", ASML_LEI) for i in range(40)])
        original = firds.BLOCK
        firds.BLOCK = 97  # force every record to straddle a block boundary
        try:
            records = list(firds.full_records(stream(xml), ("ES",)))
        finally:
            firds.BLOCK = original
        self.assertEqual(len(records), 40)

    def test_deltas_apply_in_order_new_terminated_cancelled(self):
        with tempfile.TemporaryDirectory() as tmp:
            full = write_zip(Path(tmp), "FULINS_E_1.zip", fulins([
                firds_record(ASML_ISIN, "XAMS", ASML_LEI),
                firds_record("NL0000000097", "XAMS", ASML_LEI),
            ]))
            delta = write_zip(Path(tmp), "DLTINS_1.zip", dltins([
                ("TermntdRcrd", firds_record(ASML_ISIN, "XAMS", ASML_LEI, term="2026-09-20")),
                ("CancRcrd", firds_record("NL0000000097", "XAMS", ASML_LEI)),
                ("NewRcrd", firds_record("NL0000000096", "XAMS", ASML_LEI)),
            ]))
            admissions, counts = firds.load_admissions([full], [delta], ("ES",))
        self.assertEqual(admissions[(ASML_ISIN, "XAMS")].termination, "2026-09-20")
        self.assertNotIn(("NL0000000097", "XAMS"), admissions)
        self.assertIn(("NL0000000096", "XAMS"), admissions)
        self.assertEqual(counts, Counter(full=2, terminated=1, cancelled=1, new=1))

    def test_transparency_uses_latest_period_started_by_as_of(self):
        xml = fitrs([(ASML_ISIN, "2025-04-01", 100.0), (ASML_ISIN, "2026-04-01", 250.0), (ASML_ISIN, "2027-04-01", 999.0)])
        chosen = firds.select_transparency(firds.transparency_records(stream(xml)), date(2026, 9, 25))
        self.assertEqual(chosen[ASML_ISIN].turnover_eur, 250.0)

    def test_empty_transparency_index_is_unavailable_not_all_missing(self):
        self.assertIsNone(firds.load_transparency([], date(2026, 9, 25)))


class GleifTest(unittest.TestCase):
    def test_non_latin_legal_name_uses_typed_alternative_never_previous_name(self):
        entity = gleif.entity_from_api(gleif_item(
            "5299000000000000AB12", "ШЕЛЛИ ГРУП", language="bg",
            other=[("OLD NAME AD", "PREVIOUS_LEGAL_NAME"), ("SHELLY GROUP", "PREFERRED_ASCII_TRANSLITERATED_LEGAL_NAME"),
                   ("Shelly Group SE", "ALTERNATIVE_LANGUAGE_LEGAL_NAME")],
        ))
        self.assertEqual(display_name(entity.legal_name, entity.names), ("Shelly Group SE", "alternative_language_legal_name"))
        only_transliterated = tuple(n for n in entity.names if n[1] != "ALTERNATIVE_LANGUAGE_LEGAL_NAME")
        self.assertEqual(display_name(entity.legal_name, only_transliterated)[0], "SHELLY GROUP")


class SecAndMicTest(unittest.TestCase):
    def test_sec_rows_normalise_cik_and_drop_duplicate_tickers(self):
        rows = sec.parse(sec_json([(320193, "Apple Inc.", "AAPL", "Nasdaq"), (320193, "Apple Inc.", "AAPL", "Nasdaq"), (937966, "ASML HOLDING NV", "ASML", "Nasdaq")]))
        self.assertEqual([(r.cik, r.ticker) for r in rows], [("320193", "AAPL"), ("937966", "ASML")])

    def test_sec_download_requires_a_contact_mailbox(self):
        with tempfile.TemporaryDirectory() as tmp, self.assertRaises(SystemExit):
            sec.fetch(Downloader(Path(tmp), "test"), contact="no mailbox", local=None, max_age=timedelta(days=1))

    def test_sec_contact_comes_from_the_settings_file_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {"XDG_CONFIG_HOME": tmp, "PYTHIA_REFERENCE_CONTACT": "Env Contact env@example.org"}
            self.assertIsNone(config.load_sec_identity(env))
            (Path(tmp) / "pythia").mkdir()
            (Path(tmp) / "pythia" / "settings.json").write_text(json.dumps({"sec_identity": " Example Research research@example.org "}))
            self.assertEqual(config.load_sec_identity(env), "Example Research research@example.org")

    def test_symbol_directory_places_tickers_on_their_exchange(self):
        rows = us_listed.parse(*symbol_directory(
            [("TSLL", "Direxion Daily TSLA Bull 2X ETF", "Y"), ("AAPL", "Apple Inc. - Common Stock", "N")],
            [("VOO", "Vanguard S&P 500 ETF", "P", "Y"), ("BRK.B", "Berkshire Hathaway Inc.", "N", "N"),
             ("ZTST", "Test issue", "V", "N"), ("ODD", "Unknown exchange", "Q", "N")]))
        self.assertEqual({t: (r.mic, r.etf) for t, r in rows.items()},
                         {"TSLL": ("XNAS", True), "AAPL": ("XNAS", False), "VOO": ("ARCX", True), "BRK-B": ("XNYS", False)})

    def test_mic_rows_map_segments_to_operating_mic(self):
        venues = mic.parse(MIC_CSV.encode())
        self.assertEqual(venues["XAMC"].operating_mic, "XAMS")
        self.assertEqual(venues["XAMS"].category, "RMKT")


if __name__ == "__main__":
    unittest.main()
