#!/usr/bin/env python3
"""Provider-free capture of pinned Hermes wire and formatter output.

Desk parses Hermes HTTP bodies, SSE frames, history rows and fixed strings.
This script produces those values from the exact pinned Hermes source, never
from Desk's own types, and writes them as reviewable goldens (ADR 0020). No
model, provider, credential or network is used: every non-loopback
connection is refused and the capture fails if Hermes attempts one.

Run it with the pinned Hermes virtualenv's Python (`just capture-hermes`).
``--check`` regenerates in memory and fails when committed goldens differ.
"""

from __future__ import annotations

import argparse
import asyncio
import atexit
import difflib
import json
import logging
import os
import re
import shutil
import sys
import tempfile
import time
from datetime import date
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hermes_capture_guard import BLOCKED_NETWORK, block_network, strictly_increasing_clock
from hermes_capture_history import cli, formatters, notices, session_history, tool_results
from hermes_capture_runs import (
    CAPTURE_EPOCH,
    run_approval,
    run_cancelled,
    run_completed,
    run_failed,
    run_steered,
    service,
)
from native_hermes_source import validate_source_binding

GOLDEN_DIRECTORY = Path("apps/desk/test/fixtures/hermes")
TIME_KEYS = {"timestamp", "created_at", "updated_at", "started_at", "last_active", "ended_at"}


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hermes-source", required=True, type=Path)
    parser.add_argument("--repository", required=True, type=Path)
    parser.add_argument("--check", action="store_true")
    return parser.parse_args()


class Normalizer:
    """Stable ids, times and paths; every other byte is Hermes's own."""

    def __init__(self, root: Path) -> None:
        self.roots = (str(root.resolve()), str(root))
        self.ids: dict[str, str] = {}

    def _identifier(self, value: str, prefix: str) -> str:
        if value not in self.ids:
            count = sum(1 for known in self.ids.values() if known.startswith(prefix))
            self.ids[value] = f"{prefix}{count + 1}"
        return self.ids[value]

    def text(self, value: str) -> str:
        for root in self.roots:
            value = value.replace(root, "<capture-root>")
        value = re.sub(
            r"run_[0-9a-f]{32}", lambda m: self._identifier(m.group(0), "run_capture_"), value
        )
        value = re.sub(
            r"api_\d{9,}_[0-9a-f]{8}", lambda m: self._identifier(m.group(0), "api_capture_"), value
        )
        return re.sub(
            r"(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])",
            lambda m: self._identifier(m.group(0), "capture_id_"),
            value,
        )

    def document(self, value: Any) -> Any:
        """Replace wall-clock times by their rank, preserving order and equality."""

        def is_time(key: str, child: Any) -> bool:
            return (
                key in TIME_KEYS
                and isinstance(child, (int, float))
                and not isinstance(child, bool)
                and child > 1e9
            )

        times: set[float] = set()

        def collect(node: Any) -> None:
            if isinstance(node, dict):
                for key, child in node.items():
                    if is_time(key, child):
                        times.add(float(child))
                    collect(child)
            elif isinstance(node, list):
                for child in node:
                    collect(child)

        collect(value)
        rank = {moment: index for index, moment in enumerate(sorted(times))}

        def rewrite(node: Any) -> Any:
            if isinstance(node, dict):
                return {
                    key: float(CAPTURE_EPOCH + rank[float(child)])
                    if is_time(key, child)
                    else rewrite(child)
                    for key, child in node.items()
                }
            if isinstance(node, list):
                return [rewrite(child) for child in node]
            return self.text(node) if isinstance(node, str) else node

        return rewrite(value)


def encode_sse(value: Any) -> Any:
    """Turn normalized SSE frames back into Hermes's exact wire text."""
    from gateway.platforms.api_server import _sse_frame

    if isinstance(value, dict):
        if isinstance(value.get("sse"), list):
            return {
                **value,
                "sse": [
                    _sse_frame(frame["data"]).decode().removesuffix("\n\n")
                    if "data" in frame
                    else frame["comment"]
                    for frame in value["sse"]
                ],
            }
        return {key: encode_sse(child) for key, child in value.items()}
    if isinstance(value, list):
        return [encode_sse(child) for child in value]
    return value


def render(value: Any) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False) + "\n"


def isolated_environment(root: Path) -> dict[str, str]:
    for name in ("home", "hermes-home", "workspace"):
        (root / name).mkdir(mode=0o700)
    # Manual approvals: the default `smart` mode first asks an auxiliary
    # model; its ESCALATE outcome raises this same native approval event.
    (root / "hermes-home" / "config.yaml").write_text(
        "approvals:\n  mode: manual\nauxiliary:\n  free_only: true\n"
    )
    return {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "LANG": "C.UTF-8",
        "TZ": "UTC",
        "HOME": str(root / "home"),
        "HERMES_HOME": str(root / "hermes-home"),
        "TMPDIR": str(root),
        "HERMES_DISABLE_LAZY_INSTALLS": "1",
        # `hermes gateway run` (Pythia's launch) sets this in start_gateway().
        "HERMES_EXEC_ASK": "1",
        # The optional external command scanner would otherwise be fetched.
        "TIRITH_ENABLED": "false",
        "NO_COLOR": "1",
    }


