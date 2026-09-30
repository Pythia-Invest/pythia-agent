"""Plugin sources through core's ingest, as they emit (roadmap stage 0, S7 and S8): pages shaped as a DeFi source's,
the DeFiLlama plugin's own catalogue pages, OpenFIGI's lines for one ISIN, and `identity-sync` and `identity-lookup` as
the Desk invokes them. The helpers and the world are test_identity_ingest's.
"""
import json
import os
import sqlite3
import sys
import tempfile
import types
import unittest
import unittest.mock
from contextlib import closing
from pathlib import Path

from identity_world import World
from test_identity_contracts import PROVENANCE, identity, load_reference
from test_identity_ingest import (
    ETH, GSK, GSK_BEFORE, GSK_LINE, POOL_ID, SUI_USDC, USDC, IngestTest, record, relation, source,
)
from test_identity_queue import load_core
from test_reference_package import make_package
from pythia_identity_fixture import device, ingest, page, reference_package, search, store, trust  # noqa: E402


class DeFiPageTest(IngestTest):
    """Pages shaped as the DeFiLlama plugin emits them (stage0-defillama, `catalogue.page`): protocols by their native
    reference, pools `part_of` a protocol and `market_asset` of each token, and tokens named by CAIP-19 alone."""

    def pages(self, llama, name="USDC on Sui"):
        pool, protocol = {"provider": "llama", "native_scope": "ref", "native_id": POOL_ID}, \
            {"provider": "llama", "native_scope": "protocol", "native_id": "9001"}
        token = {"level": "listing", "identifiers": [{"scheme": "caip19", "value": SUI_USDC}],
                 "attributes": {"asset_class": "crypto", "name": name},
                 "provenance": {**PROVENANCE, "plugin": "llama", "source": "llama"}}
        ether = {**token, "identifiers": [{"scheme": "caip19", "value": ETH}], "attributes": {"asset_class": "crypto"}}
        protocols = [record(llama, "9001", scope="protocol", name="Example Lend")]
        pools = [record(llama, POOL_ID, name="Example Lend USDC", asset_class="crypto"), token, ether,
                 relation(llama, "part_of", pool, protocol),
                 *(relation(llama, "market_asset", pool, {"scheme": "caip19", "value": value}) for value in (SUI_USDC, ETH))]
        return protocols, pools

    def test_tokens_named_by_caip19_alone_are_kept_and_placed(self):
        world = self.fresh(("asml.json", "failures.json", "crypto.json"))
        llama = source("llama", level="market", display=True, scopes=("protocols", "pools"),
                       introduces={"market": ["native"], "protocol": ["native"], "listing": ["caip19"]},
                       native=({"native_scope": "protocol", "level": "protocol"},))
        protocols, pools = self.pages(llama)
        self.ingest(llama, *protocols, world=world, scope="protocols", complete=True)
        done = self.ingest(llama, *pools, world=world, scope="pools", complete=True)
        pool, token, ether = f"market:provisional:llama:ref:{POOL_ID}", f"listing:caip19:{SUI_USDC}", f"listing:caip19:{ETH}"
        self.assertEqual({key: done[key] for key in ("introduced", "joined", "unmatched", "not_seen")},
                         {"introduced": 2, "joined": 4, "unmatched": 0, "not_seen": 0})  # the relations joined too
        kept = world.identity.select("SELECT native_scope, subject_id, state FROM claims WHERE plugin = 'llama' AND"
                                     " native_scope = '#record' ORDER BY subject_id")
        self.assertEqual([tuple(row) for row in kept], [("#record", ether, "joined"), ("#record", token, "introduced")])
        related = {(item["id"], item["type"], item["source"]) for item in world.subject(pool)["view"]["related"]}
        self.assertEqual(related, {("protocol:provisional:llama:protocol:9001", "part_of", "llama"),
                                   (token, "market_asset", "llama"), (ether, "market_asset", "llama")})
        self.assertEqual(world.subject(ether)["view"]["contributors"][0]["stated"], [{"scheme": "caip19", "value": ETH}])
        # The same pages again write nothing, and a renamed token keeps its row.
        before = world.identity.db.total_changes
        self.ingest(llama, *pools, world=world, scope="pools", complete=True)
        self.assertEqual(world.identity.db.total_changes, before)
        self.ingest(llama, *self.pages(llama, name="Native USDC")[1], world=world, scope="pools", complete=True)
        self.assertEqual(len(world.identity.select("SELECT 1 FROM claims WHERE native_scope = '#record'")), 2)
        self.assertEqual(device.subject_row(world.identity, token)["name"], "Native USDC")


