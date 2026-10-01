"""Provider-free qualification of the agent's tool surface against the pinned native Hermes.

It copies the managed core and plugins into a disposable profile seeded from runtime/seeds/profile/config.yaml,
then asks Hermes itself what an api_server turn delivers and how calls flow, in both Tool Search modes (the
investor's own setting; Pythia never changes it):

- off: the tools array holds core's pythia-desk tools and the plugins' provider tools, never their operation
  tools; their schemas and order equal the reviewed snapshot; no `$comment` marker reaches the model; byte-stable;
- on: the same tools are the deferred catalogue, `tool_search` finds the right one for investor phrasing, and
  `tool_call` reaches a provider tool;
- a hidden operation tool still runs for Desk HTTP and through `may_run`, while the model never sees it;
- every declared Desk HTTP operation has exactly one tool, and `identity-verdict` still resolves;
- cli and cron see no Pythia tool; the data-routing paragraph reaches Desk chat only; agent-initiated skill writing is off;
- a bad argument is named by the real JSON-Schema validator before any provider is asked;
- a plugin `approve` directive on api_server is an instant deny at this release (no human round-trip).

No model, provider or network is used.
Usage: <hermes venv python> agent_tools_native.py --hermes-source <dir> --repository <dir>
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

CORE = ["pythia_answer_identity_question", "pythia_desk_view", "pythia_document", "pythia_filings", "pythia_find",
        "pythia_identity_questions", "pythia_instrument", "pythia_prices", "pythia_propose_identity_correction"]
PROVIDERS = {"sec_company_facts", "sec_fundamentals", "esef_fundamentals", "esef_company_facts", "gleif_legal_entity",
             "eodhd_news", "eodhd_fundamentals", "yahoo_finance", "coinmarketcap_coin_info", "openfigi_identifiers",
             "hyperliquid_live_market"}
FIGURES = {"sec_company_facts", "sec_fundamentals", "esef_fundamentals", "esef_company_facts", "eodhd_fundamentals",
           "yahoo_finance"}
QUERIES = {"price of ASML": {"pythia_prices"}, "10-K annual report": {"pythia_filings"},
           "read a filing's risk factors section": {"pythia_document"}, "ISIN lookup": {"pythia_find"},
           "revenue": FIGURES, "earnings": FIGURES, "balance sheet": FIGURES, "dividend": {"yahoo_finance"},
           "news": {"eodhd_news", "yahoo_finance"}, "legal entity": {"gleif_legal_entity"},
           "price of bitcoin": {"pythia_prices"}, "perp funding rate": {"hyperliquid_live_market"}}
# Price questions must rank the concept tool first, not a provider tool that mentions prices.
FIRST = {"price of ASML": "pythia_prices", "price of bitcoin": "pythia_prices"}

CHILD = r'''
import json, os, sys
sys.path.insert(0, os.environ["HERMES_SOURCE"])
from hermes_cli.plugins import discover_plugins, get_plugin_manager
discover_plugins()
manager = get_plugin_manager()
broken = {key: plugin.error for key, plugin in manager._plugins.items()
          if plugin.error and (key == "pythia" or key.startswith("pythia-"))}
if broken:  # otherwise the first symptom is an operation that resolves to nothing
    sys.exit("Pythia plugins failed to load: " + json.dumps(broken))
from gateway.session_context import set_session_vars
set_session_vars(platform="api_server")
from hermes_cli.config import load_config_readonly
from tools import write_approval as skill_gate
from hermes_cli.tools_config import _get_platform_tools
import model_tools
from tools.registry import registry
from tools.tool_search import ToolSearchConfig, assemble_tool_defs
enabled = sorted(_get_platform_tools(load_config_readonly(), "api_server", include_default_mcp_servers=False))
queries = json.loads(os.environ["PROBE_QUERIES"])

def assembled(mode, platform_enabled=enabled):
    model_tools._clear_tool_defs_cache()
    raw = model_tools.get_tool_definitions(enabled_toolsets=platform_enabled, quiet_mode=True,
                                           skip_tool_search_assembly=True)
    return assemble_tool_defs(raw, context_length=272000, config=ToolSearchConfig.from_raw({"enabled": mode})).tool_defs

names = lambda defs: [item["function"]["name"] for item in defs]
loaded, loaded_again = assembled("off"), assembled("off")
deferred, deferred_again = assembled("on"), assembled("on")
listing = next((item["function"]["description"] for item in deferred if item["function"]["name"] == "tool_search"), "")
searches = {}
for query in queries:
    found = json.loads(model_tools.handle_function_call("tool_search", {"queries": [query]}, enabled_toolsets=enabled))
    searches[query] = (found.get("results") or [{}])[0].get("matches", [])[:3]
seen = []
manager._hooks.setdefault("pre_tool_call", []).append(lambda tool_name="", **_: seen.append(tool_name))
bridged = json.loads(model_tools.handle_function_call("tool_call", {"name": "gleif_legal_entity", "arguments": {
    "subject_id": "issuer:lei:724500Y6DUVHQD6OXN27"}}, enabled_toolsets=enabled, session_id="probe", task_id="probe"))
bad = json.loads(model_tools.handle_function_call("gleif_legal_entity", {"subject_id": 12},
                                                  session_id="probe", task_id="probe"))
answer = json.loads(model_tools.handle_function_call("pythia_answer_identity_question",
    {"item_id": "probe", "relation": "none"}, session_id="probe", task_id="probe"))
manager._hooks["pre_tool_call"].append(lambda tool_name="", **_: {"action": "approve", "message": "probe"}
                                       if tool_name == "skills_list" else None)
asked = json.loads(model_tools.handle_function_call("skills_list", {}, session_id="probe", task_id="probe"))
core = manager._plugins["pythia"].module
agent_tools = sys.modules[core.__name__ + ".agent_tools"]
http = json.loads(core.platform.http.execute("pythia", "identity-queue", {}, None, lambda: False))
set_session_vars(platform="api_server")  # the HTTP path binds and clears its own caller context
declared = {}
for name, (key, _plugin) in core.platform.access.native_tool_owners().items():
    meta = core.platform.operations.declaration(registry.get_schema(name) or {})
    if isinstance(meta, dict):
        declared.setdefault((key, meta.get("operation")), []).append(name)
verdict = core.platform.operations.resolve("pythia", "identity-verdict", {"item_id": "probe", "relation": "none"})[0]
elsewhere = {platform: [name for name in names(assembled("off", sorted(_get_platform_tools(
    load_config_readonly(), platform, include_default_mcp_servers=False)))) if name.startswith("pythia")
    or name.split("_")[0] in ("sec", "esef", "gleif", "eodhd", "yahoo", "coinmarketcap", "openfigi")]
    for platform in ("cli", "cron")}
routing = {platform: "pythia_find" in "".join(section.content for section in manager.render_system_prompt_sections(
    {"platform": platform}) if section.id in ("pythia.operating", "pythia.routing")) for platform in ("api_server", "cli", "cron")}
print(json.dumps({
    "loaded": names(loaded), "deferred_visible": names(deferred),
    "catalog": sorted({line.split(":", 1)[0].strip().lstrip("- ") for line in listing.splitlines()
                       if ":" in line and not line.strip().endswith(":")}),
    "byte_stable": json.dumps(loaded) == json.dumps(loaded_again) and json.dumps(deferred) == json.dumps(deferred_again),
    "schemas": [item["function"] for item in loaded],
    "with_comment": [item["function"]["name"] for item in loaded + deferred if "$comment" in json.dumps(item)],
    "searches": searches, "tool_call": bridged, "hook_saw": seen, "bad_argument": bad, "answer": answer,
    "approve_on_api_server": asked, "http_hidden_run": http.get("schema_version"),
    "may_run_hidden": agent_tools.may_run("pythia-sec", "facts"),
    "duplicate_operations": {f"{key}/{operation}": tools for (key, operation), tools in declared.items() if len(tools) > 1},
    "identity_verdict_tool": verdict, "pythia_tools_on": elsewhere, "routing_prompt_on": routing,
    "skill_writing_interval": (load_config_readonly().get("skills") or {}).get("creation_nudge_interval"),
    "skill_write_saved": skill_gate.evaluate_gate(skill_gate.SKILLS).allow,
    "curator_enabled": (load_config_readonly().get("curator") or {}).get("enabled"),
}))
'''


def without_context_probe(core: Path) -> None:
    """Undo what the assembled run appends to the fixture's copy of core (assembled-fixture.mjs instrumentContextProbe).

    That probe needs the lifecycle's environment to register and adds a tool that a platform with no toolset list
    would deliver; this run audits core's own tools, so it reads core as committed."""
    start, tool = "# BEGIN PYTHIA T08 DISPOSABLE CONTEXT PROBE", "pythia_qualification_context_probe"
    init, manifest = core / "__init__.py", core / "plugin.yaml"
    init.write_text(init.read_text().split(start)[0].rstrip("\n") + "\n")
    manifest.write_text("".join(line for line in manifest.read_text().splitlines(keepends=True) if tool not in line))


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hermes-source", required=True, type=Path)
    parser.add_argument("--repository", required=True, type=Path)
    return parser.parse_args()


