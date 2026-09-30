"""Roadmap stage 0's acceptance (ADR 0044 A1 and A3): an ordinary plugin adds subjects, contributes evidence about
existing ones, and keeps saved references working through disabling, re-enabling and updates, shown with an
overlapping financial source and a DeFi source. Disabling one shows its effect first (`identity-plugin-effect`).

Both sources are fixture plugins core never names: a contract.json in a plugin directory, found through a stand-in
for Hermes's plugin table by core's own `installed()`, and read through `identity-sync` into core's ingest. They
stand on equal terms whatever sign-off their contracts declare: the financial source (Meridian) is grandfathered, the
DeFi source (Tidepool) unsigned (ADR 0044, amendment of 2026-09-30). An update is what a plugin emits on its next sync,
from a new plugin version or new provider data alike.
"""
import json
import os
import sys
import tempfile
import types
import unittest
import unittest.mock as mock
from pathlib import Path

from identity_world import World
from test_identity_contracts import PROVENANCE
from test_identity_queue import CORE, load_core
from test_reference_package import make_package
from pythia_identity_fixture import reference_package  # noqa: E402

NOW = "2026-09-30T08:00:00Z"
ASML_LINE = "listing:isin:NL0010273215:XAMS:EUR"
SAP_ISIN, SAP_FIGI, OTHER_FIGI = "DE0007164600", "BBG000BLNXT1", "BBG000BLNQ16"
SAP_BY_FIGI, SAP_BY_ISIN, SAP = f"listing:figi:{SAP_FIGI}", f"listing:isin:{SAP_ISIN}:XETR:EUR", f"security:isin:{SAP_ISIN}"
APPLE_LINE, APPLE = "listing:cgs_isin:US0378331005:XNAS:USD", "security:cgs_isin:US0378331005"
POOL_ID = "00000002-0000-4000-8000-000000000000"
POOL, PROTOCOL = f"market:provisional:tidepool:pool:{POOL_ID}", "protocol:provisional:tidepool:protocol:example-lend"
USDC = "sui:mainnet/coin:0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC"
WUSDC = "sui:mainnet/coin:0x" + "ab" * 32 + "::coin::COIN"  # a bridged coin type the source also calls USDC
TOKENS = {"listing:caip19:sui:mainnet/coin:0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7"
          "%3A%3Ausdc%3A%3AUSDC", "listing:caip19:sui:mainnet/coin:0x" + "ab" * 32 + "%3A%3Acoin%3A%3ACOIN"}
RIGHTS = {"licence": "personal", "cache": "none", "hostable": False}
MERIDIAN = {"contract_version": 2, "plugin": "meridian", "provider": "meridian",
            "addressing": {"native": [{"native_scope": "line", "level": "listing"}]},
            "concepts": {"market_data": {"level": "listing", "via": "listing", "operations": {"quote": "latest"}}},
            "catalogue": {"mode": "bulk", "operation": "catalogue", "scopes": ["lines"]},
            "introduces": {"listing": ["isin", "figi", "cgs_isin"], "security": ["isin", "cgs_isin"]},
            "rights": RIGHTS, "signoff": {"status": "grandfathered"}}
TIDEPOOL = {"contract_version": 2, "plugin": "tidepool", "provider": "tidepool",
            "addressing": {"native": [{"native_scope": "pool", "level": "market"},
                                      {"native_scope": "protocol", "level": "protocol"}]},
            "catalogue": {"mode": "bulk", "operation": "catalogue", "scopes": ["protocols", "pools"]},
            "introduces": {"market": ["native"], "protocol": ["native"], "listing": ["caip19"]},
            "rights": RIGHTS, "signoff": {"status": "unsigned"}}
TABLES = ("claims", "subjects", "device_assertions", "device_aliases", "bindings", "relations", "queue")


def record(provider, scope, native_id, level, *identifiers, **attributes):
    return {"level": level, "attributes": attributes, "identifiers": [
        dict(zip(("scheme", "value", "role"), item)) for item in identifiers],
        "provenance": {**PROVENANCE, "plugin": provider, "source": provider},
        "native_ref": {"provider": provider, "native_scope": scope, "native_id": native_id}}


def line(native_id, *identifiers, mic="XETR", currency="EUR", provider="meridian", **attributes):
    return record(provider, "line", native_id, "listing", *identifiers, operating_mic=mic, currency=currency,
                  **attributes)


