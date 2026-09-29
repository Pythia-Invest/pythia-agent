"""Trust follows a hashed release, never a plugin's name (ADR 0042, amendment of 2026-09-30; ADR 0044 A4)."""
import contextlib
import hashlib
import io
import json
import logging
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

from test_identity_contracts import PROVENANCE, load, load_reference
from test_identity_page import ASML, CONTRACTS
from test_identity_queue import load_core
from test_reference_package import make_package

load_core()
import pythia_core_queue_fixture.identity as identity  # noqa: E402
from pythia_core_queue_fixture import identity_ops  # noqa: E402
from pythia_core_queue_fixture.identity import location, page, reference_package, store, trust  # noqa: E402
from pythia_core_queue_fixture.platform import access, harness  # noqa: E402

PLUGINS = Path(__file__).resolve().parents[2] / "managed/plugins"
NOW = "2026-09-26T10:00:00Z"


class TrustCase(unittest.TestCase):
    """A device with its own config folder and Pythia's release grants in a file of the test's own."""

    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.config = self.root / "config"
        self.release = self.root / "release" / trust.FILE
        self.release.parent.mkdir()
        self.enterContext(mock.patch.dict(os.environ, {"PYTHIA_CONFIG_ROOT": str(self.config)}))
        self.enterContext(mock.patch.object(trust, "RELEASE", self.release))
        for cache in ("_digests", "_files", "_warned"):
            self.enterContext(mock.patch.object(trust, cache, type(getattr(trust, cache))()))

    def copy(self, name: str, source: Path, **edits: str) -> Path:
        """A copy of a plugin directory installed as `name`, with `edits` ({file: text}) applied."""
        target = self.root / "plugins" / name
        shutil.copytree(source, target, ignore=shutil.ignore_patterns("__pycache__"))
        for file, text in edits.items():
            (target / file).write_text(text, encoding="utf-8")
        return target

    def ship(self, **directories: Path) -> dict:
        """Generate Pythia's release grants for these payloads, as the lifecycle does before copying them."""
        return trust.release([{"plugin": key.replace("_", "-"), "directory": str(directory)}
                              for key, directory in directories.items()], self.release)


class DigestTest(TrustCase):
    def test_the_digest_is_the_sha256_of_the_sorted_file_lines(self):
        plugin = self.root / "plugin"
        (plugin / "skills").mkdir(parents=True)
        files = {"definition.py": b"TOOLS = ()\n", "skills/SKILL.md": b"# Guidance\n", "contract.json": b"{}"}
        for name, data in files.items():
            (plugin / name).write_bytes(data)
        lines = sorted(f"{name}\t{hashlib.sha256(data).hexdigest()}\n" for name, data in files.items())
        self.assertEqual(trust.digest(plugin), "sha256:" + hashlib.sha256("".join(lines).encode()).hexdigest())
        self.assertEqual(trust.digest(plugin, sorted(files)), trust.digest(plugin))  # the payload list, as generated

    def test_a_renamed_copy_has_the_same_digest_and_one_changed_byte_another(self):
        shipped = self.copy("pythia-sec", PLUGINS / "sec")
        renamed = self.copy("community-sec", PLUGINS / "sec")
        self.assertEqual(trust.digest(renamed), trust.digest(shipped))
        # What Python and the lifecycle leave beside the files is not part of the release.
        (renamed / "__pycache__").mkdir()
        (renamed / "__pycache__" / "identity.cpython-312.pyc").write_bytes(b"bytecode")
        (renamed / "stale.pyc").write_bytes(b"bytecode")
        (renamed / trust.RECEIPT).write_text("{}", encoding="utf-8")
        (renamed / ".git" / "objects").mkdir(parents=True)  # a git install's clone
        (renamed / ".git" / "HEAD").write_text("ref: refs/heads/main\n", encoding="utf-8")
        self.assertEqual(trust.digest(renamed), trust.digest(shipped))
        edited = renamed / "README.md"
        edited.write_bytes(edited.read_bytes()[:-1] + b"!")
        self.assertNotEqual(trust.digest(renamed), trust.digest(shipped))
        self.assertNotEqual(trust.digest(self.copy("added", PLUGINS / "sec", **{"notes.txt": "x"})),
                            trust.digest(shipped))  # so does one added file

    def test_a_symlink_anywhere_means_no_digest(self):
        plugin = self.copy("linked", PLUGINS / "sec")
        (plugin / "elsewhere.py").symlink_to(PLUGINS / "sec" / "definition.py")
        self.assertIsNone(trust.digest(plugin))
        (self.root / "plugins" / "alias").symlink_to(PLUGINS / "sec", target_is_directory=True)
        self.assertIsNone(trust.digest(self.root / "plugins" / "alias"))
        self.assertEqual(trust.level(None), trust.DISPLAY)


