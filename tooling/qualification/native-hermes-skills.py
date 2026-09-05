#!/usr/bin/env python3
"""Provider-free Pythia skill qualification against an exact Hermes checkout."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SOURCE_MARKER_FIELDS = {
    "schema_version",
    "release",
    "commit",
    "archive_sha256",
    "source_tree_sha256",
}
SOURCE_TREE_DIGEST_SCRIPT = r"""
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[1];
const derivedNames = new Set([
  ".pythia-source.json",
  ".venv",
  "__pycache__",
]);
const hash = createHash("sha256");

function walk(current, relative = "") {
  for (const entry of readdirSync(current, { withFileTypes: true }).sort(
    (left, right) => left.name.localeCompare(right.name),
  )) {
    if (
      derivedNames.has(entry.name) ||
      (relative === "" && entry.name === "hermes_agent.egg-info") ||
      entry.name.endsWith(".pyc")
    ) continue;
    const child = join(current, entry.name);
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    const info = lstatSync(child);
    if (info.isSymbolicLink()) {
      throw new Error(`Hermes source contains a symbolic link: ${child}`);
    }
    if (info.isDirectory()) {
      hash.update(`directory\0${childRelative}\0${info.mode & 0o777}\n`);
      walk(child, childRelative);
    } else if (info.isFile()) {
      hash.update(`file\0${childRelative}\0${info.mode & 0o777}\0`);
      hash.update(readFileSync(child));
      hash.update("\n");
    } else {
      throw new Error(`Hermes source contains an unsupported entry: ${child}`);
    }
  }
}

