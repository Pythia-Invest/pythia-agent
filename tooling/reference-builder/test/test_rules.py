"""Audit rules on hand-made rows."""

import unittest

from reference_builder import rules

from .fixtures import figi_row


def status(**overrides):
    values = dict(as_of="2026-09-25", termination=None, full_name="ACME NV", cfi="ESVUFR", entity_status="ACTIVE",
                  registration_status="ISSUED", venue_count=3, has_transparency=True, has_figi=True)
    values.update(overrides)
    return rules.admission_status(**values)


class ActivityTest(unittest.TestCase):
    def test_live_line_is_active(self):
        self.assertEqual(status()[0], "active")

    def test_dead_signals_make_a_line_inactive(self):
        self.assertEqual(status(termination="2026-09-01"), ("inactive", ["terminated"]))
        self.assertEqual(status(registration_status="RETIRED")[0], "inactive")
        self.assertEqual(status(full_name="PSI SOFTWARE z.Verk.", has_figi=False)[0], "inactive")

    def test_unclassified_cfi_alone_is_not_dead(self):
        # FIRDS gives ESXXXX to live shares such as some Luxembourg issuers on XAMS.
        self.assertEqual(status(cfi="ESXXXX")[0], "active")
        self.assertEqual(status(cfi="ESXXXX", has_figi=False)[0], "inactive")

    def test_traded_corporate_action_line_is_demoted_not_dropped(self):
        self.assertEqual(status(full_name="PHILIPS BUY BACK"), ("suspect", ["corporate_action_line"]))

    def test_silent_line_without_transparency_is_suspect(self):
        self.assertEqual(status(has_figi=False, has_transparency=False)[0], "suspect")
        self.assertEqual(status(has_figi=False, has_transparency=None)[0], "active", "FITRS not loaded is not evidence")


class PrimaryVenueTest(unittest.TestCase):
    def test_uk_issuer_moves_to_its_home_line_when_openfigi_shows_one(self):
        fanout = [figi_row("0QB8", "LN", "F1", "S1"), figi_row("SHEL", "LN", "F2", "S1"), figi_row("SHELL", "NA", "F3", "S1")]
        mic, rule, row = rules.primary_venue("GB00BP6MXD84", "XAMS", False, fanout)
        self.assertEqual((mic, rule, row["ticker"]), ("XLON", "home_listing_evidence", "SHEL"))

    def test_uk_issuer_without_home_evidence_keeps_firds(self):
        self.assertEqual(rules.primary_venue("GB00BP6MXD84", "XAMS", False, [figi_row("0QB8", "LN", "F1", "S1")])[:2], ("XAMS", "firds_relevant_venue"))

    def test_frankfurt_floor_moves_to_xetra_only_with_a_live_xetra_line(self):
        self.assertEqual(rules.primary_venue("DE0007164600", "XFRA", True, [])[0], "XETR")
        self.assertEqual(rules.primary_venue("DE0007164600", "XFRA", False, [])[0], "XFRA")

    def test_eea_issuer_keeps_firds_even_with_us_lines(self):
        fanout = [figi_row("ASML", "UW", "F1", "S2")]
        self.assertEqual(rules.primary_venue("NL0010273215", "XAMS", False, fanout)[0], "XAMS")


class FigiPickTest(unittest.TestCase):
    def test_prefers_main_exchange_code_over_currency_suffixed_mtf_line(self):
        rows = [figi_row("ADYENEUR", "EU", "F1", "S"), figi_row("ADYEN", "NA", "F2", "S")]
        self.assertEqual(rules.pick_figi_row(rows, "XAMS")[0]["ticker"], "ADYEN")

    def test_prefers_plain_ticker_among_several_main_code_rows(self):
        rows = [figi_row("STR1", "AV", "F1", "S"), figi_row("STR", "AV", "F2", "S")]
        self.assertEqual(rules.pick_figi_row(rows, "XWBO")[0]["ticker"], "STR")


class NamesAndClassesTest(unittest.TestCase):
    def test_name_keys_ignore_legal_forms_but_keep_distinguishing_words(self):
        self.assertEqual(rules.normalized_name("ASML Holding N.V."), rules.normalized_name("ASML HOLDING NV"))
        self.assertNotEqual(rules.normalized_name("NN Group N.V."), rules.normalized_name("NN INC"))
        self.assertNotEqual(rules.normalized_name("FERRARI GROUP PLC"), rules.normalized_name("Ferrari N.V."))

    def test_share_class_split(self):
        self.assertEqual(rules.split_ticker("BRK-B"), ("BRK", "B"))
        self.assertEqual(rules.split_ticker("BRK/B"), ("BRK", "B"))
        self.assertEqual(rules.split_glued_class("NCCA", "NCC AB/SH A"), ("NCC", "A"))
        self.assertIsNone(rules.split_glued_class("ASML", "ASML HOLDING/SH"))

    def test_sec_non_share_lines_are_labelled(self):
        self.assertEqual(rules.sec_row_class("Common Stock", "AAPL"), "share")
        self.assertEqual(rules.sec_row_class(None, "BRKH-WS"), "warrant")
        self.assertEqual(rules.sec_row_class(None, "JPM-PC"), "preferred")
        self.assertEqual(rules.sec_row_class(None, "ODDX"), "unknown")


if __name__ == "__main__":
    unittest.main()


class DisplayNameTest(unittest.TestCase):
    def test_all_capitals_names_are_recased_keeping_acronyms_and_legal_forms(self):
        cases = {("ASML HOLDING N.V.", "ASML"): "ASML Holding N.V.", ("ING GROEP N.V.", ""): "ING Groep N.V.",
                 ("KONINKLIJKE KPN N.V.", ""): "Koninklijke KPN N.V.", ("BANK OF AMERICA CORP /DE/", ""): "Bank of America Corp",
                 ("COMPAGNIE DE SAINT-GOBAIN", ""): "Compagnie de Saint-Gobain", ("THE MAGNUM ICE CREAM COMPANY N.V.", ""):
                 "The Magnum Ice Cream Company N.V.", ("O'REILLY AUTOMOTIVE INC", ""): "O'Reilly Automotive Inc"}
        for (name, ticker), shown in cases.items():
            self.assertEqual(rules.display_case(name, frozenset({ticker})), shown)

    def test_mixed_case_names_keep_their_case_without_sec_markers(self):
        self.assertEqual(rules.display_case("CVC Capital Partners plc/ADR"), "CVC Capital Partners plc")
        self.assertEqual(rules.display_case("Anheuser-Busch InBev SA/NV"), "Anheuser-Busch InBev SA/NV")
