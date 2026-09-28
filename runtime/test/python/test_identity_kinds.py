"""Open subject kinds (stress test M1) and relation behaviour: fold versus related."""
import json
import sqlite3
from pathlib import Path

from test_identity_contracts import FIXTURES, PROVENANCE, identity
from test_identity_page import ASML, Fixture, plugin
from pythia_identity_fixture import model, page, store  # noqa: E402

RECEIPT, SHARE = "security:isin:USN070592100", "security:isin:NL0010273215"
INDEX = "index:provisional:eodhd:catalogue:GSPC.INDX"


def relation(type, start, end, **extra):
    return model.Relation(type=type, from_id=start, to_id=end, authority="curated", provenance=PROVENANCE, **extra)


class KindTest(Fixture):
    def test_the_first_segment_is_an_open_kind_and_only_instruments_have_levels(self):
        self.assertEqual(identity.subject_kind("venue:pythia:hyperliquid"), "venue")  # unregistered: passed through
        self.assertIs(identity.subject_level(ASML), identity.Level.LISTING)
        with self.assertRaises(identity.IdentifierError):
            identity.subject_level(INDEX)
        with self.assertRaises(identity.IdentifierError):
            identity.subject_kind("Index:x:y")
        with self.assertRaises(ValueError):
            identity.provisional_id("venue", "eodhd", "catalogue", "X")
        for unkeyed in ("security:bogus:x", "index:isin:NL0010273215"):  # open kinds, but registered key schemes
            with self.subTest(unkeyed=unkeyed), self.assertRaises(identity.IdentifierError):
                identity.registered_kind(unkeyed)
        self.assertIsNone(page.load_subject(self.ref, INDEX))

    def test_a_provider_index_record_is_never_provisionally_a_security(self):
        eodhd = plugin("eodhd")
        subject = page.load_subject(self.ref, ASML)  # with its identifier evidence: no false conflict
        record = {"level": "listing", "provenance": PROVENANCE, "attributes": {"name": "S&P 500", "kind": "index"}, "identifiers": [],
                  "native_ref": {"provider": "eodhd", "native_id": "GSPC.INDX", "native_scope": "catalogue"}}
        batch = identity.batch_from_json({"plugin": "eodhd", "provider": "eodhd", "adapter_version": "1",
                                          "origin": "resolve", "claims": [record]})
        _binding, item, _ = page.apply_resolve(batch, eodhd, identity.Level.LISTING, subject, {}, now="2026-09-26T10:00:00Z")
        self.assertEqual((item.kind, item.reason, item.subject_ids), ("residual", "no_key", (INDEX,)))
        with self.assertRaises(ValueError):
            model.Security(id="security:isin:US78378X1072", name="S&P 500", asset_class="equity", kind="index")
        self.assertTrue(identity.guarded("same_listing", "index", "ordinary"))  # no verdict binds it to an instrument

    def test_relation_kinds_and_grouping_live_in_the_vocabulary(self):
        self.assertEqual(relation("tracks", "security:isin:IE00B5BMR087", "index:pythia:sp500").type, "tracks")
        for type, start, end in (("wraps", ASML, SHARE), ("tracks", "index:pythia:sp500", SHARE),
                                 ("share_class_of", SHARE, "issuer:lei:724500Y6DUVHQD6OXN27")):
            with self.subTest(type=type), self.assertRaises(ValueError):
                relation(type, start, end)
        fold = {type for type, rule in identity.RELATIONS.items() if rule.grouping is identity.Grouping.FOLD}
        self.assertEqual(fold, {"depositary_receipt_of", "native_deployment_of"})

    def test_fold_edges_lead_to_one_unit_whatever_their_order(self):
        edges = [("depositary_receipt_of", "security:adr", "security:a"),
                 ("depositary_receipt_of", "security:gdr", "security:adr"), ("share_class_of", "security:c", "security:a"),
                 ("wraps", "security:wbtc", "security:btc")]
        expected = {"security:adr": "security:a", "security:gdr": "security:a"}
        self.assertEqual(identity.fold_roots(edges), (expected, []))
        self.assertEqual(identity.fold_roots(reversed(edges)), (expected, []))

    def test_odd_fold_data_is_reported_not_resolved(self):
        D = "depositary_receipt_of"
        roots, odd = identity.fold_roots([(D, "security:adr", "security:x"), (D, "security:adr", "security:y"),
                                          (D, "security:a", "security:b"), (D, "security:b", "security:a")])
        self.assertEqual(roots, {"security:adr": "security:x"})
        self.assertEqual(sorted(odd), [("cycle", "security:a"), ("cycle", "security:b"),
                                       ("second_target", "security:adr")])

    def test_the_page_lists_related_subjects_but_folds_none_of_them(self):
        with sqlite3.connect(self.path) as db:
            for item in (relation("tracks", SHARE, "index:pythia:aex"), relation("successor_of", RECEIPT, "security:isin:US0000000002")):
                db.execute("INSERT INTO relations (evidence_id, type, from_id, to_id, authority, source, plugin,"
                           " adapter_version, retrieved_at) VALUES (?,?,?,?,?,?,?,?,?)",
                           (item.evidence_id, item.type, item.from_id, item.to_id, item.authority, "fixture", "pythia",
                            "1", "2026-09-28T00:00:00Z"))
        view = page.load_subject(self.ref, ASML)["view"]
        self.assertEqual(view["related"], [{"id": "index:pythia:aex", "type": "tracks", "direction": "to", "kind": "index",
                                            "name": None}])


