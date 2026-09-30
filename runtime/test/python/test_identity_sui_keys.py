"""Sui experiment, slice E1: the open keys `sui_package` (protocol) and `sui_object` (market), the `market_asset` role
and fundamentals on protocol and market subjects. Sources here are fixtures core never names."""
import unittest

from test_identity_contracts import PROVENANCE, identity
from test_identity_ingest import IngestTest, record, relation
from pythia_identity_fixture import device, page  # noqa: E402

PACKAGE = "0x" + "ab" * 32
POOL = "0x" + "cd" * 32
OTHER_POOL = "0x" + "ef" * 32
SUI_USDC = "sui:mainnet/coin:0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC"
SUI_ASSET = "sui:mainnet/slip44:784"


def contract(name, introduces, concepts=None):
    """A bulk catalogue of markets (`pool`), protocols (`pkg`) and token deployments (`coin`)."""
    body = {"contract_version": 2, "plugin": name, "provider": name,
            "addressing": {"native": [{"native_scope": "pool", "level": "market"},
                                      {"native_scope": "pkg", "level": "protocol"},
                                      {"native_scope": "coin", "level": "listing"}]},
            "catalogue": {"mode": "bulk", "operation": "catalogue", "scopes": ["all"]},
            "introduces": introduces, "rights": {"licence": "personal", "cache": "none", "hostable": False},
            "signoff": {"status": "grandfathered"}, **({"concepts": concepts} if concepts else {})}
    return page.PluginInfo(key=f"pythia-{name}", manifest=identity.validate_manifest(body))


def source(name, *, open_keys=True):
    return contract(name, {"market": ["native", *(["sui_object"] if open_keys else [])],
                           "protocol": ["native", *(["sui_package"] if open_keys else [])],
                           "listing": ["caip19"]})


class SchemeTest(unittest.TestCase):
    def test_a_sui_address_is_padded_and_lower_cased(self):
        for scheme in ("sui_package", "sui_object"):
            self.assertEqual(identity.normalize_identifier(scheme, "0x2"), "0x" + "2".rjust(64, "0"))
            self.assertEqual(identity.normalize_identifier(scheme, "0X" + "AB" * 32), PACKAGE)
            for bad in ("", "2", "0x", "0x" + "g" * 64, "0x" + "a" * 65, "0x2::sui::SUI"):
                with self.subTest(scheme=scheme, value=bad), self.assertRaises(identity.IdentifierError):
                    identity.normalize_identifier(scheme, bad)

    def test_each_scheme_keys_one_kind_and_no_instrument(self):
        self.assertEqual(identity.registered_kind(f"market:sui_object:{POOL}"), identity.Kind.MARKET)
        self.assertEqual(identity.registered_kind(f"protocol:sui_package:{PACKAGE}"), identity.Kind.PROTOCOL)
        for wrong in (f"protocol:sui_object:{POOL}", f"market:sui_package:{POOL}", f"listing:sui_object:{POOL}"):
            with self.assertRaises(identity.IdentifierError):
                identity.registered_kind(wrong)
        self.assertEqual(identity.IdentifierValue("sui_object", "0x2").level, identity.Kind.MARKET)

    def test_a_record_states_only_its_own_kinds_open_identifier(self):
        info = source("a")
        for level, scheme in (("market", "sui_package"), ("protocol", "sui_object"), ("listing", "sui_object")):
            with self.subTest(level=level), self.assertRaises(identity.ClaimError):
                identity.batch_from_json({
                    "plugin": "a", "provider": "a", "adapter_version": "1", "origin": "catalogue", "scope": "all",
                    "claims": [record(info, "x", (scheme, PACKAGE), level=level, scope="pool" if level == "market" else
                                      "pkg" if level == "protocol" else "coin")]})


class JoinTest(IngestTest):
    def pool(self, info, native_id, object_id, **attributes):
        return record(info, native_id, ("sui_object", object_id), level="market", scope="pool", **attributes)

    def test_two_plugins_stating_the_same_object_land_on_one_subject(self):
        first, second = source("first"), source("second")
        key = f"market:sui_object:{POOL}"
        self.ingest(first, self.pool(first, "reserve-1", POOL, name="USDC reserve"))
        done = self.ingest(second, self.pool(second, "pool-A", "0x" + "CD" * 32, name="USDC pool"),  # unpadded case is the same
                           self.pool(second, "pool-B", OTHER_POOL, name="Another pool"))
        self.assertEqual((self.placed(first, "reserve-1"), self.placed(second, "pool-A"), self.placed(second, "pool-B")),
                         ((key, "introduced"), (key, "joined"), (f"market:sui_object:{OTHER_POOL}", "introduced")))
        self.assertEqual((done["joined"], done["introduced"]), (1, 1))
        self.assertEqual(device.subject_row(self.world.identity, key)["introduced_by"], "first")
        self.assertNotEqual(key, f"market:sui_object:{OTHER_POOL}")
        self.assertNoQuestions()

    def test_a_plugin_joins_a_held_key_without_declaring_it_and_introduces_only_where_declared(self):
        key = f"market:sui_object:{POOL}"
        declared, silent = source("declared"), source("silent", open_keys=False)
        self.assertEqual(self.ingest(silent, self.pool(silent, "p", POOL))["unmatched"], 1)  # no subject: not its to introduce
        self.ingest(declared, self.pool(declared, "p", POOL))
        done = self.ingest(silent, self.pool(silent, "q", POOL))
        self.assertEqual((done["joined"], self.placed(silent, "q")), (1, (key, "joined")))

    def test_a_protocol_is_keyed_by_its_package_and_a_market_by_its_object(self):
        first, second = source("first"), source("second")
        protocol = lambda info: record(info, "navi", ("sui_package", PACKAGE), level="protocol", scope="pkg", name="NAVI")  # noqa: E731
        self.ingest(first, protocol(first))
        self.ingest(second, protocol(second))
        key = f"protocol:sui_package:{PACKAGE}"
        self.assertEqual((self.placed(first, "navi"), self.placed(second, "navi")), ((key, "introduced"), (key, "joined")))

    def test_a_subject_a_plugin_introduced_by_reference_moves_up_to_the_key_it_later_states(self):
        first, second = source("first"), source("second")
        provisional = "market:provisional:first:pool:reserve-1"
        self.ingest(first, record(first, "reserve-1", level="market", scope="pool", name="USDC reserve"))
        self.assertEqual(self.placed(first, "reserve-1"), (provisional, "introduced"))
        self.ingest(second, self.pool(second, "pool-A", POOL))
        self.ingest(first, self.pool(first, "reserve-1", POOL, name="USDC reserve"))
        key = f"market:sui_object:{POOL}"
        self.assertEqual(self.placed(first, "reserve-1"), (key, "joined"))  # merged into the subject the key names
        self.assertEqual(device.current_id(self.world.ref, self.world.identity, provisional), key)
        self.assertNoQuestions()

    def test_a_reference_already_keyed_never_moves_to_another_object(self):
        info = source("first")
        self.ingest(info, self.pool(info, "reserve-1", POOL))
        self.ingest(info, self.pool(info, "reserve-1", OTHER_POOL))
        self.assertEqual(self.placed(info, "reserve-1"), (f"market:sui_object:{POOL}", "conflict"))