class DeFiLlamaPluginTest(IngestTest):
    """The DeFiLlama plugin's own pages (its `catalogue.page`, on test_defillama_catalogue's synthetic directories),
    protocols then pools as `identity-sync` reads them: its Sui coin types, named by CAIP-19 alone, join the curated
    SUI and native USDC deployments or are introduced, and its pools link to them."""

    def test_its_pages_join_the_curated_sui_and_usdc_deployments_and_introduce_the_rest(self):
        from test_defillama_catalogue import BRIDGED_USDC, reader, uuid
        from test_plugin_contracts import PLUGINS
        sui, usdc = "security:caip19:sui:mainnet/slip44:784", f"security:caip19:{USDC}"
        sui_line, usdc_line = "listing:caip19:sui:mainnet/slip44:784", f"listing:caip19:{SUI_USDC}"
        with closing(sqlite3.connect(self.world.path)) as db, db:  # core's curated SUI and USDC on Sui, as built
            load_reference(db, {
                "securities": [{"id": sui, "name": "Sui", "asset_class": "crypto", "kind": "coin"},
                               {"id": usdc, "name": "USD Coin", "asset_class": "crypto", "kind": "token"}],
                "listings": [{"id": sui_line, "security_id": sui, "chain": "sui:mainnet"},
                             {"id": usdc_line, "security_id": usdc, "chain": "sui:mainnet"}],
                "assertions": [{"subject_id": line, "scheme": "caip19", "value": line.split(":", 2)[2],
                                "authority": "source_asserted", "provenance": {**PROVENANCE, "source": "curated"}}
                               for line in (sui_line, usdc_line)]})
        llama = page.PluginInfo(key="pythia-defillama", manifest=identity.validate_manifest(
            json.loads((PLUGINS / "defillama" / "contract.json").read_text())))
        self.world.plugins = [llama]
        read, _transport = reader()
        totals = dict.fromkeys(("introduced", "joined", "unmatched", "conflicts", "rejected"), 0)
        for scope in llama.manifest.catalogue_scopes:  # the contract's order: protocols before the pools naming them
            cursor = None
            while True:
                body = read.invoke("catalogue", {"scope": scope, **({"cursor": cursor} if cursor else {})})
                done = ingest.ingest(self.world.identity, self.world.ref, llama, identity.batch_from_json(body["data"]),
                                     plugins=self.world.plugins)
                totals = {name: totals[name] + done[name] for name in totals}
                cursor = body["next_cursor"]
                if cursor is None:
                    break
        self.assertEqual((totals["unmatched"], totals["conflicts"], totals["rejected"]), (0, 0, 0))
        tokens = dict(tuple(row) for row in self.world.identity.select(
            "SELECT subject_id, state FROM claims WHERE native_scope = '#record'"))
        bridged = identity.subject_id("listing", {"caip19": f"sui:mainnet/coin:{BRIDGED_USDC}"})
        self.assertEqual(tokens, {sui_line: "joined", usdc_line: "joined", bridged: "introduced"})

        def assets(seed):
            related = self.world.subject(f"market:provisional:defillama:pool:{uuid(seed)}")["view"]["related"]
            return {(item["type"], item["id"]) for item in related}
        self.assertIn(("market_asset", sui_line), assets(1))
        self.assertEqual({item for item in assets(2) if item[0] == "market_asset"}, {("market_asset", usdc_line)})
        self.assertEqual({item for item in assets(3) if item[0] == "market_asset"}, {("market_asset", bridged)})
        self.assertEqual([kind for kind, _id in assets(1) if kind == "part_of"], ["part_of"])
        self.assertNoQuestions()


TOYOTA, TOYOTA_ISIN = "security:isin:JP3633400001", "JP3633400001"


