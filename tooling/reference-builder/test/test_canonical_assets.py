"""Core's curated canonical crypto assets: the seed's own rules, provider-independent IDs and the drift alarm."""

import json
import re
import sqlite3
import tempfile
import unittest
from pathlib import Path

from reference_builder import drift, schema, truth, writer
from reference_builder.model import Snapshot

identity = schema.identity
page, search, store = truth.page, truth.search, __import__(f"{identity.__name__}.store", fromlist=["store"])
SEED = json.loads((schema.CORE / "canonical_assets.json").read_text(encoding="utf-8"))
AUDIT = (Path(__file__).resolve().parents[1] / "truth" / "canonical-assets-audit.md").read_text(encoding="utf-8")
BTC = "bip122:000000000019d6689c085ae165831e93/slip44:0"
USDC = "eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
USDC_BASE = "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
WBTC = "eip155:1/erc20:0x2260fac5e5542a773aa44fbcfedf7c193bc2c599"


def deployments(asset):
    return (asset["caip19"], *asset.get("deployments", ()))


class SeedTest(unittest.TestCase):
    def test_every_row_is_well_formed_and_cited(self):
        chains = {row["caip2"] for row in SEED["chains"]}
        self.assertEqual(SEED["rule_id"], identity.CANONICAL_ASSETS_RULE)
        seen: set[str] = set()
        for asset in SEED["assets"]:
            with self.subTest(asset=asset["symbol"]):
                for deployment in deployments(asset):
                    # Canonical form (EVM lower case, the Sui profile's encoding) within CAIP-19's length rules.
                    self.assertEqual(identity.normalize_identifier("caip19", deployment), deployment)
                    self.assertIn(deployment.split("/")[0], chains)
                    self.assertNotIn(deployment, seen, "a deployment belongs to one asset")
                    seen.add(deployment)
                self.assertEqual(asset["kind"] == "coin", "/slip44:" in asset["caip19"])
                self.assertIn(asset["caip19"], AUDIT, "every row's evidence is in the audit note")
        for provider in drift.PROVIDERS:
            ids = [asset[provider] for asset in SEED["assets"]]
            self.assertEqual(len(ids), len(set(ids)), f"{provider} ids are unique")
        for row in SEED["provider_chains"]:
            self.assertIn(row["caip2"], chains)
        for asset in SEED["assets"]:
            if "wraps" in asset:  # related, never merged: the underlying is another curated asset
                self.assertIn(asset["wraps"], {other["caip19"] for other in SEED["assets"]} - {asset["caip19"]})


class ReferenceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        path = Path(cls.tmp.name) / "reference-test.sqlite3"
        writer.write(Snapshot(as_of="2026-09-28"), path, {"build_id": "test"}, [])  # no provider involved
        cls.path, cls.ref = path, store.open_reference(path)
        cls.canonical = {(row[0], row[1]): row[2] for row in cls.ref.execute(
            "SELECT provider, native_id, caip19 FROM canonical_assets")}
        cls.contracts = truth.load_contracts()

    @classmethod
    def tearDownClass(cls):
        cls.ref.close()
        cls.tmp.cleanup()

    def test_coingecko_only_and_coinmarketcap_only_installs_address_one_subject_per_curated_asset(self):
        coins = {(provider, caip19): native for (provider, native), caip19 in self.canonical.items()}
        for asset in SEED["assets"]:
            with self.subTest(asset=asset["symbol"]):
                subject_id = f"security:caip19:{asset['caip19']}"  # built with no provider installed
                self.assertEqual({self.canonical[(provider, asset[provider])] for provider in drift.PROVIDERS},
                                 {asset["caip19"]})
                subject = page.load_subject(self.ref, subject_id)
                for provider in drift.PROVIDERS:  # one installed coin plugin addresses that same subject
                    quote = next(section for section in page.compose(
                        subject, [self.contracts[provider]], stored=lambda *_: None, queue=[],
                        coins=lambda p, caip19: coins.get((p, caip19))) if section["section"] == "quote")
                    self.assertEqual((quote["status"], quote["binding"]["native_id"], quote["binding_status"]),
                                     ("ready", asset[provider], "confirmed"))

    def test_an_id_minted_before_curation_aliases_to_the_curated_subject(self):
        for provider, native_id in (("coingecko", "usd-coin"), ("coinmarketcap", "3408")):
            earlier = identity.provisional_id("security", provider, "coin", native_id)  # as a resolve residual mints it
            self.assertEqual(page.load_subject(self.ref, earlier)["id"], f"security:caip19:{USDC}")

    def test_deployments_are_listings_of_one_security_and_a_wrapped_asset_stays_apart(self):
        base = page.load_subject(self.ref, f"listing:caip19:{USDC_BASE}")
        self.assertEqual(base["ids"][identity.Level.SECURITY], f"security:caip19:{USDC}")
        self.assertEqual(len(base["view"]["listings"]), 7)
        coins = {(provider, caip19): native for (provider, native), caip19 in self.canonical.items()}
        quote = page.compose(base, [self.contracts["coingecko"]], stored=lambda *_: None, queue=[],
                             coins=lambda p, caip19: coins.get((p, caip19)))[0]
        self.assertEqual(quote["binding"]["native_id"], "usd-coin")  # a deployment's page reads its asset's coin id
        wbtc = page.load_subject(self.ref, f"security:caip19:{WBTC}")
        self.assertEqual(wbtc["view"]["related"], [{"id": f"security:caip19:{BTC}", "type": "wraps", "direction": "to",
                                                    "kind": "security", "name": "Bitcoin"}])
        groups = search.directory(self.path, store.open_reference).search("usdc", limit=5)["groups"]
        usdc = [(group["id"], [row["id"] for row in group["rows"]]) for group in groups
                if any(row["ticker"] == "USDC" for row in group["rows"])]
        self.assertEqual(usdc, [(f"security:caip19:{USDC}", [f"security:caip19:{USDC}"])])  # one asset, one row


