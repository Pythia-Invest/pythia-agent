"""A listing no price source covers still has a quote section that says so."""
import unittest

from test_identity_page import ASML, CONTRACTS, Fixture, identity, page


class UncoveredPriceTest(Fixture):
    def test_a_listing_no_price_source_covers_has_a_quote_section_saying_so(self):
        contract = {**CONTRACTS["yahoo"], "addressing": {**CONTRACTS["yahoo"]["addressing"], "mic_table": {"XNAS": ""}}}
        yahoo = page.PluginInfo(key="pythia-yahoo", manifest=identity.validate_manifest(contract))
        quote = self.compose(ASML, [yahoo])[1]["quote"]
        self.assertEqual((quote["plugin"], quote["status"], quote["reason"], quote["binding"]),
                         ("pythia", "not_covering", "No price source covers this listing", None))
        self.assertEqual([(item["plugin"], item["code"]) for item in quote["skipped"]],
                         [("pythia-yahoo", "not_addressable")])


if __name__ == "__main__":
    unittest.main()
