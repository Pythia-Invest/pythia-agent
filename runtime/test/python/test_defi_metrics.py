"""Core's metric row for a protocol or a market (Sui experiment, slice E4): its vocabulary, and the agent boundary that
checks and stamps what a plugin's `fundamentals.metrics` read returns.

The plugins are the real DeFiLlama and NAVI ones over a fake transport (test_defi_sources.py owns their figures); the
subjects are ingested through the real contracts into the agent-tool fixture's device store. Rows here are invented
unless a test says otherwise.
"""
from contextlib import closing
from copy import deepcopy
import importlib
import json
import unittest

from market_data_fixture import connector, wire
from test_agent_tools import AgentToolFixture, definitions, envelope, identity_ops
from test_defi_sources import NAVI, USDC_RESERVE, Transport, defillama, llama_answers, navi
from test_plugin_contracts import identity

TVL = {"metric": "tvl", "value": "192577192.70", "unit": "USD", "period": {"kind": "instant"},
       "as_of": "2026-09-30T13:10:00+00:00", "basis": "standardized",
       "definition": {"id": "net_of_borrowed", "text": "Supplied minus borrowed."}, "source_url": "https://example.org/tvl"}
UTILISATION = {**TVL, "metric": "utilisation", "value": "0.35", "unit": "ratio", "basis": "as_reported",
               "definition": {"id": "borrowed_over_supplied", "text": "Borrowed over supplied."}}
NOW = "2026-09-30T13:10:00Z"
# The agent-tool fixture loads core as its own package, so batches and the ingest come from that copy, not `identity`'s.
claims = importlib.import_module("pythia_core_fixture.identity.claims")
core_ingest = importlib.import_module("pythia_core_fixture.identity.ingest")
PROTOCOL = "protocol:provisional:defillama:protocol:3323"
POOL_UUID = "00000001-0000-4000-8000-000000000000"  # invented: DeFiLlama's own pool of the same protocol
POOL = f"market:provisional:defillama:pool:{POOL_UUID}"
RESERVE = f"market:sui_object:{USDC_RESERVE}"  # NAVI states the reserve's Pool object id as its key


def row(base=TVL, **changes):
    return {**deepcopy(base), **changes}


class Vocabulary(unittest.TestCase):
    def refused(self, bad, kind="protocol", *, message):
        with self.assertRaisesRegex(identity.MetricError, message):
            identity.validate_metrics(bad if isinstance(bad, list) else [bad], kind)

    def test_a_row_of_each_kind_is_accepted_as_stated(self):
        self.assertEqual(identity.validate_metrics([TVL], "protocol"), [TVL])
        self.assertEqual(identity.validate_metrics([UTILISATION], "market"), [UTILISATION])
        windowed = row(metric="fees", period={"kind": "duration", "window": "7d"},
                       definition={"id": "user_paid", "text": "Fees users paid."})
        self.assertEqual(identity.validate_metrics([windowed], "protocol"), [windowed])

    def test_a_tvl_must_say_which_tvl(self):
        self.refused({key: value for key, value in TVL.items() if key != "definition"}, message=r"definition: required")
        self.refused(row(definition={"id": "tvl", "text": "Total value locked."}), message="one of gross_supplied, net_of_borrowed")
        self.refused(row(definition={"id": "net_of_borrowed"}), message=r"definition\.text: required")
        self.refused(row(definition={"id": "net_of_borrowed", "text": " "}), message=r"definition\.text")
        self.assertEqual(sorted(identity.METRICS["tvl"].definitions),
                         ["gross_supplied", "held_assets", "net_of_borrowed", "pool_reserves"])

    def test_different_tvl_definitions_are_both_kept_and_never_blended(self):
        gross = row(value="250200000", definition={"id": "gross_supplied", "text": "Everything supplied."})
        kept = identity.validate_metrics([TVL, gross], "protocol")
        self.assertEqual([(item["definition"]["id"], item["value"]) for item in kept],
                         [("net_of_borrowed", "192577192.70"), ("gross_supplied", "250200000")])
        self.refused([TVL, row(value="1")], message=r"metrics\[1\]: repeats")  # one source contradicting itself

    def test_a_metric_belongs_to_its_kind_unit_and_period(self):
        self.refused(UTILISATION, "protocol", message="utilisation is about a market, not a protocol")
        self.refused(TVL, "market", message="tvl is about a protocol, not a market")
        self.refused(TVL, "listing", message="about a protocol or a market")
        self.refused(row(metric="apy"), message="metric: expected one of tvl, fees, revenue, volume")
        self.refused(row(unit="percent"), message="tvl is in USD")
        self.refused(row(period={"kind": "duration", "window": "24h"}), message="holds at an instant")
        self.refused(row(metric="fees", definition={"id": "user_paid", "text": "x"}, period={"kind": "instant"}),
                     message="covers a window")
        self.refused(row(metric="volume", definition={"id": "traded", "text": "x"},
                         period={"kind": "duration", "window": "1y"}), message="period.window")
        self.refused(row(UTILISATION, metric="volume_24h", unit="USD", definition={"id": "traded", "text": "x"},
                         period={"kind": "duration", "window": "7d"}), "market", message="period.window: expected 24h")

    def test_a_value_is_a_non_negative_decimal_string_and_the_time_is_utc(self):
        for bad in (192577192.7, "-1", "1e", "NaN", "", "1,5"):
            with self.subTest(value=bad):
                self.refused(row(value=bad), message=r"value")
        for bad in ("yesterday", "2026-09-30T13:10:00", "2026-09-30T13:10:00+02:00", None):
            with self.subTest(as_of=bad):
                self.refused(row(as_of=bad), message="as_of")
        for bad in ("http://example.org", "https://", "example.org", None):
            with self.subTest(url=bad):
                self.refused(row(source_url=bad), message="source_url")
        self.refused(row(basis="guessed"), message="basis: expected one of as_reported, standardized, on_chain")

    def test_a_plugin_cannot_state_its_own_identity_or_any_other_field(self):
        self.refused(row(source={"plugin": "pythia-sec"}), message=r"source: unknown field")
        self.refused(row(extra=1), message=r"extra: unknown field")

    def test_the_contracts_claimed_bases_bound_the_rows(self):
        with self.assertRaisesRegex(identity.MetricError, "claims as_reported"):
            identity.validate_metrics([TVL], "protocol", bases=("as_reported",))
        self.assertEqual(identity.validate_metrics([TVL], "protocol", bases=("standardized",)), [TVL])


