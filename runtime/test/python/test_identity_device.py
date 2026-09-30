"""Subjects that live on the device (roadmap stage 0; ADR 0037, amendment "device subjects"; ADR 0044, amendment of
2026-09-30).

The identity store's schema 6 keeps every row of a v5 store. A device subject's page composes from the device store
alone, with no reference package, and keeps its label, identifiers and ID when its source is disabled or removed. A
re-key re-points every device row. An enabled plugin's device assertions count like the package's, and any enabled
plugin's answer binds, onto a reference or a device subject.
"""
import json
import sqlite3
import tempfile
import threading
import types
import unittest
import unittest.mock
from contextlib import closing
from dataclasses import replace
from pathlib import Path

from identity_world import AS_OF, NOW, PROVENANCE, World, record, vendor
from test_identity_contracts import FIXTURES, identity
from test_identity_queue import load_core
from pythia_identity_fixture import build_questions, device, page, queue, reference_package, relations, store  # noqa: E402

SAP_ISIN, GSK_ISIN = "DE0007164600", "GB00BN7SWP63"  # SAP is in no reference here; GSK is in the world's
SAP, SAP_XETRA = f"security:isin:{SAP_ISIN}", f"listing:isin:{SAP_ISIN}:XETR:EUR"
ERIC_B, ERIC_B_LINE = "security:isin:SE0000108656", "listing:isin:SE0000108656:XSTO:SEK"
ERICSSON = "issuer:lei:549300W9JLPW15XIFM52"
POOL, PROTOCOL = "market:provisional:poolsource:pool:usdc-navi", "protocol:provisional:poolsource:protocol:navi"
TOKEN = "eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
USDC = f"listing:caip19:{TOKEN}"
POOL_SOURCE = {  # a DeFi source core never names, introducing its pools, protocols and tokens
    "contract_version": 2, "plugin": "pool-source", "provider": "poolsource",
    "addressing": {"native": [{"native_scope": "pool", "level": "market"},
                              {"native_scope": "protocol", "level": "protocol"}]},
    "introduces": {"market": ["native"], "protocol": ["native"], "listing": ["caip19"]},
    "concepts": {"market_data": {"level": "market", "via": "market", "operations": {"quote": "latest"}}},
    "rights": {"licence": "personal", "cache": "none", "hostable": False}, "signoff": {"status": "unsigned"}}


def sap(world: World, lister, registry=None) -> None:
    """SAP's Xetra line, introduced by `lister` under a SAP security that `registry` (else `lister`) introduced with its
    ISIN."""
    registry = registry or lister
    device.put_subject(world.identity, SAP, plugin=registry.manifest.plugin, name="SAP SE",
                       attributes={"asset_class": "equity", "kind": "ordinary"})
    device.put_assertion(world.identity, SAP, "isin", SAP_ISIN, plugin=registry.manifest.plugin,
                         ref=identity.ProviderRef(registry.manifest.provider, "SAP", "symbol"))
    device.put_subject(world.identity, SAP_XETRA, plugin=lister.manifest.plugin, name="SAP SE", parent_id=SAP,
                       attributes={"ticker": "SAP", "operating_mic": "XETR", "currency": "EUR"})


