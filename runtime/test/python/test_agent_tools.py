"""The agent's visible Pythia tools and the `pythia` depth command, over fakes: no model, no provider, no Hermes.

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
from test_identity_contracts import identity as fixture_identity

RUNTIME = Path(__file__).resolve().parents[2]
MANAGED = RUNTIME / "managed"
SNAPSHOT = Path(__file__).parent / "fixtures" / "agent-tools.json"
if "pythia_core_fixture" not in sys.modules:
    spec = importlib.util.spec_from_file_location("pythia_core_fixture", MANAGED / "core/__init__.py",
                                                  submodule_search_locations=[str(MANAGED / "core")])
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
core = sys.modules["pythia_core_fixture"]
agent_tools = importlib.import_module("pythia_core_fixture.agent_tools")
agent_reads = importlib.import_module("pythia_core_fixture.agent_reads")
command_module = importlib.import_module("pythia_core_fixture.pythia_command")
identity_ops = importlib.import_module("pythia_core_fixture.identity_ops")
queue_ops = importlib.import_module("pythia_core_fixture.queue_ops")
page = importlib.import_module("pythia_core_fixture.identity.page")
manifest = importlib.import_module("pythia_core_fixture.identity.manifest")
access = importlib.import_module("pythia_core_fixture.platform.access")
operations = importlib.import_module("pythia_core_fixture.platform.operations")

ASML = "listing:isin:NL0010273215:XAMS:EUR"
ASML_ISSUER = "issuer:lei:724500Y6DUVHQD6OXN27"


def definitions(plugin):
    spec = importlib.util.spec_from_file_location(f"agent_tools_{plugin.replace('-', '_')}_definition",
                                                  MANAGED / "plugins" / plugin / "definition.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.schemas(wire)


def contract(plugin, **state):
    """A plugin as `identity_ops.installed()` reports it; `operations` are its declared content exports."""
    raw = json.loads((MANAGED / "plugins" / plugin / "contract.json").read_text())
    parsed = manifest.validate_manifest(raw)
    operations = {entry.tool: str(section) for section, entry in parsed.content.items()}
    return page.PluginInfo(key=raw["plugin"], manifest=parsed, operations=operations, **state)


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
             "language": None} for index, form in enumerate(forms)]


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
        reference = Path(self.tmp.name) / "reference"
        reference.mkdir()
        db = sqlite3.connect(reference / "reference-20260926.sqlite3")
        db.executescript(fixture_identity.schema_sql("reference"))
        load_reference(db, load("asml.json"))
        db.execute("INSERT INTO release (key, value) VALUES ('schema_version', '2')")
        db.execute("INSERT INTO venues VALUES ('XAMS', 'XAMS', 'Euronext Amsterdam', 'NL')")
        db.commit()
        db.close()
        self.plugins = {name: contract(name) for name in ("sec", "xbrl-filings", "gleif", "yahoo-discovery", "eodhd")}
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
        self.eligible = set(self.schemas) | {agent_reads.MARKET_DATA_TOOL}
        self.handlers = {}
        self.ctx = Context(self.handlers)
        self.ctx.state = SimpleNamespace(data_dir=self.tmp.name)
        registry = ModuleType("tools.registry")
        registry.registry = SimpleNamespace(get_all_tool_names=lambda: list(self.schemas),
                                            get_schema=lambda name: self.schemas.get(name))
        self.enterContext(mock.patch.dict(sys.modules, {"tools": ModuleType("tools"), "tools.registry": registry,
                                                        **validator_module()}))
        self.enterContext(mock.patch.dict(os.environ, {"PYTHIA_REFERENCE_DIR": str(reference)}))
        self.enterContext(mock.patch.object(identity_ops, "installed", lambda: list(self.plugins.values())))
        self.enterContext(mock.patch.object(access, "eligible_tools", lambda: set(self.eligible)))
        self.enterContext(mock.patch.object(access, "native_tool_owners", lambda: dict(self.owners)))
        self.enterContext(mock.patch.object(identity_ops, "CURRENT", identity_ops.Identity(self.ctx)))

    def registered(self):
        """The tools core registers, leaving this fixture's identity in place."""
        ctx = Context({})
        with mock.patch.object(identity_ops, "CURRENT", identity_ops.CURRENT):
            core.register(ctx)
        return ctx.tools

    def pythia(self, command, args=None, **context):
        return json.loads(command_module.command(self.ctx, {"command": command, **({"args": args} if args is not None else {})},
                                                 **context))