class AgentBoundary(AgentToolFixture):
    """A DeFiLlama protocol and a NAVI reserve, ingested from the real plugins' catalogues, read through the agent."""

    def setUp(self):
        super().setUp()
        pool = {"pool": POOL_UUID, "chain": "Sui", "project": "navi-lending", "symbol": "USDC", "poolMeta": None,
                "underlyingTokens": [], "tvlUsd": 1.0}
        self.llama_transport = Transport({**llama_answers(), defillama.catalogue.URLS["pools"]:
                                          {"status": "success", "data": [pool]}})
        self.navi_transport = Transport({navi.catalogue.url(tuple(navi.catalogue.MARKETS)): NAVI})
        self.readers = {"defillama": defillama.Reader(wire, connector, transport=self.llama_transport),
                        "navi": navi.Reader(wire, connector, transport=self.navi_transport)}
        for plugin, reader in self.readers.items():
            self.schemas.update({schema["name"]: schema for schema in definitions(plugin).values()})
            self.plugins[plugin] = self.contract(plugin)
            for name, schema in definitions(plugin).items():
                self.eligible.add(schema["name"])
                owner = f"pythia-{plugin}"
                self.owners[schema["name"]] = (owner, type("Plugin", (), {"manifest": type("Manifest", (), {"name": owner})})())
                self.handlers[schema["name"]] = self.handler(plugin, reader, name)
        self.agent("pythia-defillama", "defillama_protocol_metrics", "pythia_defillama_metrics")
        self.agent("pythia-navi", "navi_reserve_metrics", "pythia_navi_metrics")
        self.ingest("defillama", "protocols", "pools")
        self.ingest("navi", "reserves", "reserves")

    def handler(self, plugin, reader, operation):
        def read(arguments, **_context):
            options = {"markets": None} if plugin == "navi" else {}
            return json.dumps(reader.invoke(operation, arguments, **options))
        return read

    def ingest(self, plugin, scope, *scopes):
        info = self.plugins[plugin]
        with closing(identity_ops.CURRENT.reference()[1]) as ref:
            for name in (scope, *scopes):
                result = self.readers[plugin].invoke("catalogue", {"scope": name})
                core_ingest.ingest(identity_ops.CURRENT.store, ref, info, claims.batch_from_json(result["data"]),
                                   plugins=list(self.plugins.values()), now=NOW)

    def test_a_protocol_subject_reads_its_metrics_stamped_with_their_source(self):
        result = self.call("defillama_protocol_metrics", subject_id=PROTOCOL)
        self.assertEqual(result["outcome"], "ok")
        rows = {(item["metric"], item["period"].get("window")): item for item in result["data"]["metrics"]}
        self.assertEqual(rows[("tvl", None)]["definition"]["id"], "net_of_borrowed")
        self.assertEqual(rows[("tvl", None)]["source"], {"plugin": "pythia-defillama", "provider": "defillama",
                                                         "label": "DeFiLlama"})
        self.assertEqual({source for item in result["data"]["metrics"] for source in item["source"]},
                         {"plugin", "provider", "label"})
        self.assertEqual(self.ctx.calls[-1][1]["native_ref"], {"provider": "defillama", "native_scope": "protocol",
                                                               "native_id": "3323"})

    def test_a_market_subject_reads_its_metrics_and_each_tool_is_offered_only_for_its_kind(self):
        result = self.call("navi_reserve_metrics", subject_id=RESERVE)
        self.assertEqual({item["metric"] for item in result["data"]["metrics"]},
                         {"supplied", "borrowed", "utilisation", "supply_rate", "borrow_rate"})
        self.assertEqual({item["source"]["provider"] for item in result["data"]["metrics"]}, {"navi"})
        offered = lambda subject: [tool["tool"] for tool in agent_tools_for(subject)]  # noqa: E731
        self.assertEqual(offered(RESERVE), ["navi_reserve_metrics"])
        self.assertEqual(offered(PROTOCOL), ["defillama_protocol_metrics"])
        refused = self.call("defillama_protocol_metrics", subject_id=RESERVE)
        self.assertEqual(refused["issues"][0]["code"], "source_unavailable")
        self.assertIn("has no address for this market", refused["issues"][0]["message"])
        self.assertEqual(self.call("navi_reserve_metrics", subject_id=PROTOCOL)["issues"][0]["code"], "source_unavailable")
        # DeFiLlama's own pool is a market it addresses, yet its metrics are the protocol's: never served for the pool.
        self.assertEqual(offered(POOL), [])
        self.assertEqual(self.call("defillama_protocol_metrics", subject_id=POOL)["issues"][0]["code"], "source_unavailable")

    def test_a_result_with_a_malformed_row_shows_none_of_its_figures(self):
        good = json.loads(self.handlers["pythia_defillama_metrics"](
            {"native_ref": {"provider": "defillama", "native_scope": "protocol", "native_id": "3323"}}))
        for label, change, message in (
                ("a TVL that does not say which", lambda rows: rows[0].pop("definition"), "definition: required"),
                ("a definition core does not list", lambda rows: rows[0]["definition"].update(id="locked"), "definition.id"),
                ("a basis the contract does not claim", lambda rows: rows[0].update(basis="on_chain"), "claims standardized"),
                ("a row stating its source", lambda rows: rows[0].update(source={"plugin": "x"}), "source: unknown field"),
                ("a repeated row", lambda rows: rows.append(dict(rows[0])), "repeats")):
            with self.subTest(label):
                bad = deepcopy(good)
                change(bad["data"]["metrics"])
                self.handlers["pythia_defillama_metrics"] = lambda *_args, **_kw: json.dumps(bad)
                result = self.call("defillama_protocol_metrics", subject_id=PROTOCOL)
                self.assertEqual(result["outcome"], "error")
                self.assertNotIn("data", result)
                self.assertEqual(result["issues"][0]["code"], "invalid_response")
                self.assertIn(message, result["issues"][0]["message"])
                self.assertNotIn("192577192", json.dumps(result))

    def test_a_failed_or_empty_read_passes_through_unchanged(self):
        self.handlers["pythia_defillama_metrics"] = lambda *_args, **_kw: json.dumps(
            {"schema_version": 1, "outcome": "error", "data": None, "issues": [
                {"code": "rate_limit", "severity": "error", "message": "Slow down."}]})
        self.assertEqual(self.call("defillama_protocol_metrics", subject_id=PROTOCOL)["issues"][0]["code"], "rate_limit")
        self.handlers["pythia_defillama_metrics"] = lambda *_args, **_kw: envelope({"metrics": []})
        self.assertEqual(self.call("defillama_protocol_metrics", subject_id=PROTOCOL)["data"], {"metrics": []})

    def test_the_sec_fundamentals_read_of_a_company_is_not_touched_by_the_metric_check(self):
        self.agent("pythia-sec", "sec_fundamentals", "pythia_sec_fundamentals")
        self.handlers["pythia_sec_fundamentals"] = lambda *_args, **_kw: envelope({"facts": [{"metric": "revenue"}]})
        self.assertEqual(self.call("sec_fundamentals", subject_id="listing:isin:NL0010273215:XAMS:EUR")["data"],
                         {"facts": [{"metric": "revenue"}]})


def agent_tools_for(subject_id):
    from test_agent_tools import agent_tools
    return agent_tools.provider_tools_for(subject_id)


if __name__ == "__main__":
    unittest.main()
