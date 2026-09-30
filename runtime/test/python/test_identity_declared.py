"""Contract version 2 (ADR 0038, amendment "contract version 2"): the kinds a plugin introduces, the claim shapes for
them, and a plugin's own references for subjects core keys (`addressing.subjects`), which replace the provider columns
of core's maintained tables."""
import contextlib
import copy
import json
import sqlite3
import types
import unittest
from pathlib import Path
from unittest import mock

from test_identity_contracts import PROVENANCE, YAHOO, identity, load, load_reference
from test_reference_package import make_package
# The loaded core's modules, the same objects the other tests patch.
from test_identity_installed import PLUGINS, PluginCase, access, harness, identity_ops, page, reference_package
from test_identity_installed import identity as core

markets = identity_ops.markets

BTC = "security:caip19:bip122:000000000019d6689c085ae165831e93/slip44:0"
SAVED_BTC = "security:provisional:coingecko:coin:bitcoin"  # as a resolve residual minted it before BTC was curated
POOL = {"provider": "pools", "native_id": "3f1c", "native_scope": "pool"}
PROTOCOL = {"provider": "pools", "native_id": "navi", "native_scope": "protocol"}
SUI_USDC = "sui:mainnet/coin:0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7%3A%3Ausdc%3A%3AUSDC"
POOLS = {  # a DeFi source: pools and protocols it keys by its own references, token deployments by CAIP-19
    "contract_version": 2, "plugin": "pools", "provider": "pools",
    "addressing": {"native": [{"native_scope": "pool", "level": "market"}, {"native_scope": "protocol", "level": "protocol"}],
                   "schemes": {"listing": ["caip19"]}},
    "introduces": {"market": ["native"], "protocol": ["native"], "listing": ["caip19"]},
    "catalogue": {"mode": "bulk", "operation": "catalogue", "scopes": ["pools"]},
    "rights": {"licence": "personal", "cache": "none", "hostable": False},
    "signoff": {"status": "unsigned"},
}
INDEXES = {**copy.deepcopy(YAHOO), "contract_version": 2}
INDEXES["addressing"]["native"].append({"native_scope": "symbol", "level": "index"})
INDEXES["addressing"]["subjects"] = {"index:pythia:sp500": {"native_scope": "symbol", "native_id": "^GSPC"}}


def refused(test, document, path):
    with test.assertRaises(identity.ManifestError) as caught:
        identity.validate_manifest(document)
    test.assertTrue(str(caught.exception).startswith(path), caught.exception)