class DeviceWorld(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        self.world = World(self.tmp)
        self.addCleanup(self.world.close)


class MigrationTest(DeviceWorld):
    def test_a_v5_store_migrates_to_6_with_every_row_and_its_answers_still_applied(self):
        # A device's store before device subjects: a binding, the user's verdict on the build's question (#104), a
        # claim, a miss, a read check, and a subject row no v5 code wrote but the table allowed.
        directory = self.tmp / "v5"
        directory.mkdir()
        question = identity.QueueItem(id="ref-1", kind="conflict", reason="identifier", subject_ids=(ERIC_B,),
                                      candidate_ids=(ERICSSON,), evidence_ids=("record:00aa",), state="resolved",
                                      opened_at=NOW, plugins=("reference",), scheme="lei",
                                      values=("529900VENUE0PERATR69",))
        claim = record(vendor("isin", name="quotes"), "ERIC-B.ST", ("isin", "SE0000108656"))
        with closing(sqlite3.connect(directory / "identity.sqlite3")) as db, db:
            db.executescript((FIXTURES / "identity-v5.sql").read_text())
            db.executemany("INSERT INTO metadata VALUES (?, ?)", [
                ("schema_version", "5"), ("reference_release", "reference-20260926:sha256:ab"),
                ("rekeyed_release", "reference-20260926:sha256:ab"), ("vanished_subjects", "[]")])
            db.execute("INSERT INTO bindings (id, plugin, provider, native_id, native_scope, subject_id, kind, status,"
                       " authority, rule_id, evidence_ids) VALUES ('b1', 'quotes', 'quotes', 'ERIC-B.ST', 'symbol', ?,"
                       " 'listing', 'confirmed', 'rule_confirmed', 'resolve_answer@1', ?)",
                       (ERIC_B_LINE, json.dumps(["ev:" + "1" * 64])))
            db.execute("INSERT INTO queue (id, key, kind, reason, subject_ids, candidate_ids, evidence_ids, plugins,"
                       " scheme, contested_values, state, opened_at, updated_at, resolved_by)"
                       " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                       (question.id, question.key, "conflict", "identifier", json.dumps([ERIC_B]),
                        json.dumps([ERICSSON]), json.dumps(["record:00aa"]), json.dumps(["reference"]), "lei",
                        json.dumps(list(question.values)), "resolved", NOW, NOW, "v1"))
            db.execute("INSERT INTO verdicts (id, item_id, resolver, plugin, authority, relation, chosen_id, user_turn,"
                       " outcome, created_at) VALUES ('v1', 'ref-1', 'user', 'pythia', 'user_attested', 'same_issuer',"
                       " ?, 'desk:identity-verdict:2026-09-26T10:00:00Z', 'confirmed', ?)", (ERICSSON, NOW))
            db.execute("INSERT INTO claims (plugin, provider, native_scope, native_id, scope, level, name, claim,"
                       " claim_digest, first_seen, last_seen) VALUES ('quotes', 'quotes', 'symbol', 'ERIC-B.ST', NULL,"
                       " 'listing', NULL, ?, 'sha256:00', ?, ?)", (json.dumps(claim), NOW, NOW))
            db.execute("INSERT INTO resolve_misses VALUES (?, 'pythia-sec', 'no match', '2026-09-27T10:00:00Z')",
                       (ERIC_B_LINE,))
            db.execute("INSERT INTO read_checks (subject_id, provider, native_scope, native_id, plugin, stated, differs,"
                       " checked_at) VALUES (?, 'quotes', 'symbol', 'ERIC-B.ST', 'quotes', '{}', '[]', ?)",
                       (ERIC_B_LINE, NOW))
            db.execute("INSERT INTO subjects (id, kind, parent_id, created_by, created_at) VALUES"
                       " ('index:provisional:eodhd:catalogue:GSPC.INDX', 'index', NULL, 'eodhd', ?)", (NOW,))
            tables = [name for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")]
            before = {table: db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] for table in tables}

        migrated = store.IdentityStore(directory)
        self.addCleanup(migrated.db.close)
        after = {table: migrated.db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] for table in tables}
        self.assertEqual((migrated.set_aside, migrated.metadata("schema_version")), (None, "6"))
        self.assertEqual(after, before)  # nothing set aside, nothing lost
        self.assertEqual(sum(before.values()), 11)
        self.assertEqual(migrated.select("SELECT COUNT(*) FROM corrections")[0][0], 0)  # added later: it starts empty
        kept = [path.name for path in directory.iterdir()
                if path.name not in ("identity.sqlite3", reference_package.MOVE_LOCK)]
        self.assertRegex(" ".join(kept), r"^identity\.before-v6-[0-9a-f]{8}\.sqlite3$")  # the v5 file, kept
        self.assertEqual(device.subject_row(migrated, "index:provisional:eodhd:catalogue:GSPC.INDX")
                         | {"attributes": None},
                         {"id": "index:provisional:eodhd:catalogue:GSPC.INDX", "kind": "index", "parent_id": None,
                          "name": None, "attributes": None, "status": "active", "introduced_by": "eodhd",
                          "first_seen": NOW, "last_seen": NOW})
        self.assertEqual(migrated.claim("quotes", identity.ProviderRef("quotes", "ERIC-B.ST", "symbol")), claim)
        self.assertEqual(migrated.select("SELECT subject_id, state FROM claims")[0][:], (None, None))
        # The user's answer to the build question is still the local override every read applies.
        subject = build_questions.load_subject(self.world.ref, ERIC_B_LINE, None, migrated)
        self.assertEqual({key: subject["view"]["issuer"][key] for key in ("id", "authority")},
                         {"id": ERICSSON, "authority": "user_attested"})
        self.assertEqual(migrated.bound_subject(identity.ProviderRef("quotes", "ERIC-B.ST", "symbol")), ERIC_B_LINE)
        # Opened again, it is the current schema: no second migration.
        store.IdentityStore(directory).db.close()
        self.assertEqual(len(list(directory.iterdir())), 3)  # the store, its v5 file and the directory's lock

    def test_a_second_process_waits_for_the_migration(self):
        # Two processes opening a v5 store at once used to both copy and replace it, leaving the first one writing to
        # a replaced file. The migration holds the directory's lock, so the other opener waits for it.
        directory = self.tmp / "v5"
        directory.mkdir()
        with closing(sqlite3.connect(directory / "identity.sqlite3")) as db, db:
            db.executescript((FIXTURES / "identity-v5.sql").read_text())
            db.execute("INSERT INTO metadata VALUES ('schema_version', '5')")
        opened = []
        with reference_package.locked(directory / reference_package.MOVE_LOCK):  # another opener, mid-migration
            waiting = threading.Thread(target=lambda: opened.append(store.IdentityStore(directory)))
            waiting.start()
            waiting.join(0.3)
            self.assertTrue(waiting.is_alive())
            with closing(sqlite3.connect(directory / "identity.sqlite3")) as db:
                self.assertEqual(db.execute("SELECT value FROM metadata WHERE key = 'schema_version'").fetchone(), ("5",))
        waiting.join(10)
        self.addCleanup(opened[0].db.close)
        self.assertEqual((opened[0].metadata("schema_version"), opened[0].set_aside), ("6", None))


