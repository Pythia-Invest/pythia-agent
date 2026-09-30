"""What the model receives from Pythia, checked in milliseconds without Hermes, a model or a provider.

The tool list is rendered from core and every managed plugin, compared with the reviewed snapshot
fixtures/agent-tools.json, held to size budgets, and checked against the operating section and the routes of the
live eval's questions (tooling/agent-eval/questions.json).
"""
import functools
import importlib
import importlib.util
import json
import os
import re
import sys
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest import mock

from native_plugin_fixtures import keep_platform_binding
from test_agent_tools import MANAGED, RUNTIME, Context, agent_tools, core, identity_ops, operations

SNAPSHOT = Path(__file__).parent / "fixtures" / "agent-tools.json"
operating = importlib.import_module("pythia_core_fixture.operating")


class Loader(Context):
    """The PluginContext calls a plugin's register makes beyond the fixture's; none of them reaches the model."""

    def has_plugin(self, _name):
        return True

    def register_skill(self, *_args, **_kwargs):
        pass

    def register_cli_command(self, *_args, **_kwargs):
        pass


@functools.cache
def delivered():
    """Pythia's tools as the pinned Hermes offers them to an api_server turn with Tool Search off.

    Core and every managed plugin register through a minimal stand-in for Hermes's plugin loader; the hidden
    pythia-core toolset is left out, and the rest is sorted by name as registry.get_definitions sorts it. With Tool
    Search on, the same tools are deferred and listed by their first sentence. agent_tools_native.py checks this
    list against the real Hermes in `just qualify`.
    """
    def package(path, name, run=True):
        spec = importlib.util.spec_from_file_location(name, path / "__init__.py", submodule_search_locations=[str(path)])
        module = sys.modules[name] = importlib.util.module_from_spec(spec)
        if run:
            spec.loader.exec_module(module)
        return module

    market = package(MANAGED / "plugins/market-data", "delivered_market_data", run=False)  # its modules, not its tools
    loaded = {key: SimpleNamespace(manifest=SimpleNamespace(name=key), enabled=True, module=module)
              for key, module in (("pythia", core), ("pythia-market-data", market))}
    manager = ModuleType("hermes_cli.plugins")
    manager.get_plugin_manager = lambda: SimpleNamespace(_plugins=loaded)
    tools = {}
    registry = ModuleType("tools.registry")
    registry.registry = SimpleNamespace(get_schema=lambda name: tools.get(name, {}).get("schema"),
                                        get_entry=lambda name: SimpleNamespace(**tools[name]) if name in tools else None,
                                        get_all_tool_names=lambda: list(tools))
    with mock.patch.dict(sys.modules, {"hermes_cli": ModuleType("hermes_cli"), "hermes_cli.plugins": manager,
                                       "tools": ModuleType("tools"), "tools.registry": registry}), \
            mock.patch.object(identity_ops, "CURRENT", None):
        ctx = Loader({})
        ctx.tools = tools
        core.register(ctx)
        for path in sorted((MANAGED / "plugins").iterdir()):
            if path.name == "market-data":
                continue
            ctx = Loader({})
            ctx.tools = tools
            ctx.plugin_id = next(line.split(":", 1)[1].strip() for line in (path / "plugin.yaml").read_text().splitlines()
                                 if line.startswith("name:"))
            ctx.manifest = SimpleNamespace(name=ctx.plugin_id, path=str(path))
            package(path, "delivered_" + path.name.replace("-", "_")).register(ctx)
    return [tools[name]["schema"] for name in sorted(tools) if tools[name]["toolset"] != identity_ops.TOOLSET]


