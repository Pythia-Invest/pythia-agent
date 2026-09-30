"""Subjects that live on the device (roadmap stage 0; ADR 0037, amendment "device subjects"; ADR 0042 B2).

The identity store's schema 6 keeps every row of a v5 store. A device subject's page composes from the device store
alone, with no reference package, and keeps its label, identifiers and ID when its source is disabled or removed. A
re-key re-points every device row. A device assertion counts at its plugin's trust level, and only confirm level
binds, except a display plugin onto a subject it introduced.
"""
import json
import sqlite3
import tempfile
import types
import unittest
import unittest.mock
from contextlib import closing
from dataclasses import replace
from pathlib import Path

from identity_world import AS_OF, NOW, World, record, vendor
from test_identity_contracts import FIXTURES, identity
from test_identity_queue import load_core
from pythia_identity_fixture import build_questions, device, queue, store, trust  # noqa: E402

SAP_ISIN, GSK_ISIN = "DE0007164600", "GB00BN7SWP63"  # SAP is in no reference here; GSK is in the world's
SAP, SAP_XETRA = f"security:isin:{SAP_ISIN}", f"listing:isin:{SAP_ISIN}:XETR:EUR"
ERIC_B, ERIC_B_LINE = "security:isin:SE0000108656", "listing:isin:SE0000108656:XSTO:SEK"
ERICSSON = "issuer:lei:549300W9JLPW15XIFM52"
POOL, PROTOCOL = "market:provisional:poolsource:pool:usdc-navi", "protocol:provisional:poolsource:protocol:navi"
TOKEN = "eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
USDC = f"listing:caip19:{TOKEN}"
POOL_SOURCE = {  # a DeFi source core never names: display level, introducing its pools, protocols and tokens
    "contract_version": 2, "plugin": "pool-source", "provider": "poolsource",
    "addressing": {"native": [{"native_scope": "pool", "level": "market"},
                              {"native_scope": "protocol", "level": "protocol"}]},
    "introduces": {"market": ["native"], "protocol": ["native"], "listing": ["caip19"]},
    "concepts": {"market_data": {"level": "market", "via": "market", "operations": {"quote": "latest"}}},
    "rights": {"licence": "personal", "cache": "none", "hostable": False}, "signoff": {"status": "unsigned"}}


def display(info):
    """The plugin at display level: its files carry no confirm grant, or the user demoted it (ADR 0042)."""
    return replace(info, manifest=identity.vouched(info.manifest, trust.DISPLAY))


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
        kept = [path.name for path in directory.iterdir() if path.name != "identity.sqlite3"]
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
        self.assertEqual(len(list(directory.iterdir())), 2)


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
        self.assertEqual(identity_store.select("SELECT from_id, to_id FROM relations")[0][:], (SAP, ERIC_B))
        self.assertEqual(identity_store.select("SELECT subject_id, state FROM claims")[0][:], (SAP, "introduced"))
        self.assertGreater(device.generation(identity_store), generation)
        # A saved old ID reads as the subject it became, and the line's page names it as its security.
        self.assertEqual((self.world.subject(old)["id"], self.world.subject(old)["values"]["isin"]), (SAP, SAP_ISIN))
        self.assertEqual(self.world.subject(line)["ids"][identity.Level.SECURITY], SAP)


class EvidenceTest(unittest.TestCase):
    def test_device_evidence_proves_and_blocks_only_at_confirm_level(self):
        # The lister states SAP's ISIN. A confirm-level quote source then answers for the Xetra line, once with the
        # same ISIN and once with another company's.
        for level, enabled, counts in ((trust.CONFIRM, True, True), (trust.DISPLAY, True, False),
                                       (trust.CONFIRM, False, False)):  # a disabled plugin's evidence is display
            with self.subTest(level=level, enabled=enabled), tempfile.TemporaryDirectory() as tmp:
                world = World(Path(tmp))
                lister = vendor("isin", name="lister")
                lister = replace(lister if level == trust.CONFIRM else display(lister), enabled=enabled)
                world.plugins = [lister]
                sap(world, lister)
                quotes = vendor("isin", name="quotes")
                subject = world.subject(SAP_XETRA)
                agreeing, _ = world.resolve(quotes, SAP_XETRA, record(quotes, "SAP.DE", ("isin", SAP_ISIN)))
                _, other = world.resolve(quotes, SAP_XETRA, record(quotes, "GSK.DE", ("isin", GSK_ISIN)))
                world.close()
                self.assertEqual(subject["values"]["isin"], SAP_ISIN)  # shown either way, with its source
                self.assertEqual((bool(subject["evidence"]), [item["source"] for item in subject["view"].get("shown", [])]),
                                 (True, []) if counts else (False, ["lister"]))
                self.assertEqual(agreeing is not None, counts)  # proves
                self.assertEqual((other.kind, other.reason), ("conflict", "binding") if counts else ("residual", "no_key"))


