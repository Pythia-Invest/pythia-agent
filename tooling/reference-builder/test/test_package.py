"""The builder's output directory is a reference package that core's installer accepts."""

import contextlib
import importlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from reference_builder import drift, manifest, schema, writer
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
            "scope": {"mics": ["XAMS"], "sec": True}, "included_sources": ["iso10383_mic", "esma_firds", "gleif"],
            "snapshot": writer.describe(path), "tables": counts,
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
        self.assertEqual(package["included_sources"], installed["included_sources"])  # reference-status lists them
        self.assertEqual(installed["included_sources"], ["iso10383_mic", "esma_firds", "gleif"])
        self.assertTrue(installer.current(data).is_file())


    def test_first_read_carries_a_provisional_coin_through_a_contract_not_the_package(self):
        """The package names no provider, so none of its aliases is a coin plugin's provisional ID; the coin plugin's
        own declaration carries a row saved under one to the curated asset on the release's first read (Lifecycle A),
        while with no plugin installed nothing moves (ADR 0044 A3)."""
        identity, store = schema.identity, importlib.import_module("pythia_core_identity.store")
        lifecycle = importlib.import_module("pythia_core_identity.lifecycle")
        declared = importlib.import_module("pythia_core_identity.declared")
        data = Path(self.tmp.name) / "core"
        local = store.IdentityStore(data)  # a binding made before USDC was curated, on its provisional ID
        old = identity.provisional_id("security", "coingecko", "coin", "usd-coin")
        local.put_binding(identity.Binding(
            provider_ref=identity.ProviderRef("coingecko", "usd-coin", "coin"), subject_id=old, status="confirmed",
            authority="user_attested", evidence_ids=("ev:" + "0" * 64,), plugin="pythia-coingecko"))
        self.assertEqual(self.build()["format_version"], installer.FORMAT_VERSION)
        installer.install(self.out, data)
        path = store.reference_path(data)  # what core's first read does (identity_ops.Identity.reference_path)
        contract = identity.validate_manifest(json.loads((drift.PLUGINS / "coingecko" / "contract.json").read_text()))
        with contextlib.closing(store.open_reference(path)) as ref:
            self.assertIsNone(ref.execute("SELECT old_id FROM id_aliases WHERE old_id LIKE 'security:provisional:%'"
                                          " AND old_id NOT LIKE '%:esma_firds:%'").fetchone())
            for contracts, moved in (([], 0), ([contract], 1)):
                with self.subTest(plugins=len(contracts)):
                    done = lifecycle.rekey(local, ref, installer.release_key(path), again=True,
                                           declared=lambda: declared.aliases(contracts))
                    self.assertEqual(done["moved"], moved)
        usdc = "security:caip19:eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
        self.assertEqual(([row["provider"] for row in local.bindings([usdc])], local.bindings([old])), (["coingecko"], []))

    def test_a_build_with_a_failed_canary_is_not_a_package(self):
        self.build()
        self.assertIsNone(self.build(canaries=[{"name": "ASML on Euronext Amsterdam", "ok": False}]))
        self.assertTrue((self.out / "reference-20260925.sqlite3").exists())  # written for inspection (--no-gates)


if __name__ == "__main__":
    unittest.main()