class ContractTest(unittest.TestCase):
    def test_a_contract_declares_the_kinds_it_introduces_and_their_key_schemes(self):
        contract = identity.validate_manifest(POOLS)
        self.assertEqual(contract.introduces, {identity.Kind.MARKET: ("native",), identity.Kind.PROTOCOL: ("native",),
                                               identity.Kind.LISTING: ("caip19",)})
        cases = {"introduces.widget": {"widget": ["native"]},     # not a registered kind
                 "introduces.listing": {"listing": ["lei"]},      # an LEI keys an issuer
                 "introduces.market": {"market": ["pythia"]},     # Pythia's own keys are no plugin's to mint
                 "introduces.issuer": {"issuer": ["native"]},     # no native scope at issuer
                 "introduces.protocol": {"protocol": []}}
        for path, introduces in cases.items():
            with self.subTest(path=path):
                refused(self, {**POOLS, "introduces": introduces}, path)

    def test_a_plugin_declares_its_own_reference_for_a_core_keyed_subject(self):
        declared = identity.validate_manifest(INDEXES).subjects
        self.assertEqual(declared, {"index:pythia:sp500": identity.DeclaredRef("symbol", "^GSPC")})
        at = {"native_scope": "symbol", "native_id": "^DJI"}
        cases = {"addressing.subjects.widget:pythia:x": {"widget:pythia:x": at},
                 "addressing.subjects.index:provisional:yahoo:symbol:DJI": {"index:provisional:yahoo:symbol:DJI": at},
                 "addressing.subjects.fx:pythia:EURUSD.native_scope": {"fx:pythia:EURUSD": at},  # no symbol scope at fx
                 "addressing.subjects.index:pythia:dow-jones": {"index:pythia:dow-jones": {**at, "venue": "x"}},
                 "addressing.subjects.index:pythia:dow": {"index:pythia:sp500": {**at, "native_id": "^GSPC"},
                                                          "index:pythia:dow": {**at, "native_id": "^GSPC"}}}
        for path, subjects in cases.items():
            with self.subTest(path=path):
                document = copy.deepcopy(INDEXES)
                document["addressing"]["subjects"] = subjects
                refused(self, document, path)
        coins = copy.deepcopy(INDEXES)
        coins["addressing"]["chain_codes"] = {"ethereum": "eip155:1"}
        self.assertEqual(identity.validate_manifest(coins).chain_codes, {"ethereum": "eip155:1"})
        coins["addressing"]["chain_codes"] = {"ethereum": "Ethereum"}
        refused(self, coins, "addressing.chain_codes.ethereum")

    def test_a_version_1_contract_is_still_read_and_declares_none_of_this(self):
        contract = identity.validate_manifest(YAHOO)
        self.assertEqual((contract.contract_version, contract.introduces, contract.subjects), (1, {}, {}))
        refused(self, {**POOLS, "contract_version": 1}, "introduces: needs contract_version 2")
        refused(self, {**INDEXES, "contract_version": 1}, "addressing.subjects: needs contract_version 2")

    def test_only_an_unambiguous_declaration_aliases_its_provisional_id(self):
        shipped = identity.validate_manifest(INDEXES)
        alias = {identity.provisional_id("index", "yahoo", "symbol", "^GSPC"): "index:pythia:sp500"}
        self.assertEqual(identity.declared.aliases([shipped]), alias)
        unsigned = identity.validate_manifest({**INDEXES, "signoff": {"status": "unsigned"}})
        self.assertEqual(identity.declared.aliases([unsigned]), alias)  # the declared sign-off changes nothing
        other = copy.deepcopy(INDEXES)
        other["addressing"]["subjects"] = {"index:pythia:dow-jones": {"native_scope": "symbol", "native_id": "^GSPC"}}
        self.assertEqual(identity.declared.aliases([shipped, identity.validate_manifest(other)]), {})


class ClaimShapeTest(unittest.TestCase):
    def batch(self, *claims):
        provenance = {**PROVENANCE, "plugin": "pools", "source": "pools"}
        return identity.batch_from_json({"plugin": "pools", "provider": "pools", "adapter_version": "1",
                                         "origin": "catalogue", "scope": "pools",
                                         "claims": [{**claim, "provenance": provenance} for claim in claims]})

    def test_a_market_record_is_keyed_by_the_plugins_own_reference(self):
        batch = self.batch({"level": "market", "identifiers": [], "native_ref": POOL, "attributes": {"name": "USDC"}})
        identity.check_batch(batch, identity.validate_manifest(POOLS))
        self.assertIs(batch.claims[0].level, identity.Kind.MARKET)
        for claim, error in (({"level": "market", "native_ref": POOL,
                               "identifiers": [{"scheme": "caip19", "value": SUI_USDC}]}, "only its own open identifier"),
                             ({"level": "widget", "identifiers": [], "native_ref": POOL}, "widget")):
            with self.subTest(error=error), self.assertRaisesRegex(identity.ClaimError, error):
                self.batch(claim)

    def test_a_relation_may_name_the_plugins_own_declared_references(self):
        batch = self.batch({"type": "part_of", "from_key": POOL, "to_key": PROTOCOL},
                           {"type": "market_asset", "from_key": POOL, "to_key": {"scheme": "caip19", "value": SUI_USDC}})
        identity.check_batch(batch, identity.validate_manifest(POOLS))
        self.assertEqual(identity.batch_from_json(identity.batch_to_json(batch)), batch)  # the wire form round-trips

    def test_a_foreign_or_undeclared_reference_or_the_wrong_kinds_are_refused(self):
        contract = identity.validate_manifest(POOLS)
        own = "names only its own declared native references"
        cases = [(own, {"type": "part_of", "from_key": {**POOL, "provider": "defillama"}, "to_key": PROTOCOL}),  # foreign
                 (own, {"type": "part_of", "from_key": {**POOL, "native_scope": "vault"}, "to_key": PROTOCOL}),  # undeclared
                 ("part_of cannot link", {"type": "part_of", "from_key": PROTOCOL, "to_key": POOL})]
        for reason, claim in cases:
            with self.subTest(claim=claim), self.assertRaisesRegex(identity.ClaimError, f"^claims\\[0\\]: .*{reason}"):
                identity.check_batch(self.batch(claim), contract)
        with self.assertRaisesRegex(identity.ClaimError, "market_asset cannot link a listing"):
            self.batch({"type": "market_asset", "from_key": {"scheme": "caip19", "value": SUI_USDC},
                        "to_key": {"scheme": "isin", "value": "NL0010273215"}})


