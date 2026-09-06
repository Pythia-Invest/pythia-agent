"""Provider-free qualification of Pythia skills against native Hermes."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from native_hermes_plugin import verify_plugin_dispatch
from native_hermes_skill_visibility import verify_skill_visibility
from native_hermes_source import validate_source_binding

def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hermes-source", required=True, type=Path)
    parser.add_argument("--hermes-source-archive", type=Path)
    parser.add_argument("--hermes-runtime-prefix", type=Path)
    parser.add_argument("--repository", required=True, type=Path)
    return parser.parse_args()
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

        verify_plugin_dispatch(
            root=root,
            repository=repository,
            tool_registry_type=ToolRegistry,
        )
        verify_skill_visibility(
            profile_home=profile_home,
            managed_skills=managed_skills,
            local_skills=local_skills,
            local_description=local_description,
            managed_description=managed_description,
            memory_description=memory_description,
            build_skills_system_prompt=build_skills_system_prompt,
            clear_skills_system_prompt_cache=clear_skills_system_prompt_cache,
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
