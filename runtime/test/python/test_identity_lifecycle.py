"""Lifecycle A: local identity state follows a new reference release's re-keyed subject IDs."""
import json
from contextlib import closing
import sqlite3
import time
import types
import unittest.mock
from dataclasses import replace
from pathlib import Path

import identity_world
from test_identity_contracts import identity
from test_identity_page import ASML, plugin
from test_identity_queue import AS_OF, NOW, QueueFixture, answer, load_core
from test_reference_package import make_package
from pythia_identity_fixture import corrections, device, lifecycle, page, reference_package, store  # noqa: E402

SECURITY = "security:isin:NL0010273215"
NEW_SECURITY, NEW_LISTING = "security:figi:BBG001S7Q066", "listing:figi:BBG000C1HT47"
MIDDLE = "listing:figi:BBG000C1HT99"


class LifecycleTest(QueueFixture):
    def setUp(self):
        super().setUp()
        self.builds = Path(self.tmp.name) / "builds"
        self.builds.mkdir()

    def release(self, name, renames=(), aliases=(), drop=()):
        return identity_world.release(self.path, self.builds, name, renames=renames, aliases=aliases, drop=drop)

    def bind(self):
        """What identity-resolve stores when EODHD answers ASML's ISIN: a binding citing the ISIN assertion."""
        eodhd, subject = plugin("eodhd"), page.load_subject(self.ref, ASML)
        binding, _, _ = page.apply_resolve(answer(("isin", "NL0010273215")), eodhd, identity.Level.LISTING, subject,
                                           page.resolve_input(eodhd, subject), now=NOW, as_of=AS_OF)
        self.assertTrue(self.identity.put_binding(binding))
        return binding

    def install(self, path, build_id, data):
        """Install a build of the fixture reference as a package, as `just reference-install` does."""
        reference_package.install(make_package(self.builds / f"package-{path.stem}", build_id, source=path), data)

    def rekey(self, path, again=False):
        with closing(store.open_reference(path)) as ref:
            return lifecycle.rekey(self.identity, ref, lifecycle.release_id(ref, path.stem), again=again)

    def bound(self):
        row = self.identity.binding_for(identity.ProviderRef("eodhd", "ASML.AS", "catalogue"))
        return row["subject_id"], json.loads(row["evidence_ids"])

    def test_a_binding_still_serves_the_page_after_its_subjects_are_re_keyed(self):
        self.bind()
        conflict = self.ask(answer(("isin", "USN070592100")))  # the receipt's ISIN: a conflict citing ASML's evidence
        path = self.release("reference-20261001", renames=[(ASML, NEW_LISTING), (SECURITY, NEW_SECURITY)],
                            aliases=[(ASML, NEW_LISTING), (SECURITY, NEW_SECURITY)])
        core = load_core()
        from pythia_core_queue_fixture import identity_ops
        data = Path(self.tmp.name) / "core"
        ops = identity_ops.Identity(types.SimpleNamespace(), data_dir=data)
        with unittest.mock.patch.object(identity_ops, "installed", lambda: [plugin("eodhd")]):
            self.install(self.path, "reference-20260926", data)  # the release the rows were written under
            self.assertEqual(json.loads(ops.subject({"subject_id": ASML}))["data"]["subject"]["id"], ASML)
            self.install(path, "reference-20261001", data)  # installing a newer package re-keys nothing yet
            self.assertEqual(self.bound()[0], ASML)
            view = json.loads(ops.subject({"subject_id": ASML}))["data"]  # its first read, by a bookmarked old ID
        ops.store.db.close()
        del core
        [quote] = [section for section in view["sections"] if section["section"] == "quote"]
        self.assertEqual((view["subject"]["id"], quote["plugin"], quote["status"], quote["binding_status"]),
                         (NEW_LISTING, "pythia-eodhd", "ready", "confirmed"))

        with closing(store.open_reference(path)) as ref:
            isin = ref.execute("SELECT evidence_id FROM assertions WHERE subject_id = ? AND scheme = 'isin'",
                               (NEW_SECURITY,)).fetchone()[0]
            cited = {row["evidence_id"] for row in ref.execute("SELECT evidence_id FROM assertions")}
        bound = self.identity.binding_for(identity.ProviderRef("eodhd", "ASML.AS", "catalogue"))
        self.assertEqual((bound["subject_id"], bound["kind"], json.loads(bound["evidence_ids"])), (NEW_LISTING, "listing", [isin]))
        item = self.identity.queue_item(conflict.id)
        self.assertEqual((item["candidate_ids"], item["state"]), ([NEW_LISTING], "open"))
        self.assertLessEqual(set(item["evidence_ids"]), cited)
        self.assertEqual(item["key"], replace(conflict, subject_ids=tuple(item["subject_ids"])).key)

    def test_a_same_day_rebuild_is_a_new_release_for_the_re_key(self):
        self.bind()
        core = load_core()
        from pythia_core_queue_fixture import identity_ops
        data = Path(self.tmp.name) / "core"
        ops = identity_ops.Identity(types.SimpleNamespace(), data_dir=data)
        with unittest.mock.patch.object(identity_ops, "installed", lambda: [plugin("eodhd")]):
            self.install(self.path, "reference-20261001", data)
            ops.subject({"subject_id": ASML})
            # Rebuilt the same day with the same build ID: another checksum, and a re-keyed ASML.
            self.install(self.release("rebuild", renames=[(ASML, NEW_LISTING)], aliases=[(ASML, NEW_LISTING)]),
                         "reference-20261001", data)
            ops.subject({"subject_id": ASML})
        ops.store.db.close()
        del core
        self.assertEqual(self.bound()[0], NEW_LISTING)

    def test_a_same_day_rebuild_settles_the_whole_queue_again(self):
        core = load_core()
        from pythia_core_queue_fixture import identity_ops, queue_ops
        data = Path(self.tmp.name) / "core"
        ops = identity_ops.Identity(types.SimpleNamespace(), data_dir=data)
        settled = []
        with unittest.mock.patch.object(identity_ops, "installed", lambda: []), \
                unittest.mock.patch.object(queue_ops.questions, "settle_by_rules",
                                           lambda _store, _ref, _plugins, items, **_: settled.append(len(items))):
            self.ask(answer(("isin", "USN070592100")))  # one open question
            for source in (self.path, self.release("rebuild")):  # the same build ID, another checksum
                self.install(source, "reference-20261001", data)
                queue_ops.settle(ops, [])  # no subject of its own: only a new release settles every open item
        ops.store.db.close()
        del core
        self.assertEqual(settled, [1, 1])

    def test_a_two_hop_alias_chain_is_followed(self):
        self.bind()
        self.identity.put_miss(ASML, "pythia-yahoo", "no match", 3600)
        path = self.release("reference-20261001", renames=[(ASML, NEW_LISTING)],
                            aliases=[(ASML, MIDDLE), (MIDDLE, NEW_LISTING)])
        done = self.rekey(path)
        self.assertEqual((done["moved"], done["vanished"]), (1, 0))
        self.assertEqual([row["subject_id"] for row in self.identity.bindings([NEW_LISTING])], [NEW_LISTING])
        self.assertEqual(self.identity.misses(NEW_LISTING), {"pythia-yahoo": "no match"})
        with closing(store.open_reference(path)) as ref:
            self.assertEqual(page.load_subject(ref, ASML)["id"], NEW_LISTING)

    def test_the_investors_corrections_follow_a_re_keyed_subject_and_a_collision_keeps_the_newest(self):
        def correct(kind, subject, scheme, value):
            return corrections.put(self.identity, {"kind": kind, "subject_id": subject, "scheme": scheme, "value": value},
                                   now=NOW, user_turn="desk:identity-correction:test", note=None)

        correct("identifier", SECURITY, "isin", "US0378331005")
        correct("price_source", ASML, None, "eodhd")
        correct("identifier", NEW_SECURITY, "isin", "US5949181045")  # the same fact, already under the new key: newer
        before = device.generation(self.identity)
        path = self.release("reference-20261001", renames=[(ASML, NEW_LISTING), (SECURITY, NEW_SECURITY)],
                            aliases=[(ASML, NEW_LISTING), (SECURITY, NEW_SECURITY)])
        self.assertEqual(self.rekey(path)["moved"], 2)
        found = [(row["kind"], row["subject_id"], row["value"], row["state"]) for row in
                 self.identity.select("SELECT * FROM corrections ORDER BY rowid")]
        self.assertEqual(found, [("identifier", NEW_SECURITY, "US0378331005", "undone"),
                                 ("price_source", NEW_LISTING, "eodhd", "active"),
                                 ("identifier", NEW_SECURITY, "US5949181045", "active")])
        self.assertGreater(device.generation(self.identity), before)
        self.assertEqual(self.rekey(path, again=True), {"release": "reference-20261001", "moved": 0, "rows": 0, "vanished": 0})

    def test_a_correction_about_a_subject_a_release_drops_is_kept_and_flagged_with_it(self):
        corrections.put(self.identity, {"kind": "price_source", "subject_id": ASML, "scheme": None, "value": "eodhd"},
                        now=NOW, user_turn="desk:identity-correction:test", note=None)
        self.rekey(self.release("reference-20261001", drop=[ASML]))
        self.assertEqual(lifecycle.vanished(self.identity), [ASML])
        self.assertEqual([row["state"] for row in self.identity.select("SELECT state FROM corrections")], ["active"])

    def test_a_vanished_subject_keeps_its_rows_and_is_flagged(self):
        binding = self.bind()
        done = self.rekey(self.release("reference-20261001", drop=[ASML]))
        self.assertEqual(done["vanished"], 1)
        self.assertEqual(lifecycle.vanished(self.identity), [ASML])
        self.assertEqual(self.identity.bound_subject(binding.provider_ref), ASML)
        # A later release that holds it again clears the flag.
        self.rekey(self.release("reference-20261002"))
        self.assertEqual(lifecycle.vanished(self.identity), [])

    def test_a_release_is_applied_once_and_re_applying_it_changes_nothing(self):
        self.bind()
        path = self.release("reference-20261001", renames=[(ASML, NEW_LISTING), (SECURITY, NEW_SECURITY)],
                            aliases=[(ASML, NEW_LISTING), (SECURITY, NEW_SECURITY)])
        done = self.rekey(path)
        self.assertEqual(done["rows"], 1)
        snapshot = self.identity.db.execute("SELECT * FROM bindings").fetchall()
        self.assertIsNone(self.rekey(path))
        self.identity.set_metadata(lifecycle.REKEYED, "")  # forced again: nothing left to move
        again = self.rekey(path)
        self.assertEqual((again["moved"], again["rows"]), (0, 0))
        self.assertEqual([tuple(row) for row in self.identity.db.execute("SELECT * FROM bindings")],
                         [tuple(row) for row in snapshot])

    def test_a_row_written_under_the_previous_release_during_a_re_key_is_carried_again(self):
        path = self.release("reference-20261001", renames=[(ASML, NEW_LISTING)], aliases=[(ASML, NEW_LISTING)])
        self.rekey(path)
        self.bind()  # identity-resolve answered for the subject it loaded before the new release landed
        self.assertIsNone(self.rekey(path))
        self.assertEqual(self.rekey(path, again=True)["rows"], 1)
        self.assertEqual(self.bound()[0], NEW_LISTING)

    def test_reinstalling_an_older_release_re_keys_back_or_flags_and_a_newer_one_re_applies(self):
        self.bind()
        original = self.bound()
        newer = self.release("reference-20261001", renames=[(ASML, NEW_LISTING), (SECURITY, NEW_SECURITY)],
                             aliases=[(ASML, NEW_LISTING), (SECURITY, NEW_SECURITY)])
        self.rekey(newer)
        # An older build that knows the newer key (the builder aliases every key a subject could have had).
        self.rekey(self.release("reference-20260927", aliases=[(NEW_LISTING, ASML), (NEW_SECURITY, SECURITY)]))
        self.assertEqual(self.bound(), original)
        self.rekey(newer)
        # An older build that does not: the rows are kept and flagged until a newer build applies again.
        self.rekey(self.release("reference-20260926"))
        self.assertEqual((self.bound()[0], lifecycle.vanished(self.identity)), (NEW_LISTING, [NEW_LISTING]))
        self.rekey(newer)
        self.assertEqual((self.bound()[0], lifecycle.vanished(self.identity)), (NEW_LISTING, []))


