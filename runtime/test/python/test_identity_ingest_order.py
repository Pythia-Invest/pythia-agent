"""Plugins extend the universe on equal terms (ADR 0044 A1), so what ingest stores must not depend on which plugin syncs
first: a link-only plugin's relations are placed once the tokens they name exist, and a subject's display name follows
the investor's source order or a fixed rule, never who introduced it. Fixture plugins, as test_identity_ingest's."""
import itertools
import json
import unittest

from test_identity_ingest import SUI_USDC, IngestTest, record, relation, source
from pythia_identity_fixture import device


BRIDGED = "sui:mainnet/coin:0x" + "ab" * 32 + "%3A%3Acoin%3A%3ACOIN"  # two coin types no reference holds
STAKED = "sui:mainnet/coin:0x" + "cd" * 32 + "%3A%3Astaked%3A%3ASTAKED"


def edges(world):
    return [tuple(row) for row in world.identity.select("SELECT type, from_id, to_id, plugin FROM relations ORDER BY 1, 2, 3")]


def names(world):
    return {row[0]: row[1] for row in world.identity.select("SELECT id, name FROM subjects")}


class RelationOrderTest(IngestTest):
    """A plugin that only links syncs before, between and after the plugins that introduce the tokens it names."""

    def plugins(self):
        links = source("links", level="market", introduces={"market": ["native"]})
        first = source("first", introduces={"listing": ["caip19"]})
        second = source("second", introduces={"listing": ["caip19"]})
        market = lambda name: {"provider": "links", "native_scope": "ref", "native_id": name}  # noqa: E731
        pages = {
            "links": (links, [record(links, "reserve-a", name="Reserve A"), record(links, "reserve-b", name="Reserve B"),
                              relation(links, "market_asset", market("reserve-a"), {"scheme": "caip19", "value": SUI_USDC}),
                              relation(links, "market_asset", market("reserve-a"), {"scheme": "caip19", "value": BRIDGED}),
                              relation(links, "market_asset", market("reserve-b"), {"scheme": "caip19", "value": STAKED})]),
            "first": (first, [record(first, "usdc", ("caip19", SUI_USDC), name="USDC on Sui", asset_class="crypto")]),
            "second": (second, [record(second, "bridged", ("caip19", BRIDGED), name="Bridged", asset_class="crypto"),
                                record(second, "staked", ("caip19", STAKED), name="Staked", asset_class="crypto")]),
        }
        return pages

    def sync(self, order):
        world = self.fresh(("asml.json", "failures.json", "crypto.json"))
        pages = self.plugins()
        for name in order:
            info, claims = pages[name]
            self.ingest(info, *claims, world=world)
        return world

    def test_every_order_gives_the_same_relations_after_one_sync_each(self):
        outcomes = {order: edges(self.sync(order)) for order in itertools.permutations(("links", "first", "second"))}
        expected = outcomes[("first", "second", "links")]
        self.assertEqual(len(expected), 3)
        for order, found in outcomes.items():
            with self.subTest(order=order):
                self.assertEqual(found, expected)

    def test_a_waiting_relation_leaves_no_row_once_placed_and_a_second_sync_writes_nothing(self):
        world = self.sync(("links", "first", "second"))
        self.assertEqual(world.identity.select("SELECT 1 FROM pending_relations"), [])
        pages = self.plugins()
        before = world.identity.db.total_changes
        for name in ("links", "first", "second"):
            self.ingest(pages[name][0], *pages[name][1], world=world)
        self.assertEqual(world.identity.db.total_changes, before)

    def test_a_relation_waits_until_its_end_exists_and_only_that_end_places_it(self):
        world = self.fresh(("asml.json", "failures.json", "crypto.json"))
        links, first = self.plugins()["links"][0], self.plugins()["first"][0]
        done = self.ingest(links, *self.plugins()["links"][1], world=world)
        self.assertEqual((done["introduced"], done["unmatched"], edges(world)), (2, 3, []))
        self.assertEqual(len(world.identity.select("SELECT DISTINCT relation FROM pending_relations")), 3)
        self.ingest(first, *self.plugins()["first"][1], world=world)  # names one of the three ends
        self.assertEqual([edge[:1] + edge[2:3] for edge in edges(world)], [("market_asset", f"listing:caip19:{SUI_USDC}")])
        self.assertEqual(len(world.identity.select("SELECT DISTINCT relation FROM pending_relations")), 2)

    def test_a_stated_again_relation_is_one_waiting_claim_with_its_latest_statement(self):
        world = self.fresh(("asml.json", "failures.json", "crypto.json"))
        links, claims = self.plugins()["links"]
        self.ingest(links, *claims, world=world)
        again = json.loads(json.dumps(claims))
        for claim in again:
            claim["provenance"]["retrieved_at"] = "2026-10-01T00:00:00+00:00"
        self.ingest(links, *again, world=world)
        rows = world.identity.select("SELECT claim FROM pending_relations")
        self.assertEqual((len(rows), {json.loads(row[0])["provenance"]["retrieved_at"] for row in rows}),
                         (3, {"2026-10-01T00:00:00+00:00"}))


class NameOrderTest(IngestTest):
    """Two plugins state one deployment under their own names; the name shown does not depend on who arrived first."""

    def plugins(self):
        return {"alpha": source("alpha", introduces={"listing": ["caip19"]}),
                "beta": source("beta", introduces={"listing": ["caip19"]})}

    def sync(self, order, *, prefer=()):
        world = self.fresh(("asml.json", "failures.json", "crypto.json"))
        infos = self.plugins()
        for name in order:
            info = infos[name]
            claim = record(info, "coin", ("caip19", SUI_USDC), name=f"{name.title()} USDC", asset_class="crypto")
            world.plugins = [item for item in world.plugins if item.key != info.key] + [info]
            world.ingest(info, claim, scope="all", order=prefer)
        return world

    def test_the_name_is_the_same_in_either_order_and_the_introducer_stays_history(self):
        forward, reverse = self.sync(("alpha", "beta")), self.sync(("beta", "alpha"))
        subject = f"listing:caip19:{SUI_USDC}"
        self.assertEqual((names(forward)[subject], names(reverse)[subject]), ("Alpha USDC", "Alpha USDC"))
        self.assertEqual((device.subject_row(forward.identity, subject)["introduced_by"],
                          device.subject_row(reverse.identity, subject)["introduced_by"]), ("alpha", "beta"))

    def test_the_investors_source_order_picks_the_name_in_either_order(self):
        for order in (("alpha", "beta"), ("beta", "alpha")):
            with self.subTest(order=order):
                world = self.sync(order, prefer=("pythia-beta",))
                self.assertEqual(names(world)[f"listing:caip19:{SUI_USDC}"], "Beta USDC")

    def test_a_plugin_renaming_its_record_changes_the_name_only_if_it_ranks_first(self):
        world = self.sync(("beta", "alpha"))
        infos = self.plugins()
        subject = f"listing:caip19:{SUI_USDC}"
        for name, expected in (("beta", "Alpha USDC"), ("alpha", "Alpha USDC Renamed")):
            claim = record(infos[name], "coin", ("caip19", SUI_USDC), name=f"{name.title()} USDC Renamed",
                           asset_class="crypto")
            world.ingest(infos[name], claim, scope="all")
            self.assertEqual(names(world)[subject], expected)


if __name__ == "__main__":
    unittest.main()