class TransactionTest(DeviceWorld):
    def test_a_failed_commit_rolls_back_and_the_next_write_lands(self):
        identity_store = self.world.identity
        identity_store.db.execute("PRAGMA busy_timeout = 0")  # fail at once instead of after five seconds
        miss = "INSERT INTO resolve_misses VALUES (?, 'p', 'r', '2030-01-01T00:00:00Z')"
        with closing(sqlite3.connect(identity_store.path, isolation_level=None)) as reader:
            reader.execute("BEGIN")
            reader.execute("SELECT * FROM metadata").fetchall()  # another process mid-read: COMMIT cannot proceed
            with self.assertRaises(sqlite3.OperationalError):
                with identity_store.transaction():
                    identity_store.db.execute(miss, ("listing:x:1",))
            self.assertFalse(identity_store.db.in_transaction)  # rolled back, never joined by the next write
            reader.execute("COMMIT")
        with identity_store.transaction():
            with identity_store.transaction():  # nested: part of the one outside
                identity_store.db.execute(miss, ("listing:x:2",))
            self.assertTrue(identity_store.db.in_transaction)
        with closing(sqlite3.connect(identity_store.path)) as disk:  # what another process, or the next start, reads
            self.assertEqual(disk.execute("SELECT subject_id FROM resolve_misses").fetchall(), [("listing:x:2",)])