class DeliveredViewTest(unittest.TestCase):
    """What the model receives from Pythia: a reviewed snapshot, size budgets, no operation markers, and routes."""

    def test_the_delivered_tools_match_the_reviewed_snapshot(self):
        schemas = delivered()
        if os.environ.get("PYTHIA_UPDATE_SNAPSHOTS") == "1":
            SNAPSHOT.write_text(json.dumps(schemas, indent=2, ensure_ascii=False) + "\n")
        self.assertEqual(schemas, json.loads(SNAPSHOT.read_text()),
                         "The model-visible tool list changed. It is every session's cached prefix: review the "
                         "change, then rerun with PYTHIA_UPDATE_SNAPSHOTS=1 and format the file with Biome to accept it.")

    def test_registration_order_leaves_one_verdict_operation_and_no_marker_on_the_answer(self):
        keep_platform_binding(self)
        with mock.patch.object(identity_ops, "CURRENT", None):
            for _ in range(2):  # core registered before (as the loaded plugin is) stamps the shared Desk schema
                ctx = Context({})
                core.register(ctx)
        declared = [name for name, entry in ctx.tools.items()
                    if (operations.declaration(entry["schema"]) or {}).get("operation") == "identity-verdict"]
        self.assertEqual(declared, ["pythia_identity_verdict"])
        self.assertNotIn("$comment", json.dumps(ctx.tools["pythia_answer_identity_question"]["schema"]))

    def test_budgets_and_no_operation_markers(self):
        schemas = delivered()
        sizes = {schema["name"]: len(json.dumps(schema, separators=(",", ":"))) for schema in schemas}
        for name, size in sizes.items():
            self.assertLessEqual(size, 2000, name)
        self.assertLessEqual(sum(sizes.values()), 17000)  # about 4,250 tokens by Hermes's chars/4
        for schema in schemas:
            self.assertLessEqual(len(schema["description"]), 700, schema["name"])
            self.assertNotIn("$comment", json.dumps(schema), schema["name"])
            # Tool Search lists a deferred tool by its first sentence, clipped past 60 characters (tools/tool_search.py).
            first = re.split(r"(?<=[.!?])\s", " ".join(schema["description"].split()), maxsplit=1)[0]
            self.assertLessEqual(len(first), 60, schema["name"])
        desk = {"platform": "api_server"}
        section = operating.operating_context(desk) + operating.routing_context(desk)
        # Their sizes against the registered max_chars are test_core's check.
        named = set(re.findall(r"\bpythia_\w+", section))
        self.assertLessEqual(named, set(sizes), "the operating section names a tool the model does not get")
        prefixes = set(re.findall(r"\b([a-z]+_)(?=[,)])", section))
        self.assertEqual(prefixes, {name.split("_")[0] + "_" for name in sizes} - {"pythia_"},
                         "the operating section's provider prefixes differ from the delivered provider tools")

    def test_each_eval_question_can_route_to_its_expected_calls(self):
        schemas = {schema["name"]: schema["parameters"] for schema in delivered()}
        questions = json.loads((RUNTIME.parent / "tooling/agent-eval/questions.json").read_text())["questions"]
        for question in questions:
            for step in question["route"]:
                with self.subTest(question=question["id"], tool=step["tool"]):
                    self.assertIn(step["tool"], schemas)
                    parameters = schemas[step["tool"]]
                    self.assertLessEqual(set(parameters.get("required", [])), set(step["arguments"]))
                    for key, value in step["arguments"].items():
                        spec = parameters["properties"][key]
                        allowed = spec.get("enum") or spec.get("items", {}).get("enum")
                        for item in value if isinstance(value, list) else [value]:
                            self.assertTrue(allowed is None or item in allowed, f"{key}={item!r}")

    def test_the_seed_hides_plugin_toolsets_and_leaves_tool_search_to_the_investor(self):
        text = (RUNTIME / "seeds/profile/config.yaml").read_text()
        self.assertNotIn("tool_search", text)  # Tool Search on or off is the investor's own Hermes setting
        block = text.split("known_plugin_toolsets:\n", 1)[1].split("\ntools:", 1)[0]
        hidden = {platform: re.findall(r"^    - (\S+)$", body, re.M)
                  for platform, body in re.findall(r"^  (\w+):\n((?:    - \S+\n)+)", block + "\n", re.M)}
        # Plugin operations share core's hidden toolset; Pythia's and the plugins' agent tools serve Desk chat only.
        providers = ["pythia-sec", "pythia-xbrl-filings", "pythia-gleif", "pythia-eodhd", "pythia-yahoo-discovery",
                     "pythia-coinmarketcap", "pythia-openfigi", "pythia-hyperliquid"]
        elsewhere = [identity_ops.TOOLSET, agent_tools.TOOLSET, *providers]
        self.assertEqual(hidden, {"api_server": [identity_ops.TOOLSET], "cli": elsewhere, "cron": elsewhere})
        for plugin in (MANAGED / "plugins").iterdir():
            sources = "".join(path.read_text() for path in plugin.glob("*.py"))
            self.assertNotRegex(sources, r"toolset=['\"](?!pythia-core)|TOOLSET = ['\"](?!pythia-core)", plugin.name)


if __name__ == "__main__":
    unittest.main()
