"""The builder's output directory is a reference package that core's installer accepts."""

import importlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from reference_builder import manifest, schema, writer
from reference_builder.pipeline import build_snapshot

from .fixtures import FakeOpenFigi
from .test_pipeline import OPENFIGI, gleif_fetch, inputs

installer = importlib.import_module("pythia_core_identity.reference_package")  # core's reader, loaded by schema


class PackageTest(unittest.TestCase):
    def setUp(self):
        with mock.patch("urllib.request.urlopen", side_effect=AssertionError("network access in a test")):
            self.snap = build_snapshot(inputs(), gleif_fetch, FakeOpenFigi(OPENFIGI))
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.out = Path(self.tmp.name) / "out"

    def build(self):
        build_id = "reference-20260925"
        sources = [{"source": "esma_firds:FULINS_E_1", "url": "https://example.invalid/f", "version": "20260920",
                    "retrieved_at": "2026-09-25T06:00:00Z", "sha256": "0" * 64, "bytes": 1, "licence": "x"},
                   {"source": "gleif_lei_records", "url": "https://example.invalid/g", "version": None,
                    "retrieved_at": "2026-09-25T07:00:00Z", "sha256": None, "bytes": None, "licence": "CC0 1.0"}]
        path = self.out / f"{build_id}.sqlite3"
        counts = writer.write(self.snap, path, {"build_id": build_id}, sources)
        manifest.write_manifest(self.out / "manifest.json", {
            "build_id": build_id, "schema_version": schema.SCHEMA_VERSION, "builder_version": "1",
            "as_of": "2026-09-25", "started_at": "2026-09-25T06:00:00Z", "finished_at": "2026-09-25T08:00:00Z",
            "scope": {"mics": ["XAMS"], "sec": True}, "snapshot": writer.describe(path), "tables": counts,
            "sources": sources, "audit": self.snap.audit, "canaries": [], "truth_audit": None})
        return json.loads((self.out / "package.json").read_text(encoding="utf-8"))

    def test_the_output_directory_installs_as_a_package(self):
        package = self.build()
        self.assertEqual((package["format_version"], package["database"]["file"]),
                         (installer.FORMAT_VERSION, "reference-20260925.sqlite3"))
        self.assertEqual([(s["source"], s["as_of"]) for s in package["sources"]],
                         [("esma_firds:FULINS_E_1", "2026-09-25"), ("gleif_lei_records", "2026-09-25")])
        self.assertTrue(all(s["notice"] for s in package["sources"]))
        self.assertIn("listings", package["quality"]["tables"])
        data = Path(self.tmp.name) / "core"
        installed = installer.install(self.out, data)
        self.assertEqual((installed["build_id"], installed["as_of"], len(installed["notices"])),
                         ("reference-20260925", "2026-09-25", 2))
        self.assertTrue(installer.current(data).is_file())


if __name__ == "__main__":
    unittest.main()
