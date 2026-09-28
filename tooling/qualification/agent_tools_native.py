"""Provider-free qualification of the agent's tool surface against the pinned native Hermes.

It copies the managed core and plugins into a disposable profile seeded from runtime/seeds/profile/config.yaml,
then asks Hermes itself what an api_server turn delivers and how calls flow:

- the assembled tool list: only the pythia-desk tools and the kept Hermes built-ins, no Tool Search bridge,
  byte-identical when assembled twice;
- `may_run` still admits hidden plugin tools;
- `pythia` reaches a hidden plugin tool through `ctx.dispatch_tool` while `pre_tool_call` sees only `pythia`;
- the visible identity answer runs as a provisional write;
- a plugin `approve` directive on api_server is an instant deny at this release, with no human round-trip,
  which is why Pythia registers no approval hook yet.

No model, provider or network is used: the only plugin call is SEC's, which stops at its missing contact.
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
import json, os, sys
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
from tools.tool_search import assemble_tool_defs, load_config
enabled = sorted(_get_platform_tools(load_config_readonly(), "api_server", include_default_mcp_servers=False))

def assembled():
    model_tools._clear_tool_defs_cache()
    raw = model_tools.get_tool_definitions(enabled_toolsets=enabled, quiet_mode=True, skip_tool_search_assembly=True)
    return assemble_tool_defs(raw, context_length=272000, config=load_config()).tool_defs

first, second = assembled(), assembled()
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
print(json.dumps({
    "failed_plugins": failed,
    "enabled_toolsets": enabled,
    "visible": [(item["function"]["name"], len(json.dumps(item, separators=(",", ":")))) for item in first],
    "byte_stable": json.dumps(first) == json.dumps(second),
    "may_run_hidden": sorted(name for name in core.platform.access.eligible_tools() if name.startswith("pythia_sec")),
    "help_sources": [row["source"] for row in help_result.get("sources", [])],
    "sec_issue": (sec.get("issues") or [{}])[0].get("code"),
    "hook_saw": seen,
    "answer": answer,
    "approve_on_api_server": asked,
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
    pythia = sorted(name for name in names if name.startswith("pythia"))
    problems = [message for failed, message in (
        (pythia != ["pythia", "pythia_answer_identity_question", "pythia_desk_view", "pythia_filings", "pythia_find",
                    "pythia_instrument", "pythia_prices"], "visible Pythia tools differ from the pythia-desk set"),
        (any(name in names for name in ("tool_search", "tool_describe", "tool_call")), "Tool Search is still on"),
        (not report["byte_stable"], "the tool list changed between two assemblies"),
        ("pythia_sec_facts" not in report["may_run_hidden"], "may_run lost a hidden plugin tool"),
        (report["sec_issue"] != "needs_configuration", "pythia did not reach the hidden SEC tool"),
        (report["hook_saw"][:2] != ["pythia", "pythia"], "pre_tool_call saw a nested plugin call"),
        ("error" in report["answer"], "the identity answer did not run"),
        ("unattended platform" not in report["approve_on_api_server"].get("error", ""),
         "api_server approvals now round-trip: revisit the effect policy"),
    ) if failed]
    for problem in problems:
        print("FAILED:", problem, file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