class DriftTest(unittest.TestCase):
    SEED = {"provider_chains": [{"provider": "coingecko", "chain": "ethereum", "caip2": "eip155:1"},
                                {"provider": "coingecko", "chain": "base", "caip2": "eip155:8453"}],
            "assets": [{"caip19": USDC, "symbol": "USDC", "deployments": [USDC_BASE, "eip155:42161/erc20:0xaf88"],
                        "coingecko": "usd-coin"},
                       {"caip19": BTC, "symbol": "BTC", "coingecko": "bitcoin"}]}
    ETH_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"  # checksummed: EVM addresses compare case-insensitively
    BASE_USDC = USDC_BASE.split(":")[-1]

    def findings(self, listed):
        return drift.check(self.SEED, "coingecko", listed)

    def test_the_curated_contracts_on_mapped_chains_are_no_drift(self):
        listed = {"usd-coin": {"ethereum": {self.ETH_USDC}, "base": {self.BASE_USDC}, "tron": {"TEkx"}}, "bitcoin": {}}
        self.assertEqual(self.findings(listed), [])  # an extra, unmapped chain is the provider's own claim

    def test_a_missing_id_a_changed_or_dropped_contract_and_a_moved_one_are_drift(self):
        cases = {
            "no longer resolves": {"usd-coin": {"ethereum": {self.ETH_USDC}, "base": {self.BASE_USDC}}},
            "not the curated": {"usd-coin": {"ethereum": {"0xbad"}, "base": {self.BASE_USDC}}, "bitcoin": {}},
            "no longer lists eip155:8453": {"usd-coin": {"ethereum": {self.ETH_USDC}}, "bitcoin": {}},
            "also listed under coingecko usd-coin-base": {
                "usd-coin": {"ethereum": {self.ETH_USDC}, "base": {self.BASE_USDC}}, "bitcoin": {},
                "usd-coin-base": {"base": {self.BASE_USDC}}},
        }
        for expected, listed in cases.items():
            with self.subTest(expected):
                found = self.findings(listed)
                self.assertEqual(len(found), 1, found)
                self.assertTrue(re.search(re.escape(expected), found[0]), found[0])

    def test_coinmarketcap_chains_follow_the_connector_network_key(self):
        data = {"3408": {"contract_address": [
            {"contract_address": "0xabc", "platform": {"name": "Avalanche C-Chain", "coin": {"id": "5805"}}}]}}
        self.assertEqual(drift.coinmarketcap_listed(data), {"3408": {"coin:5805:avalanche-c-chain": {"0xabc"}}})


if __name__ == "__main__":
    unittest.main()
