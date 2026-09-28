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
        self.assertEqual((status["build_id"], status["as_of"], status["compatible"], status["previous"]),
                         ("reference-20260926", "2026-09-26", True, None))
        self.assertEqual(status["notices"], ["LEI records from GLEIF under CC0 1.0. GLEIF does not endorse this data.",
                                             "Source: ESMA FIRDS."])

    def test_reinstalling_the_current_package_changes_nothing(self):
        source = make_package(self.root / "out")
        reference_package.install(source, self.data)
        self.assertFalse(reference_package.install(source / "package.json", self.data)["changed"])
        self.assertEqual(len(self.installed_packages()), 1)

    def test_the_previous_package_is_kept_for_rollback_and_older_ones_dropped(self):
        for day in ("24", "25", "26"):
            reference_package.install(make_package(self.root / day, f"reference-202609{day}"), self.data)
        status = reference_package.status(self.data)
        self.assertEqual((status["build_id"], status["previous"]["build_id"]), ("reference-20260926", "reference-20260925"))
        self.assertEqual([name[:18] for name in self.installed_packages()], ["reference-20260925", "reference-20260926"])
        rolled = reference_package.rollback(self.data)
        self.assertEqual((rolled["build_id"], rolled["previous"]["build_id"]), ("reference-20260925", "reference-20260926"))
        self.assertIn("reference-20260925", str(store.reference_path(self.data)))
        # Installing the package that is now previous again swaps back without copying.
        again = reference_package.install(self.root / "26", self.data)
        self.assertEqual((again["build_id"], again["previous"]["build_id"]), ("reference-20260926", "reference-20260925"))

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
        # A damaged copy of the installed package is refused too, though an intact copy is installed.
        copy = self.root / "copy"
        shutil.copytree(self.root / "good", copy)
        with (copy / "reference-20260926.sqlite3").open("r+b") as handle:
            handle.seek(200)
            handle.write(b"\xff")
        with self.assertRaisesRegex(reference_package.PackageError, "Checksum mismatch"):
            reference_package.install(copy, self.data)

    def test_an_incompatible_format_is_refused(self):
        newer = make_package(self.root / "newer", format_version=reference_package.FORMAT_VERSION + 1)
        with self.assertRaisesRegex(reference_package.PackageError, "Update Pythia"):
            reference_package.install(newer, self.data)
        older = make_package(self.root / "older", format_version=reference_package.FORMAT_VERSION - 1)
        with self.assertRaisesRegex(reference_package.PackageError, "Rebuild it"):
            reference_package.install(older, self.data)
        self.assertIsNone(reference_package.status(self.data))

    def test_a_database_that_disagrees_with_its_manifest_is_refused(self):
        source = make_package(self.root / "out")
        manifest = json.loads((source / "package.json").read_text())
        manifest["build_id"] = "reference-20260930"  # the file says reference-20260926
        (source / "package.json").write_text(json.dumps(manifest))
        with self.assertRaisesRegex(reference_package.PackageError, "build reference-20260926"):
            reference_package.install(source, self.data)

    def test_the_command_line_reports_refusals_plainly(self):
        script = Path(reference_package.__file__)
        bad = make_package(self.root / "bad")
        (bad / "reference-20260926.sqlite3").write_bytes(b"not the file")
        result = subprocess.run([sys.executable, "-P", str(script), "install", str(bad), "--data-dir", str(self.data)],
                                capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 2)
        self.assertIn("Reference package refused: Checksum mismatch", result.stderr)
        result = subprocess.run([sys.executable, "-P", str(script), "install", str(make_package(self.root / "ok")),
                                 "--data-dir", str(self.data)], capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(result.stdout)["build_id"], "reference-20260926")


if __name__ == "__main__":
    unittest.main()
