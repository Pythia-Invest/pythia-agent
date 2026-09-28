"""Provider-free qualification of the agent's tool surface against the pinned native Hermes.

It copies the managed core and plugins into a disposable profile seeded from runtime/seeds/profile/config.yaml,
then asks Hermes itself what an api_server turn delivers and how calls flow:

- with Tool Search off, the assembled tool list: only the pythia-desk tools and the kept Hermes built-ins,
  byte-identical when assembled twice, equal to the reviewed snapshot and free of `$comment` markers, with
  core registered in production order;
- with Tool Search on (the investor's choice either way), the catalogue lists exactly the pythia-desk tools,
  tool_search finds them for investor phrasing, and tool_call reaches `pythia`'s hidden functions;
- every declared Desk HTTP operation has exactly one tool, and `identity-verdict` still resolves;
- cli and cron sessions see no Pythia tool, and a bad argument is named by the real JSON-Schema validator;
- `may_run` still admits hidden plugin tools;
- `pythia` runs a hidden tool through `ctx.dispatch_tool` while `pre_tool_call` sees only `pythia`;
- the visible identity answer runs as a provisional write;
- a plugin `approve` directive on api_server is an instant deny at this release, with no human round-trip,
  which is why Pythia registers no approval hook yet.

No model, provider or network is used: the one hidden tool run is core's local identity queue.
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

CHILD = r'''
import json, os, re, sys
sys.path.insert(0, os.environ["HERMES_SOURCE"])
from hermes_cli.plugins import discover_plugins, get_plugin_manager
discover_plugins()
manager = get_plugin_manager()
failed = {key: str(getattr(plugin, "error", "") or "") for key, plugin in manager._plugins.items()
          if not getattr(plugin, "enabled", False) or getattr(plugin, "error", None)}
from gateway.session_context import set_session_vars
set_session_vars(platform="api_server")
from hermes_cli.config import load_config_readonly
from hermes_cli.tools_config import _get_platform_tools
import model_tools
from tools.tool_search import ToolSearchConfig, assemble_tool_defs
enabled = sorted(_get_platform_tools(load_config_readonly(), "api_server", include_default_mcp_servers=False))

def assembled(mode):
    model_tools._clear_tool_defs_cache()
    raw = model_tools.get_tool_definitions(enabled_toolsets=enabled, quiet_mode=True, skip_tool_search_assembly=True)
    return assemble_tool_defs(raw, context_length=272000, config=ToolSearchConfig.from_raw({"enabled": mode})).tool_defs

# Tool Search is the investor's choice: both modes must work. "off" loads every schema; "on" defers plugin tools.
first, second = assembled("off"), assembled("off")
deferred, deferred_again = assembled("on"), assembled("on")
listing = next((item["function"]["description"] for item in deferred if item["function"]["name"] == "tool_search"), "")
searches = {}
for query in ("price of ASML", "10-K annual report", "ISIN lookup", "company revenue fundamentals"):
    found = json.loads(model_tools.handle_function_call("tool_search", {"queries": [query]}, enabled_toolsets=enabled))
    searches[query] = (found.get("results") or [{}])[0].get("matches", [])[:3]
bridged = json.loads(model_tools.handle_function_call("tool_call", {"name": "pythia", "arguments": {
    "command": "identity queue"}}, enabled_toolsets=enabled, session_id="probe", task_id="probe"))
core = manager._plugins["pythia"].module
seen = []
manager._hooks.setdefault("pre_tool_call", []).append(lambda tool_name="", **_: seen.append(tool_name))
help_result = json.loads(model_tools.handle_function_call("pythia", {"command": "help"}, session_id="probe", task_id="probe"))
sec = json.loads(model_tools.handle_function_call("pythia", {"command": "sec facts", "args": {
    "native_ref": {"provider": "sec", "native_id": "0000000001", "native_scope": "cik"},
    "taxonomy": "us-gaap", "concepts": ["Revenues"]}}, session_id="probe", task_id="probe"))
answer = json.loads(model_tools.handle_function_call("pythia_answer_identity_question",
    {"item_id": "probe", "relation": "none"}, session_id="probe", task_id="probe"))
manager._hooks["pre_tool_call"].append(lambda tool_name="", **_: {"action": "approve", "message": "probe"}
                                       if tool_name == "skills_list" else None)
asked = json.loads(model_tools.handle_function_call("skills_list", {}, session_id="probe", task_id="probe"))
queue = json.loads(model_tools.handle_function_call("pythia", {"command": "identity queue", "args": {}},
                                                  session_id="probe", task_id="probe"))
bad = json.loads(model_tools.handle_function_call("pythia", {"command": "identity queue", "args": {"limit": "many"}},
                                                session_id="probe", task_id="probe"))
from tools.registry import registry
declared = {}
for name, (key, _plugin) in core.platform.access.native_tool_owners().items():
    meta = core.platform.operations.declaration(registry.get_schema(name) or {})
    if isinstance(meta, dict):
        declared.setdefault((key, meta.get("operation")), []).append(name)
verdict = core.platform.operations.resolve("pythia", "identity-verdict", {"item_id": "probe", "relation": "none"})[0]
routing = {platform: "pythia_find" in "".join(section.content for section in manager.render_system_prompt_sections(
    {"platform": platform}) if section.id == "pythia.operating") for platform in ("api_server", "cli", "cron")}
elsewhere = {}
for platform in ("cli", "cron"):
    model_tools._clear_tool_defs_cache()
    names = [item["function"]["name"] for item in model_tools.get_tool_definitions(
        enabled_toolsets=sorted(_get_platform_tools(load_config_readonly(), platform, include_default_mcp_servers=False)),
        quiet_mode=True, skip_tool_search_assembly=True)]
    elsewhere[platform] = [name for name in names if name.startswith("pythia")]
print(json.dumps({
    "failed_plugins": failed,
    "enabled_toolsets": enabled,
    "visible": [(item["function"]["name"], len(json.dumps(item, separators=(",", ":")))) for item in first],
    "byte_stable": json.dumps(first) == json.dumps(second) and json.dumps(deferred) == json.dumps(deferred_again),
    "visible_with_tool_search": [item["function"]["name"] for item in deferred],
    "catalog_pythia": sorted(set(re.findall(r"\b(pythia(?:_[a-z_]+)?):", listing))),
    "searches": searches,
    "tool_call_reaches": bridged.get("function"),
    "may_run_hidden": sorted(name for name in core.platform.access.eligible_tools() if name.startswith("pythia_sec")),
    "help_sources": [row["source"] for row in help_result.get("sources", [])],
    "sec_issue": (sec.get("issues") or [{}])[0].get("code"),
    "queue_via_pythia": queue,
    "hook_saw": seen,
    "answer": answer,
    "approve_on_api_server": asked,
    "pythia_schemas": [item["function"] for item in first if item["function"]["name"].startswith("pythia")],
    "with_comment": [item["function"]["name"] for item in first + deferred if "$comment" in json.dumps(item)],
    "duplicate_operations": {f"{key}/{operation}": names for (key, operation), names in declared.items() if len(names) > 1},
    "identity_verdict_tool": verdict,
    "bad_argument": (bad.get("issues") or [{}])[0].get("message", ""),
    "pythia_tools_on": elsewhere,
    "routing_prompt_on": routing,
    "skill_writing_interval": (load_config_readonly().get("skills") or {}).get("creation_nudge_interval"),
}))
'''


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
        environment = {"PATH": os.environ.get("PATH", ""), "HOME": str(root), "HERMES_HOME": str(home),
                       "PYTHIA_CONFIG_ROOT": str(config), "HERMES_SOURCE": str(options.hermes_source)}
        completed = subprocess.run([sys.executable, "-c", CHILD], cwd=options.hermes_source, env=environment,
                                   capture_output=True, text=True, timeout=120, check=False)
        if completed.returncode:
            print(completed.stderr[-4000:], file=sys.stderr)
            return completed.returncode
        report = json.loads(completed.stdout.strip().splitlines()[-1])
    print(json.dumps(report, indent=1))
    names = [name for name, _size in report["visible"]]
    snapshot = json.loads((options.repository / "runtime/test/python/fixtures/agent-tools.json").read_text())
    pythia = sorted(name for name in names if name.startswith("pythia"))
    problems = [message for failed, message in (
        (pythia != ["pythia", "pythia_answer_identity_question", "pythia_desk_view", "pythia_filings", "pythia_find",
                    "pythia_instrument", "pythia_prices"], "visible Pythia tools differ from the pythia-desk set"),
        (any(name in names for name in ("tool_search", "tool_describe", "tool_call")), "Tool Search off still bridged"),
        (not {"tool_search", "tool_describe", "tool_call"} <= set(report["visible_with_tool_search"])
         or any(name.startswith("pythia") for name in report["visible_with_tool_search"]),
         "with Tool Search on, Pythia's tools are not deferred behind the bridge"),
        (report["catalog_pythia"] != ["pythia", "pythia_answer_identity_question", "pythia_desk_view", "pythia_filings",
                                      "pythia_find", "pythia_instrument", "pythia_prices"],
         "the Tool Search catalogue differs from the pythia-desk tools (plumbing leaked or a tool is missing)"),
        (any(expected not in report["searches"][query] for query, expected in (
            ("price of ASML", "pythia_prices"), ("10-K annual report", "pythia_filings"),
            ("ISIN lookup", "pythia_find"), ("company revenue fundamentals", "pythia"))),
         "tool_search does not find the Pythia tool for investor phrasing"),
        (report["tool_call_reaches"] != "identity queue", "tool_call cannot reach pythia's hidden functions"),
        (not report["byte_stable"], "the tool list changed between two assemblies"),
        ("pythia_sec_facts" not in report["may_run_hidden"], "may_run lost a hidden plugin tool"),
        (report["sec_issue"] != "needs_configuration", "pythia did not report SEC's missing contact"),
        (report["queue_via_pythia"].get("function") != "identity queue", "pythia did not run a hidden core tool"),
        (report["hook_saw"][:2] != ["pythia", "pythia"], "pre_tool_call saw a nested plugin call"),
        ("error" in report["answer"], "the identity answer did not run"),
        ("unattended platform" not in report["approve_on_api_server"].get("error", ""),
         "api_server approvals now round-trip: revisit the effect policy"),
        (report["with_comment"], "an operation marker reaches the model"),
        (sorted(report["pythia_schemas"], key=lambda item: item["name"]) != sorted(snapshot, key=lambda item: item["name"]),
         "the delivered Pythia schemas differ from runtime/test/python/fixtures/agent-tools.json"),
        (report["duplicate_operations"], "an operation is declared by more than one tool"),
        (report["identity_verdict_tool"] != "pythia_identity_verdict", "Desk's identity-verdict no longer resolves"),
        (not report["bad_argument"].startswith("args.limit:"), "a bad argument is not named"),
        (any(report["pythia_tools_on"].values()), "cli or cron sees Pythia tools"),
        (report["skill_writing_interval"] != 0, "automatic skill writing is not off in the seeded profile"),
        (report["routing_prompt_on"] != {"api_server": True, "cli": False, "cron": False},
         "the data-routing paragraph reaches a platform without the data tools, or misses Desk chat"),
    ) if failed]
    for problem in problems:
        print("FAILED:", problem, file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