class PythiaCommandTest(AgentToolFixture):
    def test_a_runs_a_declared_function_with_the_subject_filled_in(self):
        self.handlers["pythia_sec_facts"] = lambda args, **_: envelope({"facts": [{"concept": args["concepts"][0]}]})
        result = self.pythia("sec facts", {"subject_id": ASML, "taxonomy": "ifrs-full", "concepts": ["Revenue"]},
                             session_id="session-1", task_id="task-1", user_task="ignored")
        self.assertEqual((result["outcome"], result["function"]), ("ok", "sec facts"))
        name, args, context = self.ctx.calls[-1]
        self.assertEqual(name, "pythia_sec_facts")
        self.assertEqual(args["native_ref"], {"provider": "sec", "native_id": "0000937966", "native_scope": "cik"})
        self.assertNotIn("subject_id", args)
        self.assertEqual(context, {"session_id": "session-1", "task_id": "task-1"})
        # A leading `pythia` and a Yahoo symbol filled from the listing's MIC suffix work the same way.
        self.handlers["pythia_yahoo_research"] = lambda args, **_: envelope({"symbol": args["symbol"],
                                                                             "symbols": args["symbols"]})
        result = self.pythia("pythia yahoo finance", {"subject_id": ASML, "operation": "quote"})
        self.assertEqual(result["data"], {"symbol": "ASML.AS", "symbols": ["ASML.AS"]})  # quote reads `symbols`
        # A profile read is a function: core serves no profile concept yet (quote, chart and filings it does).
        self.handlers["pythia_gleif_profile"] = lambda args, **_: envelope({"lei": args["native_ref"]["native_id"]})
        self.assertEqual(self.pythia("gleif profile", {"subject_id": ASML})["data"], {"lei": "724500Y6DUVHQD6OXN27"})
        # Core's own read function passes its own subject_id through.
        self.handlers["pythia_identity_queue"] = lambda args, **_: envelope({"items": [args]})
        self.assertEqual(self.pythia("identity queue", {"subject_id": ASML})["data"]["items"], [{"subject_id": ASML}])

    def test_b_help_lists_sources_and_prints_one_functions_arguments(self):
        overview = self.pythia("help")
        sources = {row["source"]: row for row in overview["sources"]}
        self.assertEqual(list(sources), ["eodhd", "gleif", "identity", "sec", "xbrl-filings", "yahoo"])
        self.assertEqual(list(sources["eodhd"]["functions"]), ["fundamentals", "news"])  # eodhd-news is `eodhd news`
        self.assertEqual(list(sources["identity"]["functions"]), ["queue"])
        self.assertTrue(sources["sec"]["functions"]["facts"].startswith("Read bounded native XBRL facts"))
        self.assertEqual(sources["eodhd"]["functions"]["news"], "Not loaded in this profile.")
        self.assertEqual(self.pythia("sec")["functions"].keys(), {"facts", "fundamentals"})
        for form in ("help sec facts", "sec facts --help", "pythia sec facts help"):
            one = self.pythia(form)
            self.assertEqual(one["function"], "sec facts")
            self.assertEqual(one["arguments"]["required"], ["native_ref", "taxonomy", "concepts"])
            self.assertNotIn("$comment", json.dumps(one))
        self.assertEqual(self.ctx.calls, [])

    def test_c_bad_arguments_name_the_parameter_before_any_call(self):
        cases = [({"subject_id": ASML, "taxonomy": "ifrs-full"}, ("args:", "'concepts'")),
                 ({"subject_id": ASML, "taxonomy": "ifrs-full", "concepts": ["Revenue"], "limit": "5"},
                  ("args.limit:", "integer")),
                 ({"subject_id": ASML, "taxonomy": "gaap", "concepts": ["Revenue"]}, ("args.taxonomy:", "gaap")),
                 ({"subject_id": ASML, "taxonomy": "ifrs-full", "concepts": ["Revenue"], "form": "10-K"},
                  ("args:", "'form' was unexpected")),
                 ({"subject_id": ASML, "taxonomy": "ifrs-full", "concepts": ["Revenue"] * 9},
                  ("args.concepts:", "too long"))]
        for args, words in cases:
            with self.subTest(words=words):
                result = self.pythia("sec facts", args)
                self.assertEqual(result["issues"][0]["code"], "invalid_arguments")
                for word in words:
                    self.assertIn(word, result["issues"][0]["message"])
                self.assertEqual(result["usage"], "help sec facts")
        self.assertEqual(self.pythia("sec facts", ["x"])["issues"][0]["code"], "invalid_command")
        unknown = self.pythia("sec facts", {"subject_id": "listing:isin:XX0000000000:XAMS:EUR", "taxonomy": "ifrs-full",
                                            "concepts": ["Revenue"]})
        self.assertIn("Unknown subject", unknown["issues"][0]["message"])
        self.assertEqual(self.ctx.calls, [])

    def test_d_unknown_source_or_function_suggests_the_close_ones(self):
        source = self.pythia("secc facts")
        self.assertEqual(source["issues"][0]["code"], "unknown_source")
        self.assertIn("Did you mean sec?", source["issues"][0]["message"])
        function = self.pythia("sec fact")
        self.assertIn("Did you mean facts?", function["issues"][0]["message"])
        elsewhere = self.pythia("sec news")
        self.assertIn("Sources with a news function: eodhd", elsewhere["issues"][0]["message"])
        # Internal plumbing is not a function: the concept tools own quotes and filings.
        self.assertEqual(self.pythia("yahoo latest")["issues"][0]["code"], "unknown_function")
        self.assertEqual(self.pythia("sec filings")["issues"][0]["code"], "unknown_function")
        # Even if a contract listed it, a tool core runs for a concept tool is not a function.
        raw = json.loads((MANAGED / "plugins/sec/contract.json").read_text())
        self.plugins["sec"] = page.PluginInfo(key="pythia-sec", manifest=manifest.validate_manifest(
            {**raw, "functions": ["filings"]}))
        self.assertEqual(self.pythia("sec filings", {"subject_id": ASML})["issues"][0]["code"], "unknown_function")
        self.assertNotIn("filings", self.pythia("help")["sources"][3]["functions"])
        self.assertEqual(self.ctx.calls, [])

    def test_e_disabled_or_unconfigured_sources_say_why_without_a_call(self):
        self.plugins["sec"] = contract("sec", missing=({"key": "sec_identity", "label": "SEC contact",
                                                        "file": "settings.json", "status": "missing"},))
        self.plugins["gleif"] = contract("gleif", enabled=False)
        unconfigured = self.pythia("sec facts", {"subject_id": ASML, "taxonomy": "ifrs-full", "concepts": ["Revenue"]})
        self.assertEqual(unconfigured["issues"][0]["code"], "needs_configuration")
        self.assertIn("SEC contact (sec_identity in settings.json, missing)", unconfigured["issues"][0]["message"])
        disabled = self.pythia("gleif profile", {"subject_id": ASML})
        self.assertEqual(disabled["issues"][0]["code"], "unavailable")
        self.assertIn("disabled", self.pythia("help")["sources"][1]["unavailable"])
        self.assertEqual(self.ctx.calls, [])
        # A plugin's own needs_configuration result passes through unchanged.
        self.plugins["sec"] = contract("sec")
        blocked = {"schema_version": 1, "outcome": "error", "data": None, "issues": [{
            "code": "needs_configuration", "severity": "error", "fields": [], "message": "Add the SEC contact."}]}
        self.handlers["pythia_sec_fundamentals"] = lambda *_args, **_kw: json.dumps(blocked)
        self.assertEqual(self.pythia("sec fundamentals", {"subject_id": ASML})["issues"], blocked["issues"])

    def test_f_a_function_declared_as_a_write_is_refused_before_dispatch(self):
        verdict = copy.deepcopy(queue_ops.VERDICT_SCHEMA)
        operations.declare_operation(verdict, plugin="pythia", operation="identity-verdict", read_only=False)
        self.schemas["pythia_identity_verdict"] = verdict
        self.owners["pythia_identity_verdict"] = self.owners["pythia_identity_queue"]
        with mock.patch.object(command_module, "CORE", ("pythia", "identity", "identity",
                                                        ("identity-queue", "identity-verdict"))):
            refused = self.pythia("identity verdict", {"item_id": "q1", "relation": "none"})
        self.assertIn("not available as a read-only function", refused["issues"][0]["message"])
        comment = json.loads(self.schemas["pythia_sec_facts"]["parameters"]["$comment"])
        del comment["pythia_http_operation"]["read_only"]  # a hand-written marker that omits the key
        self.schemas["pythia_sec_facts"]["parameters"]["$comment"] = json.dumps(comment)
        unmarked = self.pythia("sec facts", {"subject_id": ASML, "taxonomy": "ifrs-full", "concepts": ["Revenue"]})
        self.assertIn("not available as a read-only function", unmarked["issues"][0]["message"])
        self.assertEqual(self.ctx.calls, [])

    def test_g_an_oversized_result_is_shortened_and_says_so(self):
        rows = [{"concept": "Revenue", "value": str(index), "period": "2025"} for index in range(5000)]
        self.handlers["pythia_sec_facts"] = lambda *_args, **_kw: envelope({"facts": rows})
        text = command_module.command(self.ctx, {"command": "sec facts", "args": {
            "subject_id": ASML, "taxonomy": "ifrs-full", "concepts": ["Revenue"]}})
        self.assertLessEqual(len(text), agent_tools.MAX_CHARS)
        result = json.loads(text)
        self.assertEqual(result["truncated"]["field"], "data.facts")
        self.assertEqual(result["truncated"]["total"], 5000)
        self.assertEqual(len(result["data"]["facts"]), result["truncated"]["returned"])
        self.handlers["pythia_sec_facts"] = lambda *_args, **_kw: envelope({"note": "x" * 40000})
        too_large = self.pythia("sec facts", {"subject_id": ASML, "taxonomy": "ifrs-full", "concepts": ["Revenue"]})
        self.assertEqual(too_large["issues"][0]["code"], "result_too_large")

    def test_h_hidden_tools_run_only_through_may_run(self):
        self.handlers["pythia_yahoo_research"] = lambda *_args, **_kw: envelope({"ok": True})
        visible = {name for name, entry in self.registered().items() if entry["toolset"] == agent_tools.TOOLSET}
        self.assertNotIn("pythia_yahoo_research", visible)
        self.assertNotIn("pythia_identity_queue", visible)
        self.assertEqual(self.pythia("yahoo finance", {"subject_id": ASML, "operation": "quote"})["data"], {"ok": True})
        self.eligible.discard("pythia_yahoo_research")  # may_run: plugin disabled or its availability check fails
        denied = self.pythia("yahoo finance", {"subject_id": ASML, "operation": "quote"})
        self.assertEqual(denied["issues"][0]["code"], "unavailable")
        self.assertEqual([call[0] for call in self.ctx.calls], ["pythia_yahoo_research"])

    def test_i_a_raising_handler_becomes_a_source_error_without_its_text(self):
        def broken(*_args, **_kwargs):
            raise RuntimeError("secret-token-in-exception")
        self.handlers["pythia_sec_facts"] = broken
        with self.assertLogs(agent_tools.logger, "WARNING"):
            result = self.pythia("sec facts", {"subject_id": ASML, "taxonomy": "ifrs-full", "concepts": ["Revenue"]})
        self.assertEqual(result["issues"][0]["code"], "source_error")
        self.assertNotIn("secret-token", json.dumps(result))
        self.handlers["pythia_sec_facts"] = lambda *_args, **_kw: "not json"
        self.assertEqual(self.pythia("sec facts", {"subject_id": ASML, "taxonomy": "ifrs-full", "concepts": ["Revenue"]})
                         ["issues"][0]["code"], "invalid_response")

    def test_j_the_visible_tool_list_is_byte_stable_while_plugins_change(self):
        def visible():
            tools = self.registered()
            return json.dumps([tools[name]["schema"] for name in sorted(tools)
                               if tools[name]["toolset"] == agent_tools.TOOLSET], separators=(",", ":"))
        first = visible()
        self.plugins["sec"] = contract("sec", enabled=False)
        self.plugins.pop("eodhd")
        self.assertEqual(visible(), first)  # plugin state reaches results (help), never the schemas
        self.assertEqual(self.pythia("help"), self.pythia("help"))


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

    def test_find_rows_hand_over_identifiers_and_the_next_step(self):
        result = self.call(agent_tools.find, query="asml")
        row = result["data"]["rows"][0]
        self.assertEqual((row["id"], row["isin"], row["lei"], row["cik"]),
                         (ASML, "NL0010273215", "724500Y6DUVHQD6OXN27", "937966"))
        self.assertNotIn("bindings", row)
        self.assertIn("pythia_instrument", result["next"])

    def test_instrument_names_the_source_of_each_concept(self):
        result = self.call(agent_tools.instrument, subject_id=ASML)
        sources = {row["concept"]: row for row in result["data"]["sources"]}
        self.assertEqual(sources["quote"]["source"], "Yahoo Finance")
        self.assertEqual(sources["filings"]["source"], "filings.xbrl.org")
        self.assertEqual([item["source"] for item in sources["filings"]["alternatives"]], ["SEC EDGAR"])
        self.assertNotIn("request", json.dumps(result))  # Desk's operation requests stay out of the agent's view
        self.assertEqual(result["data"]["identifiers"]["lei"], "724500Y6DUVHQD6OXN27")

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
        self.plugins["eodhd"] = contract("eodhd", enabled=False)
        result = self.call(agent_reads.prices, subject_id=ASML, start="2026-01-01", points=2)
        yahoo = {"provider": "yahoo", "native_id": "ASML.AS", "native_scope": "symbol"}
        self.assertEqual(seen[0]["request"]["view"]["subject"], yahoo)  # the source core chose, and labels
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
        self.assertEqual((company["subject_id"], self.ctx.calls[-1][1]["request"]["view"]["subject"]["native_id"]),
                         (ASML, "ASML.AS"))
        self.assertEqual([row["source"] for row in latest["alternatives"]], ["EODHD"])
        self.handlers[agent_reads.MARKET_DATA_TOOL] = lambda args, **_: json.dumps(self.read_result(
            args["request"], outcome="error", issues=[{"code": "source_error", "message": "Down.", "severity": "error"}]))
        failed = self.call(agent_reads.prices, subject_id=ASML)
        self.assertEqual((failed["outcome"], failed["source"]["source"]), ("error", "Yahoo Finance"))
        self.assertIn("Name one of the alternatives", failed["next"])
        self.assertEqual(len(self.ctx.calls), 3)

    def test_filings_use_the_first_filings_source_and_filter_by_form(self):
        xbrl = {"dataset": "filings", "provider": "xbrl-filings", "observed_at": "2026-09-26T10:00:00Z",
                "filings": filing_rows(["AFR", "IR", "AFR"]), "coverage": {"scope": "indexed_reports", "total_available": 3}}
        sec = {"dataset": "filings", "provider": "sec", "observed_at": "2026-09-26T10:00:00Z",
               "filings": filing_rows(["6-K", "20-F/A", "20-F", "6-K"]), "coverage": {"scope": "recent_submissions",
                                                                                   "total_available": 400}}
        self.handlers["pythia_xbrl_filings_filings"] = lambda args, **_: envelope(xbrl)
        self.handlers["pythia_sec_filings"] = lambda args, **_: envelope(sec)
        result = self.call(agent_reads.filings, subject_id=ASML, forms=["afr"])
        self.assertEqual(result["source"]["source"], "filings.xbrl.org")
        self.assertEqual([row["form"] for row in result["filings"]], ["AFR", "AFR"])
        self.assertEqual(self.ctx.calls[-1][1]["native_ref"]["native_id"], "724500Y6DUVHQD6OXN27")
        self.assertEqual([row["source"] for row in result["alternatives"]], ["SEC EDGAR"])
        named = self.call(agent_reads.filings, subject_id=ASML, forms=["20-F"], source="sec", limit=1)
        self.assertEqual((named["filings"][0]["form"], named["coverage"]["matched"]), ("20-F/A", 2))
        missing = self.call(agent_reads.filings, subject_id=ASML, forms=["10-K"], source="sec")
        self.assertEqual(missing["outcome"], "empty")
        self.assertIn("Only the 4 most recent filings were searched", missing["next"])

    def test_the_identity_answer_is_recorded_as_the_agent(self):
        with mock.patch.object(queue_ops.questions, "submit", return_value={"outcome": "refused"}) as submit:
            result = self.call(agent_tools.answer, item_id="q1", relation="none")
        self.assertEqual(result["data"], {"outcome": "refused"})
        self.assertEqual(submit.call_args.kwargs["resolver"], queue_ops.questions.ResolverKind.AGENT)


