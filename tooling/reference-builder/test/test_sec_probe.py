"""The SEC content probe's fingerprint of submissions and companyfacts (docs/sources/sec.md, stage 2).

Documents follow the EDGAR APIs' published shapes: a submissions document with columnar `filings.recent`, and
companyfacts `facts.<taxonomy>.<concept>.units.<unit>` rows. Values are illustrative.
"""

import unittest

from reference_builder import sec_probe, source_drift

STAMP = "2026-09-28T16:00:00+00:00"


def submissions(cik=123456, rows=(("0000123456-26-000002", "6-K", "2026-07-30", "", 1), ("0000123456-26-000001", "20-F", "2026-02-26", "2025-12-31", 1)),
                drop=()):
    columns = {
        "accessionNumber": [r[0] for r in rows], "form": [r[1] for r in rows], "filingDate": [r[2] for r in rows],
        "reportDate": [r[3] for r in rows], "acceptanceDateTime": [r[2] + "T10:00:00.000Z" for r in rows],
        "items": ["" for _ in rows], "primaryDocument": ["doc.htm" for _ in rows],
        "primaryDocDescription": ["" for _ in rows], "isXBRL": [r[4] for r in rows], "isInlineXBRL": [r[4] for r in rows],
        "size": [1000 for _ in rows]}
    for key in drop:
        del columns[key]
    return {"cik": f"{cik:010d}", "name": "EXAMPLE GROEP NV", "entityType": "operating", "tickers": ["EXM"],
            "exchanges": ["NYSE"], "lei": None, "formerNames": [], "stateOfIncorporation": "P7",
            "filings": {"recent": columns, "files": []}}


def companyfacts(accession="0000123456-26-000001", fp="FY"):
    row = {"start": "2025-01-01", "end": "2025-12-31", "val": 100, "accn": accession, "fy": 2025, "fp": fp,
           "form": "20-F", "filed": "2026-02-26", "frame": "CY2025"}
    return {"cik": 123456, "entityName": "EXAMPLE GROEP NV", "facts": {"ifrs-full": {"Revenue": {"units": {"EUR": [row]}}}}}


def prints(documents):
    return {source: fingerprint.to_dict() for source, fingerprint in sec_probe.observe(documents, STAMP).items()}


class SecProbeTest(unittest.TestCase):
    def test_filings_and_facts_are_fingerprinted_and_a_missing_interim_report_is_counted(self):
        found = prints([(submissions(), companyfacts())])
        self.assertEqual((found["sec_filers"]["records"], found["sec_filings"]["records"], found["sec_facts"]["records"]), (1, 2, 1))
        self.assertEqual(found["sec_filings"]["vocab"]["form_group"], {"periodic": 2})
        self.assertEqual(found["sec_facts"]["vocab"]["taxonomy"], {"ifrs-full": 1})
        # The 6-K with XBRL is the newest report companyfacts should hold: the plugin's own freshness check says stale.
        self.assertEqual(found["sec_facts"]["metrics"]["latest_report_missing"], 1)
        self.assertEqual(prints([(submissions(), companyfacts("0000123456-26-000002"))])["sec_facts"]["metrics"]["latest_report_missing"], 0)
        self.assertEqual(found["sec_filings"]["metrics"]["unknown_form"], 0)
        self.assertEqual(found["sec_filers"]["metrics"]["lei_present"], 0)

    def test_new_forms_legacy_items_and_a_vanished_column_are_told_apart(self):
        before = prints([(submissions(), companyfacts())])
        renamed = submissions(rows=(("0000123456-26-000002", "SCHEDULE 13Z", "2026-07-30", "", 0),
                                    ("0000123456-04-000001", "8-K", "2003-05-01", "", 0)))
        renamed["filings"]["recent"]["items"] = ["", "5,7"]  # whole-number items before 2004-08-23 are not drift
        after = prints([(renamed, companyfacts())])
        self.assertEqual((after["sec_filings"]["metrics"]["unknown_form"], after["sec_filings"]["metrics"]["unknown_8k_item"]), (1, 0))
        kinds = {(a["kind"], a["key"]) for a in source_drift.compare(before["sec_filings"], after["sec_filings"], sec_probe.READ["sec_filings"])}
        self.assertIn(("new_value", "form_group=unknown"), kinds)
        self.assertIn(("metric_shift", "unknown_form"), kinds)
        gone = prints([(submissions(drop=("acceptanceDateTime",)), companyfacts())])
        breaks = source_drift.breaks(source_drift.compare(before["sec_filings"], gone["sec_filings"], sec_probe.READ["sec_filings"]))
        self.assertEqual([(a["kind"], a["key"]) for a in breaks], [("field_missing", "acceptanceDateTime")])
        no_frame = companyfacts()
        del no_frame["facts"]["ifrs-full"]["Revenue"]["units"]["EUR"][0]["frame"]
        self.assertEqual([(a["kind"], a["key"]) for a in source_drift.breaks(source_drift.compare(
            before["sec_facts"], prints([(submissions(), no_frame)])["sec_facts"], sec_probe.READ["sec_facts"]))],
            [("field_missing", "frame")])

    def test_unequal_columns_and_a_missing_companyfacts_are_counted(self):
        broken = submissions()
        broken["filings"]["recent"]["size"] = [1000]
        found = prints([(broken, None)])
        self.assertEqual((found["sec_filings"]["records"], found["sec_filings"]["metrics"]["columns_unequal"]), (0, 1))
        self.assertEqual(found["sec_facts"]["metrics"]["companyfacts_missing"], 1)


if __name__ == "__main__":
    unittest.main()
