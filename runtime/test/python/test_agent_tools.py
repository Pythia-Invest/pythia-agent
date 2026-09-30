"""The agent's Pythia tools and the plugins' provider tools, over fakes: no model, no provider, no Hermes.

The reference is the hand-written ASML fixture; plugin contracts are the shipped contract.json files; the SEC,
xbrl-filings, GLEIF and Yahoo tool schemas come from their own definition modules. Plugin handlers are fakes
that return shapes from those plugins' result builders. `Context.dispatch_tool` mirrors the pinned Hermes
`registry.dispatch` contract (tools/registry.py:1128-1169): a handler that raises becomes {"error": ...}.
"""
import copy
import importlib
import importlib.util
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest import mock

from market_data_fixture import wire
from test_identity_contracts import load, load_reference
from test_reference_package import make_package
from test_identity_contracts import identity as fixture_identity

RUNTIME = Path(__file__).resolve().parents[2]
MANAGED = RUNTIME / "managed"
if "pythia_core_fixture" not in sys.modules:
    spec = importlib.util.spec_from_file_location("pythia_core_fixture", MANAGED / "core/__init__.py",
                                                  submodule_search_locations=[str(MANAGED / "core")])
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
core = sys.modules["pythia_core_fixture"]
agent_tools = importlib.import_module("pythia_core_fixture.agent_tools")
agent_reads = importlib.import_module("pythia_core_fixture.agent_reads")
agent_depth = importlib.import_module("pythia_core_fixture.agent_depth")
platform_module = importlib.import_module("pythia_core_fixture.platform.v1")
identity_ops = importlib.import_module("pythia_core_fixture.identity_ops")
queue_ops = importlib.import_module("pythia_core_fixture.queue_ops")
page = importlib.import_module("pythia_core_fixture.identity.page")
manifest = importlib.import_module("pythia_core_fixture.identity.manifest")
access = importlib.import_module("pythia_core_fixture.platform.access")
operations = importlib.import_module("pythia_core_fixture.platform.operations")
concept_ops = importlib.import_module("pythia_core_fixture.concept_ops")

ASML = "listing:isin:NL0010273215:XAMS:EUR"
ASML_ISSUER = "issuer:lei:724500Y6DUVHQD6OXN27"