class GrantTest(TrustCase):
    def test_the_release_confirms_exactly_the_shipped_contracts_that_sign_off(self):
        shipped = {path.parent.name: path.parent for path in PLUGINS.glob("*/contract.json")}
        self.ship(**shipped)
        for name, directory in shipped.items():
            status = json.loads((directory / "contract.json").read_text())["signoff"]["status"]
            with self.subTest(plugin=name):
                self.assertEqual(trust.level(trust.digest(directory)),
                                 trust.CONFIRM if status in ("signed_off", "grandfathered") else trust.DISPLAY)

    def test_a_local_grant_wins_in_both_directions(self):
        shipped, community = self.copy("pythia-sec", PLUGINS / "sec"), self.copy("community-nsm", PLUGINS / "nsm")
        self.ship(pythia_sec=shipped)
        self.assertEqual((trust.level(trust.digest(shipped)), trust.level(trust.digest(community))),
                         (trust.CONFIRM, trust.DISPLAY))
        self.assertTrue(trust.grant(trust.digest(community), trust.CONFIRM, plugin="community-nsm"))
        self.assertTrue(trust.grant(trust.digest(shipped), trust.DISPLAY, plugin="pythia-sec"))
        self.assertEqual((trust.level(trust.digest(shipped)), trust.level(trust.digest(community))),
                         (trust.DISPLAY, trust.CONFIRM))
        self.assertFalse(trust.grant(trust.digest(shipped), trust.CONFIRM, keep=True))  # an existing choice is kept
        self.assertEqual((self.config / trust.FILE).stat().st_mode & 0o777, 0o600)

    def test_a_malformed_local_file_is_ignored_with_one_warning_and_the_release_still_applies(self):
        shipped, community = self.copy("pythia-sec", PLUGINS / "sec"), self.copy("community-nsm", PLUGINS / "nsm")
        self.ship(pythia_sec=shipped)
        self.config.mkdir()
        local = self.config / trust.FILE
        grant = {"digest": trust.digest(community), "level": "suggest"}  # a level that does not exist yet
        for document in ("{not json", json.dumps({"schema_version": 1, "digest_rule": trust.RULE, "grants": [grant]})):
            with self.subTest(document=document[:12]), self.assertLogs(trust.logger, logging.WARNING) as logged:
                local.write_text(document, encoding="utf-8")
                package = {"build_id": "reference-20260926", "database": {"sha256": "0" * 64}}
                self.assertFalse(trust.grant_package(package, trust.CONFIRM))  # left as it is, no second warning
                for _ in range(2):
                    self.assertEqual((trust.level(trust.digest(shipped)), trust.level(trust.digest(community))),
                                     (trust.CONFIRM, trust.DISPLAY))
                self.assertEqual(len(logged.records), 1)
            with self.assertRaisesRegex(ValueError, "malformed"):  # the user's file is never overwritten
                trust.grant(trust.digest(community), trust.CONFIRM)

    def test_only_display_and_confirm_are_levels(self):
        community = self.copy("community-nsm", PLUGINS / "nsm")
        with self.assertRaisesRegex(ValueError, "suggest"):
            trust.grant(trust.digest(community), "suggest")
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            trust.main(["grant", str(community), "suggest"])
        self.assertFalse((self.config / trust.FILE).exists())

    def test_the_command_line_grants_a_plugin_directory_and_reports_its_level(self):
        community = self.copy("community-nsm", PLUGINS / "nsm")
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(trust.main(["grant", str(community), "confirm"]), 0)
        self.assertEqual(json.loads(out.getvalue())["digest"], trust.digest(community))
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(trust.main(["status", str(community)]), 0)
        report = json.loads(out.getvalue())
        self.assertEqual([(item["digest"], item["level"]) for item in report["directories"]],
                         [(trust.digest(community), "confirm")])
        self.assertEqual(report["local"]["grants"][0]["plugin"], "community-nsm")  # a label; lookup is by digest


