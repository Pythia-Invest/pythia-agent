from __future__ import annotations

import importlib.util
import hashlib
import json
import gzip
import shutil
import stat
import tarfile
import tempfile
import unittest
from pathlib import Path

QUALIFICATION = (
    Path(__file__).parents[3] / "tooling" / "qualification" / "native-hermes-skills.py"
)
SPEC = importlib.util.spec_from_file_location("native_qualification", QUALIFICATION)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

PIN = {
    "release": "fixture-release",
    "commit": "fixture-commit",
    "artifacts": [{"sha256": "a" * 64}],
}


def write_archive(source: Path, archive_path: Path) -> str:
    with archive_path.open("wb") as raw:
        with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w") as archive:
                for path in [source, *sorted(source.rglob("*"))]:
                    relative = Path(source.name) / path.relative_to(source)
                    info = archive.gettarinfo(str(path), arcname=str(relative))
                    info.mtime = 0
                    info.uid = 0
                    info.gid = 0
                    info.uname = ""
                    info.gname = ""
                    if info.isfile():
                        with path.open("rb") as content:
                            archive.addfile(info, content)
                    else:
                        archive.addfile(info)
    return hashlib.sha256(archive_path.read_bytes()).hexdigest()


class SourceMarkerTest(unittest.TestCase):
    def test_accepts_only_the_canonical_marker_bound_to_the_source_tree(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            root.chmod(0o700)
            nested = root / "agent"
            nested.mkdir(mode=0o755)
            (root / "pyproject.toml").write_text("[project]\n", encoding="utf-8")
            (root / "uv.lock").write_text("version = 1\n", encoding="utf-8")
            source = nested / "prompt.py"
            source.write_text("PROMPT = 'fixture'\n", encoding="utf-8")
            source.chmod(0o644)
            digest = MODULE.source_tree_sha256(root)
            marker = {
                "schema_version": 1,
                "release": PIN["release"],
                "commit": PIN["commit"],
                "archive_sha256": PIN["artifacts"][0]["sha256"],
                "source_tree_sha256": digest,
            }
            marker_path = root / ".pythia-source.json"
            marker_path.write_text(json.dumps(marker), encoding="utf-8")
            marker_path.chmod(stat.S_IRUSR | stat.S_IWUSR)

            self.assertEqual(
                MODULE.validate_source_binding(root, PIN, None),
                "exact-pythia-source-marker",
            )

            source.write_text("PROMPT = 'tampered'\n", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "source tree"):
                MODULE.validate_source_binding(root, PIN, None)

    def test_ignores_only_uvs_top_level_editable_install_metadata(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            root.chmod(0o700)
            source = root / "agent"
            source.mkdir(mode=0o755)
            (source / "prompt.py").write_text("PROMPT = 'fixture'\n", encoding="utf-8")
            marker = {
                "schema_version": 1,
                "release": PIN["release"],
                "commit": PIN["commit"],
                "archive_sha256": PIN["artifacts"][0]["sha256"],
                "source_tree_sha256": MODULE.source_tree_sha256(root),
            }
            (root / ".pythia-source.json").write_text(
                json.dumps(marker), encoding="utf-8"
            )

            derived = root / "hermes_agent.egg-info"
            derived.mkdir(mode=0o755)
            (derived / "PKG-INFO").write_text("generated\n", encoding="utf-8")
            self.assertEqual(
                MODULE.validate_source_binding(root, PIN, None),
                "exact-pythia-source-marker",
            )

            nested = source / "hermes_agent.egg-info"
            nested.mkdir(mode=0o755)
            (nested / "PKG-INFO").write_text("source\n", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "source tree"):
                MODULE.validate_source_binding(root, PIN, None)

    def test_rejects_incomplete_wrong_and_extended_markers(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            root.chmod(0o700)
            (root / "pyproject.toml").write_text("[project]\n", encoding="utf-8")
            digest = MODULE.source_tree_sha256(root)
            canonical = {
                "schema_version": 1,
                "release": PIN["release"],
                "commit": PIN["commit"],
                "archive_sha256": PIN["artifacts"][0]["sha256"],
                "source_tree_sha256": digest,
            }
            marker_path = root / ".pythia-source.json"
            cases = (
                {key: value for key, value in canonical.items() if key != "source_tree_sha256"},
                {**canonical, "commit": "wrong"},
                {**canonical, "archive_sha256": "b" * 64},
                {**canonical, "unexpected": True},
            )
            for marker in cases:
                with self.subTest(marker=marker):
                    marker_path.write_text(json.dumps(marker), encoding="utf-8")
                    with self.assertRaises(RuntimeError):
                        MODULE.validate_source_binding(root, PIN, None)

    def test_binds_markerless_source_to_the_exact_archive_bytes_and_tree(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive_source = root / "hermes-agent-fixture"
            (archive_source / "hermes").mkdir(parents=True, mode=0o755)
            (archive_source / "pyproject.toml").write_text(
                "[project]\nname = 'fixture'\n", encoding="utf-8"
            )
            (archive_source / "hermes" / "prompt.py").write_text(
                "PROMPT = 'fixture'\n", encoding="utf-8"
            )
            archive_path = root / "hermes-agent-fixture.tar.gz"
            archive_hash = write_archive(archive_source, archive_path)
            pin = {
                **PIN,
                "artifacts": [{"sha256": archive_hash}],
            }
            extracted = root / "installed-source"
            shutil.copytree(archive_source, extracted)

            self.assertEqual(
                MODULE.validate_source_binding(extracted, pin, archive_path),
                "exact-qualified-archive-extraction",
            )

            (extracted / "hermes" / "prompt.py").write_text(
                "PROMPT = 'tampered'\n", encoding="utf-8"
            )
            with self.assertRaisesRegex(RuntimeError, "differs"):
                MODULE.validate_source_binding(extracted, pin, archive_path)

            wrong_pin = {
                **pin,
                "artifacts": [{"sha256": "b" * 64}],
            }
            with self.assertRaisesRegex(RuntimeError, "archive"):
                MODULE.validate_source_binding(archive_source, wrong_pin, archive_path)


if __name__ == "__main__":
    unittest.main()