class StoreKindTest(Fixture):
    def test_a_v3_store_migrates_keeping_its_rows_and_then_accepts_any_registered_kind(self):
        directory = Path(self.tmp.name) / "v3"
        directory.mkdir()
        with sqlite3.connect(directory / "identity.sqlite3") as db:
            db.executescript((FIXTURES / "identity-v3.sql").read_text())
            db.execute("INSERT INTO metadata VALUES ('schema_version', '3')")
            db.execute("INSERT INTO bindings (id, plugin, provider, native_id, native_scope, subject_id, level, status,"
                       " authority, evidence_ids) VALUES ('b1', 'eodhd', 'eodhd', 'ASML.AS', 'catalogue', ?, 'listing',"
                       " 'confirmed', 'snapshot', ?)", (ASML, json.dumps(["ev:1"])))
        migrated = store.IdentityStore(directory)
        self.assertEqual((migrated.metadata("schema_version"), migrated.set_aside), (store.SCHEMA_VERSION, None))
        self.assertEqual([(row["subject_id"], row["kind"]) for row in migrated.bindings([ASML])], [(ASML, "listing")])
        ref = identity.ProviderRef(provider="eodhd", native_id="GSPC.INDX", native_scope="catalogue")
        binding = model.Binding(provider_ref=ref, subject_id=INDEX, status="candidate", authority="source_asserted",
                                evidence_ids=(), plugin="eodhd")
        self.assertTrue(migrated.put_binding(binding))
        with self.assertRaises(ValueError):  # the store keeps registered kinds only
            migrated.put_binding(model.Binding(provider_ref=ref, subject_id="venue:pythia:x", status="candidate",
                                               authority="source_asserted", evidence_ids=(), plugin="eodhd"))
        names = sorted(path.name for path in directory.iterdir())
        self.assertEqual((len(names), names[1]), (2, "identity.sqlite3"))
        self.assertRegex(names[0], r"^identity\.before-v4-[0-9a-f]{8}\.sqlite3$")  # the v3 file, kept

    def test_a_failed_migration_leaves_no_staging_file_and_keeps_the_store_aside(self):
        directory = Path(self.tmp.name) / "broken"
        directory.mkdir()
        with sqlite3.connect(directory / "identity.sqlite3") as db:  # a v3 store missing its tables
            db.execute("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            db.execute("INSERT INTO metadata VALUES ('schema_version', '3')")
        fresh = store.IdentityStore(directory)
        self.assertEqual(fresh.metadata("schema_version"), store.SCHEMA_VERSION)
        self.assertFalse(any(path.suffix == ".part" for path in directory.iterdir()))
        self.assertTrue(fresh.set_aside.startswith("identity.v3-"))
