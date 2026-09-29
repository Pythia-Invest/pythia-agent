"""Pythia's own store directory (ADR 0034, 2026-09-29 amendment): identity.sqlite3 and the reference live under
PYTHIA_DATA_ROOT, and an earlier store in the core plugin's Hermes data directory moves there once, never lost."""
import errno
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
import types
import unittest.mock
from contextlib import closing
from pathlib import Path

from test_identity_contracts import FIXTURES, PACKAGE, identity
from test_identity_page import ASML
from test_identity_queue import NOW, QueueFixture, answer, load_core
from test_reference_package import make_package
from pythia_identity_fixture import lifecycle, location, page, queue, reference_package, store  # noqa: E402

TABLES = ("bindings", "verdicts", "claims", "queue")
# Two movers in separate processes, released together once both are ready.
MOVER = """
import importlib.util, json, sys, time
from pathlib import Path
package, legacy, target, ready, go = map(Path, sys.argv[1:6])
spec = importlib.util.spec_from_file_location("mover_identity", package / "__init__.py",
                                              submodule_search_locations=[str(package)])
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
from mover_identity import location
ready.touch()
deadline = time.monotonic() + 10
while not go.exists() and time.monotonic() < deadline:
    time.sleep(0.001)
print(json.dumps(location.adopt_legacy(legacy, target)))
"""


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class StoreFixture(QueueFixture):
    """A device an earlier Pythia used: its answers in the core plugin's data directory (`legacy`), none in the store."""

    def setUp(self):
        super().setUp()
        self.root = Path(self.tmp.name)
        self.identity.db.close()
        self.legacy, self.target = self.root / "legacy", self.root / "store"
        self.identity = store.IdentityStore(self.legacy)
        self.addCleanup(lambda: self.identity.db.close())
        self.enterContext(unittest.mock.patch.dict(os.environ, {"PYTHIA_DATA_ROOT": self.tmp.name}))

    def answers(self):
        """A binding, a question the user answered (its verdict and the binding it made) and the claims behind them."""
        item = self.ask(answer(("isin", "NL0010273215")), subject=self.bare())
        self.submit(item, "user", user_turn="desk:identity-verdict:test")
        self.ask(answer(("isin", "USN070592100"), native_id="ASML.XX"))  # an open conflict
        self.identity.db.close()
        return self.rows(self.legacy / location.IDENTITY)

    @staticmethod
    def rows(path: Path) -> dict:
        with closing(sqlite3.connect(path)) as db:
            return {table: db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] for table in TABLES}

    def adopt(self):
        self.target.mkdir(mode=0o700, exist_ok=True)
        return location.adopt_legacy(self.legacy, self.target)

    def core(self):
        """The registered core's identity over this device, with no plugins installed."""
        load_core()
        from pythia_core_queue_fixture import identity_ops
        self.enterContext(unittest.mock.patch.object(identity_ops, "installed", lambda: []))
        ops = identity_ops.Identity(types.SimpleNamespace(state=types.SimpleNamespace(data_dir=self.legacy)))
        self.addCleanup(lambda: ops._store and ops._store.db.close())
        return ops