const rootInfo = lstatSync(root);
if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
  throw new Error(`Hermes source must be a real directory: ${root}`);
}
walk(root);
process.stdout.write(hash.digest("hex"));
"""


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hermes-source", required=True, type=Path)
    parser.add_argument("--hermes-source-archive", type=Path)
    parser.add_argument("--hermes-runtime-prefix", type=Path)
    parser.add_argument("--repository", required=True, type=Path)
    return parser.parse_args()


def source_tree_sha256(source: Path) -> str:
    try:
        result = subprocess.run(
            [
                "node",
                "--input-type=module",
                "--eval",
                SOURCE_TREE_DIGEST_SCRIPT,
                str(source),
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError("Could not verify the Hermes source tree.") from error
    digest = result.stdout.strip()
    if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
        raise RuntimeError("Hermes source-tree verification returned an invalid digest.")
    return digest


def validate_source_binding(
    hermes_source: Path,
    hermes_pin: dict[str, object],
    source_archive: Path | None,
) -> str:
    expected_commit = hermes_pin["commit"]
    expected_archive_hash = hermes_pin["artifacts"][0]["sha256"]
    if (hermes_source / ".git").exists():
        observed_commit = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=hermes_source,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        if observed_commit != expected_commit:
            raise RuntimeError("Hermes checkout does not match the qualified commit.")
        return "exact-git-head"

    marker_path = hermes_source / ".pythia-source.json"
    try:
        marker = json.loads(marker_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError) as error:
        if source_archive is None:
            raise RuntimeError("Hermes extraction marker is missing or invalid.") from error
        archive_hash = hashlib.sha256(source_archive.read_bytes()).hexdigest()
        if archive_hash != expected_archive_hash:
            raise RuntimeError("Hermes source archive does not match the exact pin.")
        with tempfile.TemporaryDirectory(prefix="native-hermes-source-") as raw:
            extraction = Path(raw)
            subprocess.run(
                ["tar", "-xzf", str(source_archive), "-C", str(extraction)],
                check=True,
                capture_output=True,
                text=True,
                timeout=60,
            )
            roots = [path for path in extraction.iterdir() if path.is_dir()]
            if len(roots) != 1:
                raise RuntimeError("Hermes source archive has an unexpected root shape.")
            if source_tree_sha256(roots[0]) != source_tree_sha256(hermes_source):
                raise RuntimeError("Hermes source differs from the exact pinned archive.")
        return "exact-qualified-archive-extraction"
    if not isinstance(marker, dict) or set(marker) != SOURCE_MARKER_FIELDS:
        raise RuntimeError("Hermes extraction marker has an incompatible shape.")
    if (
        type(marker["schema_version"]) is not int
        or marker["schema_version"] != 1
        or marker["release"] != hermes_pin["release"]
        or marker["commit"] != expected_commit
        or marker["archive_sha256"] != expected_archive_hash
    ):
        raise RuntimeError("Hermes extraction marker does not match the exact pin.")
    observed_tree_hash = source_tree_sha256(hermes_source)
    if marker["source_tree_sha256"] != observed_tree_hash:
        raise RuntimeError("Hermes source tree does not match its verified extraction marker.")
    return "exact-pythia-source-marker"


def write_skill(path: Path, name: str, description: str, toolset: str) -> None:
    path.mkdir(parents=True, exist_ok=True)
    (path / "SKILL.md").write_text(
        "\n".join(
            [
                "---",
                f"name: {name}",
                f"description: {description}",
                "metadata:",
                "  hermes:",
                f"    requires_toolsets: [{toolset}]",
                "---",
                "",
                "Synthetic provider-free qualification skill.",
                "",
            ]
        ),
        encoding="utf-8",
    )


def run_native(command: list[str], *, environment: dict[str, str], cwd: Path) -> str:
    try:
        result = subprocess.run(
            command,
            cwd=cwd,
            env=environment,
            check=True,
            capture_output=True,
            text=True,
            timeout=60,
        )
    except subprocess.CalledProcessError as error:
        detail = (error.stderr or error.stdout or "").strip()
        raise RuntimeError(
            f"Native command failed ({' '.join(command)}): {detail}"
        ) from error
    return result.stdout.strip()


def main() -> int:
    args = arguments()
    hermes_source = args.hermes_source.resolve()
    repository = args.repository.resolve()
    versions = json.loads((repository / "runtime/versions.json").read_text())
    hermes_pin = versions["dependencies"]["hermes_agent"]
    expected_commit = hermes_pin["commit"]
    expected_archive_hash = hermes_pin["artifacts"][0]["sha256"]
    source_archive = (
        args.hermes_source_archive.resolve()
        if args.hermes_source_archive is not None
        else None
    )
    source_binding = validate_source_binding(
        hermes_source,
        hermes_pin,
        source_archive,
    )
    expected_prefix = (
        args.hermes_runtime_prefix.resolve()
        if args.hermes_runtime_prefix is not None
        else (hermes_source / ".venv").resolve()
    )
    if Path(sys.prefix).resolve() != expected_prefix:
        raise RuntimeError(
            f"Run this probe with {expected_prefix / 'bin' / 'python'}."
        )

    managed_skills = repository / "runtime/managed/skills"
    required_managed = {
        "eodhd-market-data": "pythia-eodhd",
        "investment-memory": "mcp-basic-memory",
        "sec-edgar-research": "pythia-sec",
    }
    for name, toolset in required_managed.items():
        text = (managed_skills / name / "SKILL.md").read_text(encoding="utf-8")
        if f"requires_toolsets: [{toolset}]" not in text:
            raise RuntimeError(f"{name} lacks native requires_toolsets metadata.")

    probe_parent = repository / ".local/qualification/t10"
    probe_parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    root_value = ""
    results: dict[str, object] = {}
    with tempfile.TemporaryDirectory(prefix="native-hermes-", dir=probe_parent) as raw:
        root = Path(raw)
        root_value = str(root)
        hermes_home = root / "hermes-home"
        profile_name = "pythia-t01"
        profile_home = hermes_home / "profiles" / profile_name
        local_skills = profile_home / "skills"
        qualification_skills = root / "qualification-skills"
        support_skill = qualification_skills / "supporting-files-probe"
        workspace = root / "workspace"
        launch_directory = root / "launch-directory"
        home = root / "home"
        home.mkdir(mode=0o700)
        workspace.mkdir(mode=0o700)
        launch_directory.mkdir(mode=0o700)
        (workspace / "AGENTS.md").write_text(
            "WORKSPACE_CONTEXT_CANARY\n", encoding="utf-8"
        )
        (launch_directory / "AGENTS.md").write_text(
            "PROCESS_CWD_CONTEXT_CANARY\n", encoding="utf-8"
        )
        write_skill(
            support_skill,
            "supporting-files-probe",
            "Native supporting-file qualification",
            "terminal",
        )
        support_files = {
            "references/context.md": "REFERENCE_SUPPORT_CANARY",
            "templates/note.md": "TEMPLATE_SUPPORT_CANARY",
            "assets/fixture.txt": "ASSET_SUPPORT_CANARY",
            "scripts/check.sh": "SCRIPT_SUPPORT_CANARY",
        }
        for relative, content in support_files.items():
            target = support_skill / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
        local_description = "LOCAL_PRECEDENCE_CANARY"
        managed_description = "Read the latest non-amended 10-K metadata"
        memory_description = "Search and maintain authoritative Markdown investment"

        isolated_environment = {
            "HOME": str(home),
            "HERMES_HOME": str(hermes_home),
            "HERMES_PLATFORM": "api_server",
            "PYTHIA_CONFIG_ROOT": str(root / "config"),
            "PYTHIA_EDGAR_CACHE_DIR": str(root / "edgar-cache"),
            "PYTHIA_EDGAR_DATA_DIR": str(root / "edgar-data"),
            "PYTHIA_MANAGED_ROOT": str(repository / "runtime/managed"),
            "PYTHIA_MANAGED_SKILLS_DIR": str(managed_skills),
            "NO_PROXY": "*",
            "HTTP_PROXY": "http://127.0.0.1:9",
            "HTTPS_PROXY": "http://127.0.0.1:9",
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        }
        hermes = expected_prefix / "bin" / "hermes"
        run_native(
            [
                str(hermes),
                "profile",
                "create",
                profile_name,
                "--no-alias",
                "--no-skills",
            ],
            environment=isolated_environment,
            cwd=launch_directory,
        )
        write_skill(
            local_skills / "sec-edgar-research",
            "sec-edgar-research",
            local_description,
            "pythia-sec",
        )
        run_native(
            [
                str(hermes),
                "-p",
                profile_name,
                "config",
                "set",
                "terminal.cwd",
                str(workspace),
            ],
            environment=isolated_environment,
            cwd=launch_directory,
        )
        run_native(
            [
                str(hermes),
                "-p",
                profile_name,
                "config",
                "set",
                "skills.external_dirs",
                json.dumps([str(managed_skills), str(qualification_skills)]),
            ],
            environment=isolated_environment,
            cwd=launch_directory,
        )
        configured_cwd = json.loads(
            run_native(
                [
                    str(hermes),
                    "-p",
                    profile_name,
                    "config",
                    "get",
                    "terminal.cwd",
                    "--json",
                ],
                environment=isolated_environment,
                cwd=launch_directory,
            )
        )
        if configured_cwd != str(workspace):
            raise RuntimeError("Native profile did not retain terminal.cwd.")
        config_before_auth_status = (profile_home / "config.yaml").read_bytes()
        auth_status = run_native(
            [str(hermes), "auth", "status", "openai-codex"],
            environment=isolated_environment,
            cwd=launch_directory,
        )
        if not auth_status.startswith("openai-codex: logged out"):
            raise RuntimeError("Native provider auth status changed shape.")
        if (profile_home / "config.yaml").read_bytes() != config_before_auth_status:
            raise RuntimeError("Native auth status changed profile configuration.")
        if (hermes_home / "auth.json").exists():
            raise RuntimeError("Native auth status created a credential store.")

        isolated_environment["HERMES_HOME"] = str(profile_home)
        isolated_environment["MESSAGING_CWD"] = str(home)
        os.environ.clear()
        os.environ.update(isolated_environment)
        os.chdir(launch_directory)

        sys.dont_write_bytecode = True
        sys.path.insert(0, str(hermes_source))
        from hermes_cli import (  # pylint: disable=import-outside-toplevel
            __version__ as hermes_version,
        )

        if hermes_version != hermes_pin["package_version"]:
            raise RuntimeError("Hermes source reports an unexpected package version.")
        if not Path(sys.modules["hermes_cli"].__file__).resolve().is_relative_to(
            hermes_source
        ):
            raise RuntimeError("Hermes modules were not loaded from the pinned source.")
        from agent.prompt_builder import (  # pylint: disable=import-outside-toplevel
            build_context_files_prompt,
            build_skills_system_prompt,
            clear_skills_system_prompt_cache,
        )
        from agent.runtime_cwd import (  # pylint: disable=import-outside-toplevel
            resolve_agent_cwd,
            resolve_context_cwd,
        )
        from gateway.cwd_placeholder import (  # pylint: disable=import-outside-toplevel
            resolve_placeholder_terminal_cwd,
        )
        from tools.registry import (  # pylint: disable=import-outside-toplevel
            ToolRegistry,
        )
        from tools.skills_tool import skill_view  # pylint: disable=import-outside-toplevel
        from tools.terminal_tool import terminal_tool  # pylint: disable=import-outside-toplevel

        terminal_cwd = resolve_placeholder_terminal_cwd(
            configured_cwd=configured_cwd,
            terminal_backend="local",
            messaging_cwd=os.environ["MESSAGING_CWD"],
            docker_mount_cwd_to_workspace=False,
            home_fallback=str(home),
        )
        if terminal_cwd != str(workspace):
            raise RuntimeError("Explicit native terminal.cwd did not win resolution.")
        os.environ["TERMINAL_CWD"] = terminal_cwd
        if resolve_agent_cwd() != workspace or resolve_context_cwd() != workspace:
            raise RuntimeError("Native agent/context cwd diverged from terminal.cwd.")
        terminal_result = json.loads(
            terminal_tool(command="pwd", task_id="pythia-t01-cwd")
        )
        if (
            terminal_result.get("exit_code") != 0
            or terminal_result.get("output", "").strip() != str(workspace)
        ):
            raise RuntimeError("Native terminal did not execute in terminal.cwd.")
        context_prompt = build_context_files_prompt(
            cwd=str(resolve_context_cwd()), skip_soul=True
        )
        if (
            "WORKSPACE_CONTEXT_CANARY" not in context_prompt
            or "PROCESS_CWD_CONTEXT_CANARY" in context_prompt
        ):
            raise RuntimeError("Native context discovery did not follow terminal.cwd.")

        linked = json.loads(skill_view("supporting-files-probe"))
        if linked.get("linked_files") != {
            "references": ["references/context.md"],
            "templates": ["templates/note.md"],
            "assets": ["assets/fixture.txt"],
            "scripts": ["scripts/check.sh"],
        }:
            raise RuntimeError("Native skill supporting-file inventory changed.")
        for relative, canary in support_files.items():
            support = json.loads(
                skill_view("supporting-files-probe", file_path=relative)
            )
            if not support.get("success") or support.get("content") != canary:
                raise RuntimeError(f"Native skill_view could not read {relative}.")

        plugin_path = repository / "runtime/managed/plugin/__init__.py"
        plugin_spec = importlib.util.spec_from_file_location(
            "pythia_qualification_plugin", plugin_path
        )
        if plugin_spec is None or plugin_spec.loader is None:
            raise RuntimeError("Could not load the managed Pythia plugin.")
        plugin = importlib.util.module_from_spec(plugin_spec)
        plugin_spec.loader.exec_module(plugin)

        config_root = root / "config"
        config_root.mkdir(mode=0o700)
        for filename, value in (
            (
                "settings.json",
                {
                    "schema_version": 1,
                    "sec_identity": "Researcher test@example.invalid",
                },
            ),
            (
                "secrets.json",
                {"schema_version": 1, "eodhd_api_token": "synthetic-token"},
            ),
        ):
            path = config_root / filename
            path.write_text(json.dumps(value), encoding="utf-8")
            path.chmod(0o600)

        tool_registry = ToolRegistry()
        provider_calls: list[dict[str, object]] = []

        class QualificationContext:
            def register_system_prompt_section(self, *_args, **_kwargs) -> None:
                return None

            def register_tool(self, **kwargs) -> None:
                tool_registry.register(**kwargs)

        def provider_free_run(_command, request, _environment) -> str:
            provider_calls.append(request)
            return json.dumps({"status": "ok", "data": [], "error": None})

        plugin._run = provider_free_run
        plugin.register(QualificationContext())
        sec_result = json.loads(
            tool_registry.dispatch(
                "pythia_sec_company",
                {"company": "EXAMPLE", "fact_limit": 7},
                qualification_context=True,
            )
        )
        eod_result = json.loads(
            tool_registry.dispatch(
                "pythia_eod_prices",
                {
                    "ticker": "EXAMPLE.US",
                    "from_date": "2025-01-01",
                    "to_date": "2025-01-31",
                    "limit": 3,
                },
                qualification_context=True,
            )
        )
        if sec_result.get("status") != "ok" or eod_result.get("status") != "ok":
            raise RuntimeError("Native Hermes registry dispatch rejected a Pythia tool.")
        if provider_calls != [
            {"company": "EXAMPLE", "fact_limit": 7},
            {
                "api_token": "synthetic-token",
                "ticker": "EXAMPLE.US",
                "from": "2025-01-01",
                "to": "2025-01-31",
                "limit": 3,
            },
        ]:
            raise RuntimeError("Native registry dispatch changed Pythia tool arguments.")

        finance_toolsets = {"pythia-eodhd", "pythia-sec"}
        all_toolsets = {*finance_toolsets, "mcp-basic-memory"}
        clear_skills_system_prompt_cache(clear_snapshot=True)
        complete_prompt = build_skills_system_prompt(
            available_tools=set(),
            available_toolsets=all_toolsets,
            skills_dir_override=local_skills,
        )
        if local_description not in complete_prompt:
            raise RuntimeError("Hermes did not select the profile-local skill.")
        if managed_description in complete_prompt:
            raise RuntimeError("Hermes exposed the shadowed managed skill description.")
        if "eodhd-market-data" not in complete_prompt:
            raise RuntimeError("Hermes hid EODHD despite its toolset being present.")
        if memory_description not in complete_prompt:
            raise RuntimeError(
                "Hermes hid Basic Memory guidance despite its toolset being present."
            )

        (profile_home / "config.yaml").write_text(
            "skills:\n"
            f'  external_dirs: ["{managed_skills}"]\n'
            "  disabled: [eodhd-market-data]\n",
            encoding="utf-8",
        )
        clear_skills_system_prompt_cache(clear_snapshot=True)
        disabled_prompt = build_skills_system_prompt(
            available_tools=set(),
            available_toolsets=all_toolsets,
            skills_dir_override=local_skills,
        )
        if "eodhd-market-data" in disabled_prompt:
            raise RuntimeError("Hermes exposed a globally disabled managed skill.")

        (profile_home / "config.yaml").write_text(
            "skills:\n"
            f'  external_dirs: ["{managed_skills}"]\n'
            "  disabled: []\n",
            encoding="utf-8",
        )
        clear_skills_system_prompt_cache(clear_snapshot=True)
        no_memory_prompt = build_skills_system_prompt(
            available_tools=set(),
            available_toolsets=finance_toolsets,
            skills_dir_override=local_skills,
        )
        if memory_description in no_memory_prompt or "investment-memory" in no_memory_prompt:
            raise RuntimeError(
                "Hermes exposed Basic Memory-specific guidance without its toolset."
            )
        if (
            local_description not in no_memory_prompt
            or "eodhd-market-data" not in no_memory_prompt
        ):
            raise RuntimeError(
                "Hermes removed unrelated finance guidance with Basic Memory."
            )

        (profile_home / "config.yaml").write_text(
            "skills:\n"
            f'  external_dirs: ["{managed_skills}"]\n'
            "  disabled: []\n",
            encoding="utf-8",
        )
        clear_skills_system_prompt_cache(clear_snapshot=True)
        no_toolsets_prompt = build_skills_system_prompt(
            available_tools=set(),
            available_toolsets=set(),
            skills_dir_override=local_skills,
        )
        if "eodhd-market-data" in no_toolsets_prompt:
            raise RuntimeError("Hermes exposed EODHD without its required toolset.")
        if "sec-edgar-research" in no_toolsets_prompt:
            raise RuntimeError("Hermes exposed SEC without its required toolset.")
        if "investment-memory" in no_toolsets_prompt:
            raise RuntimeError(
                "Hermes exposed Basic Memory without its required toolset."
            )

        clear_skills_system_prompt_cache(clear_snapshot=True)
        unknown_inventory_prompt = build_skills_system_prompt(
            available_tools=None,
            available_toolsets=None,
            skills_dir_override=local_skills,
        )
        if "eodhd-market-data" not in unknown_inventory_prompt:
            raise RuntimeError("Hermes did not preserve native fail-open semantics.")
        if memory_description not in unknown_inventory_prompt:
            raise RuntimeError(
                "Hermes did not preserve Basic Memory's native fail-open semantics."
            )

        results = {
            "auth_status_provider_scoped_read_only": True,
            "configured_cwd_context_not_process_cwd": True,
            "configured_cwd_terminal_execution": True,
            "profile_local_precedence": True,
            "skill_supporting_files": True,
            "skills_disabled_global": True,
            "requires_toolsets_present": True,
            "requires_toolsets_absent": True,
            "basic_memory_guidance_native_filter": True,
            "native_plugin_tool_dispatch": True,
            "unknown_inventory_fail_open": True,
        }

    cleanup_proven = not Path(root_value).exists()
    if not cleanup_proven:
        shutil.rmtree(root_value, ignore_errors=True)
        raise RuntimeError("Native Hermes probe did not clean up its isolated state.")

    print(
        json.dumps(
            {
                "schema_version": 1,
                "hermes_archive_sha256": expected_archive_hash,
                "hermes_commit": expected_commit,
                "hermes_version": hermes_pin["package_version"],
                "platform": "api_server",
                "provider_or_model_call": False,
                "external_network_required": False,
                "isolated_profile_cleanup": cleanup_proven,
                "results": results,
                "source_binding": source_binding,
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