class RekeyTest(DeviceWorld):
    def test_a_better_key_re_points_the_subject_its_parents_assertions_relations_and_claims(self):
        lister = vendor("isin", name="lister")
        self.world.plugins = [lister]
        identity_store, ref = self.world.identity, identity.ProviderRef("lister", "SAP", "symbol")
        old, line = "security:provisional:lister:symbol:SAP", "listing:provisional:lister:symbol:SAP.DE"
        device.put_subject(identity_store, old, plugin="lister", name="SAP SE", attributes={"kind": "ordinary"})
        device.put_subject(identity_store, line, plugin="lister", name="SAP SE", parent_id=old,
                           attributes={"ticker": "SAP", "operating_mic": "XETR", "currency": "EUR"})
        cited = device.put_assertion(identity_store, old, "isin", SAP_ISIN, plugin="lister", ref=ref)
        identity_store.put_claim("lister", "lister", record(lister, "SAP", ("isin", SAP_ISIN)))
        self.assertTrue(device.place_claim(identity_store, "lister", ref, old, "introduced"))
        identity_store.db.execute(
            "INSERT INTO relations (evidence_id, type, from_id, to_id, authority, source, plugin, retrieved_at)"
            " VALUES ('ev:relation', 'successor_of', ?, ?, 'source_asserted', 'lister', 'lister', ?)", (old, ERIC_B, NOW))
        identity_store.put_binding(identity.Binding(provider_ref=ref, subject_id=old, status="confirmed",
                                                    authority="source_asserted", evidence_ids=(cited,), plugin="lister"))
        device.put_alias(identity_store, old, SAP)  # its record now states an ISIN: the better key
        generation = device.generation(identity_store)

        done = self.world.rekey(self.world.path)

        self.assertEqual((done["moved"], done["vanished"]), (1, 0))
        self.assertIsNone(device.subject_row(identity_store, old))
        self.assertEqual({key: device.subject_row(identity_store, SAP)[key] for key in ("name", "introduced_by")},
                         {"name": "SAP SE", "introduced_by": "lister"})
        self.assertEqual(device.subject_row(identity_store, line)["parent_id"], SAP)
        [moved] = device.assertions(identity_store, [SAP])
        self.assertNotEqual(moved["evidence_id"], cited)
        bound = identity_store.binding_for(ref)
        self.assertEqual((bound["subject_id"], json.loads(bound["evidence_ids"])), (SAP, [moved["evidence_id"]]))
        [moved_relation] = identity_store.select("SELECT * FROM relations")
        self.assertEqual((moved_relation["from_id"], moved_relation["to_id"]), (SAP, ERIC_B))
        self.assertEqual(moved_relation["evidence_id"], relations.relation_id(moved_relation))  # its new ends' ID
        self.assertEqual(identity_store.select("SELECT subject_id, state FROM claims")[0][:], (SAP, "introduced"))
        self.assertGreater(device.generation(identity_store), generation)
        # A saved old ID reads as the subject it became, and the line's page names it as its security.
        self.assertEqual((self.world.subject(old)["id"], self.world.subject(old)["values"]["isin"]), (SAP, SAP_ISIN))
        self.assertEqual(self.world.subject(line)["ids"][identity.Level.SECURITY], SAP)

    def test_a_device_alias_never_moves_an_id_the_reference_holds(self):
        # A later release holds a subject under the ID a device alias leads away from: the reference's subject wins.
        device.put_alias(self.world.identity, ERIC_B_LINE, "listing:provisional:lister:symbol:ERIC-B.ST")
        self.assertEqual(device.current_id(self.world.ref, self.world.identity, ERIC_B_LINE), ERIC_B_LINE)
        self.assertEqual(device.current_id(None, self.world.identity, ERIC_B_LINE),
                         "listing:provisional:lister:symbol:ERIC-B.ST")  # with no reference, the device's alias