class MoveTest(StoreFixture):
    def test_a_fresh_device_gets_a_private_store_and_nothing_under_the_profile(self):
        profile = self.root / "profile-data"
        directory = location.store_dir(profile)
        created = store.IdentityStore(directory)
        created.db.close()
        self.assertEqual(directory, self.target)
        self.assertEqual((directory.stat().st_mode & 0o777, created.path.stat().st_mode & 0o777), (0o700, 0o600))
        self.assertFalse(profile.exists())

    def test_an_earlier_store_moves_with_every_answer_once(self):
        before = self.answers()
        self.assertTrue(all(before.values()), before)
        [note] = self.adopt()
        self.assertIn("kept as identity.moved.sqlite3", note)
        moved = self.target / location.IDENTITY
        self.assertEqual((self.rows(moved), moved.stat().st_mode & 0o777), (before, 0o600))
        self.assertEqual(sorted(path.name for path in self.legacy.iterdir()), ["MOVED.json", location.MOVED])
        self.assertEqual(self.rows(self.legacy / location.MOVED), before)  # renamed, never deleted
        self.assertEqual(json.loads((self.legacy / "MOVED.json").read_text())["moved_to"], str(moved))
        kept = digest(moved)
        self.assertEqual(self.adopt(), [])  # a second run changes nothing
        self.assertEqual(digest(moved), kept)
        reopened = store.IdentityStore(self.target)
        self.assertEqual(reopened.metadata("schema_version"), store.SCHEMA_VERSION)
        reopened.db.close()

    def test_a_corrupt_or_foreign_earlier_store_is_left_as_it_was_and_identity_stays_closed(self):
        self.identity.db.close()
        source = self.legacy / location.IDENTITY
        foreign = self.root / "foreign.sqlite3"
        with closing(sqlite3.connect(foreign)) as db:
            db.execute("CREATE TABLE notes (text TEXT)")
            db.commit()
        for name, content in (("corrupt", b"SQLite format 3\x00" + b"\xff" * 4096), ("foreign", foreign.read_bytes())):
            with self.subTest(name):
                source.write_bytes(content)
                with self.assertRaisesRegex(location.Unavailable, "left in place"):
                    self.adopt()
                self.assertEqual(source.read_bytes(), content)
                self.assertEqual(sorted(path.name for path in self.target.iterdir()), [reference_package.MOVE_LOCK])
        ops = self.core()  # the registered core: every identity read is unavailable, and the log says why once
        from pythia_core_queue_fixture import queue_ops
        with self.assertLogs(level="WARNING") as logged:
            answers = [json.loads(ops.search({"query": "ASML"})), json.loads(ops.subject({"subject_id": ASML})),
                       json.loads(queue_ops.read_queue(ops, {}))]
        self.assertEqual(sum(f"identity is unavailable: the identity store {source}" in line for line in logged.output), 1)
        self.assertIn("unavailable", answers[0]["issues"][0]["message"])
        self.assertEqual([body["issues"][0]["code"] for body in answers[1:]], ["unavailable", "unavailable"])
        with self.assertRaisesRegex(OSError, "left in place"):  # a write answers the reason (the registry's error)
            queue_ops.submit_verdict(ops, {"item_id": "q", "relation": "none"})
        with self.assertRaisesRegex(OSError, re.escape(str(source))):
            ops.store  # noqa: B018
        self.assertFalse((self.target / location.IDENTITY).exists())
        self.assertEqual(source.read_bytes(), content)

    def test_an_interrupted_move_publishes_nothing_or_everything_and_is_never_repeated(self):
        before = self.answers()
        source, moved = self.legacy / location.IDENTITY, self.target / location.IDENTITY
        original = source.read_bytes()
        with unittest.mock.patch.object(location.os, "link", side_effect=KeyboardInterrupt):  # stopped before publishing
            with self.assertRaises(KeyboardInterrupt):
                self.adopt()
        self.assertFalse(moved.exists())
        self.assertEqual((source.read_bytes(), list(self.target.glob("*.part"))), (original, []))
        (self.target / "identity.0123abcd.part").write_bytes(b"left by a mover that was killed")
        with unittest.mock.patch.object(Path, "rename", side_effect=KeyboardInterrupt):  # stopped after publishing
            with self.assertRaises(KeyboardInterrupt):
                self.adopt()
        self.assertEqual((self.rows(moved), source.read_bytes()), (before, original))
        published = digest(moved)
        [note] = self.adopt()  # the old file is still there: it is kept and named, never moved over the store
        self.assertRegex(note, rf"^kept {re.escape(str(source))} \(\d+ bytes\): {re.escape(str(moved))} already exists$")
        self.assertEqual((digest(moved), source.read_bytes()), (published, original))
        # Both are present: the status reads say so, in Settings and in Repairs, until the old file is deleted by hand.
        reference_package.install(make_package(self.root / "out", source=self.path), self.target)
        ops = self.core()
        from pythia_core_queue_fixture import queue_ops
        both = json.loads(ops.reference_status({}))["data"]["both_present"]
        self.assertIn(f"still present: {source} (", both)
        self.assertEqual(json.loads(queue_ops.read_queue(ops, {}))["data"]["notice"], both)
        source.unlink()
        self.assertIsNone(json.loads(ops.reference_status({}))["data"]["both_present"])
        self.assertNotIn("notice", json.loads(queue_ops.read_queue(ops, {}))["data"] or {})

    def test_two_movers_at_once_publish_once(self):
        before = self.answers()
        reference_package.install(make_package(self.root / "out", source=self.path), self.legacy)
        self.target.mkdir(mode=0o700)
        go = self.root / "go"
        movers = [subprocess.Popen([sys.executable, "-c", MOVER, str(PACKAGE), str(self.legacy), str(self.target),
                                    str(self.root / f"ready-{index}"), str(go)], stdout=subprocess.PIPE, text=True)
                  for index in range(2)]
        deadline = time.monotonic() + 10
        while not all((self.root / f"ready-{index}").exists() for index in range(2)) and time.monotonic() < deadline:
            time.sleep(0.01)
        go.touch()
        notes = [note for mover in movers for note in json.loads(mover.communicate(timeout=30)[0])]
        self.assertEqual([mover.returncode for mover in movers], [0, 0])
        self.assertEqual(sum(note.startswith(f"moved {self.legacy}") for note in notes), 2, notes)  # identity, reference
        self.assertEqual(self.rows(self.target / location.IDENTITY), before)
        self.assertEqual(sorted(path.name for path in self.legacy.iterdir()), ["MOVED.json", location.MOVED])
        self.assertEqual(list(self.target.glob("*.part")), [])
        self.assertIsNotNone(reference_package.current(self.target))

    def test_older_schemas_migrate_at_the_new_location(self):
        self.identity.db.close()
        source = self.legacy / location.IDENTITY
        for version, schema in (("3", (FIXTURES / "identity-v3.sql").read_text()), ("4", identity.schema_sql("identity"))):
            with self.subTest(version):
                for path in (source, self.target / location.IDENTITY):
                    path.unlink(missing_ok=True)
                with closing(sqlite3.connect(source)) as db:
                    db.executescript(schema)
                    db.execute("DELETE FROM metadata")
                    db.execute("INSERT INTO metadata VALUES ('schema_version', ?)", (version,))
                    db.execute(f"INSERT INTO bindings (id, plugin, provider, native_id, native_scope, subject_id,"
                               f" {'level' if version == '3' else 'kind'}, status, authority, evidence_ids) VALUES"
                               f" ('b1', 'eodhd', 'eodhd', 'ASML.AS', 'catalogue', ?, 'listing', 'confirmed',"
                               f" 'source_asserted', '[\"ev:1\"]')", (ASML,))
                    db.commit()
                self.adopt()
                migrated = store.IdentityStore(self.target)
                self.assertEqual((migrated.metadata("schema_version"), migrated.set_aside), (store.SCHEMA_VERSION, None))
                self.assertEqual([row["subject_id"] for row in migrated.bindings([ASML])], [ASML])
                migrated.db.close()
                (self.legacy / location.MOVED).unlink()