class RoleTest(IngestTest):
    def setUp(self):
        super().setUp()
        self.info = source("pools")
        self.ingest(self.info, record(self.info, "usdc", ("caip19", SUI_USDC), level="listing", scope="coin"),
                    record(self.info, "sui", ("caip19", SUI_ASSET), level="listing", scope="coin"),
                    record(self.info, "pool", ("sui_object", POOL), level="market", scope="pool", name="SUI / USDC"))

    def edge(self, asset, role, info=None):
        claim = relation(info or self.info, "market_asset", {"scheme": "sui_object", "value": POOL},
                         {"scheme": "caip19", "value": asset})
        return {**claim, **({"role": role} if role else {})}

    def roles(self):
        return sorted(((row["to_id"].rsplit(":", 1)[-1][-12:], row["role"] or "") for row in self.world.identity.select(
            "SELECT to_id, role FROM relations WHERE type = 'market_asset'")))

    def test_a_market_asset_edge_carries_the_role_its_source_states(self):
        done = self.ingest(self.info, self.edge(SUI_ASSET, "base"), self.edge(SUI_USDC, "quote"))
        self.assertEqual(done["joined"], 2)
        self.assertEqual({role for _, role in self.roles()}, {"base", "quote"})
        self.ingest(self.info, self.edge(SUI_USDC, None))  # a source that states no role leaves it unsaid
        self.assertIn("", {role for _, role in self.roles()})

    def test_one_asset_may_hold_two_roles_and_each_shows_in_the_markets_relations(self):
        self.ingest(self.info, self.edge(SUI_ASSET, "supply"), self.edge(SUI_ASSET, "collateral"))
        self.assertEqual([role for _, role in self.roles()], ["collateral", "supply"])
        shown = self.world.subject(f"market:sui_object:{POOL}")["view"]["related"]
        self.assertEqual(sorted(item["role"] for item in shown if item["type"] == "market_asset"),
                         ["collateral", "supply"])

    def test_a_role_outside_the_vocabulary_or_on_another_relation_is_refused(self):
        with self.assertRaises(identity.ClaimError):
            self.ingest(self.info, self.edge(SUI_ASSET, "primary"))
        part_of = relation(self.info, "part_of", {"scheme": "sui_object", "value": POOL},
                           {"scheme": "sui_package", "value": PACKAGE})
        with self.assertRaises(identity.ClaimError):
            self.ingest(self.info, {**part_of, "role": "base"})

    def test_a_store_made_before_roles_gains_the_column(self):
        db = self.world.identity.db
        db.execute("ALTER TABLE relations DROP COLUMN role")
        identity.add_columns(db, identity.Store.IDENTITY)
        self.assertIn("role", {row[1] for row in db.execute("PRAGMA table_info(relations)")})


class FundamentalsKindsTest(unittest.TestCase):
    def concept(self, level, **extra):
        return {"fundamentals": {"level": level, "via": level, "operations": {"metrics": "metrics"},
                                 "qualities": {"metrics": {"basis": ["on_chain"]}}, **extra}}

    def test_a_plugin_declares_metrics_for_a_protocol_or_a_market(self):
        for kind in ("protocol", "market"):
            with self.subTest(kind=kind):
                info = contract("defi", {kind: ["native"]}, self.concept(kind))
                entry = info.manifest.concepts[identity.Concept.FUNDAMENTALS]
                self.assertEqual((str(entry.level), str(entry.via)), (kind, kind))
                self.assertEqual(entry.qualities["metrics"]["basis"], ("on_chain",))

    def test_the_kinds_are_not_open_to_anything_else_and_the_basis_stays_closed(self):
        for concept, message in ((self.concept("currency"), "fundamentals data is about"),
                                 ({"fundamentals": {**self.concept("market")["fundamentals"], "via": "protocol"}},
                                  "cannot address"),
                                 ({"fundamentals": {**self.concept("market")["fundamentals"],
                                                    "qualities": {"metrics": {"basis": ["guessed"]}}}}, "basis")):
            with self.subTest(message=message), self.assertRaisesRegex(identity.ManifestError, message):
                contract("defi", {"market": ["native"]}, concept)


if __name__ == "__main__":
    unittest.main()
