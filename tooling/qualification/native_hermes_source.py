"""Exact Hermes source binding checks for provider-free qualification."""

from __future__ import annotations

import hashlib
import json
import subprocess
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