def pool(name="Example Lend USDC"):
    return record("tidepool", "pool", POOL_ID, "market", name=name, asset_class="crypto")


def pools(*records):
    """A pools page: the pool records, each Sui coin type named by CAIP-19 alone, and how they relate."""
    provenance = {**PROVENANCE, "plugin": "tidepool", "source": "tidepool"}
    tokens = [{"level": "listing", "identifiers": [{"scheme": "caip19", "value": value}], "provenance": provenance,
               "attributes": {"asset_class": "crypto", "name": name}} for value, name in ((USDC, "USDC"),
                                                                                        (WUSDC, "Wormhole USDC"))]
    ends = {"provider": "tidepool", "native_scope": "pool", "native_id": POOL_ID}
    links = [{"type": "part_of", "from_key": ends, "to_key": {"provider": "tidepool", "native_scope": "protocol",
                                                                "native_id": "example-lend"}, "provenance": provenance},
             *({"type": "market_asset", "from_key": ends, "to_key": {"scheme": "caip19", "value": value},
                "provenance": provenance} for value in (USDC, WUSDC))]
    return [*records, *tokens, *(links if records else [])]


class PeersFixture(unittest.TestCase):
    """Core on a device with a reference package, fixture plugins in plugin directories, the investor's
    settings.json, and stand-ins for Hermes's plugin table, enablement and tool registry."""

    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.config = self.root / "config"
        self.config.mkdir(mode=0o700)
        self.enterContext(mock.patch.dict(os.environ, {"PYTHIA_CONFIG_ROOT": str(self.config)}))
        load_core()
        from pythia_core_queue_fixture import identity_ops, ingest_ops, markets_ops, plugin_effect, queue_ops
        from pythia_core_queue_fixture.identity import ingest
        from pythia_core_queue_fixture.platform import access, harness
        self.identity_ops, self.ingest_ops, self.markets_ops = identity_ops, ingest_ops, markets_ops
        self.plugin_effect, self.queue_ops = plugin_effect, queue_ops
        self.enterContext(mock.patch.object(ingest, "stamp", lambda: NOW))
        config = types.ModuleType("hermes_cli.config")
        config.load_config_readonly = dict
        registry = types.SimpleNamespace(dispatch=self.dispatch)
        self.enterContext(mock.patch.dict(sys.modules, {
            "hermes_cli": types.ModuleType("hermes_cli"), "hermes_cli.config": config, "tools": types.ModuleType("tools"),
            "tools.registry": types.SimpleNamespace(registry=registry)}))
        self.enterContext(mock.patch.object(harness, "plugins", lambda: {
            key: types.SimpleNamespace(manifest=types.SimpleNamespace(path=str(path))) for key, path in self.dirs.items()}))
        self.enterContext(mock.patch.object(access, "native_plugin_enabled", lambda key, *_: key not in self.disabled))
        self.enterContext(mock.patch.object(identity_ops, "native_operations", lambda keys: {
            key: {operation: f"{key}.{operation}" for operation in ("catalogue", "latest", "resolve")} for key in keys}))
        self.device("device")

    def device(self, name):
        """A fresh device: its own store, the reference package installed, and no plugins yet."""
        self.dirs, self.disabled, self.pages, self.calls, self.syncs = {}, set(), {}, [], 0
        folder = self.root / name
        (folder / "world").mkdir(parents=True)
        World(folder / "world", ("asml.json", "failures.json", "crypto.json")).close()
        reference_package.install(make_package(folder / "package", source=folder / "world" / "reference-20260926.sqlite3"),
                                  folder / "core")
        self.ops = self.identity_ops.Identity(
            types.SimpleNamespace(manifest=types.SimpleNamespace(path=str(CORE.parent))), data_dir=folder / "core")
        self.addCleanup(lambda ops=self.ops: ops.store.db.close())

    def install(self, key, contract):
        """A plugin payload in its own directory, as Hermes finds it."""
        directory = self.root / "plugins" / f"{len(self.dirs)}-{key}"
        directory.mkdir(parents=True)
        (directory / "contract.json").write_text(json.dumps(contract, indent=2), encoding="utf-8")
        (directory / "definition.py").write_text("OPERATIONS = ('catalogue', 'latest')\n", encoding="utf-8")
        self.dirs[key] = directory
        return directory

    def save(self, *watchlist):
        path = self.config / "settings.json"
        path.write_text(json.dumps({"schema_version": 1, "markets_watchlist": " ".join(watchlist)}), encoding="utf-8")
        path.chmod(0o600)

    def dispatch(self, tool, arguments):
        """The provider behind each plugin: one complete page per catalogue scope, from `self.pages`, each sync a new
        retrieval (`retrieved_at`), as a real one is, so every record is placed again."""
        self.calls.append((tool, arguments))
        key, _operation = tool.rsplit(".", 1)
        contract = json.loads((self.dirs[key] / "contract.json").read_text(encoding="utf-8"))
        claims = [{**claim, "provenance": {**claim["provenance"], "retrieved_at": f"2026-09-30T08:{self.syncs:02d}:00Z"}}
                  for claim in self.pages.get((contract["plugin"], arguments["scope"]), [])]
        return json.dumps({"data": {"plugin": contract["plugin"], "provider": contract["provider"],
                                    "adapter_version": "1", "origin": "catalogue", "scope": arguments["scope"],
                                    "complete": True, "claims": claims} if claims else None, "next_cursor": None})

    def sync(self, key):
        self.syncs += 1
        body = json.loads(self.ingest_ops.sync(self.ops, {"plugin": key}))
        self.assertEqual(body.get("issues", []), [])
        return body["data"]

    def page(self, subject_id):
        body = json.loads(self.queue_ops.read_subject(self.ops, {"subject_id": subject_id}))
        self.assertEqual(body["outcome"], "ok", body.get("issues"))
        return body["data"]

    def sections(self, subject_id):
        return {section["section"]: section["status"] for section in self.page(subject_id)["sections"]}

    def source(self, subject_id):
        """What the page says about the plugin that introduced its subject."""
        [found] = [item for item in self.page(subject_id)["contributors"] if item["introduced"]]
        return found["label"], found["status"], found["not_offered_since"]

    def found(self, query):
        """The subjects local search answers for a query: its groups and their rows."""
        body = json.loads(self.ops.search({"query": query}))
        return {subject for group in body["data"]["groups"] for subject in (group["id"], *(row["id"] for row in group["rows"]))}

    def names(self):
        return json.loads(self.markets_ops.MarketReads(self.ops).overview({}))["data"]["names"]

    def effect(self, key=None):
        body = json.loads(self.plugin_effect.effect(self.ops, {"plugin": key} if key else {}))
        self.assertEqual(body["outcome"], "ok", body.get("issues"))
        return body["data"]["plugins"]

    def rows(self):
        return {table: len(self.ops.store.select(f"SELECT 1 FROM {table}")) for table in TABLES}

    def placed(self, native_id):
        return tuple(self.ops.store.select("SELECT subject_id, state FROM claims WHERE native_id = ?", (native_id,))[0])

    def meridian(self, *, key="pythia-meridian", name="meridian", signoff="grandfathered"):
        """The financial source, installed as `key`: its plugin and provider are `name`, which its records carry."""
        self.install(key, {**MERIDIAN, "plugin": name, "provider": name, "signoff": {"status": signoff}})
        self.pages[(name, "lines")] = [
            line("ASML.AS", ("isin", "NL0010273215"), mic="XAMS", ticker="ASML", name="ASML Holding", provider=name),
            line("SAP.DE", ("figi", SAP_FIGI), ticker="SAP", name="SAP SE", provider=name),
            line("AAPL.OQ", ("isin", "US0378331005"), mic="XNAS", currency="USD", ticker="AAPL", name="Apple Inc.",
                 provider=name)]
        return key

    def tidepool(self):
        self.install("tidepool-community", TIDEPOOL)
        self.pages[("tidepool", "protocols")] = [record("tidepool", "protocol", "example-lend", "protocol",
                                                        name="Example Lend")]
        self.pages[("tidepool", "pools")] = pools(pool())
        return "tidepool-community"