class ReferenceMoveTest(StoreFixture):
    def setUp(self):
        super().setUp()
        reference_package.install(make_package(self.root / "out", source=self.path), self.legacy)
        self.installed = reference_package.current(self.legacy)
        self.release = reference_package.release_key(self.installed)

    def test_the_reference_moves_by_rename_and_nothing_is_re_keyed(self):
        with closing(store.open_reference(self.installed)) as ref:  # what the earlier core did on its first use
            lifecycle.rekey(self.identity, ref, self.release)
        self.identity.set_metadata("reference_release", self.release)
        security = page.load_subject(self.ref, ASML)["ids"]["security"]
        self.identity.put_queue_item(identity.QueueItem(  # re-keying would supersede this earlier build question
            id="ref-old", kind="residual", reason="ambiguous", subject_ids=(security,), candidate_ids=(ASML,),
            evidence_ids=(), state="open", opened_at=NOW, plugins=(queue.BUILD,)))
        conflict = self.ask(answer(("isin", "USN070592100")))
        self.identity.db.close()
        inode = self.installed.stat().st_ino
        ops = self.core()
        view = json.loads(ops.subject({"subject_id": ASML}))["data"]
        moved = reference_package.current(self.target)
        self.assertEqual((view["subject"]["id"], reference_package.release_key(moved)), (ASML, self.release))
        self.assertEqual((moved.stat().st_ino, (self.legacy / "reference").exists()), (inode, False))  # one rename
        self.assertEqual({item["id"] for item in ops.store.queue_items()}, {"ref-old", conflict.id})
        self.assertEqual(ops.store.metadata(lifecycle.REKEYED), self.release)

    def test_across_file_systems_a_verified_copy_is_installed_and_the_source_kept(self):
        rename = os.rename

        def other_device(source, target, *args, **kwargs):
            if Path(source) == self.legacy / "reference":
                raise OSError(errno.EXDEV, os.strerror(errno.EXDEV))
            return rename(source, target, *args, **kwargs)
        self.target.mkdir(mode=0o700)
        with unittest.mock.patch.object(os, "rename", side_effect=other_device):
            note = reference_package.adopt(self.legacy, self.target)
        copied = reference_package.current(self.target)
        self.assertIn("installed a verified copy", note)
        self.assertEqual((copied.parent.name, digest(copied)), (self.installed.parent.name, digest(self.installed)))
        self.assertEqual(reference_package.current(self.legacy), self.installed)  # the source is kept
        self.assertIsNone(reference_package.status(self.target)["refused"])

    def test_a_damaged_source_across_file_systems_installs_nothing(self):
        self.installed.write_bytes(self.installed.read_bytes()[:-1] + b"\x01")
        self.target.mkdir(mode=0o700)
        with unittest.mock.patch.object(os, "rename", side_effect=OSError(errno.EXDEV, "cross-device link")):
            note = reference_package.adopt(self.legacy, self.target)
        self.assertIn("Checksum mismatch", note)
        self.assertIsNone(reference_package.current(self.target))
        self.assertTrue(self.installed.exists())

    def test_an_installed_reference_is_never_replaced_and_the_earlier_one_is_kept_and_logged(self):
        self.target.mkdir(mode=0o700)
        newer = make_package(self.root / "newer", "reference-20261001", source=self.path)
        reference_package.install(newer, self.target)
        with self.assertLogs(location.logger, "INFO") as logged:
            self.adopt()
        self.assertRegex(" ".join(logged.output), rf"kept {re.escape(str(self.legacy / 'reference'))} \(\d+ bytes\)")
        self.assertEqual(reference_package.status(self.target)["installed"]["build_id"], "reference-20261001")
        self.assertEqual(reference_package.current(self.legacy), self.installed)

    def test_the_lifecycle_moves_it_before_installing(self):
        """`just dev` and `just reference-install` run `move` first, so an install never strands the earlier copy."""
        command = [sys.executable, "-P", reference_package.__file__, "move", "--from", str(self.legacy), "--data-dir",
                   str(self.target)]
        self.target.mkdir(mode=0o700)
        first = json.loads(subprocess.run(command, capture_output=True, text=True, check=True).stdout)
        again = json.loads(subprocess.run(command, capture_output=True, text=True, check=True).stdout)
        self.assertEqual((first["moved"], again["moved"]),
                         (f"moved {self.legacy / 'reference'} to {self.target / 'reference'}", None))


