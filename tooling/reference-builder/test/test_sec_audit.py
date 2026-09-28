"""The SEC audit's network-free parts: the XBRL instance reader, the Wilson bound, and the cache-only rule.

The instance follows the XBRL 2.1 layout (contexts, units, facts); values are illustrative.
"""

import tempfile
import unittest
from pathlib import Path

from reference_builder import sec_audit, sec_evidence

INSTANCE = b"""<?xml version="1.0" encoding="utf-8"?>
<xbrl xmlns="http://www.xbrl.org/2003/instance" xmlns:dei="http://xbrl.sec.gov/dei/2025"
      xmlns:us-gaap="http://fasb.org/us-gaap/2025" xmlns:xbrldi="http://xbrl.org/2006/xbrldi">
  <context id="FY"><entity><identifier scheme="http://www.sec.gov/CIK">0000123456</identifier></entity>
    <period><startDate>2025-01-01</startDate><endDate>2025-12-31</endDate></period></context>
  <context id="Day"><entity><identifier scheme="http://www.sec.gov/CIK">0000123456</identifier></entity>
    <period><startDate>2025-08-01</startDate><endDate>2025-08-01</endDate></period></context>
  <context id="Class"><entity><identifier scheme="http://www.sec.gov/CIK">0000123456</identifier>
    <segment><xbrldi:explicitMember dimension="us-gaap:StatementClassOfStockAxis">us-gaap:CommonStockMember</xbrldi:explicitMember></segment>
    </entity><period><startDate>2025-01-01</startDate><endDate>2025-12-31</endDate></period></context>
  <unit id="USD"><measure>iso4217:USD</measure></unit>
  <dei:EntityCentralIndexKey contextRef="FY">0000123456</dei:EntityCentralIndexKey>
  <dei:TradingSymbol contextRef="Class">EXM</dei:TradingSymbol>
  <us-gaap:Revenues contextRef="FY" unitRef="USD" decimals="-6">100000000</us-gaap:Revenues>
  <us-gaap:ProceedsFromIssuanceOfCommonStock contextRef="Day" unitRef="USD" decimals="0">5000</us-gaap:ProceedsFromIssuanceOfCommonStock>
</xbrl>"""


class SecAuditTest(unittest.TestCase):
    def test_instance_facts_carry_taxonomy_period_unit_and_dimensions(self):
        facts = {f["concept"]: f for f in sec_evidence.parse_instance(INSTANCE)}
        revenue = facts["Revenues"]
        self.assertEqual((revenue["taxonomy"], revenue["start"], revenue["end"], revenue["unit"], revenue["dims"]),
                         ("us-gaap", "2025-01-01", "2025-12-31", "USD", False))
        self.assertTrue(facts["TradingSymbol"]["dims"])
        day = facts["ProceedsFromIssuanceOfCommonStock"]  # companyfacts gives this one-day duration as an instant
        self.assertEqual(day["start"], day["end"])

    def test_wilson_bounds_match_the_record(self):
        self.assertEqual(sec_audit.wilson(217, 217), "100.0% (98.26–100.00%)")
        self.assertEqual(sec_audit.wilson(10, 11), "90.9% (62.26–98.38%)")
        self.assertEqual(sec_audit.wilson(0, 0), "n/a")

    def test_draw_and_label_never_reach_the_network(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(sec_audit.main(["draw", "--cache", str(Path(tmp))]), 2)


if __name__ == "__main__":
    unittest.main()