def definitions(plugin):
    spec = importlib.util.spec_from_file_location(f"agent_tools_{plugin.replace('-', '_')}_definition",
                                                  MANAGED / "plugins" / plugin / "definition.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.schemas(wire)


def contract(plugin, schemas=None, **state):
    """A plugin as `identity_ops.installed()` reports it: `operations` maps each operation its tools declare to the tool."""
    raw = json.loads((MANAGED / "plugins" / plugin / "contract.json").read_text())
    declared = {name: operations.declaration(schema) or {} for name, schema in (schemas or {}).items()}
    found = {meta["operation"]: name for name, meta in declared.items() if meta.get("plugin") == raw["plugin"]}
    return page.PluginInfo(key=raw["plugin"], manifest=manifest.validate_manifest(raw), operations=found, **state)


def envelope(data, issues=()):
    return json.dumps({"schema_version": 1, "outcome": "ok" if data else "empty", "data": data, "issues": list(issues)})


def validator_module():
    """jsonschema when installed (the pinned Hermes environment has it). Otherwise a stand-in with its interface for
    the keywords these cases use; tooling/qualification/agent_tools_native.py checks the real one."""
    try:
        import jsonschema  # noqa: F401
        return {}
    except ImportError:
        pass

    def iter_errors(schema, value):
        properties = schema.get("properties", {})
        for key in value:
            if key not in properties and schema.get("additionalProperties") is False:
                yield SimpleNamespace(json_path="$", message=f"Additional properties are not allowed ('{key}' was unexpected)")
        for key in schema.get("required", []):
            if key not in value:
                yield SimpleNamespace(json_path="$", message=f"'{key}' is a required property")
        for key, item in value.items():
            spec = properties.get(key, {})
            if spec.get("type") == "integer" and type(item) is not int:
                yield SimpleNamespace(json_path=f"$.{key}", message=f"{item!r} is not of type 'integer'")
            if "enum" in spec and item not in spec["enum"]:
                yield SimpleNamespace(json_path=f"$.{key}", message=f"{item!r} is not one of {spec['enum']}")
            if isinstance(item, list) and len(item) > spec.get("maxItems", len(item)):
                yield SimpleNamespace(json_path=f"$.{key}", message=f"{item!r} is too long")

    module, exceptions = ModuleType("jsonschema"), ModuleType("jsonschema.exceptions")
    module.Draft202012Validator = lambda schema: SimpleNamespace(iter_errors=lambda value: iter_errors(schema, value))
    exceptions.best_match = lambda errors: next(iter(errors), None)
    return {"jsonschema": module, "jsonschema.exceptions": exceptions}


def filing_rows(forms):
    """Rows as sec/financials.filings and xbrl-filings/reports.filings build them (synthetic values)."""
    return [{"accession": f"0000000000-26-{index:06d}", "form": form, "filed_at": f"2026-0{9 - index % 9}-01",
             "title": form + " report", "url": f"https://example.org/{index}", "period_end": "2025-12-31",
             "language": None, "country": "NL", "kind": "annual" if form in ("AFR", "20-F", "20-F/A") else "other"}
            for index, form in enumerate(forms)]


class Context:
    """The pinned PluginContext surface these tools use; dispatch mirrors registry.dispatch."""

    def __init__(self, handlers):
        self.handlers, self.calls, self.tools, self.hooks, self.sections = handlers, [], {}, {}, []
        self.state = None

    def register_tool(self, **entry):
        self.tools[entry["name"]] = entry

    def register_hook(self, name, callback):
        self.hooks[name] = callback

    def register_platform_handler(self, *_args):
        pass

    def register_skill(self, *_args, **_kwargs):
        pass

    def on_unload(self, *_args):
        pass

    def register_system_prompt_section(self, *args, **kwargs):
        self.sections.append((args, kwargs))

    def dispatch_tool(self, name, args, **kwargs):
        self.calls.append((name, copy.deepcopy(args), kwargs))
        handler = self.handlers.get(name)
        if handler is None:
            return json.dumps({"error": f"Unknown tool: {name}"})
        try:
            return handler(args, **kwargs)
        except Exception as error:  # noqa: BLE001 - the registry's own contract
            return json.dumps({"error": f"Tool execution failed: {type(error).__name__}: {error}"})


class AgentToolFixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        build = Path(self.tmp.name) / "build"
        build.mkdir()
        db = sqlite3.connect(build / "reference-20260926.sqlite3")
        db.executescript(fixture_identity.schema_sql("reference"))
        load_reference(db, load("asml.json"))
        db.execute("INSERT INTO release (key, value) VALUES ('schema_version', '2')")
        db.execute("INSERT INTO venues (mic, operating_mic, name, country, category) VALUES ('XAMS', 'XAMS', 'Euronext Amsterdam', 'NL', 'RMKT')")
        db.commit()
        db.close()
        identity_ops.reference_package.install(make_package(Path(self.tmp.name) / "package",
                                                            source=build / "reference-20260926.sqlite3"),
                                               Path(self.tmp.name))
        self.schemas = {}
        for plugin in ("sec", "xbrl-filings", "gleif", "yahoo-discovery"):
            self.schemas.update({schema["name"]: schema for schema in definitions(plugin).values()})
        # Declarations made at registration: Yahoo's specialist read (specialist.register_read_command) and core's queue.
        operations.declare_operation(self.schemas["pythia_yahoo_research"], plugin="pythia-yahoo-discovery",
                                     operation="yahoo-finance", updates=True, read_only=True)
        self.schemas["pythia_identity_queue"] = copy.deepcopy(queue_ops.QUEUE_SCHEMA)
        operations.declare_operation(self.schemas["pythia_identity_queue"], plugin="pythia", operation="identity-queue",
                                     read_only=True)
        self.owners = {name: (owner, SimpleNamespace(manifest=SimpleNamespace(name=owner)))
                       for name, schema in self.schemas.items()
                       if (owner := (operations.declaration(schema) or {}).get("plugin"))}
        self.plugins = {name: self.contract(name) for name in ("sec", "xbrl-filings", "gleif", "yahoo-discovery", "eodhd")}
        self.eligible = set(self.schemas) | {agent_reads.MARKET_DATA_TOOL, agent_reads.COMBINED_FILINGS}
        self.entries = {}
        self.handlers = {}
        self.ctx = Context(self.handlers)
        self.enterContext(mock.patch.dict(os.environ, {"PYTHIA_CACHE_ROOT": self.tmp.name}))  # the document cache
        registry = ModuleType("tools.registry")
        registry.registry = SimpleNamespace(get_all_tool_names=lambda: list(self.schemas),
                                            get_schema=lambda name: self.schemas.get(name),
                                            get_entry=lambda name: self.entries.get(name),
                                            dispatch=lambda name, args, **_: self.ctx.dispatch_tool(name, args))
        self.enterContext(mock.patch.dict(sys.modules, {"tools": ModuleType("tools"), "tools.registry": registry,
                                                        **validator_module()}))
        self.enterContext(mock.patch.object(identity_ops, "installed", lambda: list(self.plugins.values())))
        self.enterContext(mock.patch.object(access, "eligible_tools", lambda: set(self.eligible)))
        self.enterContext(mock.patch.object(access, "native_tool_owners", lambda: dict(self.owners)))
        self.enterContext(mock.patch.object(identity_ops, "CURRENT", identity_ops.Identity(self.ctx, data_dir=self.tmp.name)))
        self.handlers[agent_reads.COMBINED_FILINGS] = concept_ops.ConceptReads(identity_ops.CURRENT).filings

    def contract(self, name, **state):
        return contract(name, self.schemas, **state)

    def registered(self):
        """The tools core registers, leaving this fixture's identity in place."""
        ctx = Context({})
        with mock.patch.object(identity_ops, "CURRENT", identity_ops.CURRENT):
            core.register(ctx)
        return ctx.tools

    def agent(self, plugin_key, name, tool, description="Test tool from a provider. Body.", operations=None):
        """Register a plugin's agent tool as the plugin does, through core's platform helper."""
        ctx = Context(self.handlers)
        package = MANAGED / "plugins" / plugin_key.removeprefix("pythia-")
        ctx.plugin_id, ctx.dispatch_tool = plugin_key, self.ctx.dispatch_tool
        ctx.manifest = SimpleNamespace(name=plugin_key, path=str(package))
        platform_module.register_agent_tool(ctx, name, tool, description, operations=operations)
        entry = ctx.tools[name]
        self.schemas[name] = entry["schema"]
        self.entries[name] = SimpleNamespace(handler=entry["handler"], toolset=entry["toolset"])
        self.owners[name] = (plugin_key, SimpleNamespace(manifest=SimpleNamespace(name=plugin_key)))
        return entry

    def call_instrument(self):
        return json.loads(agent_tools.instrument({"subject_id": ASML}))

    def call(self, name, **arguments):
        return json.loads(self.entries[name].handler(arguments, **arguments.pop("_context", {})))


class ProviderToolTest(AgentToolFixture):
    """Provider depth as real tools in each plugin's own toolset, addressed by subject id through core."""

    def setUp(self):
        super().setUp()
        self.facts = self.agent("pythia-sec", "sec_company_facts", "pythia_sec_facts",
                                "Reported financial facts (revenue, net income) from SEC. Named XBRL concepts.")
        self.agent("pythia-yahoo-discovery", "yahoo_finance", "pythia_yahoo_research",
                   operations=("quoteSummary", "news"))
        self.agent("pythia-gleif", "gleif_legal_entity", "pythia_gleif_profile")

    def test_a_a_provider_tool_is_a_native_tool_addressed_by_subject(self):
        self.assertEqual(self.facts["toolset"], "pythia-sec")  # the plugin's own toolset, not core's hidden one
        schema = self.facts["schema"]
        self.assertEqual(schema["parameters"]["required"], ["subject_id", "taxonomy", "concepts"])
        self.assertNotIn("native_ref", schema["parameters"]["properties"])
        self.assertNotIn("$comment", json.dumps(schema))
        self.handlers["pythia_sec_facts"] = lambda args, **_: envelope({"facts": [{"concept": args["concepts"][0]}]})
        result = json.loads(self.entries["sec_company_facts"].handler(
            {"subject_id": ASML, "taxonomy": "ifrs-full", "concepts": ["Revenue"]},
            session_id="session-1", task_id="task-1", user_task="ignored"))
        self.assertEqual(result["outcome"], "ok")
        name, args, context = self.ctx.calls[-1]
        self.assertEqual((name, args["native_ref"]), ("pythia_sec_facts", {"provider": "sec", "native_id": "0000937966",
                                                                           "native_scope": "cik"}))
        self.assertEqual(context, {"session_id": "session-1", "task_id": "task-1"})
        # Yahoo's native scope is its symbol: both symbol and the one-item symbols are filled (quote reads symbols).
        self.handlers["pythia_yahoo_research"] = lambda args, **_: envelope({"symbol": args["symbol"],
                                                                             "symbols": args["symbols"]})
        self.assertEqual(self.call("yahoo_finance", subject_id=ASML, operation="quoteSummary")["data"],
                         {"symbol": "ASML.AS", "symbols": ["ASML.AS"]})
        # Only the reads the tool offers, addressed only by subject: prices are pythia_prices', never a raw symbol.
        yahoo = self.schemas["yahoo_finance"]["parameters"]
        self.assertEqual((yahoo["required"], yahoo["properties"]["operation"]["enum"]),
                         (["subject_id", "operation"], ["quoteSummary", "news"]))
        self.assertFalse({"symbol", "symbols"} & set(yahoo["properties"]))
        refused = self.call("yahoo_finance", operation="quote", symbols=["ASML.AS"])
        self.assertEqual(refused["issues"][0]["code"], "invalid_arguments")
        # A profile read is a provider tool: core serves no profile concept of its own.
        self.handlers["pythia_gleif_profile"] = lambda args, **_: envelope({"lei": args["native_ref"]["native_id"]})
        self.assertEqual(self.call("gleif_legal_entity", subject_id=ASML)["data"], {"lei": "724500Y6DUVHQD6OXN27"})

    def test_j_an_operation_that_names_its_subject_keeps_it(self):
        # Hyperliquid's live_market takes the market subject and the perp's reference; core fills only the reference.
        live = definitions("hyperliquid")["live_market"]
        self.schemas[live["name"]] = live
        self.owners[live["name"]] = ("pythia-hyperliquid", SimpleNamespace(manifest=SimpleNamespace(
            name="pythia-hyperliquid")))
        self.plugins["hyperliquid"] = self.contract("hyperliquid")
        self.eligible.add(live["name"])
        entry = self.agent("pythia-hyperliquid", "hyperliquid_live_market", live["name"])
        self.assertEqual(entry["schema"]["parameters"]["required"], ["subject_id"])
        self.assertIn("^market:", entry["schema"]["parameters"]["properties"]["subject_id"]["pattern"])
        self.handlers[live["name"]] = lambda args, **_: envelope(args)
        market = "market:pythia:hyperliquid-btc-perp"
        read = self.call("hyperliquid_live_market", subject_id=market)
        self.assertEqual(read["data"], {
            "subject_id": market, "native_ref": {"provider": "hyperliquid", "native_id": "BTC", "native_scope": "perp"}})
        self.assertNotIn("unaudited_source", [issue["code"] for issue in read.get("issues", [])])  # its sign-off says nothing

    def test_b_a_record_under_review_is_refused_as_on_the_page(self):
        original = identity_ops.Identity._load

        def load(identity, subject_id):  # Yahoo's stored record for this listing contradicts the reference
            path, subject, lookups, issue = original(identity, subject_id)
            stored = lookups.get("stored")
            conflicting = {"provider": "yahoo", "native_id": "ASML.AS", "native_scope": "symbol", "status": "conflicting"}
            lookups = {**lookups, "stored": lambda target, provider: conflicting if provider == "yahoo"
                       else stored(target, provider)}
            return path, subject, lookups, issue
        self.enterContext(mock.patch.object(identity_ops.Identity, "_load", load))
        refused = self.call("yahoo_finance", subject_id=ASML, operation="quoteSummary")
        self.assertEqual(refused["issues"][0]["code"], "source_unavailable")
        self.assertIn("contradicts the reference", refused["issues"][0]["message"])
        # The quarantined record cannot be read around by naming its symbol.
        for raw in ({"symbols": ["ASML.AS"]}, {"symbol": "ASML.AS"}):
            bypass = self.call("yahoo_finance", operation="quoteSummary", **raw)
            self.assertEqual(bypass["issues"][0]["code"], "invalid_arguments")
        tools = [row["tool"] for row in json.loads(agent_tools.instrument({"subject_id": ASML}))["data"]["provider_tools"]]
        self.assertNotIn("yahoo_finance", tools)
        self.assertIn("sec_company_facts", tools)
        self.assertEqual(self.ctx.calls, [])

    def test_c_bad_arguments_name_the_parameter_before_any_call(self):
        for args, words in (({"subject_id": ASML, "taxonomy": "ifrs-full"}, ("args:", "'concepts'")),
                            ({"subject_id": ASML, "taxonomy": "gaap", "concepts": ["Revenue"]}, ("args.taxonomy:", "gaap")),
                            ({"subject_id": ASML, "taxonomy": "ifrs-full", "concepts": ["Revenue"] * 9},
                             ("args.concepts:", "too long"))):
            with self.subTest(words=words):
                result = self.call("sec_company_facts", **args)
                self.assertEqual(result["issues"][0]["code"], "invalid_arguments")
                for word in words:
                    self.assertIn(word, result["issues"][0]["message"])
        unknown = self.call("sec_company_facts", subject_id="listing:isin:XX0000000000:XAMS:EUR",
                            taxonomy="ifrs-full", concepts=["Revenue"])
        self.assertIn("Unknown subject", unknown["issues"][0]["message"])
        self.assertEqual(self.ctx.calls, [])

    def test_e_disabled_or_unconfigured_sources_say_why_without_a_call(self):
        self.plugins["sec"] = self.contract("sec", missing=({"key": "sec_identity", "label": "SEC contact",
                                                                    "file": "settings.json", "status": "missing"},))
        unconfigured = self.call("sec_company_facts", subject_id=ASML, taxonomy="ifrs-full", concepts=["Revenue"])
        self.assertEqual(unconfigured["issues"][0]["code"], "needs_configuration")
        self.assertIn("SEC contact (sec_identity in settings.json, missing)", unconfigured["issues"][0]["message"])
        self.plugins["gleif"] = self.contract("gleif", enabled=False)
        disabled = self.call("gleif_legal_entity", subject_id=ASML)
        self.assertIn("disabled", disabled["issues"][0]["message"])
        self.assertEqual(self.ctx.calls, [])

    def test_f_an_operation_not_declared_read_only_never_runs(self):
        comment = json.loads(self.schemas["pythia_sec_facts"]["parameters"]["$comment"])
        del comment["pythia_http_operation"]["read_only"]  # a hand-written marker that omits the key
        self.schemas["pythia_sec_facts"]["parameters"]["$comment"] = json.dumps(comment)
        refused = self.call("sec_company_facts", subject_id=ASML, taxonomy="ifrs-full", concepts=["Revenue"])
        self.assertIn("not available", refused["issues"][0]["message"])
        self.assertEqual(self.ctx.calls, [])

    def test_g_an_oversized_result_is_shortened_and_says_so(self):
        rows = [{"concept": "Revenue", "value": str(index), "period": "2025"} for index in range(5000)]
        self.handlers["pythia_sec_facts"] = lambda *_args, **_kw: envelope({"facts": rows})
        text = self.entries["sec_company_facts"].handler({"subject_id": ASML, "taxonomy": "ifrs-full",
                                                          "concepts": ["Revenue"]})
        self.assertLessEqual(len(text), agent_tools.MAX_CHARS)
        self.assertEqual(json.loads(text)["truncated"]["total"], 5000)

    def test_h_the_operation_tool_runs_only_through_may_run(self):
        self.handlers["pythia_gleif_profile"] = lambda *_args, **_kw: envelope({"ok": True})
        visible = {name for name, entry in self.registered().items() if entry["toolset"] == agent_tools.TOOLSET}
        self.assertNotIn("pythia_gleif_profile", visible)
        self.assertEqual(self.call("gleif_legal_entity", subject_id=ASML)["data"], {"ok": True})
        self.eligible.discard("pythia_gleif_profile")  # may_run: plugin disabled or its availability check fails
        self.assertEqual(self.call("gleif_legal_entity", subject_id=ASML)["issues"][0]["code"], "unavailable")
        self.assertEqual([call[0] for call in self.ctx.calls], ["pythia_gleif_profile"])

    def test_i_a_raising_handler_becomes_a_source_error_without_its_text(self):
        def broken(*_args, **_kwargs):
            raise RuntimeError("secret-token-in-exception")
        self.handlers["pythia_sec_facts"] = broken
        with self.assertLogs(agent_tools.logger, "WARNING"):
            result = self.call("sec_company_facts", subject_id=ASML, taxonomy="ifrs-full", concepts=["Revenue"])
        self.assertEqual(result["issues"][0]["code"], "source_error")
        self.assertNotIn("secret-token", json.dumps(result))


class ConceptToolTest(AgentToolFixture):
    def read_result(self, request, provider="yahoo", observations=(), outcome="ok", issues=()):
        return {"schema_version": 1, "outcome": outcome, "request": request, "series": {"fields": {"close": {
            "unit": {"kind": "currency", "code": "EUR", "scale": "1"}, "adjustment": {"kind": "unknown", "anchor": None}}}},
            "observations": list(observations), "selection": {"view": request["view"], "reason": "preference",
                                                              "preference_revision": None, "alternatives": []},
            "provenance": {"provider": provider, "native_ref": {}, "adapter_version": "1",
                           "retrieved_at": "2026-09-26T10:00:00Z", "source_time": "2026-09-26T09:59:00Z"},
            "retrieved_at": "2026-09-26T10:00:00Z", "returned_window": {"start": None, "end": None},
            "coverage": {"status": "complete", "gaps": [], "truncated": False, "continuation": None},
            "freshness": {"status": "unknown", "as_of": "2026-09-26T09:59:00Z", "basis": "source_time",
                          "market_data_type": "delayed"}, "requirements_satisfied": True, "issues": list(issues),
            "price_context": {"delay_seconds": 900}}

    def call(self, handler, **arguments):
        return json.loads(handler(self.ctx, arguments) if handler in (agent_reads.prices, agent_reads.filings)
                          else handler(arguments))

    def test_find_groups_hand_over_subject_ids_and_the_next_step(self):
        result = self.call(agent_tools.find, query="asml")
        group, = result["data"]["groups"]
        self.assertEqual(group["rows"][0]["id"], ASML)
        self.assertNotIn("lookup", result["data"])
        self.assertIn("pythia_instrument", result["next"])

    def test_instrument_names_the_source_of_each_concept(self):
        result = self.call(agent_tools.instrument, subject_id=ASML)
        sources = {row["concept"]: row for row in result["data"]["sources"]}
        self.assertEqual(sources["quote"]["source"], "Yahoo Finance")
        self.assertEqual([item["source"] for item in sources["filings"]["sources"]], ["filings.xbrl.org", "SEC EDGAR"])
        self.agent("pythia-gleif", "gleif_legal_entity", "pythia_gleif_profile")
        result = self.call_instrument()
        self.assertEqual([row["tool"] for row in result["data"]["provider_tools"]], ["gleif_legal_entity"])
        self.assertNotIn("request", json.dumps(result))  # Desk's operation requests stay out of the agent's view
        self.assertEqual(result["data"]["identifiers"]["lei"], "724500Y6DUVHQD6OXN27")

    def test_instrument_states_home_unknown_unless_a_primary_is_decided(self):
        data = self.call_instrument()["data"]
        self.assertEqual((data["home"], "home_note" in data), (ASML, False))
        installed = identity_ops.reference_package.current(Path(self.tmp.name))
        with sqlite3.connect(installed) as db:
            db.execute("UPDATE listings SET is_primary = 0")
        data = self.call_instrument()["data"]
        # The first line is still listed first; it is not the home.
        self.assertEqual((data["listings"][0]["id"], data["home"]), (ASML, "unknown"))
        # The result itself says what "unknown" means for an answer, beside no tool description.
        self.assertEqual(data["home_note"], agent_tools.HOME_UNKNOWN)

    def test_prices_reads_the_first_source_and_names_it_without_fallback(self):
        seen = []

        def market_data(args, **_):
            seen.append(args)
            bars = [{"shape": "ohlc", "time": {"kind": "session_date", "value": f"2026-0{month}-01"}, "interval": None,
                     "completion": {"state": "completed", "basis": "source"}, "open": "1", "high": str(month * 10),
                     "low": "1", "close": str(month * 100)} for month in (1, 2, 3)]
            if args["criteria"].get("measurement") == "ohlc" and len(seen) > 1:
                return json.dumps(self.read_result(args["request"], outcome="error", issues=[
                    {"code": "incompatible_series", "message": "No series.", "severity": "error"}]))
            return json.dumps(self.read_result(args["request"], observations=bars))

        self.handlers[agent_reads.MARKET_DATA_TOOL] = market_data
        self.plugins["eodhd"] = self.contract("eodhd", enabled=False)
        result = self.call(agent_reads.prices, subject_id=ASML, start="2026-01-01", points=2)
        # The subject is read in core's one order, with market-data's read checks and audit labels.
        self.assertEqual(seen[0]["request"]["view"]["subject"], {"kind": "listing", "id": ASML})
        self.assertEqual(seen[0]["request"]["window"]["start"], {"kind": "session_date", "value": "2026-01-01"})
        self.assertEqual((result["source"]["source"], result["source"]["selected"], result["source"]["delay_seconds"]),
                         ("Yahoo Finance", "first in order", 900))
        self.assertEqual(result["summary"]["change_pct"], "200.00")
        self.assertEqual((result["summary"]["high"], len(result["bars"]), result["currency"]), ("30", 2, "EUR"))
        self.assertEqual(result["skipped"], [{"source": "EODHD", "provider": "eodhd", "plugin": "pythia-eodhd",
                                              "reason": "EODHD is disabled"}])
        # A named source is read explicitly; an incompatible OHLC request retries the same source's close series.
        named = self.call(agent_reads.prices, subject_id=ASML, start="2026-01-01", source="yahoo")
        self.assertEqual(seen[-2]["request"]["view"]["subject"]["provider"], "yahoo")
        self.assertEqual((seen[-2]["criteria"]["measurement"], "measurement" in seen[-1]["criteria"]), ("ohlc", False))
        self.assertEqual((named["outcome"], named["source"]["selected"]), ("ok", "named"))
        refused = self.call(agent_reads.prices, subject_id=ASML, source="eodhd")
        self.assertEqual(refused["issues"][0]["code"], "source_unavailable")
        self.assertIn("EODHD is disabled", refused["issues"][0]["message"])
        self.assertEqual(len(seen), 3)  # the refused source was never read

    def test_prices_latest_and_a_failure_offer_alternatives_not_a_substitute(self):
        quote = {"shape": "scalar", "time": {"kind": "instant", "value": "2026-09-26T09:59:00Z"}, "interval": None,
                 "completion": {"state": "unknown", "basis": "unknown"}, "value": "612.40"}
        self.handlers[agent_reads.MARKET_DATA_TOOL] = lambda args, **_: json.dumps(
            self.read_result(args["request"], observations=[quote]))
        latest = self.call(agent_reads.prices, subject_id=ASML)
        self.assertEqual(latest["quote"], {"t": "2026-09-26T09:59:00Z", "v": "612.40"})
        company = self.call(agent_reads.prices, subject_id=ASML_ISSUER)  # a company reads its primary listing
        self.assertEqual((company["subject_id"], self.ctx.calls[-1][1]["request"]["view"]["subject"]["id"]),
                         (ASML, ASML))
        self.assertEqual([row["source"] for row in latest["alternatives"]], ["EODHD"])
        # The label is the source that answered, as market-data reports it.
        self.handlers[agent_reads.MARKET_DATA_TOOL] = lambda args, **_: json.dumps(
            self.read_result(args["request"], provider="eodhd", observations=[quote]))
        served = self.call(agent_reads.prices, subject_id=ASML)
        self.assertEqual((served["source"]["source"], [row["source"] for row in served["alternatives"]]),
                         ("EODHD", ["Yahoo Finance"]))
        self.handlers[agent_reads.MARKET_DATA_TOOL] = lambda args, **_: json.dumps(self.read_result(
            args["request"], outcome="error", issues=[{"code": "source_error", "message": "Down.", "severity": "error"}]))
        failed = self.call(agent_reads.prices, subject_id=ASML)
        self.assertEqual((failed["outcome"], failed["source"]["source"]), ("error", "Yahoo Finance"))
        self.assertIn("Name one of the alternatives", failed["next"])
        self.assertEqual(len(self.ctx.calls), 4)

    def test_filings_front_core_combined_read_and_filter_by_form(self):
        xbrl = {"dataset": "filings", "provider": "xbrl-filings", "filings": filing_rows(["AFR", "IR", "AFR"])}
        sec = {"dataset": "filings", "provider": "sec", "filings": filing_rows(["6-K", "20-F/A", "20-F", "6-K"])}
        self.handlers["pythia_xbrl_filings_filings"] = lambda args, **_: envelope(xbrl)
        self.handlers["pythia_sec_filings"] = lambda args, **_: envelope(sec)
        result = self.call(agent_reads.filings, subject_id=ASML, forms=["afr", "20-f"])
        self.assertEqual([source["source"] for source in result["sources"]], ["filings.xbrl.org", "SEC EDGAR"])
        self.assertEqual([(row["form"], row["source"]) for row in result["filings"]],
                         [("AFR", "filings.xbrl.org"), ("20-F/A", "SEC EDGAR"), ("AFR", "filings.xbrl.org"),
                          ("20-F", "SEC EDGAR")])
        self.assertEqual(result["coverage"], {"matched": 4, "listed": 4})  # core searches by form
        annual = self.call(agent_reads.filings, subject_id=ASML, kinds=["annual"])
        self.assertEqual({row["kind"] for row in annual["filings"]}, {"annual"})
        self.assertEqual(annual["coverage"]["listed"], 4)  # core filters by kind: the IR and 6-Ks are left out
        # A common name reads that source first for its authorities; an unknown one says which exist.
        self.call(agent_reads.filings, subject_id=ASML, source="esef")
        self.assertIn("pythia_xbrl_filings_filings", [call[0] for call in self.ctx.calls[-2:]])
        unknown = self.call(agent_reads.filings, subject_id=ASML, source="bloomberg")
        self.assertEqual(unknown["issues"][0]["code"], "unknown_source")
        missing = self.call(agent_reads.filings, subject_id=ASML, forms=["10-K"])
        self.assertEqual(missing["outcome"], "empty")
        self.assertIn("None of the listed filings match", missing["next"])

    def test_prices_period_returns_follow_the_chart_rule(self):
        today = agent_reads.date(2026, 9, 26)
        self.assertEqual(agent_reads.period_start("1Y", today), agent_reads.date(2025, 9, 26))
        self.assertEqual(agent_reads.period_start("YTD", today), agent_reads.date(2026, 1, 1))
        self.assertEqual(agent_reads.period_start("1M", agent_reads.date(2026, 3, 31)), agent_reads.date(2026, 3, 3))
        bars = [{"shape": "ohlc", "time": {"kind": "session_date", "value": day}, "close": close}
                for day, close in (("2025-09-24", "100"), ("2025-09-25", "110"), ("2025-09-26", "120"),
                                   ("2026-09-25", "132"))]
        result = agent_reads._period_return("1Y", bars, agent_reads.date(2025, 9, 26))
        self.assertEqual((result["from"], result["change_pct"]), ({"t": "2025-09-25", "close": "110"}, "20.00"))
        self.handlers[agent_reads.MARKET_DATA_TOOL] = lambda args, **_: json.dumps(
            self.read_result(args["request"], observations=bars))
        read = self.call(agent_reads.prices, subject_id=ASML, period="1Y")
        self.assertEqual(read["period_return"]["period"], "1Y")
        self.assertEqual(self.ctx.calls[-1][1]["request"]["operation"], "history")
        refused = self.call(agent_reads.prices, subject_id=ASML, period="1Y", start="2026-01-01")
        self.assertEqual(refused["issues"][0]["code"], "invalid_request")

    def test_prices_periods_read_bounded_windows_around_their_start_and_end(self):
        today = agent_reads.datetime.now(agent_reads.timezone.utc).date()
        anchor = agent_reads.period_start("1Y", today)
        windows = []

        def market_data(args, **_):  # a crypto-like source: daily bars on instant edges, one year back at most
            window = args["request"]["window"]
            windows.append(window)
            start = window["start"] and window["start"]["value"][:10]
            if window["start"] and window["start"]["kind"] == "session_date":
                return json.dumps(self.read_result(args["request"], outcome="error", issues=[
                    {"code": "incompatible_series", "message": "No series.", "severity": "error"}]))
            if start and start <= anchor.isoformat():
                return json.dumps(self.read_result(args["request"], outcome="error", issues=[
                    {"code": "unsupported_window", "message": "Too far back.", "severity": "error"}]))
            first, last = agent_reads.date.fromisoformat(start), today
            bars = [{"shape": "ohlc", "time": {"kind": "instant", "value": f"{day.isoformat()}T00:00:00Z"},
                     "close": "100" if day < today - agent_reads.timedelta(days=30) else "150"}
                    for day in (first, first + agent_reads.timedelta(days=1), last)]
            return json.dumps(self.read_result(args["request"], observations=bars))

        self.handlers[agent_reads.MARKET_DATA_TOOL] = market_data
        read = self.call(agent_reads.prices, subject_id=ASML, period="1Y")
        self.assertTrue(all(window["end"] for window in windows))  # every read is bounded
        self.assertEqual(windows[0]["start"], {"kind": "session_date",
                                               "value": (anchor - agent_reads.BASE_SLACK).isoformat()})
        self.assertEqual(windows[-1]["start"], {"kind": "instant",  # the recent closes, after the dates were refused
                                                "value": f"{(today - agent_reads.BASE_SLACK).isoformat()}T00:00:00Z"})
        self.assertLessEqual(windows[-1]["end"]["value"], agent_reads.datetime.now(
            agent_reads.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
        period = read["period_return"]
        self.assertEqual((period["from"]["t"][:10], period["change_pct"]),
                         ((anchor + agent_reads.timedelta(days=1)).isoformat(), "50.00"))
        self.assertIn("first close on or after", period["basis"])

    def test_the_identity_answer_is_recorded_as_the_agent(self):
        with mock.patch.object(queue_ops.questions, "submit", return_value={"outcome": "refused"}) as submit:
            result = self.call(agent_tools.answer, item_id="q1", relation="none")
        self.assertEqual(result["data"], {"outcome": "refused"})
        self.assertEqual(submit.call_args.kwargs["resolver"], queue_ops.questions.ResolverKind.AGENT)


if __name__ == "__main__":
    unittest.main()
