"""Reference packages: core installs a verified package atomically, keeps the previous one and reads only it."""
import hashlib
import json
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from test_identity_contracts import identity
from pythia_identity_fixture import reference_package, store  # noqa: E402


def make_package(directory: Path, build_id: str = "reference-20260926", *, source: Path | None = None,
                 format_version: int = reference_package.FORMAT_VERSION) -> Path:
    """A package as the builder writes it: the SQLite file (copied from `source`, else an empty reference) and
    its package.json."""
    directory.mkdir(parents=True, exist_ok=True)
    database = directory / f"{build_id}.sqlite3"
    if source is not None:
        shutil.copyfile(source, database)
    db = sqlite3.connect(database)
    if source is None:
        db.executescript(identity.schema_sql("reference"))
    db.executemany("INSERT OR REPLACE INTO release (key, value) VALUES (?, ?)",
                   [("schema_version", str(format_version)), ("release", build_id)])
    db.commit()
    db.close()
    data = database.read_bytes()
    (directory / "package.json").write_text(json.dumps({
        "format": reference_package.FORMAT, "format_version": format_version, "build_id": build_id,
        "built_at": "2026-09-26T12:00:00Z", "as_of": "2026-09-26",
        "database": {"file": database.name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()},
        "sources": [{"source": "gleif_lei_records", "url": "https://api.gleif.org/api/v1/lei-records",
                     "as_of": "2026-09-26", "licence": "CC0 1.0",
                     "notice": "LEI records from GLEIF under CC0 1.0. GLEIF does not endorse this data."},
                    {"source": "esma_firds:FULINS_E_1", "as_of": "2026-09-26", "licence": "ESMA legal notice",
                     "notice": "Source: ESMA FIRDS."},
                    {"source": "esma_firds:FULINS_E_2", "as_of": "2026-09-26", "licence": "ESMA legal notice",
                     "notice": "Source: ESMA FIRDS."}],
        "quality": {"tables": {"listings": 0}, "canaries": []},
    }), encoding="utf-8")
    return directory


class InstallTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.data = self.root / "core"

    def tearDown(self):
        self.tmp.cleanup()

    def installed_packages(self):
        return sorted(path.name for path in (self.data / "reference" / "packages").iterdir())

    def test_core_reads_only_the_installed_package(self):
        self.assertIsNone(store.reference_path(self.data))
        loose = self.data / "reference"
        make_package(loose)  # a builder output folder left where the old core looked
        self.assertIsNone(store.reference_path(self.data))
        result = reference_package.install(make_package(self.root / "out"), self.data)
        self.assertTrue(result["changed"])
        path = store.reference_path(self.data)
        self.assertEqual(path.parent.parent, self.data / "reference" / "packages")
        self.assertTrue((loose / "reference-20260926.sqlite3").exists())  # never removed
        status = reference_package.status(self.data)
        installed = status["installed"]
        self.assertEqual((installed["build_id"], installed["as_of"], installed["compatible"], status["refused"]),
                         ("reference-20260926", "2026-09-26", True, None))
        self.assertEqual(installed["notices"], ["LEI records from GLEIF under CC0 1.0. GLEIF does not endorse this data.",
                                             "Source: ESMA FIRDS."])

    def test_a_package_carries_its_build_questions_into_the_installed_copy(self):
        source = make_package(self.root / "out")
        data = json.dumps({"questions": [{"kind": "residual", "reason": "ambiguous", "subject_ids": ["security:isin:X"]}]}).encode()
        (source / "questions-20260926.json").write_bytes(data)
        manifest = json.loads((source / "package.json").read_text())
        manifest["claims"] = {"file": "questions-20260926.json", "bytes": len(data), "sha256": hashlib.sha256(b"damaged").hexdigest()}
        (source / "package.json").write_text(json.dumps(manifest))
        with self.assertRaises(reference_package.PackageError):
            reference_package.install(source, self.data)
        manifest["claims"]["sha256"] = hashlib.sha256(data).hexdigest()
        (source / "package.json").write_text(json.dumps(manifest))
        reference_package.install(source, self.data)
        self.assertEqual(reference_package.questions(store.reference_path(self.data))[0]["reason"], "ambiguous")

    def test_reinstalling_the_current_package_changes_nothing(self):
        source = make_package(self.root / "out")
        reference_package.install(source, self.data)
        self.assertFalse(reference_package.install(source / "package.json", self.data)["changed"])
        self.assertEqual(len(self.installed_packages()), 1)

    def test_reinstalling_repairs_a_damaged_installed_copy(self):
        source = make_package(self.root / "out")
        reference_package.install(source, self.data)
        [installed] = (self.data / "reference" / "packages").iterdir()
        (installed / "package.json").write_text("{not json")
        self.assertIsNone(store.reference_path(self.data))
        self.assertTrue(reference_package.install(source, self.data)["changed"])
        self.assertEqual(store.reference_path(self.data).parent, installed)
        self.assertEqual(self.installed_packages(), [installed.name])
        (installed / "reference-20260926.sqlite3").write_bytes(b"truncated")  # and a truncated database
        self.assertTrue(reference_package.install(source, self.data)["changed"])
        self.assertFalse(reference_package.install(source, self.data)["changed"])

    def test_a_new_package_replaces_the_installed_one_and_leftovers_are_swept(self):
        reference_package.install(make_package(self.root / "25", "reference-20260925"), self.data)
        packages = self.data / "reference" / "packages"
        (packages / ".staging-interrupted").mkdir()  # an install that was killed mid-copy
        (self.data / "reference" / ".installed.json.interrupted").write_text("{}")
        result = reference_package.install(make_package(self.root / "26", "reference-20260926"), self.data)
        self.assertEqual((result["changed"], result["installed"]["build_id"]), (True, "reference-20260926"))
        self.assertEqual([name[:18] for name in self.installed_packages()], ["reference-20260926"])
        self.assertEqual(list((self.data / "reference").glob(".installed.json.*")), [])
        # Going back to an older build is an ordinary install.
        older = reference_package.install(self.root / "25", self.data)
        self.assertEqual(older["installed"]["build_id"], "reference-20260925")
        self.assertEqual(len(self.installed_packages()), 1)

    def test_a_bad_checksum_is_refused_and_nothing_changes(self):
        reference_package.install(make_package(self.root / "good"), self.data)
        before = store.reference_path(self.data)
        bad = make_package(self.root / "bad", "reference-20260927")
        db = sqlite3.connect(bad / "reference-20260927.sqlite3")
        db.execute("INSERT INTO release (key, value) VALUES ('tampered', '1')")
        db.commit()
        db.close()
        with self.assertRaisesRegex(reference_package.PackageError, "Checksum mismatch.*Nothing was installed"):
            reference_package.install(bad, self.data)
        self.assertEqual(store.reference_path(self.data), before)
        self.assertEqual(len(self.installed_packages()), 1)  # no staging left behind
        status = reference_package.status(self.data)  # the refusal is visible beside the package still in use
        self.assertEqual(status["installed"]["build_id"], "reference-20260926")
        self.assertEqual(status["refused"]["package"], str(bad))
        self.assertIn("Checksum mismatch", status["refused"]["message"])
        # A damaged copy of the installed package is refused too, though an intact copy is installed.
        copy = self.root / "copy"
        shutil.copytree(self.root / "good", copy)
        with (copy / "reference-20260926.sqlite3").open("r+b") as handle:
            handle.seek(200)
            handle.write(b"\xff")
        with self.assertRaisesRegex(reference_package.PackageError, "Checksum mismatch"):
            reference_package.install(copy, self.data)
        reference_package.install(self.root / "good", self.data)  # an install clears the refusal
        self.assertIsNone(reference_package.status(self.data)["refused"])

    def test_an_incompatible_format_is_refused(self):
        newer = make_package(self.root / "newer", format_version=reference_package.FORMAT_VERSION + 1)
        with self.assertRaisesRegex(reference_package.PackageError, "Update Pythia"):
            reference_package.install(newer, self.data)
        older = make_package(self.root / "older", format_version=reference_package.FORMAT_VERSION - 1)
        with self.assertRaisesRegex(reference_package.PackageError, "Rebuild it"):
            reference_package.install(older, self.data)
        status = reference_package.status(self.data)
        self.assertIsNone(status["installed"])
        self.assertIn("Rebuild it", status["refused"]["message"])

    def test_a_database_that_disagrees_with_its_manifest_is_refused(self):
        source = make_package(self.root / "out")
        manifest = json.loads((source / "package.json").read_text())
        manifest["build_id"] = "reference-20260930"  # the file says reference-20260926
        (source / "package.json").write_text(json.dumps(manifest))
        with self.assertRaisesRegex(reference_package.PackageError, "build reference-20260926"):
            reference_package.install(source, self.data)

    def test_the_included_sources_are_reported_and_must_be_names(self):
        source = make_package(self.root / "out")
        manifest = json.loads((source / "package.json").read_text())
        for included in ([1], "esma_firds"):
            with self.subTest(included=included):
                (source / "package.json").write_text(json.dumps(manifest | {"included_sources": included}))
                with self.assertRaisesRegex(reference_package.PackageError, "invalid fields: included_sources"):
                    reference_package.install(source, self.data)
        (source / "package.json").write_text(json.dumps(manifest | {"included_sources": ["esma_firds"]}))
        installed = reference_package.install(source, self.data)["installed"]
        self.assertEqual(installed["included_sources"], ["esma_firds"])

    def test_the_command_line_reports_refusals_plainly_and_installs_a_good_package(self):
        script = Path(reference_package.__file__)
        bad = make_package(self.root / "bad")
        (bad / "reference-20260926.sqlite3").write_bytes(b"not the file")
        result = subprocess.run([sys.executable, "-P", str(script), "install", str(bad), "--data-dir", str(self.data)],
                                capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 2)
        self.assertIn("Reference package refused: Checksum mismatch", result.stderr)
        good = make_package(self.root / "ok")
        result = subprocess.run([sys.executable, "-P", str(script), "install", str(good), "--data-dir", str(self.data)],
                                capture_output=True, text=True, check=True)
        installed = json.loads(result.stdout)["installed"]
        self.assertEqual((installed["build_id"], "trust" in installed), ("reference-20260926", False))


if __name__ == "__main__":
    unittest.main()