class ContributionTest(PeersFixture):
    def test_the_financial_source_joins_reference_subjects_by_identifier_and_introduces_the_rest(self):
        key = self.meridian()
        done = self.sync(key)
        self.assertEqual({name: done[name] for name in ("joined", "introduced", "conflicts", "unmatched")},
                         {"joined": 1, "introduced": 2, "conflicts": 0, "unmatched": 0})
        self.assertEqual([self.placed(name) for name in ("ASML.AS", "SAP.DE", "AAPL.OQ")],
                         [(ASML_LINE, "joined"), (SAP_BY_FIGI, "introduced"), (APPLE_LINE, "introduced")])
        asml = self.page(ASML_LINE)  # evidence about a reference subject, labelled with its plugin, changing nothing
        self.assertEqual((asml["subject"]["id"], asml["identifiers"]["isin"]), (ASML_LINE, "NL0010273215"))
        self.assertIn({"scheme": "ticker_mic", "value": "ASML@XAMS"}, asml["contributors"][0]["stated"])
        apple = self.page(APPLE_LINE)  # a CGS-area ISIN keys a device subject and its security, from any plugin
        self.assertEqual((apple["subject"]["name"], apple["security"]["id"]), ("Apple Inc.", APPLE))
        self.assertEqual((self.source(SAP_BY_FIGI), self.sections(SAP_BY_FIGI)),
                         (("meridian", "enabled", None), {"quote": "ready"}))
        self.assertTrue({SAP_BY_FIGI, APPLE_LINE} <= self.found("SAP SE") | self.found("Apple"))  # search finds them
        self.assertEqual(self.ops.store.queue_items(), [])

    def test_the_defi_source_introduces_sui_coin_types_a_pool_and_its_protocol(self):
        key = self.tidepool()
        self.assertEqual(self.sync(key)["introduced"], 4)
        view = self.page(POOL)
        self.assertEqual((view["subject"]["level"], view["subject"]["name"]), ("market", "Example Lend USDC"))
        self.assertEqual({(item["type"], item["id"]) for item in view["related"]},
                         {("part_of", PROTOCOL), *(("market_asset", token) for token in TOKENS)})
        for token in TOKENS:  # two coin types the source calls USDC stay two subjects
            self.assertEqual(self.page(token)["subject"]["id"], token)