class ScaleTest(QueueFixture):
    """PR #47 alone re-keys about 55k IDs: carrying a device's rows across such a release must stay fast."""

    ALIASES, BOUND = 55_000, 2_000

    def test_fifty_five_thousand_aliases(self):
        path = Path(self.tmp.name) / "reference-20261001.sqlite3"
        provenance = {"plugin": "fixture", "source": "fixture", "adapter_version": "1", "retrieved_at": NOW}
        rows, aliases, cited = [], [], {}
        for index in range(self.ALIASES):
            old, new = f"listing:isin:NL{index:010d}:XAMS:EUR", f"listing:figi:BBG{index:09d}"
            item = identity.IdentifierAssertion(subject_id=new, scheme="ticker_mic", value=f"T{index}@XAMS",
                                                authority="source_asserted", provenance=provenance)
            rows.append((item.evidence_id, new, item.value))
            aliases.append((old, new, "reference-20261001"))
            if index < self.BOUND:
                cited[old] = (replace(item, subject_id=old).evidence_id, item.evidence_id, new)
        with sqlite3.connect(path) as db:
            db.executescript(identity.schema_sql("reference"))
            db.execute("INSERT INTO release (key, value) VALUES ('release', 'reference-20261001')")
            db.executemany("INSERT INTO securities (id, name, asset_class, kind) VALUES (?, 'x', 'equity', 'ordinary')",
                           [(f"security:figi:{row[1][13:]}",) for row in rows])
            db.executemany("INSERT INTO listings (id, security_id, mic, operating_mic, currency) VALUES"
                           " (?, ?, 'XAMS', 'XAMS', 'EUR')", [(row[1], f"security:figi:{row[1][13:]}") for row in rows])
            db.executemany("INSERT INTO assertions (evidence_id, subject_id, level, scheme, value, authority, source,"
                           " plugin, adapter_version, retrieved_at) VALUES (?, ?, 'listing', 'ticker_mic', ?, 'source_asserted',"
                           " 'fixture', 'fixture', '1', ?)", [(*row, NOW) for row in rows])
            db.executemany("INSERT INTO id_aliases (old_id, new_id, release) VALUES (?, ?, ?)", aliases)
        with self.identity.transaction():
            for index, (old, (evidence, _new_evidence, _new)) in enumerate(cited.items()):
                self.identity.put_binding(identity.Binding(
                    provider_ref=identity.ProviderRef("eodhd", f"T{index}.AS", "catalogue"), subject_id=old,
                    status="confirmed", authority="rule_confirmed", rule_id="resolve_answer@1",
                    evidence_ids=(evidence,), plugin="eodhd"))
        with closing(store.open_reference(path)) as ref:
            started = time.perf_counter()
            done = lifecycle.rekey(self.identity, ref, "reference-20261001")
            elapsed = time.perf_counter() - started
        print(f"\nrekey: {self.ALIASES} aliases, {self.BOUND} bindings re-pointed with their evidence in {elapsed:.2f}s")
        self.assertEqual((done["moved"], done["rows"]), (self.BOUND, self.BOUND))
        stored = {row["subject_id"]: json.loads(row["evidence_ids"]) for row in self.identity.db.execute("SELECT * FROM bindings")}
        self.assertEqual(stored, {new: [new_evidence] for _evidence, new_evidence, new in cited.values()})
        self.assertLess(elapsed, 10)


if __name__ == "__main__":
    unittest.main()