class InstalledTest(TrustCase):
    """`installed()` over a fake Hermes: the level comes from each plugin's files, whatever its name."""

    def setUp(self):
        super().setUp()
        path = self.root / "reference.sqlite3"
        with contextlib.closing(sqlite3.connect(path)) as db:
            db.executescript(identity.schema_sql("reference"))
            load_reference(db, load("asml.json"))
            db.commit()
        self.ref = store.open_reference(path, trust.CONFIRM)
        self.addCleanup(self.ref.close)
        self.identity = store.IdentityStore(self.root / "store")
        self.addCleanup(self.identity.db.close)
        self.eodhd = self.root / "source" / "eodhd"
        self.eodhd.mkdir(parents=True)
        (self.eodhd / "contract.json").write_text(json.dumps(CONTRACTS["eodhd"]), encoding="utf-8")
        (self.eodhd / "definition.py").write_text("OPERATIONS = ('resolve', 'latest')\n", encoding="utf-8")
        self.ship(pythia_eodhd=self.eodhd)

    def installed(self, **directories: Path) -> dict[str, page.PluginInfo]:
        loaded = {key.replace("_", "-"): types.SimpleNamespace(manifest=types.SimpleNamespace(path=str(directory)))
                  for key, directory in directories.items()}
        config = types.ModuleType("hermes_cli.config")
        config.load_config_readonly = dict
        with mock.patch.dict("sys.modules", {"hermes_cli": types.ModuleType("hermes_cli"), "hermes_cli.config": config}), \
                mock.patch.object(harness, "plugins", lambda: loaded), \
                mock.patch.object(access, "native_plugin_enabled", lambda *_: True), \
                mock.patch.object(identity_ops, "native_operations", lambda _keys: {}):
            return {info.key: info for info in identity_ops.installed()}

    def compose(self, info: page.PluginInfo) -> dict:
        subject = page.load_subject(self.ref, ASML)
        stored = {row["provider"]: row for row in self.identity.bindings([ASML], ("confirmed",))}
        return {section["section"]: section for section in page.compose(
            subject, [info], stored=lambda _target, provider: stored.get(provider), coins=lambda *_: None, queue=[])}

    def bind(self, info: page.PluginInfo) -> None:
        record = {"level": "listing", "provenance": PROVENANCE, "identifiers": [{"scheme": "isin", "value": "NL0010273215"}],
                  "native_ref": {"provider": "eodhd", "native_id": "ASML.AS", "native_scope": "catalogue"}}
        batch = identity.batch_from_json({"plugin": "eodhd", "provider": "eodhd", "adapter_version": "1",
                                          "origin": "resolve", "claims": [record]})
        subject = page.load_subject(self.ref, ASML)
        binding, item, _ = page.apply_resolve(batch, info, identity.Level.LISTING, subject,
                                              page.resolve_input(info, subject), now=NOW, as_of="2026-09-26")
        self.assertIsNone(item)
        self.assertTrue(self.identity.put_binding(binding))

    def test_a_renamed_byte_identical_copy_gets_the_same_level_and_serves_alike(self):
        found = self.installed(pythia_eodhd=self.copy("pythia-eodhd", self.eodhd),
                               mirror_eodhd=self.copy("mirror-eodhd", self.eodhd))
        shipped, mirror = found["pythia-eodhd"], found["mirror-eodhd"]
        self.assertEqual((shipped.manifest.unaudited, mirror.manifest.unaudited), (False, False))
        self.assertEqual(json.dumps(self.compose(mirror)).replace("mirror-eodhd", "pythia-eodhd"),
                         json.dumps(self.compose(shipped)))
        section = page.Section.QUOTE
        self.assertEqual([info.key for info in page.ordered([mirror, shipped], section)],
                         [info.key for info in page.ordered([shipped, mirror], section)])  # only the names differ

    def test_the_users_grant_decides_in_both_directions_whatever_the_contract_declares(self):
        community = self.root / "source" / "community"
        community.mkdir()
        (community / "contract.json").write_text(json.dumps({**CONTRACTS["eodhd"], "signoff": {"status": "unsigned"}}))
        shipped = self.copy("pythia-eodhd", self.eodhd)
        found = self.installed(pythia_eodhd=shipped, community_eodhd=community)
        self.assertEqual((found["pythia-eodhd"].manifest.unaudited, found["community-eodhd"].manifest.unaudited),
                         (False, True))
        trust.grant(trust.digest(community), trust.CONFIRM)  # the user's own sign-off
        trust.grant(trust.digest(shipped), trust.DISPLAY)    # and a demotion of Pythia's
        found = self.installed(pythia_eodhd=shipped, community_eodhd=community)
        self.assertEqual((found["pythia-eodhd"].manifest.unaudited, found["community-eodhd"].manifest.unaudited),
                         (True, False))
        with contextlib.redirect_stdout(io.StringIO()) as out:
            trust.main(["status", str(community), str(shipped)])
        self.assertEqual([item["level"] for item in json.loads(out.getvalue())["directories"]], ["confirm", "display"])

    def test_a_bundled_name_on_foreign_bytes_is_display_and_says_why(self):
        foreign = self.copy("pythia-eodhd", self.eodhd, **{"definition.py": "OPERATIONS = ('resolve', 'latest')\n#"})
        with self.assertLogs(trust.logger, logging.WARNING) as logged:
            found = self.installed(pythia_eodhd=foreign)
        self.assertTrue(found["pythia-eodhd"].manifest.unaudited)
        [warning] = logged.output
        self.assertIn("pythia-eodhd", warning)
        self.assertIn(trust.digest(foreign), warning)

    def test_a_plugin_whose_files_change_drops_to_display_and_keeps_its_bindings(self):
        installed = self.copy("pythia-eodhd", self.eodhd)
        self.bind(self.installed(pythia_eodhd=installed)["pythia-eodhd"])
        before = [dict(row) for row in self.identity.db.execute("SELECT * FROM bindings")]
        (installed / "definition.py").write_text("OPERATIONS = ('resolve', 'latest', 'history')\n", encoding="utf-8")
        with self.assertLogs(trust.logger, logging.WARNING):
            updated = self.installed(pythia_eodhd=installed)["pythia-eodhd"]
        self.assertTrue(updated.manifest.unaudited)
        quote = self.compose(updated)["quote"]
        self.assertEqual((quote["status"], quote["binding_status"], quote["unaudited"]), ("ready", "confirmed", True))
        self.assertEqual([dict(row) for row in self.identity.db.execute("SELECT * FROM bindings")], before)