def installed(**directories: Path) -> list[page.PluginInfo]:
    """`identity_ops.installed()` over a fake Hermes holding these plugin directories (keys: `_` for `-`)."""
    loaded = {key.replace("_", "-"): types.SimpleNamespace(manifest=types.SimpleNamespace(path=str(directory)))
              for key, directory in directories.items()}
    config = types.ModuleType("hermes_cli.config")
    config.load_config_readonly = dict
    with mock.patch.dict("sys.modules", {"hermes_cli": types.ModuleType("hermes_cli"), "hermes_cli.config": config}), \
            mock.patch.object(harness, "plugins", lambda: loaded), \
            mock.patch.object(access, "native_plugin_enabled", lambda *_: True), \
            mock.patch.object(identity_ops, "native_operations", lambda _keys: {}):
        return identity_ops.installed()


class DeclaredAddressTest(PluginCase):
    """A device whose reference package holds the curated crypto assets but no provider coin ids or aliases: the
    coin plugins' own contracts address them (package format 6)."""

    def setUp(self):
        super().setUp()
        path = self.root / "reference.sqlite3"
        with contextlib.closing(sqlite3.connect(path)) as db, db:
            db.executescript(identity.schema_sql("reference"))
            for name in ("asml.json", "crypto.json"):
                load_reference(db, load(name))
        reference_package.install(make_package(self.root / "package", source=path), self.root / "data")
        self.ops = identity_ops.Identity(types.SimpleNamespace(), data_dir=self.root / "data")
        self.addCleanup(lambda: self.ops.store.db.close())

    def read(self, plugins: list[page.PluginInfo], subject_id: str = BTC) -> dict | None:
        with mock.patch.object(identity_ops, "installed", lambda: plugins):
            return json.loads(self.ops.subject({"subject_id": subject_id}))["data"]

    def quote(self, plugins: list[page.PluginInfo], subject_id: str = BTC) -> dict:
        return next(section for section in self.read(plugins, subject_id)["sections"] if section["section"] == "quote")

    def test_a_renamed_byte_identical_copy_of_coingecko_serves_btc_identically(self):
        shipped, renamed = self.copy("pythia-coingecko", PLUGINS / "coingecko"), self.copy("coins", PLUGINS / "coingecko")
        [pythia], [copied] = installed(pythia_coingecko=shipped), installed(coins=renamed)
        self.assertEqual(json.dumps(self.read([copied])).replace('"coins"', '"pythia-coingecko"'),
                         json.dumps(self.read([pythia])))
        quote = self.quote([copied])
        self.assertEqual((quote["status"], quote["binding"], quote["binding_status"]),
                         ("ready", {"provider": "coingecko", "native_id": "bitcoin", "native_scope": "coin"}, "confirmed"))

    def test_a_saved_provisional_coin_id_still_resolves_through_a_contract(self):
        shipped = self.copy("pythia-coingecko", PLUGINS / "coingecko")
        [coingecko] = installed(pythia_coingecko=shipped)
        with contextlib.closing(sqlite3.connect(reference_package.current(self.root / "data"))) as ref:
            self.assertEqual(ref.execute("SELECT count(*) FROM id_aliases").fetchone()[0], 0)  # the package names none
        view = self.read([coingecko], SAVED_BTC)
        self.assertEqual((view["subject"]["id"], view["subject"]["name"]), (BTC, "Bitcoin"))
        with mock.patch.object(identity_ops, "installed", lambda: [coingecko]):
            self.assertEqual(self.ops.price_sources(SAVED_BTC)["refs"],
                             [{"provider": "coingecko", "native_id": "bitcoin", "native_scope": "coin"}])

    def test_a_row_saved_under_a_provisional_coin_id_follows_a_contract_on_the_releases_first_read(self):
        """Lifecycle A re-points stored rows through a contract's declared alias, as it did through the package's
        alias before the package stopped naming providers; with no plugin installed it moves nothing."""
        self.ops.store.put_binding(core.Binding(
            provider_ref={"provider": "coingecko", "native_id": "bitcoin", "native_scope": "coin"}, subject_id=SAVED_BTC,
            status="confirmed", authority="user_attested", evidence_ids=("ev:" + "0" * 64,), plugin="pythia-coingecko"))
        with mock.patch.object(identity_ops, "installed", list):
            self.ops.reference_path()
        self.assertEqual(len(self.ops.store.bindings([SAVED_BTC])), 1)
        shipped = self.copy("pythia-coingecko", PLUGINS / "coingecko")
        [coingecko] = installed(pythia_coingecko=shipped)
        with mock.patch.object(identity_ops, "installed", lambda: [coingecko]):
            self.ops.reference_path(again=True)  # rows written under an older ID, carried again
        self.assertEqual((self.ops.store.bindings([SAVED_BTC]), [row["provider"] for row in self.ops.store.bindings([BTC])]),
                         ([], ["coingecko"]))
        self.assertEqual(identity_ops.lifecycle.vanished(self.ops.store), [])

    def test_a_saved_provisional_market_id_resolves_through_a_contract(self):
        yahoo = self.copy("pythia-yahoo-discovery", PLUGINS / "yahoo-discovery")
        saved = identity.provisional_id("index", "yahoo", "symbol", "^GSPC")  # `^` is hashed into the ID
        self.assertTrue(saved.startswith("index:provisional:yahoo:symbol:sha256-"))
        self.assertIsNone(self.read([], saved))  # with no plugin installed, nothing aliases it
        [yahoo] = installed(pythia_yahoo_discovery=yahoo)
        self.assertEqual(self.read([yahoo], saved)["subject"]["id"], "index:pythia:sp500")

    def test_the_default_price_source_for_btc_is_unchanged(self):
        """CoinGecko first, then CoinMarketCap once its key is set: from their contracts, not the package."""
        plugins = {name.replace("-", "_"): self.copy(f"pythia-{name}", PLUGINS / name)
                   for name in ("coingecko", "coinmarketcap", "yahoo-discovery", "eodhd")}
        found = installed(**plugins)
        with mock.patch.object(identity_ops, "installed", lambda: found):
            refs = self.ops.price_sources(BTC)["refs"]
        self.assertEqual(refs, [{"provider": "coingecko", "native_id": "bitcoin", "native_scope": "coin"}])
        keyed = [page.PluginInfo(key=info.key, manifest=info.manifest) for info in found]  # every key configured
        with mock.patch.object(identity_ops, "installed", lambda: keyed):
            self.assertEqual(self.ops.price_sources(BTC)["refs"], [
                {"provider": "coingecko", "native_id": "bitcoin", "native_scope": "coin"},
                {"provider": "coinmarketcap", "native_id": "1", "native_scope": "coin"}])