def capture(hermes_source: Path, repository: Path, package_version: str) -> dict[str, str]:
    parent = repository / ".local/qualification"
    parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    root = Path(tempfile.mkdtemp(prefix="hermes-capture-", dir=parent))
    # Registered before Hermes loads, so it runs after Hermes's own exit
    # handlers, which recreate cache directories under HERMES_HOME.
    atexit.register(shutil.rmtree, root, True)
    try:
        environment = isolated_environment(root)
        os.environ.clear()
        os.environ.update(environment)
        time.tzset()
        os.chdir(root / "workspace")
        block_network()
        strictly_increasing_clock()
        # Hermes's expected warnings (SQLite WAL, rejected test key) are noise here.
        logging.disable(logging.WARNING)
        sys.path.insert(0, str(hermes_source))

        import hermes_cli

        if hermes_cli.__version__ != package_version:
            raise RuntimeError(f"Hermes {hermes_cli.__version__} is not the pinned {package_version}.")
        results = tool_results()
        texts = notices()
        documents = {
            "run-completed.json": asyncio.run(run_completed()),
            "run-approval.json": asyncio.run(run_approval()),
            "run-steered.json": asyncio.run(run_steered()),
            "run-failed.json": asyncio.run(run_failed()),
            "run-cancelled.json": asyncio.run(run_cancelled()),
            "service.json": asyncio.run(service()),
            "session-history.json": asyncio.run(session_history(results, texts)),
            "formatters.json": formatters(),
            "cli.json": cli(hermes_source, environment, root / "workspace"),
        }
        if BLOCKED_NETWORK:
            raise RuntimeError(
                "Hermes attempted network access: " + ", ".join(sorted(set(BLOCKED_NETWORK)))
            )
        normalizer = Normalizer(root)
        return {
            name: render(encode_sse(normalizer.document(value)))
            for name, value in documents.items()
        }
    finally:
        os.chdir(repository)
        shutil.rmtree(root, ignore_errors=True)


def main() -> int:
    args = arguments()
    hermes_source = args.hermes_source.resolve()
    repository = args.repository.resolve()
    if Path(sys.prefix).resolve() != (hermes_source / ".venv").resolve():
        raise RuntimeError(f"Run this capture with {hermes_source / '.venv/bin/python'}.")
    versions = json.loads((repository / "runtime/versions.json").read_text())
    pin = versions["dependencies"]["hermes_agent"]
    validate_source_binding(hermes_source, pin, None)
    goldens = capture(hermes_source, repository, pin["package_version"])

    target = repository / GOLDEN_DIRECTORY
    provenance = {
        "hermes_release": pin["release"],
        "hermes_package_version": pin["package_version"],
        "hermes_commit": pin["commit"],
        "capture_script": "tooling/qualification/hermes-wire-capture.py",
        "regenerate": "just capture-hermes",
        "content": (
            "Hermes-generated protocol and formatter output from scripted agents "
            "(ADR 0020). No model, provider, credential or network was used."
        ),
        "files": sorted(goldens),
    }
    provenance_path = target / "provenance.json"
    previous = json.loads(provenance_path.read_text()) if provenance_path.exists() else {}
    captured_on = previous.pop("captured_on", None)
    current = {
        name: (target / name).read_text() if (target / name).exists() else ""
        for name in goldens
    }
    stale = sorted(
        path.name
        for path in (target.glob("*.json") if target.exists() else [])
        if path.name not in goldens and path.name != "provenance.json"
    )
    unchanged = current == goldens and previous == provenance and not stale

    if args.check:
        if unchanged:
            print(f"Hermes goldens match the pinned capture ({len(goldens)} files).")
            return 0
        for name, text in sorted(goldens.items()):
            sys.stdout.writelines(
                difflib.unified_diff(
                    current[name].splitlines(keepends=True),
                    text.splitlines(keepends=True),
                    f"committed/{name}",
                    f"captured/{name}",
                )
            )
        if previous != provenance:
            print("provenance.json does not match the pin or capture file list.")
        for name in stale:
            print(f"Unexpected golden: {name}")
        print("Hermes goldens differ from the pinned capture; run `just capture-hermes` and review the diff.")
        return 1

    target.mkdir(parents=True, exist_ok=True)
    for name in stale:
        (target / name).unlink()
    for name, text in goldens.items():
        (target / name).write_text(text)
    provenance["captured_on"] = (
        captured_on if unchanged and captured_on else date.today().isoformat()
    )
    provenance_path.write_text(render(provenance))
    print(f"Wrote {len(goldens)} Hermes goldens to {GOLDEN_DIRECTORY}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