class OpenFigiTest(IngestTest):
    """Roadmap stage 0's overlapping financial source (S7): the OpenFIGI plugin's answer for one ISIN (its
    `mapping.claims`, on synthetic mapping candidates) carries FIGIs and exchange codes, never a currency. Lines the
    build holds join, a line on an exchange it lacks is introduced under the security, and a line that could only be a
    second one on an exchange stays unmatched."""

    def setUp(self):
        super().setUp()
        from test_openfigi_connector import mapping
        from test_plugin_contracts import PLUGINS
        self.mapping = mapping
        self.world = self.fresh(("toyota.json",))
        self.openfigi = page.PluginInfo(key="pythia-openfigi", manifest=identity.validate_manifest(
            json.loads((PLUGINS / "openfigi" / "contract.json").read_text())))
        self.world.plugins = [self.openfigi]

    def answer(self, *lines, world=None):
        """What core does with the plugin's answer for Toyota's ISIN: each line (FIGI, exchange code, ticker,
        share-class FIGI) as OpenFIGI's mapping gives a candidate."""
        world = world or self.world
        candidates = [{"figi": figi, "compositeFIGI": None, "shareClassFIGI": share_class, "ticker": ticker,
                       "exchCode": code, "name": "TOYOTA MOTOR CORP", "securityType": "Common Stock",
                       "securityType2": "Common Stock", "marketSector": "Equity", "securityDescription": ticker}
                      for figi, code, ticker, share_class in ((*line, "BBG000TYSCF0")[:4] for line in lines)]
        batch = self.mapping.claims(TOYOTA_ISIN, candidates, "2026-09-30T10:00:00Z", self.openfigi.manifest.venue_codes)
        return ingest.ingest(world.identity, world.ref, self.openfigi, identity.batch_from_json(batch),
                             plugins=world.plugins)

    def line(self, venue, currency="EUR"):
        return f"listing:isin:{TOYOTA_ISIN}:{venue}:{currency}"

    def test_the_german_lines_join_the_builds_the_ticker_less_frankfurt_line_by_its_exchange(self):
        lines = {"BBG000TYTKY0": ("JT", "7203"), "BBG000TYXTR4": ("GY", "TOM"), "BBG000TYFRN2": ("GF", "TOM"),
                 "BBG000TYHNV0": ("GI", "TOM"),  # two Hanover lines: which one?
                 "BBG000TYMNX2": ("GM", None),  # Munich's line has another FIGI
                 "BBG000TYHNX8": ("XX", None)}  # an exchange code the contract maps to no venue
        done = self.answer(*((figi, code, ticker) for figi, (code, ticker) in lines.items()))
        self.assertEqual({figi: self.placed(self.openfigi, figi) for figi in lines},
                         {"BBG000TYTKY0": (self.line("XJPX", "JPY"), "joined"),
                          "BBG000TYXTR4": (self.line("XETR"), "joined"), "BBG000TYFRN2": (self.line("XFRA"), "joined"),
                          "BBG000TYHNV0": (None, "unmatched"), "BBG000TYMNX2": (None, "unmatched"),
                          "BBG000TYHNX8": (None, "unmatched")})
        self.assertEqual(done["introduced"], 0)  # never a second line on an exchange, nor a line nowhere
        self.assertEqual(self.world.identity.select("SELECT id FROM subjects"), [])
        # The Frankfurt line FIRDS gave no ticker gains OpenFIGI's FIGI and ticker, so search can find it by them.
        frankfurt = self.world.subject(self.line("XFRA"))
        self.assertEqual((frankfurt["values"]["figi"], frankfurt["values"]["ticker_mic"]), ("BBG000TYFRN2", "TOM@XFRA"))
        self.assertEqual(frankfurt["view"]["contributors"][0]["plugin"], "pythia-openfigi")
        self.assertNoQuestions()

    def test_an_answer_with_two_lines_on_one_exchange_or_another_ticker_there_joins_no_line(self):
        # Two Frankfurt lines in the answer (say USD and EUR) and one in the build: which one is it? Neither joins.
        self.answer(("BBG000TYFRN2", "GF", "TOMUSD"), ("BBG000TYHNX8", "GF", "TOM"))
        self.assertEqual((self.placed(self.openfigi, "BBG000TYFRN2"), self.placed(self.openfigi, "BBG000TYHNX8")),
                         ((None, "unmatched"), (None, "unmatched")))
        self.assertNotIn("figi", self.world.subject(self.line("XFRA"))["values"])
        # Stuttgart's line states its ticker: a line under another ticker is not it; one under the same ticker is.
        self.answer(("BBG000TYSWX6", "GS", "TYO"))
        self.assertEqual(self.placed(self.openfigi, "BBG000TYSWX6"), (None, "unmatched"))
        self.answer(("BBG000TYSWX6", "GS", "TOM"))
        self.assertEqual(self.placed(self.openfigi, "BBG000TYSWX6"), (self.line("XSTU"), "joined"))

    def test_a_display_plugins_line_on_the_exchange_never_blocks_the_join(self):
        community = source("community", introduces={"listing": ["isin", "figi"]}, display=True)
        self.world.plugins = [self.openfigi, community]
        self.ingest(community, record(community, "TOM.F", ("isin", TOYOTA_ISIN), ("figi", "BBG000TYHNX8"),
                                      operating_mic="XFRA", currency="USD"))
        self.assertEqual(device.subject_row(self.world.identity, self.line("XFRA", "USD"))["parent_id"], TOYOTA)
        self.answer(("BBG000TYFRN2", "GF", "TOM"))
        self.assertEqual(self.placed(self.openfigi, "BBG000TYFRN2"), (self.line("XFRA"), "joined"))

    def test_a_confirm_level_line_record_gives_the_parent_whoever_introduced_the_line(self):
        # A display plugin's London line with no security, and OpenFIGI's, in either order: the line sits under Toyota.
        london = "listing:figi:BBG000TYLND5"
        community = source("community", introduces={"listing": ["figi"]}, display=True)
        outcomes = []
        for community_first in (True, False):
            world = self.world = self.fresh(("toyota.json",))
            world.plugins = [self.openfigi, community]
            steps = [lambda: self.ingest(community, record(community, "L", ("figi", "BBG000TYLND5"),
                                                           operating_mic="XLON", currency="GBP"), world=world),
                     lambda: self.answer(("BBG000TYLND5", "LN", "TYT"))]
            for step in steps if community_first else steps[::-1]:
                step()
            outcomes.append((device.subject_row(world.identity, london)["parent_id"], sorted(
                tuple(row) for row in world.identity.select("SELECT subject_id, scheme, value FROM device_assertions"))))
        self.assertEqual(outcomes[0], outcomes[1])
        self.assertEqual(outcomes[0][0], TOYOTA)

    def test_a_display_line_under_another_security_never_carries_toyotas_identifiers_there(self):
        # A display plugin puts the London line under ASML; OpenFIGI answers it for Toyota. In either order the line
        # sits under Toyota, ASML's security takes none of Toyota's values and asks nothing, and a later Frankfurt
        # answer still joins the build's one Frankfurt line.
        asml, london = "security:isin:NL0010273215", "listing:figi:BBG000TYLND5"
        community = source("community", introduces={"listing": ["figi"]}, display=True)
        outcomes = []
        for community_first in (True, False):
            world = self.world = self.fresh(("toyota.json", "asml.json"))
            world.plugins = [self.openfigi, community]
            steps = [lambda: self.ingest(community, record(community, "L", ("figi", "BBG000TYLND5"),
                                                           ("isin", "NL0010273215"), operating_mic="XLON"), world=world),
                     lambda: self.answer(("BBG000TYLND5", "LN", "TYT"))]
            for step in steps if community_first else steps[::-1]:
                step()
            on_asml = world.identity.select("SELECT scheme, value, plugin FROM device_assertions WHERE subject_id = ?",
                                            (asml,))
            self.assertEqual(([tuple(row) for row in on_asml], world.touch(asml), world.identity.queue_items()),
                             ([("isin", "NL0010273215", "community")], 0, []))
            self.assertEqual(world.subject(asml)["view"]["identifiers"]["isin"], "NL0010273215")
            self.answer(("BBG000TYFRN2", "GF", "TOM"))
            self.assertEqual(self.placed(self.openfigi, "BBG000TYFRN2", world), (self.line("XFRA"), "joined"))
            outcomes.append(device.subject_row(world.identity, london)["parent_id"])
        self.assertEqual(outcomes, [TOYOTA, TOYOTA])

    def test_a_line_with_no_currency_whose_isin_names_two_securities_is_no_line_core_adds(self):
        # A confirm-level source states Toyota's ISIN for another security too: which security's Frankfurt line is it?
        world = self.world = self.fresh(("toyota.json", "asml.json"))
        vendor = source("vendor", level="security")
        world.plugins = [self.openfigi, vendor]
        device.put_assertion(world.identity, "security:isin:NL0010273215", "isin", TOYOTA_ISIN, plugin="vendor",
                             ref=identity.ProviderRef("vendor", "ASML", "ref"))
        done = self.answer(("BBG000TYFRN2", "GF", "TOM"))
        self.assertEqual((self.placed(self.openfigi, "BBG000TYFRN2"), done["introduced"]), ((None, "unmatched"), 0))
        self.assertEqual(world.identity.select("SELECT id FROM subjects"), [])

    def test_a_line_on_an_exchange_the_build_lacks_sits_under_the_security_until_a_release_holds_it(self):
        london = "listing:figi:BBG000TYLND5"
        self.answer(("BBG000TYLND5", "LN", "TYT"))
        self.assertEqual(self.placed(self.openfigi, "BBG000TYLND5"), (london, "introduced"))
        self.assertEqual(device.subject_row(self.world.identity, london)["parent_id"], TOYOTA)
        ref = identity.ProviderRef("openfigi", "BBG000TYLND5", "figi")
        self.assertEqual(self.world.identity.bound_subject(ref), london)
        # A later release holds the London line under its own key and states its FIGI: the device ID aliases to it.
        path = self.world.release("with-london")
        held = self.line("XLON", "GBP")
        with closing(sqlite3.connect(path)) as db, db:
            load_reference(db, {"securities": [], "listings": [{"id": held, "security_id": TOYOTA, "mic": "XLON",
                                                                "operating_mic": "XLON", "currency": "GBP",
                                                                "ticker": "TYT"}],
                                "assertions": [{"subject_id": held, "scheme": "figi", "value": "BBG000TYLND5",
                                                "authority": "source_asserted", "provenance": {
                                                    **PROVENANCE, "source": "fixture", "source_record": "firds"}}]})
        self.world.ref.close()
        self.world.ref = store.open_reference(path, "confirm")
        self.world.rekey(path)
        self.assertEqual((device.current_id(self.world.ref, self.world.identity, london),
                          self.world.identity.bound_subject(ref), self.world.subject(london)["id"]), (held, held, held))
        lines = [line["id"] for line in search.Directory(self.world.ref).instrument_listings(TOYOTA)
                 if line["mic"] == "XLON"]
        self.assertEqual(lines, [held])  # one row
        tables = ("subjects", "claims", "device_assertions", "bindings")
        before = [self.world.identity.select(f"SELECT * FROM {table}") for table in tables]
        again = self.answer(("BBG000TYLND5", "LN", "TYT"))  # the same answer again: placed on the held line
        self.assertEqual(again["subjects"], [held])
        self.assertEqual([self.world.identity.select(f"SELECT * FROM {table}") for table in tables], before)

    def test_a_differing_share_class_figi_stays_an_unresolved_conflict(self):
        other = "BBG000TYSCX0"
        self.answer(("BBG000TYXTR4", "GY", "TOM", other), ("BBG000TYSWX6", "SE", "TOM", other))
        self.assertEqual(self.placed(self.openfigi, "BBG000TYXTR4"), (self.line("XETR"), "conflict"))
        self.assertEqual(self.world.subject(self.line("XETR"))["ids"][identity.Level.SECURITY], TOYOTA)
        # A new line whose security the evidence contests is introduced without one, never under Toyota.
        self.assertEqual(self.placed(self.openfigi, "BBG000TYSWX6"), ("listing:figi:BBG000TYSWX6", "conflict"))
        self.assertIsNone(device.subject_row(self.world.identity, "listing:figi:BBG000TYSWX6")["parent_id"])
        self.assertNoQuestions()
        self.assertEqual((self.world.touch(self.line("XETR")), self.world.touch(TOYOTA)), (1, 0))
        [asked] = self.world.identity.queue_items()
        self.assertEqual((asked["reason"], asked["scheme"], asked["subject_ids"]), ("identifier", "share_class_figi",
                                                                                    [TOYOTA]))