class SavedReferenceTest(PeersFixture):
    """A saved `markets_watchlist` ID of an introduced subject through disabling, re-enabling and updates."""

    def test_a_saved_line_keeps_resolving_through_disable_enable_and_the_sources_updates(self):
        key = self.meridian()
        self.sync(key)
        self.save(SAP_BY_FIGI)
        self.assertIn(SAP_BY_FIGI, self.found("SAP SE"))
        before, calls = self.rows(), len(self.calls)
        self.disabled.add(key)  # a labelled stub: its own ID and name, "from Meridian, which is disabled"
        self.assertNotIn(SAP_BY_FIGI, self.found("SAP SE"))  # out of search while its plugin is off
        view = self.page(SAP_BY_FIGI)
        self.assertEqual((view["subject"]["id"], view["subject"]["name"]), (SAP_BY_FIGI, "SAP SE"))
        self.assertEqual((self.source(SAP_BY_FIGI), self.sections(SAP_BY_FIGI)),
                         (("meridian", "disabled", None), {"quote": "disabled"}))
        self.assertEqual((self.names()[SAP_BY_FIGI], self.rows()), ("SAP SE", before))  # no row deleted
        self.disabled.clear()  # its data is back, with no sync
        self.assertEqual((self.source(SAP_BY_FIGI), self.sections(SAP_BY_FIGI)),
                         (("meridian", "enabled", None), {"quote": "ready"}))
        self.assertIn(SAP_BY_FIGI, self.found("SAP SE"))
        self.assertEqual(len(self.calls), calls)
        # A renamed record keeps its ID.
        self.pages[("meridian", "lines")][1] = line("SAP.DE", ("figi", SAP_FIGI), ticker="SAP", name="SAP SE (Xetra)")
        self.sync(key)
        self.assertEqual(self.page(SAP_BY_FIGI)["subject"], {**view["subject"], "name": "SAP SE (Xetra)"})
        # A better identifier re-keys it: the saved ID is an alias of the new one, and its binding follows.
        self.pages[("meridian", "lines")][1] = line("SAP.DE", ("figi", SAP_FIGI), ("isin", SAP_ISIN), ticker="SAP",
                                                    name="SAP SE (Xetra)")
        self.sync(key)
        view = self.page(SAP_BY_FIGI)
        self.assertEqual((view["subject"]["id"], view["security"]["id"], self.sections(SAP_BY_FIGI)),
                         (SAP_BY_ISIN, SAP, {"quote": "ready"}))
        self.assertEqual(self.names()[SAP_BY_FIGI], "SAP SE (Xetra)")
        # A contradicting identifier is a conflict, sync after sync, until the source states the kept value again: the
        # line keeps its ID and its security, never another FIGI or another company's (GSK's ISIN).
        for contradiction in ((("figi", OTHER_FIGI), ("isin", SAP_ISIN)), (("figi", SAP_FIGI), ("isin", "GB00BN7SWP63"))):
            self.pages[("meridian", "lines")][1] = line("SAP.DE", *contradiction, ticker="SAP")
            for again in range(2):
                with self.subTest(contradiction=contradiction, sync=again):
                    self.assertEqual(self.sync(key)["conflicts"], 1)
                    view = self.page(SAP_BY_FIGI)
                    self.assertEqual((self.placed("SAP.DE"), view["subject"]["id"], view["security"]["id"]),
                                     ((SAP_BY_ISIN, "conflict"), SAP_BY_ISIN, SAP))
        self.pages[("meridian", "lines")][1] = line("SAP.DE", ("figi", SAP_FIGI), ("isin", SAP_ISIN), ticker="SAP")
        self.sync(key)
        self.assertEqual((self.placed("SAP.DE"), self.page(SAP_BY_FIGI)["identifiers"]["figi"]),
                         ((SAP_BY_ISIN, "introduced"), SAP_FIGI))
        self.assertEqual(self.ops.store.select("SELECT subject_id FROM device_assertions WHERE native_id = 'SAP.DE'"
                                               " AND subject_id NOT IN (?, ?)", (SAP_BY_ISIN, SAP)), [])
        # A record its complete scope no longer carries: "no longer offered by Meridian since …", still bound.
        del self.pages[("meridian", "lines")][1]
        self.assertEqual(self.sync(key)["not_seen"], 1)
        self.assertEqual((self.source(SAP_BY_FIGI), self.sections(SAP_BY_FIGI)),
                         (("meridian", "enabled", NOW), {"quote": "ready"}))

    def test_leaving_out_the_isin_its_lines_id_spells_never_lets_a_later_record_move_the_line(self):
        key = self.meridian()
        self.sync(key)  # SAP's line, keyed by its FIGI and saved so

        def state(*identifiers):
            self.pages[("meridian", "lines")][1] = line("SAP.DE", *identifiers, ticker="SAP")
            self.sync(key)
            return self.placed("SAP.DE"), self.page(SAP_BY_FIGI)["security"]["id"]
        sap = (("figi", SAP_FIGI), ("isin", SAP_ISIN))
        self.assertEqual(state(*sap), ((SAP_BY_ISIN, "introduced"), SAP))
        # Leaving the ISIN out moves nothing; GSK's after that is a conflict, sync after sync, with the line under SAP.
        self.assertEqual(state(("figi", SAP_FIGI)), ((SAP_BY_ISIN, "introduced"), SAP))
        for again in range(2):
            with self.subTest(sync=again):
                self.assertEqual(state(("figi", SAP_FIGI), ("isin", "GB00BN7SWP63")), ((SAP_BY_ISIN, "conflict"), SAP))
        self.assertEqual(state(*sap), ((SAP_BY_ISIN, "introduced"), SAP))  # restating SAP's ISIN clears the conflict

    def test_leaving_out_the_figi_its_lines_id_spells_never_lets_a_later_record_take_another(self):
        key = self.meridian()
        self.sync(key)
        for identifiers, expected in (((), "introduced"), ((("figi", OTHER_FIGI),), "conflict"),
                                      ((("figi", OTHER_FIGI),), "conflict"), ((("figi", SAP_FIGI),), "introduced")):
            with self.subTest(identifiers=identifiers):
                self.pages[("meridian", "lines")][1] = line("SAP.DE", *identifiers, ticker="SAP")
                self.sync(key)
                self.assertEqual((self.placed("SAP.DE"), self.page(SAP_BY_FIGI)["identifiers"]["figi"]),
                                 ((SAP_BY_FIGI, expected), SAP_FIGI))

    def test_a_saved_pool_keeps_its_label_while_its_plugin_is_off_and_through_its_updates(self):
        key = self.tidepool()
        self.sync(key)
        self.save(POOL)
        before = self.rows()
        self.assertIn(POOL, self.found("Example Lend USDC"))
        self.disabled.add(key)
        self.assertNotIn(POOL, self.found("Example Lend USDC"))
        view = self.page(POOL)
        self.assertEqual((view["subject"]["id"], view["subject"]["name"], self.source(POOL)),
                         (POOL, "Example Lend USDC", ("tidepool", "disabled", None)))
        self.assertEqual((self.names()[POOL], self.rows()), ("Example Lend USDC", before))
        self.disabled.clear()
        self.assertEqual(self.source(POOL), ("tidepool", "enabled", None))
        self.assertIn(POOL, self.found("Example Lend USDC"))
        self.pages[("tidepool", "pools")] = pools(pool("Example Lend USDC (Sui)"))
        self.sync(key)
        self.assertEqual((self.page(POOL)["subject"]["name"], self.names()[POOL]), ("Example Lend USDC (Sui)",) * 2)
        self.pages[("tidepool", "pools")] = pools()
        self.sync(key)
        self.assertEqual((self.page(POOL)["subject"]["id"], self.source(POOL)), (POOL, ("tidepool", "enabled", NOW)))