class DeliveredViewTest(unittest.TestCase):
    """What the model receives from Pythia: a reviewed snapshot, size budgets and no operation markers."""

    def visible(self):
        ctx = Context({})
        with mock.patch.object(identity_ops, "CURRENT", None):
            core.register(ctx)
        return [ctx.tools[name]["schema"] for name in ctx.tools if ctx.tools[name]["toolset"] == agent_tools.TOOLSET]

    def test_the_visible_tools_match_the_reviewed_snapshot(self):
        schemas = self.visible()
        if os.environ.get("PYTHIA_UPDATE_SNAPSHOTS") == "1":
            SNAPSHOT.write_text(json.dumps(schemas, indent=2, ensure_ascii=False) + "\n")
        self.assertEqual(schemas, json.loads(SNAPSHOT.read_text()),
                         "The model-visible tool list changed. It is every session's cached prefix: review the "
                         "change, then rerun with PYTHIA_UPDATE_SNAPSHOTS=1 and format the file with Biome to accept it.")

    def test_registration_order_leaves_one_verdict_operation_and_no_marker_on_the_answer(self):
        with mock.patch.object(identity_ops, "CURRENT", None):
            for _ in range(2):  # core registered before (as the loaded plugin is) stamps the shared Desk schema
                ctx = Context({})
                core.register(ctx)
        declared = [name for name, entry in ctx.tools.items()
                    if (operations.declaration(entry["schema"]) or {}).get("operation") == "identity-verdict"]
        self.assertEqual(declared, ["pythia_identity_verdict"])
        self.assertNotIn("$comment", json.dumps(ctx.tools["pythia_answer_identity_question"]["schema"]))

    def test_budgets_and_no_operation_markers(self):
        schemas = self.visible()
        sizes = {schema["name"]: len(json.dumps(schema, separators=(",", ":"))) for schema in schemas}
        self.assertEqual(sorted(sizes), ["pythia", "pythia_answer_identity_question", "pythia_desk_view",
                                         "pythia_filings", "pythia_find", "pythia_instrument", "pythia_prices"])
        for name, size in sizes.items():
            self.assertLessEqual(size, 2000, name)
        self.assertLessEqual(sum(sizes.values()), 9200)  # about 2,300 tokens by Hermes's chars/4
        for schema in schemas:
            self.assertLessEqual(len(schema["description"]), 700, schema["name"])
            self.assertNotIn("$comment", json.dumps(schema), schema["name"])

    def test_the_seed_hides_plugin_toolsets_and_turns_tool_search_off(self):
        import re
        text = (RUNTIME / "seeds/profile/config.yaml").read_text()
        self.assertRegex(text, r'\ntools:\n  tool_search:\n    enabled: "off"\n')
        block = text.split("known_plugin_toolsets:\n", 1)[1].split("\ntools:", 1)[0]
        hidden = {platform: re.findall(r"^    - (\S+)$", body, re.M)
                  for platform, body in re.findall(r"^  (\w+):\n((?:    - \S+\n)+)", block + "\n", re.M)}
        # One hidden toolset for every plugin operation; the agent's tools serve Desk chat only.
        self.assertEqual(hidden, {"api_server": [identity_ops.TOOLSET], "cli": [identity_ops.TOOLSET, agent_tools.TOOLSET],
                                  "cron": [identity_ops.TOOLSET, agent_tools.TOOLSET]})
        for plugin in (MANAGED / "plugins").iterdir():
            sources = "".join(path.read_text() for path in plugin.glob("*.py"))
            self.assertNotRegex(sources, r"toolset=['\"](?!pythia-core)|TOOLSET = ['\"](?!pythia-core)", plugin.name)


if __name__ == "__main__":
    unittest.main()