class OperationFixture(unittest.TestCase):
    """Core loaded with an installed confirm-level package, fixture plugins and a stand-in for Hermes's tool registry."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        (root / "world").mkdir()
        world = World(root / "world", ("asml.json", "failures.json", "crypto.json"))
        world.close()
        self.enterContext(unittest.mock.patch.dict(os.environ, {"PYTHIA_CONFIG_ROOT": str(root / "config")}))
        load_core()
        from pythia_core_queue_fixture import identity_ops, ingest_ops, queue_ops
        from pythia_core_queue_fixture.identity import page as core_page, validate_manifest
        self.ingest_ops, self.queue_ops, self.core_page, self.validate = ingest_ops, queue_ops, core_page, validate_manifest
        reference_package.install(make_package(root / "package", source=world.path), root / "core", trust.CONFIRM)
        self.plugins, self.calls, self.answers = [], [], {}
        self.enterContext(unittest.mock.patch.object(identity_ops, "installed", lambda: self.plugins))
        registry = types.SimpleNamespace(dispatch=self.dispatch)
        self.enterContext(unittest.mock.patch.dict(sys.modules, {"tools": types.ModuleType("tools"),
                                                                 "tools.registry": types.SimpleNamespace(registry=registry)}))
        self.ops = identity_ops.Identity(types.SimpleNamespace(), data_dir=root / "core")
        self.addCleanup(lambda: self.ops.store.db.close())

    def dispatch(self, tool, arguments):
        self.calls.append((tool, json.loads(json.dumps(arguments))))
        return json.dumps(self.answers[tool](arguments))

    def plugin(self, name, contract):
        info = self.core_page.PluginInfo(key=f"pythia-{name}", manifest=self.validate(contract),
                                         operations={"catalogue": f"{name}_catalogue", "resolve": f"{name}_resolve"})
        self.plugins.append(info)
        return info

    @staticmethod
    def batch(name, claims, scope=None, complete=False):
        return {"plugin": name, "provider": name, "adapter_version": PROVENANCE["adapter_version"],
                "origin": "catalogue" if scope else "resolve", "scope": scope, "complete": complete, "claims": claims}


class OperationTest(OperationFixture):
    """identity-sync and identity-lookup as the Desk invokes them: core dispatches the plugin's own operation and ingests
    what it answers; a conflict it finds is asked about once the subject is read."""

    def test_sync_reads_every_scope_in_the_contracts_order_page_by_page(self):
        llama = source("llama", level="market", scopes=("protocols", "pools"),
                       introduces={"market": ["native"], "protocol": ["native"]},
                       native=({"native_scope": "protocol", "level": "protocol"},))
        info = self.plugin("llama", {**_contract(llama), "signoff": {"status": "unsigned"}})
        protocol = {"provider": "llama", "native_scope": "protocol", "native_id": "9001"}
        pages = {("protocols", None): ([record(llama, "9001", scope="protocol", name="Example Lend")], None),
                 ("pools", None): ([record(llama, POOL_ID, name="Example Lend USDC")], "1"),
                 ("pools", "1"): ([relation(llama, "part_of", {"provider": "llama", "native_scope": "ref",
                                                               "native_id": POOL_ID}, protocol)], None)}
        self.answers["llama_catalogue"] = lambda arguments: {
            "data": self.batch("llama", pages[(arguments["scope"], arguments.get("cursor"))][0], arguments["scope"],
                               complete=pages[(arguments["scope"], arguments.get("cursor"))][1] is None),
            "next_cursor": pages[(arguments["scope"], arguments.get("cursor"))][1]}
        body = json.loads(self.ingest_ops.sync(self.ops, {"plugin": info.key}))
        self.assertEqual([arguments for _tool, arguments in self.calls],
                         [{"scope": "protocols"}, {"scope": "pools"}, {"scope": "pools", "cursor": "1"}])
        self.assertEqual({key: body["data"][key] for key in ("introduced", "joined", "unmatched", "pages", "partial")},
                         {"introduced": 2, "joined": 1, "unmatched": 0, "pages": 3, "partial": False})
        self.assertEqual(json.loads(self.ingest_ops.sync(self.ops, {"plugin": "nobody"}))["issues"][0]["message"],
                         "Unknown plugin.")

    def test_a_lookup_ingests_the_answer_and_its_conflict_is_asked_once_the_subject_is_read(self):
        info = self.plugin("vendor", {**_contract(source("vendor")),
                                      "resolve": {"operation": "resolve", "input_schemes": ["isin"], "echoes": []}})
        self.answers["vendor_resolve"] = lambda _arguments: {"data": self.batch("vendor", [record(
            source("vendor"), "GSK.L", ("figi", "BBG000CT5GJ1"), ("isin", "GB0009252882"))])}
        body = json.loads(self.ingest_ops.lookup(self.ops, {"plugin": info.key, "query": " gb00bn7swp63 "}))
        self.assertEqual(self.calls, [("vendor_resolve", {"identifiers": {"isin": "GB00BN7SWP63"}})])
        self.assertEqual((body["data"]["conflicts"], body["data"]["subjects"]), (1, [GSK_LINE]))
        self.assertEqual(self.ops.store.queue_items(), [])  # ingest asks nothing
        for _read in range(2):
            json.loads(self.queue_ops.read_subject(self.ops, {"subject_id": GSK_LINE}))
        [asked] = self.ops.store.queue_items()
        self.assertEqual((asked["reason"], asked["candidate_ids"]), ("identifier", [GSK_BEFORE, GSK]))
        refused = json.loads(self.ingest_ops.lookup(self.ops, {"plugin": info.key, "query": "Glaxo"}))
        self.assertEqual(refused["issues"][0]["message"], "vendor cannot look up Glaxo.")
        self.answers["vendor_resolve"] = lambda _arguments: {"data": None}  # no match is an answer, not a failure
        none = json.loads(self.ingest_ops.lookup(self.ops, {"plugin": info.key, "query": "GB00BN7SWP63"}))
        self.assertEqual((none["outcome"], none["data"]["subjects"], none["issues"][0]["code"]), ("empty", [], "empty"))


class OperationFailureTest(OperationFixture):
    """A source's failure is a failure: sync stops `partial` with the reason, lookup says it failed, never "no match";
    and sync stops `partial` at its page and time bounds."""

    ERROR = {"schema_version": 1, "outcome": "error", "data": None,
             "issues": [{"code": "unavailable", "message": "The source failed."}]}

    def lines(self):
        contract = {**_contract(source("lines", introduces={"listing": ["figi"]})),
                    "resolve": {"operation": "resolve", "input_schemes": ["isin"], "echoes": []}}
        return self.plugin("lines", contract), source("lines", introduces={"listing": ["figi"]})

    def page(self, fixture, index):
        claims = [record(fixture, f"L{index}", ("figi", "BBG000BLNXT1"), operating_mic="XETR", currency="EUR")]
        return {"data": self.batch("lines", claims, "all"), "next_cursor": str(index + 1)}

    def test_a_failing_page_stops_sync_partial_and_a_failing_lookup_is_no_no_match(self):
        info, fixture = self.lines()
        self.answers["lines_catalogue"] = lambda arguments: self.page(fixture, 0) if "cursor" not in arguments \
            else self.ERROR
        body = json.loads(self.ingest_ops.sync(self.ops, {"plugin": info.key}))
        self.assertEqual((body["data"]["pages"], body["data"]["partial"], body["data"]["introduced"]), (1, True, 1))
        self.assertEqual((body["issues"][0]["code"], body["issues"][0]["message"]),
                         ("unavailable", "lines's catalogue stopped: the source reported an error"))
        self.answers["lines_resolve"] = lambda _arguments: self.ERROR
        body = json.loads(self.ingest_ops.lookup(self.ops, {"plugin": info.key, "query": "GB00BN7SWP63"}))
        self.assertEqual(body["issues"][0]["message"], "lines lookup failed: the source reported an error")

    def test_sync_stops_partial_at_its_page_and_time_bounds(self):
        info, fixture = self.lines()
        self.answers["lines_catalogue"] = lambda arguments: self.page(fixture, int(arguments.get("cursor") or 0))
        for bound, value, pages in (("SYNC_PAGES", 3, 3), ("SYNC_SECONDS", 0.0, 0)):
            with self.subTest(bound=bound), unittest.mock.patch.object(self.ingest_ops, bound, value):
                body = json.loads(self.ingest_ops.sync(self.ops, {"plugin": info.key}))
                self.assertEqual((body["data"]["pages"], body["data"]["partial"]), (pages, True))


def _contract(info):
    """The contract a fixture plugin was built from, for core's own validator."""
    manifest = info.manifest
    return {"contract_version": 2, "plugin": manifest.plugin, "provider": manifest.provider,
            "addressing": {"native": [{"native_scope": scope.native_scope, "level": str(scope.level)}
                                      for scope in manifest.native]},
            "catalogue": {"mode": "bulk", "operation": "catalogue", "scopes": list(manifest.catalogue_scopes)},
            **({"introduces": {str(kind): list(tags) for kind, tags in manifest.introduces.items()}}
               if manifest.introduces else {}),
            "rights": {"licence": "personal", "cache": "none", "hostable": False},
            "signoff": {"status": "grandfathered"}}



if __name__ == "__main__":
    unittest.main()