class PackageGrantTest(TrustCase):
    """The reference package is trusted like any contributor: by a grant on its digest, recorded when it is installed."""

    def setUp(self):
        super().setUp()
        self.data = self.root / "data" / "store"

    def grants(self) -> list[tuple[str, str]]:
        return [(item["package"], item["level"]) for item in trust.grants(trust.local_file()).values()]

    def test_installing_records_the_users_trust_and_display_opts_out(self):
        first = make_package(self.root / "first")
        installed = reference_package.install(first, self.data, trust.CONFIRM)["installed"]
        self.assertEqual(installed["trust"], trust.CONFIRM)
        self.assertEqual(reference_package.install(first, self.data, trust.DISPLAY)["installed"]["trust"], trust.DISPLAY)
        # Installing the same package again keeps the user's choice; a new package is the user's new act.
        self.assertEqual(reference_package.install(first, self.data, trust.CONFIRM)["installed"]["trust"], trust.DISPLAY)
        second = make_package(self.root / "second", "reference-20260927")
        self.assertEqual(reference_package.install(second, self.data, trust.CONFIRM)["installed"]["trust"], trust.CONFIRM)
        self.assertEqual(self.grants(), [("reference-20260926", "display"), ("reference-20260927", "confirm")])

    def test_the_command_line_installs_only_where_it_can_record_trust_and_display_stays_display(self):
        script, package = Path(reference_package.__file__), make_package(self.root / "package")

        def install(environment):
            return subprocess.run([sys.executable, "-P", str(script), "install", str(package), "--data-dir",
                                   str(self.data), "--display"], capture_output=True, text=True, env=environment)
        refused = install({name: value for name, value in os.environ.items() if name != "PYTHIA_CONFIG_ROOT"})
        self.assertEqual(refused.returncode, 2)
        self.assertIn("PYTHIA_CONFIG_ROOT", refused.stderr)
        self.assertIsNone(reference_package.status(self.data)["installed"])  # nothing installed
        self.assertEqual(install(dict(os.environ)).returncode, 0)
        self.enterContext(mock.patch.dict(os.environ, {location.ROOT: str(self.data.parent)}))
        self.enterContext(mock.patch.object(location, "_opened", {}))
        self.assertEqual(location.store_dir(self.root / "legacy"), self.data)  # a later first use
        self.assertEqual(reference_package.status(self.data)["installed"]["trust"], trust.DISPLAY)

    def test_a_package_installed_before_grants_is_granted_once_on_first_use(self):
        self.assertEqual(reference_package.install(make_package(self.root / "old"), self.data)["installed"]["trust"],
                         trust.DISPLAY)  # as an installer without grants left it
        self.enterContext(mock.patch.dict(os.environ, {location.ROOT: str(self.data.parent)}))
        self.enterContext(mock.patch.object(location, "_opened", {}))
        with self.assertLogs(location.logger, logging.INFO) as logged:
            self.assertEqual(location.store_dir(self.root / "legacy"), self.data)
        self.assertIn("granted confirm to the installed reference package reference-20260926, which had no trust grant",
                      "\n".join(logged.output))
        self.assertEqual(reference_package.status(self.data)["installed"]["trust"], trust.CONFIRM)
        trust.grant(trust.package_digest(reference_package.read_manifest(self.root / "old")), trust.DISPLAY)
        location._opened.clear()  # a later run: the user's choice stands
        self.assertFalse(location.grant_installed(self.data))
        location.store_dir(self.root / "legacy")
        self.assertEqual(self.grants(), [("reference-20260926", "display")])


if __name__ == "__main__":
    unittest.main()
