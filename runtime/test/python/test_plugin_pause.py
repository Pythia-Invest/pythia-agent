"""The investor's per-plugin switch (Settings → Data sources): a paused plugin counts as a disabled one.

Pythia keeps the pause in its own settings.json (`pythia_paused_plugins`), so it needs no Hermes restart: every read
sees the file as it is now. These cases run the peers' fixture plugins through core's own `installed()`, search, pages,
ingest and the effect read, pausing by rewriting that file the way Desk's settings service does (a new file, renamed
into place).
"""
import json
import os
import sys
import types
import unittest
from unittest import mock

from test_identity_peers import ASML_LINE, MERIDIAN, OTHER_FIGI, POOL, SAP_BY_FIGI, PeersFixture, line
from test_identity_queue import CORE


class PauseTest(PeersFixture):
    def pause(self, *keys):
        path = self.config / "settings.json"
        store = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"schema_version": 1}
        store["pythia_paused_plugins"] = list(keys)
        temporary = path.with_name(".settings.tmp")
        temporary.write_text(json.dumps(store), encoding="utf-8")
        temporary.chmod(0o600)
        os.replace(temporary, path)

    def test_a_paused_source_leaves_selection_search_and_ingest_at_once_and_returns_without_a_sync(self):
        key = self.meridian()
        self.sync(key)
        self.save(SAP_BY_FIGI)
        before, calls = self.rows(), len(self.calls)
        self.assertEqual(len(self.ops.price_sources(SAP_BY_FIGI)["refs"]), 1)
        self.assertIn(SAP_BY_FIGI, self.found("SAP SE"))

        self.pause(key)  # nothing reloads: the next read sees it
        self.assertEqual((self.ops.price_sources(SAP_BY_FIGI)["refs"], self.sections(SAP_BY_FIGI)),
                         ([], {"quote": "disabled"}))
        self.assertNotIn(SAP_BY_FIGI, self.found("SAP SE"))
        refused = json.loads(self.ingest_ops.sync(self.ops, {"plugin": key}))
        self.assertEqual(refused["issues"][0]["message"], "meridian is paused.")
        self.assertEqual(len(self.calls), calls)  # no provider was asked

        # Its subject and the saved reference keep resolving, labelled as paused; no row is touched.
        view = self.page(SAP_BY_FIGI)
        self.assertEqual((view["subject"]["id"], view["subject"]["name"], self.source(SAP_BY_FIGI)),
                         (SAP_BY_FIGI, "SAP SE", ("meridian", "paused", None)))
        self.assertEqual((self.names()[SAP_BY_FIGI], self.rows()), ("SAP SE", before))
        self.assertIn("meridian is paused", json.dumps(self.page(SAP_BY_FIGI)["sections"]))

        self.pause()  # unpaused: everything is back, nothing was read again
        self.assertEqual(len(self.ops.price_sources(SAP_BY_FIGI)["refs"]), 1)
        self.assertEqual((self.source(SAP_BY_FIGI), self.sections(SAP_BY_FIGI)),
                         (("meridian", "enabled", None), {"quote": "ready"}))
        self.assertIn(SAP_BY_FIGI, self.found("SAP SE"))
        self.assertEqual((len(self.calls), self.rows()), (calls, before))

    def test_a_paused_source_no_longer_contests_what_the_reference_states(self):
        key = self.meridian()
        self.sync(key)
        self.pages[("meridian", "lines")][0] = line("ASML.AS", ("isin", "NL0010273215"), ("figi", OTHER_FIGI), mic="XAMS")
        self.assertEqual(self.sync(key)["conflicts"], 1)  # a FIGI the package's line contradicts
        self.assertIn("figi", self.page(ASML_LINE)["contested"])
        self.pause(key)
        paused = self.page(ASML_LINE)
        self.assertNotIn("figi", paused.get("contested", {}))  # shown with its source at most, never deciding
        self.assertEqual(paused["contributors"][0]["status"], "paused")
        self.pause()
        self.assertIn("figi", self.page(ASML_LINE)["contested"])

    def test_the_data_sources_list_keeps_a_paused_plugin_and_says_what_its_pause_hides(self):
        self.sync(self.meridian())
        self.sync(self.tidepool())
        self.save(POOL)
        [pool_source] = self.effect("tidepool-community")
        self.pause("tidepool-community")
        self.assertEqual([(item["plugin"], item["enabled"], item["paused"]) for item in self.effect()],
                         [("pythia-meridian", True, False), ("tidepool-community", False, True)])
        [paused] = self.effect("tidepool-community")
        self.assertEqual((paused["sole"], paused["saved"]), (pool_source["sole"], pool_source["saved"]))
        self.assertNotIn(POOL, self.found("Example Lend USDC"))

    def test_a_price_source_with_no_catalogue_or_lookup_has_a_switch_too(self):
        self.meridian()
        self.install("quotes", {**{name: value for name, value in MERIDIAN.items() if name != "catalogue"},
                                "plugin": "quotes", "provider": "quotes", "addressing": {
                                    "native": [{"native_scope": "line", "level": "listing"}],
                                    "mic_table": {"XETR": ".DE"}}})  # prices only, like Yahoo or EODHD
        self.assertEqual({item["plugin"]: item["paused"] for item in self.effect()},
                         {"pythia-meridian": False, "quotes": False})
        self.pause("quotes")
        self.assertEqual({item["plugin"]: item["paused"] for item in self.effect()},
                         {"pythia-meridian": False, "quotes": True})

    def test_a_paused_sources_agent_tool_refuses_with_the_switch_as_the_reason(self):
        """`installed()` reads the pause from settings.json and `agent_depth.run` refuses on it: no faked PluginInfo."""
        key = self.meridian()
        from pythia_core_queue_fixture import agent_depth
        registry = sys.modules["tools.registry"].registry

        def answer():
            raw = agent_depth.run(types.SimpleNamespace(), key, "meridian_quote", "meridian.latest", {}, {})
            return json.loads(raw)["issues"][0]
        with mock.patch.object(registry, "get_schema", lambda _tool: {}, create=True):
            self.assertNotEqual(answer()["code"], "paused")
            self.pause(key)
            refused = answer()
            self.assertEqual(refused["code"], "paused")
            self.assertIn("paused in Settings", refused["message"])
            self.pause()
            self.assertNotEqual(answer()["code"], "paused")

    def test_only_a_source_enabled_in_hermes_can_be_paused(self):
        key = self.meridian()
        self.sync(key)
        self.disabled.add(key)  # disabled in Hermes: Hermes's state, whatever the pause list says
        self.pause(key)
        self.assertEqual((self.effect(), self.source(SAP_BY_FIGI)), ([], ("meridian", "disabled", None)))
        # Core and the feature backends ship no contract: naming them pauses nothing.
        self.pause("pythia", "pythia-market-data")
        from pythia_core_queue_fixture.platform import access
        core = types.SimpleNamespace(manifest=types.SimpleNamespace(path=str(CORE.parent), name="pythia"))
        self.assertFalse(access.plugin_paused("pythia", core, {}))


if __name__ == "__main__":
    unittest.main()