class DelistedLineTest(unittest.TestCase):
    def test_a_declared_reference_never_addresses_a_delisted_line(self):
        """A delisted line's reference may name another company now (ADR 0037, ticker reuse), declared or not."""
        line = "listing:isin:NL0010273215:XAMS:EUR"
        contract = copy.deepcopy(INDEXES)
        contract["addressing"]["subjects"] = {line: {"native_scope": "symbol", "native_id": "ASML.AS"}}
        info = page.PluginInfo(key="pythia-yahoo", manifest=identity_ops.validate_manifest(contract))
        subject = {"ids": {identity_ops.Level.LISTING: line}, "values": {}, "asset_class": "equity",
                   "listing": {"ticker": "ASML", "mic": "XAMS", "operating_mic": "XAMS", "status": "active"}}
        self.assertEqual(page.derive(info, identity_ops.Level.LISTING, subject)[1], "declared_ref@1")
        subject["listing"]["status"] = "inactive"
        self.assertIsNone(page.derive(info, identity_ops.Level.LISTING, subject))


class MaintainedSubjectsTest(unittest.TestCase):
    """Core's maintained subject lists name no provider; the shipped plugins' contracts address them."""

    def setUp(self):
        self.contracts = {path.parent.name: page.PluginInfo(
            key=f"pythia-{path.parent.name}", manifest=identity_ops.validate_manifest(json.loads(path.read_text())),
            operations={"live_market": "pythia_hyperliquid_live_market"} if path.parent.name == "hyperliquid" else {})
            for path in sorted(PLUGINS.glob("*/contract.json"))}

    def test_every_maintained_market_keeps_its_reference_through_a_shipped_contract(self):
        table = markets.curated()
        for subject_id in table:
            with self.subTest(subject=subject_id):
                declaring = [name for name, info in self.contracts.items() if subject_id in info.manifest.subjects]
                self.assertEqual(len(declaring), 1, declaring)
                sections = page.compose(markets.load_market(table, subject_id), list(self.contracts.values()),
                                        stored=lambda *_: None, queue=[])
                served = [section for section in sections if section["status"] == "ready"]
                self.assertEqual({section["plugin"] for section in served}, {f"pythia-{declaring[0]}"})
        served = {subject_id: next(section for section in page.compose(
            markets.load_market(table, subject_id), list(self.contracts.values()), stored=lambda *_: None, queue=[])
            if section["status"] == "ready") for subject_id in ("index:pythia:sp500", "fx:pythia:EURUSD",
                                                                 "market:pythia:hyperliquid-btc-perp")}
        self.assertEqual({subject_id: (section["binding"]["provider"], section["binding"]["native_id"],
                                       section["binding_status"]) for subject_id, section in served.items()},
                         {"index:pythia:sp500": ("yahoo", "^GSPC", "confirmed"),
                          "fx:pythia:EURUSD": ("yahoo", "EURUSD=X", "confirmed"),
                          "market:pythia:hyperliquid-btc-perp": ("hyperliquid", "BTC", "confirmed")})

    def test_every_subject_a_shipped_contract_declares_is_a_maintained_subject(self):
        core = Path(page.__file__).parent
        assets = {f"security:caip19:{asset['caip19']}"
                  for asset in json.loads((core / "canonical_assets.json").read_text())["assets"]}
        for name, info in self.contracts.items():
            with self.subTest(plugin=name):
                self.assertLessEqual(set(info.manifest.subjects), set(markets.curated()) | assets)


if __name__ == "__main__":
    unittest.main()
