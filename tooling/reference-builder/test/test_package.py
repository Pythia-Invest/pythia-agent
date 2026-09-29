"""The builder's output directory is a reference package that core's installer accepts."""

import contextlib
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

    def build(self, canaries=()):
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
            "sources": sources, "audit": self.snap.audit, "canaries": list(canaries), "truth_audit": None})
        path = self.out / "package.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None

    def test_the_output_directory_installs_as_a_package(self):
        package = self.build()
        self.assertEqual((package["format_version"], package["database"]["file"]),
                         (installer.FORMAT_VERSION, "reference-20260925.sqlite3"))
        self.assertEqual([(s["source"], s["as_of"]) for s in package["sources"]],
                         [("esma_firds:FULINS_E_1", "2026-09-25"), ("gleif_lei_records", "2026-09-25")])
        self.assertTrue(all(s["notice"] for s in package["sources"]))
        self.assertIn("listings", package["quality"]["tables"])
        data = Path(self.tmp.name) / "core"
        installed = installer.install(self.out, data)["installed"]
        self.assertEqual((installed["build_id"], installed["as_of"], len(installed["notices"])),
                         ("reference-20260925", "2026-09-25", 2))
        self.assertTrue(installer.current(data).is_file())


    def test_first_read_of_a_format_3_package_carries_provisional_coins_to_their_curated_ids(self):
        identity, store = schema.identity, importlib.import_module("pythia_core_identity.store")
        lifecycle = importlib.import_module("pythia_core_identity.lifecycle")
        data = Path(self.tmp.name) / "core"
        local = store.IdentityStore(data)  # a binding made before USDC was curated, on its provisional ID
        old = identity.provisional_id("security", "coingecko", "coin", "usd-coin")
        local.put_binding(identity.Binding(
            provider_ref=identity.ProviderRef("coingecko", "usd-coin", "coin"), subject_id=old, status="confirmed",
            authority="user_attested", evidence_ids=("ev:" + "0" * 64,), plugin="pythia-coingecko"))
        self.assertEqual(self.build()["format_version"], 4)
        installer.install(self.out, data)
        path = store.reference_path(data)  # what core's first read does (identity_ops.Identity.reference_path)
        with contextlib.closing(store.open_reference(path)) as ref:
            done = lifecycle.rekey(local, ref, installer.release_key(path))
        usdc = "security:caip19:eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
        self.assertEqual((done["moved"], done["vanished"]), (1, 0))
        self.assertEqual([row["provider"] for row in local.bindings([usdc])], ["coingecko"])
        self.assertEqual(local.bindings([old]), [])

    def test_a_build_with_a_failed_canary_is_not_a_package(self):
        self.build()
        self.assertIsNone(self.build(canaries=[{"name": "ASML on Euronext Amsterdam", "ok": False}]))
        self.assertTrue((self.out / "reference-20260925.sqlite3").exists())  # written for inspection (--no-gates)


if __name__ == "__main__":
    unittest.main()