class NoRootTest(StoreFixture):
    def test_without_an_absolute_data_root_identity_is_unavailable_and_writes_nothing(self):
        self.answers()
        home, cwd = self.root / "home", self.root / "cwd"
        for path in (home, cwd):
            path.mkdir()
        self.addCleanup(os.chdir, os.getcwd())
        os.chdir(cwd)
        legacy = {path.name: digest(path) for path in self.legacy.iterdir()}
        for root in (None, "data"):
            with self.subTest(root=root), unittest.mock.patch.dict(os.environ, {"HOME": str(home)}):
                os.environ.pop("PYTHIA_DATA_ROOT", None)
                os.environ.pop("PYTHIA_CACHE_ROOT", None)
                if root:
                    os.environ["PYTHIA_DATA_ROOT"] = root
                ops = self.core()
                with self.assertLogs(level="WARNING"):
                    self.assertEqual(json.loads(ops.subject({"subject_id": ASML}))["issues"][0]["code"], "unavailable")
                with self.assertRaisesRegex(OSError, "PYTHIA_DATA_ROOT is not set to an absolute path"):
                    ops.store  # noqa: B018
                from pythia_core_queue_fixture import documents
                self.assertIsNone(documents.Reader(ops).cache.directory)  # no cache root: nothing is kept
        self.assertEqual((list(home.iterdir()), list(cwd.iterdir())), ([], []))
        self.assertEqual({path.name: digest(path) for path in self.legacy.iterdir()}, legacy)
        self.assertFalse(self.target.exists())


if __name__ == "__main__":
    unittest.main()
