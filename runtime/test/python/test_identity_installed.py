"""Every installed plugin is equal: `installed()` reads each plugin's contract whatever its name, its files or the
sign-off it declares (ADR 0044, amendment of 2026-09-30: installing a plugin means trusting it)."""
import contextlib
import json
import shutil
import sqlite3
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

from test_identity_contracts import PROVENANCE, load, load_reference
from test_identity_page import ASML, CONTRACTS
from test_identity_queue import load_core

load_core()
import pythia_core_queue_fixture.identity as identity  # noqa: E402
from pythia_core_queue_fixture import identity_ops  # noqa: E402
from pythia_core_queue_fixture.identity import page, reference_package, store  # noqa: E402
from pythia_core_queue_fixture.platform import access, harness  # noqa: E402

PLUGINS = Path(__file__).resolve().parents[2] / "managed/plugins"
NOW = "2026-09-26T10:00:00Z"


class PluginCase(unittest.TestCase):
    """A temporary device folder, and copies of plugin directories installed under any name."""

    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))

    def copy(self, name: str, source: Path, **edits: str) -> Path:
        """A copy of a plugin directory installed as `name`, with `edits` ({file: text}) applied."""
        target = self.root / "plugins" / name
        shutil.copytree(source, target, ignore=shutil.ignore_patterns("__pycache__"))
        for file, text in edits.items():
            (target / file).write_text(text, encoding="utf-8")
        return target


def installed(**directories: Path) -> dict[str, page.PluginInfo]:
    """`identity_ops.installed()` over a fake Hermes holding these plugin directories (keys: `_` for `-`)."""
    loaded = {key.replace("_", "-"): types.SimpleNamespace(manifest=types.SimpleNamespace(path=str(directory)))
              for key, directory in directories.items()}
    config = types.ModuleType("hermes_cli.config")
    config.load_config_readonly = dict
    with mock.patch.dict("sys.modules", {"hermes_cli": types.ModuleType("hermes_cli"), "hermes_cli.config": config}), \
            mock.patch.object(harness, "plugins", lambda: loaded), \
            mock.patch.object(access, "native_plugin_enabled", lambda *_: True), \
            mock.patch.object(identity_ops, "native_operations", lambda _keys: {}):
        return {info.key: info for info in identity_ops.installed()}


class InstalledTest(PluginCase):
    """`installed()` over a fake Hermes: a plugin is what its contract says, whatever its name or files."""

    def setUp(self):
        super().setUp()
        path = self.root / "reference.sqlite3"
        with contextlib.closing(sqlite3.connect(path)) as db:
            db.executescript(identity.schema_sql("reference"))
            load_reference(db, load("asml.json"))
            db.commit()
        self.ref = store.open_reference(path)
        self.addCleanup(self.ref.close)
        self.identity = store.IdentityStore(self.root / "store")
        self.addCleanup(self.identity.db.close)
        self.eodhd = self.root / "source" / "eodhd"
        self.eodhd.mkdir(parents=True)
        (self.eodhd / "contract.json").write_text(json.dumps(CONTRACTS["eodhd"]), encoding="utf-8")
        (self.eodhd / "definition.py").write_text("OPERATIONS = ('resolve', 'latest')\n", encoding="utf-8")

    def compose(self, info: page.PluginInfo) -> dict:
        subject = page.load_subject(self.ref, ASML)
        stored = {row["provider"]: row for row in self.identity.bindings([ASML], ("confirmed",))}
        return {section["section"]: section for section in page.compose(
            subject, [info], stored=lambda _target, provider: stored.get(provider), queue=[])}

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

    def test_a_renamed_byte_identical_copy_serves_alike(self):
        found = installed(pythia_eodhd=self.copy("pythia-eodhd", self.eodhd), mirror_eodhd=self.copy("mirror-eodhd", self.eodhd))
        shipped, mirror = found["pythia-eodhd"], found["mirror-eodhd"]
        self.assertEqual(json.dumps(self.compose(mirror)).replace("mirror-eodhd", "pythia-eodhd"),
                         json.dumps(self.compose(shipped)))
        section = page.Section.QUOTE
        self.assertEqual([info.key for info in page.ordered([mirror, shipped], section)],
                         [info.key for info in page.ordered([shipped, mirror], section)])  # only the names differ

    def test_the_sign_off_a_contract_declares_changes_nothing(self):
        """`signoff` records Pythia's audit; no code reads it, so an unsigned plugin serves like a signed-off one."""
        statuses = {"signed": {"status": "signed_off", "record": "docs/sources/eodhd.md"}, "grand": {"status": "grandfathered"},
                    "unsigned": {"status": "unsigned"}}
        found = installed(**{f"{name}_eodhd": self.copy(f"{name}-eodhd", self.eodhd, **{
            "contract.json": json.dumps({**CONTRACTS["eodhd"], "signoff": signoff})}) for name, signoff in statuses.items()})
        self.bind(found["signed-eodhd"])  # one binding for the provider serves every copy
        composed = {key.split("-")[0]: json.dumps(self.compose(info)).replace(key, "x") for key, info in found.items()}
        self.assertEqual(len(set(composed.values())), 1)
        self.assertEqual(json.loads(composed["unsigned"])["quote"]["status"], "ready")
        self.assertNotIn("unaudited", composed["unsigned"])

    def test_a_plugin_whose_files_change_keeps_serving_and_keeps_its_bindings(self):
        folder = self.copy("pythia-eodhd", self.eodhd)
        self.bind(installed(pythia_eodhd=folder)["pythia-eodhd"])
        before = [dict(row) for row in self.identity.db.execute("SELECT * FROM bindings")]
        (folder / "definition.py").write_text("OPERATIONS = ('resolve', 'latest', 'history')\n", encoding="utf-8")
        quote = self.compose(installed(pythia_eodhd=folder)["pythia-eodhd"])["quote"]
        self.assertEqual((quote["status"], quote["binding_status"]), ("ready", "confirmed"))
        self.assertEqual([dict(row) for row in self.identity.db.execute("SELECT * FROM bindings")], before)


if __name__ == "__main__":
    unittest.main()