class BindingTest(DeviceWorld):
    """ADR 0042, amendment of 2026-09-30 (B2): only confirm level binds, onto reference or device subjects; a display
    plugin binds only a subject it introduced itself."""

    def test_a_confirm_level_answer_binds_a_device_subject_and_a_display_one_waits_for_the_user(self):
        lister = vendor("isin", name="lister")
        self.world.plugins = [lister]
        sap(self.world, lister)
        quotes = vendor("isin", name="quotes")
        binding, item = self.world.resolve(quotes, SAP_XETRA, record(quotes, "SAP.DE", ("isin", SAP_ISIN)))
        self.assertEqual((binding.subject_id, binding.rule_id, item), (SAP_XETRA, "resolve_answer@1", None))
        community = display(vendor("isin", name="community"))
        binding, item = self.world.resolve(community, SAP_XETRA, record(community, "SAP.DE", ("isin", SAP_ISIN)))
        self.assertIsNone(binding)
        self.assertEqual((item.reason, item.candidate_ids), ("unaudited", (SAP_XETRA,)))
        # The user's answer binds it: a device subject is a known target.
        answer = queue.submit(self.world.identity, self.world.ref, item_id=item.id, resolver="user",
                              relation="same_listing", chosen_id=SAP_XETRA, now=NOW, as_of=AS_OF,
                              user_turn="desk:identity-verdict:test", plugins=self.world.plugins)
        self.assertEqual(answer["outcome"], "confirmed")
        ref = identity.ProviderRef("community", "SAP.DE", "symbol")
        self.assertEqual(self.world.identity.bound_subject(ref), SAP_XETRA)
        self.assertEqual(queue.summary(self.world.identity, self.world.ref, self.world.identity.queue_item(item.id))[
            "candidates"][0]["name"], "SAP SE")

    def test_a_display_plugin_binds_a_subject_it_introduced_and_no_other(self):
        registry, lister = vendor("isin", name="registry"), display(vendor("isin", name="lister"))
        self.world.plugins = [registry, lister]
        sap(self.world, lister, registry)  # the registry introduced the security, the lister its Xetra line
        binding, item = self.world.resolve(lister, SAP_XETRA, record(lister, "SAP.DE", ("isin", SAP_ISIN)))
        self.assertEqual((binding.subject_id, item), (SAP_XETRA, None))
        community = display(vendor("isin", name="community"))
        _, item = self.world.resolve(community, SAP_XETRA, record(community, "SAP.DE", ("isin", SAP_ISIN)))
        self.assertEqual(item.reason, "unaudited")
        # Ingest's rule `introduced@1`: a plugin's own record binds its own subject, whatever its level; never another.
        own, other = identity.ProviderRef("lister", "SAP.XETRA", "symbol"), identity.ProviderRef("lister", "SAP", "symbol")
        self.assertTrue(device.bind_introduced(self.world.identity, "lister", own, SAP_XETRA))
        self.assertFalse(device.bind_introduced(self.world.identity, "lister", other, SAP))
        row = self.world.identity.binding_for(own)
        self.assertEqual((row["subject_id"], row["authority"], row["rule_id"]), (SAP_XETRA, "rule_confirmed", "introduced@1"))
        self.assertIsNone(self.world.identity.binding_for(other))


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
        self.assertEqual((quote["plugin"], quote["status"], quote["binding_status"], quote["binding"], quote["unaudited"]),
                         ("pool-source", "ready", "confirmed", self.pool.wire(), True))  # labelled not yet audited
        self.assertEqual(view["sources"], [{"plugin": "pool-source", "label": "poolsource", "status": "enabled"}])
        self.assertEqual(view["related"], [{"id": PROTOCOL, "type": "part_of", "direction": "to", "kind": "protocol",
                                            "name": "Navi"}])
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
        self.assertEqual((view["subject"]["name"], quote["status"], view["sources"][0]["status"]),
                         ("USDC lending on Navi", "disabled", "disabled"))
        token = self.page(USDC)["data"]
        self.assertEqual((token["subject"]["name"], token["identifiers"], token["sources"][0]["status"]),
                         ("USD Coin on Ethereum", {"caip19": TOKEN}, "disabled"))
        self.plugins = []  # removed
        for subject_id in (POOL, USDC):
            body = self.page(subject_id)
            self.assertEqual((body["outcome"], body["data"]["sources"][0]["status"]), ("ok", "removed"))
        self.assertEqual(self.page(POOL)["data"]["sections"], [])


if __name__ == "__main__":
    unittest.main()