class EvidenceTest(unittest.TestCase):
    def test_an_enabled_plugins_evidence_proves_and_blocks_and_a_disabled_ones_does_not(self):
        # The lister states SAP's ISIN. Another quote source then answers for the Xetra line, once with the same ISIN
        # and once with another company's.
        for enabled in (True, False):
            with self.subTest(enabled=enabled), tempfile.TemporaryDirectory() as tmp:
                world = World(Path(tmp))
                lister = replace(vendor("isin", name="lister"), enabled=enabled)
                world.plugins = [lister]
                sap(world, lister)
                quotes = vendor("isin", name="quotes")
                subject = world.subject(SAP_XETRA)
                agreeing, _ = world.resolve(quotes, SAP_XETRA, record(quotes, "SAP.DE", ("isin", SAP_ISIN)))
                _, other = world.resolve(quotes, SAP_XETRA, record(quotes, "GSK.DE", ("isin", GSK_ISIN)))
                world.close()
                self.assertEqual(subject["values"]["isin"], SAP_ISIN)  # shown either way, with its source
                self.assertEqual((bool(subject["evidence"]), [item["source"] for item in subject["view"].get("shown", [])]),
                                 (True, []) if enabled else (False, ["lister"]))
                self.assertEqual(agreeing is not None, enabled)  # proves
                self.assertEqual((other.kind, other.reason), ("conflict", "binding") if enabled else ("residual", "no_key"))


class BindingTest(DeviceWorld):
    """ADR 0044, amendment of 2026-09-30: any enabled plugin binds, onto reference or device subjects; a plugin's own
    record binds the subject it introduced."""

    def test_any_enabled_plugins_answer_binds_a_device_subject(self):
        lister = vendor("isin", name="lister")
        self.world.plugins = [lister]
        sap(self.world, lister)
        for name in ("quotes", "community"):  # no plugin ranks above another: neither name nor sign-off decides
            with self.subTest(plugin=name):
                source = vendor("isin", name=name)
                binding, item = self.world.resolve(source, SAP_XETRA, record(source, "SAP.DE", ("isin", SAP_ISIN)))
                self.assertEqual((binding.subject_id, binding.rule_id, item), (SAP_XETRA, "resolve_answer@1", None))

    def test_a_plugins_own_record_binds_the_subject_it_introduced_and_no_other(self):
        lister = vendor("isin", name="lister")
        self.world.plugins = [lister]
        sap(self.world, lister)
        # Ingest's rule `introduced@1`: a plugin's own record binds its own subject; never another.
        own, other = identity.ProviderRef("lister", "SAP.XETRA", "symbol"), identity.ProviderRef("community", "SAP", "symbol")
        self.assertTrue(device.bind_introduced(self.world.identity, "lister", own, SAP_XETRA))
        self.assertFalse(device.bind_introduced(self.world.identity, "community", other, SAP))
        row = self.world.identity.binding_for(own)
        self.assertEqual((row["subject_id"], row["authority"], row["rule_id"]), (SAP_XETRA, "rule_confirmed", "introduced@1"))
        self.assertIsNone(self.world.identity.binding_for(other))
        # The user rejected it: its own record never confirms it again.
        self.world.identity.db.execute("UPDATE bindings SET status = 'rejected' WHERE native_id = 'SAP.XETRA'")
        self.assertFalse(device.bind_introduced(self.world.identity, "lister", own, SAP_XETRA))
        self.assertEqual(self.world.identity.binding_for(own)["status"], "rejected")