class EqualTermsTest(PeersFixture):
    """PLAN-REVIEW test 9, and ADR 0044's amendment of 2026-09-30: two plugins that send the same records under other
    names, one declaring itself grandfathered and the other unsigned, give identical IDs, rows, statuses, conflicts and
    effects, and nothing in any of them is a level."""

    COLUMNS = {"claims": "plugin, native_scope, native_id, scope, subject_id, state, claim",
               "subjects": "id, kind, parent_id, name, attributes, status, introduced_by",
               "device_assertions": "subject_id, scheme, value, role, plugin, native_id",  # an ID hashes the source
               "device_aliases": "old_id, new_id", "queue": "key, kind, reason, subject_ids, candidate_ids, state",
               "bindings": "provider, native_scope, native_id, subject_id, status, authority, rule_id, plugin"}

    def run_as(self, device, key, name, signoff):
        self.device(device)
        self.meridian(key=key, name=name, signoff=signoff)
        summaries = [self.sync(key)]
        self.pages[(name, "lines")][1] = line("SAP.DE", ("figi", SAP_FIGI), ("isin", SAP_ISIN), ticker="SAP", provider=name)
        summaries.append(self.sync(key))
        self.pages[(name, "lines")][0] = line("ASML.AS", ("isin", "NL0010273215"), ("figi", OTHER_FIGI), mic="XAMS",
                                              provider=name)
        summaries.append(self.sync(key))
        pages = {subject: {**self.page(subject), "queue": None} for subject in (ASML_LINE, SAP_BY_FIGI, APPLE_LINE)}
        rows = {table: sorted(tuple(row) for row in self.ops.store.select(f"SELECT {columns} FROM {table}"))
                for table, columns in self.COLUMNS.items()}
        [plugin] = self.effect(key)
        results = {"summaries": summaries, "pages": pages, "rows": rows, "effect": {**plugin, "plugin": None, "label": None}}
        # Only the names differ: read them back as one, and the two results are the same.
        return json.loads(json.dumps(results).replace(key, "KEY").replace(name, "NAME"))

    def test_the_same_records_under_other_names_and_sign_offs_give_identical_results(self):
        shipped = self.run_as("shipped", "pythia-meridian", "meridian", "grandfathered")
        community = self.run_as("community", "community-ledger", "ledger", "unsigned")
        self.assertEqual(shipped, community)
        self.assertEqual(shipped["summaries"][2]["conflicts"], 1)  # a FIGI the package's line contradicts
        self.assertIn("figi", shipped["pages"][ASML_LINE]["contested"])
        self.assertGreater(shipped["effect"]["sole"]["count"], 0)  # its own subjects, as any plugin's are
        everything = json.dumps(shipped)  # no trust level, label or "shown" evidence anywhere in what it says
        for level in ('"confirm"', '"display"', '"trust"', '"unaudited"', '"shown"'):
            self.assertNotIn(level, everything)