def main() -> int:
    options = arguments()
    managed = options.repository / "runtime/managed"
    with tempfile.TemporaryDirectory(prefix="pythia-agent-tools-") as scratch:
        root = Path(scratch)
        home, config, skills = root / "hermes", root / "config", root / "skills"
        for path in (home / "plugins", config, skills):
            path.mkdir(parents=True, mode=0o700)
        shutil.copytree(managed / "core", home / "plugins/pythia")
        without_context_probe(home / "plugins/pythia")
        names = ["pythia"]
        for package in sorted((managed / "plugins").iterdir()):
            name = next(line.split(":", 1)[1].strip() for line in (package / "plugin.yaml").read_text().splitlines()
                        if line.startswith("name:"))
            shutil.copytree(package, home / "plugins" / name)
            names.append(name)
        seed = (options.repository / "runtime/seeds/profile/config.yaml").read_text()
        seed = seed.replace("${PYTHIA_MANAGED_SKILLS_DIR}", str(skills))
        seed = seed.replace("plugins:\n  enabled:\n    - pythia\n",
                            "plugins:\n  enabled:\n" + "".join(f"    - {name}\n" for name in names))
        (home / "config.yaml").write_text(seed)
        # The Yahoo worker's availability check only needs its built file and a node path; nothing runs it here.
        environment = {"PATH": os.environ.get("PATH", ""), "HOME": str(root), "HERMES_HOME": str(home),
                       "PYTHIA_CONFIG_ROOT": str(config), "PYTHIA_DATA_ROOT": str(root), "PYTHIA_CACHE_ROOT": str(root),
                       "HERMES_SOURCE": str(options.hermes_source),
                       "PYTHIA_MANAGED_ROOT": str(managed), "PYTHIA_NODE": shutil.which("node") or "",
                       "PROBE_QUERIES": json.dumps(list(QUERIES))}
        completed = subprocess.run([sys.executable, "-c", CHILD], cwd=options.hermes_source, env=environment,
                                   capture_output=True, text=True, timeout=180, check=False)
        if completed.returncode:
            print(completed.stderr[-4000:], file=sys.stderr)
            return completed.returncode
        report = json.loads(completed.stdout.strip().splitlines()[-1])
    print(json.dumps({key: value for key, value in report.items() if key != "schemas"}, indent=1))
    snapshot = json.loads((options.repository / "runtime/test/python/fixtures/agent-tools.json").read_text())
    offered = set(CORE) | PROVIDERS
    loaded = set(report["loaded"])
    pythia_loaded = {name for name in loaded if name in offered or name.startswith("pythia")}
    bridge = {"tool_search", "tool_describe", "tool_call"}
    problems = [message for failed, message in (
        (not set(CORE) <= loaded, "Tool Search off: a core Pythia tool is missing"),
        (not {"sec_company_facts", "esef_fundamentals", "gleif_legal_entity", "yahoo_finance"} <= loaded,
         "Tool Search off: provider tools are missing"),
        (pythia_loaded - offered, "Tool Search off: an operation tool reaches the model"),
        (bool(loaded & bridge), "Tool Search off: the bridge is still there"),
        (not bridge <= set(report["deferred_visible"]) or set(report["deferred_visible"]) & offered,
         "Tool Search on: Pythia's tools are not deferred behind the bridge"),
        (set(report["catalog"]) & offered != pythia_loaded,
         "Tool Search on: the catalogue differs from the offered tools (an operation leaked or a tool is missing)"),
        (any(not set(report["searches"][query]) & wanted for query, wanted in QUERIES.items()),
         "tool_search does not find the right tool for investor phrasing"),
        (any((report["searches"][query] or [None])[0] != tool for query, tool in FIRST.items()),
         "tool_search ranks another tool above pythia_prices for a price question"),
        ("unknown" in json.dumps(report["tool_call"]).lower() or "error" in report["tool_call"],
         "tool_call does not reach a provider tool"),
        (not report["byte_stable"], "the tool list changed between two assemblies"),
        (report["with_comment"], "an operation marker reaches the model"),
        ([item for item in report["schemas"] if item["name"] in offered] != [item for item in snapshot if item["name"] in loaded],
         "the delivered Pythia schemas differ from runtime/test/python/fixtures/agent-tools.json"),
        (report["may_run_hidden"] != "pythia_sec_facts", "may_run lost a hidden operation tool"),
        (report["http_hidden_run"] != 1, "Desk HTTP cannot run a hidden operation tool"),
        ("pythia_gleif_profile" in report["hook_saw"], "pre_tool_call saw a nested operation call"),
        ("error" in report["answer"], "the identity answer did not run"),
        ("unattended platform" not in report["approve_on_api_server"].get("error", ""),
         "api_server approvals now round-trip: revisit the permission design"),
        (report["duplicate_operations"], "an operation is declared by more than one tool"),
        (report["identity_verdict_tool"] != "pythia_identity_verdict", "Desk's identity-verdict no longer resolves"),
        (not str((report["bad_argument"].get("issues") or [{}])[0].get("message", "")).startswith("args.subject_id:"),
         "a bad argument is not named"),
        (any(report["pythia_tools_on"].values()), "cli or cron sees Pythia tools"),
        (report["skill_writing_interval"] != 0, "automatic skill writing is not off in the seeded profile"),
        (report["skill_write_saved"] is not False, "an agent's skill_manage write would be saved without approval"),
        (report["curator_enabled"] is not False, "the skill curator is on in the seeded profile"),
        (report["routing_prompt_on"] != {"api_server": True, "cli": False, "cron": False},
         "the data-routing paragraph reaches a platform without the data tools, or misses Desk chat"),
    ) if failed]
    for problem in problems:
        print("FAILED:", problem, file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