class NoReferenceTest(unittest.TestCase):
    """A device subject's page, as the Desk reads it, on a device with no reference package installed."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.core = load_core()
        from pythia_core_queue_fixture import identity_ops, queue_ops
        from pythia_core_queue_fixture.identity import (
            Kind, ProviderRef, Relation, device as core_device, page, provisional_id, validate_manifest)
        self.queue_ops = queue_ops
        self.source = page.PluginInfo(key="pool-source", manifest=validate_manifest(POOL_SOURCE))
        # The IDs its contract's `introduces` gives: its own native reference for a pool or protocol, CAIP-19 for a token.
        self.assertEqual((provisional_id(Kind.MARKET, "poolsource", "pool", "usdc-navi"),
                          provisional_id(Kind.PROTOCOL, "poolsource", "protocol", "navi")), (POOL, PROTOCOL))
        self.plugins = [self.source]
        self.enterContext(unittest.mock.patch.object(identity_ops, "installed", lambda: self.plugins))
        self.ops = identity_ops.Identity(types.SimpleNamespace(), data_dir=Path(tmp.name) / "core")
        self.addCleanup(lambda: self.ops.store.db.close())
        at = self.ops.store
        self.pool = ProviderRef("poolsource", "usdc-navi", "pool")
        core_device.put_subject(at, POOL, plugin="pool-source", name="USDC lending on Navi",
                                attributes={"asset_class": "crypto"})
        core_device.put_subject(at, USDC, plugin="pool-source", name="USD Coin on Ethereum",
                                attributes={"asset_class": "crypto"})
        core_device.put_assertion(at, USDC, "caip19", TOKEN, plugin="pool-source",
                                  ref=ProviderRef("poolsource", "usdc", "token"))
        core_device.put_subject(at, PROTOCOL, plugin="pool-source", name="Navi")
        part_of = Relation(type="part_of", from_id=POOL, to_id=PROTOCOL, authority="source_asserted",
                           provenance={"plugin": "pool-source", "source": "poolsource", "adapter_version": "1",
                                       "retrieved_at": "2026-09-30T00:00:00Z"})
        at.db.execute("INSERT INTO relations (evidence_id, type, from_id, to_id, authority, source, plugin, retrieved_at)"
                      " VALUES (?,?,?,?,?,?,?,?)", (part_of.evidence_id, "part_of", POOL, PROTOCOL, "source_asserted",
                                                     "poolsource", "pool-source", "2026-09-30T00:00:00Z"))
        self.assertTrue(core_device.bind_introduced(at, "pool-source", self.pool, POOL))

    def page(self, subject_id):
        return json.loads(self.queue_ops.read_subject(self.ops, {"subject_id": subject_id}))

    def test_a_device_market_composes_its_page_with_no_reference_package(self):
        body = self.page(POOL)
        self.assertEqual(body["outcome"], "ok")
        view = body["data"]
        [quote] = [section for section in view["sections"] if section["section"] == "quote"]
        self.assertEqual((view["subject"]["name"], view["subject"]["level"]), ("USDC lending on Navi", "market"))
        self.assertEqual((quote["plugin"], quote["status"], quote["binding_status"], quote["binding"]),
                         ("pool-source", "ready", "confirmed", self.pool.wire()))
        self.assertEqual(view["contributors"], [{"plugin": "pool-source", "label": "poolsource", "status": "enabled",
                                                 "stated": [], "introduced": True, "not_offered_since": None}])
        self.assertEqual(view["related"], [{"id": PROTOCOL, "type": "part_of", "direction": "to", "kind": "protocol",
                                            "name": "Navi", "source": "pool-source"}])  # labelled with its plugin
        protocol = self.page(PROTOCOL)["data"]  # a protocol's page: its label and its pools, no data section
        self.assertEqual((protocol["subject"]["name"], protocol["related"][0]["id"], protocol["sections"]),
                         ("Navi", POOL, []))
        self.assertEqual(self.ops.price_sources(POOL)["refs"], [self.pool.wire()])
        # With no package, an instrument no plugin introduced still says why; an unknown market is unknown.
        self.assertEqual(self.page("listing:figi:BBG000BB13V0")["issues"][0]["message"], "No reference data on this device yet.")
        self.assertEqual(self.page("market:provisional:poolsource:pool:gone")["issues"][0]["code"], "unknown_subject")

    def test_a_disabled_or_removed_source_leaves_the_label_identifiers_and_id(self):
        self.plugins = [replace(self.source, enabled=False)]
        view = self.page(POOL)["data"]
        [quote] = [section for section in view["sections"] if section["section"] == "quote"]
        self.assertEqual((view["subject"]["name"], quote["status"], view["contributors"][0]["status"]),
                         ("USDC lending on Navi", "disabled", "disabled"))
        token = self.page(USDC)["data"]
        self.assertEqual((token["subject"]["name"], token["identifiers"], token["contributors"][0]["status"]),
                         ("USD Coin on Ethereum", {"caip19": TOKEN}, "disabled"))
        self.plugins = []  # removed
        for subject_id in (POOL, USDC):
            body = self.page(subject_id)
            self.assertEqual((body["outcome"], body["data"]["contributors"][0]["status"]), ("ok", "removed"))
        self.assertEqual(self.page(POOL)["data"]["sections"], [])


if __name__ == "__main__":
    unittest.main()