class PluginEffectTest(PeersFixture):
    """identity-plugin-effect: what disabling a plugin takes away, before it happens (ADR 0044 A3)."""

    def test_it_counts_the_subjects_only_the_plugin_supplies_and_the_saved_entries_naming_them(self):
        self.sync(self.meridian())
        self.sync(self.tidepool())
        self.save(POOL, SAP_BY_FIGI, ASML_LINE)
        [pools_effect] = self.effect("tidepool-community")
        self.assertEqual((pools_effect["catalogue"], pools_effect["sole"]["count"]), (True, 4))
        self.assertEqual(pools_effect["saved"], {"count": 1, "sample": [
            {"id": POOL, "name": "Example Lend USDC", "setting": "markets_watchlist"}]})
        [lines] = self.effect("pythia-meridian")  # the ASML line is the package's: disabling keeps it
        self.assertEqual({item["id"] for item in lines["sole"]["sample"]}, {SAP_BY_FIGI, APPLE_LINE, APPLE})
        self.assertEqual([item["id"] for item in lines["saved"]["sample"]], [SAP_BY_FIGI])
        # Another enabled plugin that also states the SAP line keeps it; disabled, it does not.
        self.install("atlas", {**MERIDIAN, "plugin": "atlas", "provider": "atlas", "concepts": {},
                               "catalogue": {"mode": "bulk", "operation": "catalogue", "scopes": ["lines"]}})
        self.pages[("atlas", "lines")] = [record("atlas", "line", "SAP", "listing", ("figi", SAP_FIGI),
                                                 operating_mic="XETR", currency="EUR")]
        self.sync("atlas")
        [lines] = self.effect("pythia-meridian")
        self.assertEqual((lines["sole"]["count"], lines["saved"]["count"]), (2, 0))
        self.disabled.add("atlas")
        self.assertEqual(self.effect("pythia-meridian")[0]["saved"]["count"], 1)
        # Enabled again but no longer offering the line (its complete scope dropped it), it keeps nothing, as in search;
        # and a pool its own plugin no longer offers is not that plugin's to take away.
        self.disabled.clear()
        self.pages[("atlas", "lines")] = [record("atlas", "line", "X", "listing", ticker="X", operating_mic="XETR",
                                                 currency="EUR")]
        self.assertEqual(self.sync("atlas")["not_seen"], 1)
        self.assertEqual(self.effect("pythia-meridian")[0]["saved"]["count"], 1)
        self.pages[("tidepool", "pools")] = pools()
        self.sync("tidepool-community")
        self.assertEqual(self.effect("tidepool-community")[0]["sole"]["count"], 3)
        self.assertNotIn(POOL, self.found("Example Lend USDC"))

    def test_without_a_plugin_it_lists_every_enabled_plugin_that_ships_a_contract_and_what_it_serves(self):
        self.meridian()
        self.tidepool()
        self.install("quotes", {**{name: value for name, value in MERIDIAN.items() if name != "catalogue"},
                                "plugin": "quotes", "provider": "quotes", "addressing": {
                                    "native": [{"native_scope": "line", "level": "listing"}],
                                    "mic_table": {"XETR": ".DE"}}})  # quotes only: no catalogue, no resolve
        self.assertEqual([(item["plugin"], item["serves"], item["sole"]["count"]) for item in self.effect()],
                         [("pythia-meridian", ["market_data"], 0), ("tidepool-community", [], 0),
                          ("quotes", ["market_data"], 0)])
        self.disabled.add("tidepool-community")
        self.assertEqual([item["plugin"] for item in self.effect()], ["pythia-meridian", "quotes"])
        body = json.loads(self.plugin_effect.effect(self.ops, {"plugin": "nobody"}))
        self.assertEqual(body["issues"][0]["message"], "Unknown plugin.")


    def test_it_says_which_identifiers_a_plugin_can_look_up_and_counts_an_inactive_subject_search_still_finds(self):
        self.meridian()
        directory = self.install("finder", {"contract_version": 2, "plugin": "finder", "provider": "finder",
                                            "addressing": {"native": [{"native_scope": "line", "level": "listing"}]},
                                            "resolve": {"operation": "resolve", "input_schemes": ["isin"], "echoes": []},
                                            "introduces": {"listing": ["figi"]}, "rights": RIGHTS,
                                            "signoff": {"status": "grandfathered"}})
        self.assertEqual({item["plugin"]: item["lookup"] for item in self.effect()},
                         {"pythia-meridian": [], "finder": ["isin"]})
        # A pool its source marks inactive is still found in search, flagged delisted, so disabling the plugin hides it.
        self.pages[("tidepool", "pools")] = pools()
        self.tidepool()
        self.sync("tidepool-community")
        before = self.effect("tidepool-community")[0]["sole"]["count"]
        self.ops.store.db.execute("UPDATE subjects SET status = 'inactive' WHERE id = ?", (POOL,))
        self.ops.store.db.commit()
        self.assertEqual(self.effect("tidepool-community")[0]["sole"]["count"], before)


if __name__ == "__main__":
    unittest.main()
