"""Core's ingest of plugin claims (roadmap stage 0; ADR 0037, amendment "ingest"): every record joins by identifier
agreement at its own scope, a contradiction is kept as a conflict and asked about only when relevant, a subject is
introduced only under a key scheme its contract declares, and keys only move up. Every enabled plugin counts alike
(ADR 0044, amendment of 2026-09-30).

The world is `identity_world` (Ericsson, Alphabet, GSK, Shell and US Steel from the identity truth set); the plugins
are fixtures core never names. Sources as they emit, and the operations, are test_identity_ingest_sources's.
"""
import random
import sqlite3
import tempfile
import unittest
from contextlib import closing
from dataclasses import replace
from pathlib import Path

from identity_world import World
from test_identity_contracts import PROVENANCE, identity
from pythia_identity_fixture import device, lifecycle, page, relations, search, store  # noqa: E402

ERICSSON_LEI, ERICSSON = "549300W9JLPW15XIFM52", "issuer:lei:549300W9JLPW15XIFM52"
ERIC_A, ERIC_B = "security:isin:SE0000108649", "security:isin:SE0000108656"
ERIC_A_LINE, ERIC_B_LINE = "listing:isin:SE0000108649:XSTO:SEK", "listing:isin:SE0000108656:XSTO:SEK"
ADS, ADS_LINE = "security:figi:BBG001S5QXT3", "listing:figi:BBG000BB13V0"
GOOGL, GOOG, GOOG_LINE = "security:figi:BBG009S39JY5", "security:figi:BBG009S3NB21", "listing:figi:BBG009S4MVF2"
GSK, GSK_BEFORE, GSK_LINE = "security:isin:GB00BN7SWP63", "security:isin:GB0009252882", "listing:isin:GB00BN7SWP63:XLON:GBP"
SAP_ISIN, SAP_FIGI, SAP_FRANKFURT, NOWHERE = "DE0007164600", "BBG000BLNXT1", "BBG000BLNQ16", "BBG000BLNX93"
SAP_SHARE = "BBG001S9GX16"
ETH, USDC = "eip155:1/slip44:60", "eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
SUI_USDC = "sui:mainnet/coin:0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7%3A%3Ausdc%3A%3AUSDC"
POOL_ID = "00000002-0000-4000-8000-000000000000"


def source(name, *, level="listing", introduces=None, scopes=("all",), native=(), resolve=()):
    """A plugin core never names: a bulk catalogue of records at `level` (and a resolve by `resolve` schemes),
    introducing what `introduces` declares."""
    contract = {"contract_version": 2, "plugin": name, "provider": name,
                "addressing": {"native": [{"native_scope": "ref", "level": level}, *native]},
                "catalogue": {"mode": "bulk", "operation": "catalogue", "scopes": list(scopes)},
                **({"introduces": introduces} if introduces else {}),
                **({"resolve": {"operation": "resolve", "input_schemes": list(resolve), "echoes": []}} if resolve else {}),
                "rights": {"licence": "personal", "cache": "none", "hostable": False},
                "signoff": {"status": "grandfathered"}}
    return page.PluginInfo(key=f"pythia-{name}", manifest=identity.validate_manifest(contract))


def record(info, native_id, *identifiers, level=None, scope="ref", **attributes):
    """One record as the plugin emits it; `identifiers` are (scheme, value) or (scheme, value, role)."""
    return {"level": level or str(info.manifest.native_scope(scope).level), "attributes": attributes,
            "provenance": {**PROVENANCE, "plugin": info.manifest.plugin, "source": info.manifest.provider},
            "identifiers": [dict(zip(("scheme", "value", "role"), item)) for item in identifiers],
            "native_ref": {"provider": info.manifest.provider, "native_id": native_id, "native_scope": scope}}


def relation(info, type, start, end):
    return {"type": type, "from_key": start, "to_key": end,
            "provenance": {**PROVENANCE, "plugin": info.manifest.plugin, "source": info.manifest.provider}}


class IngestTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        self.world = self.fresh()

    def fresh(self, fixtures=("asml.json", "failures.json")) -> World:
        world = World(Path(tempfile.mkdtemp(dir=self.tmp)), fixtures)
        self.addCleanup(world.close)
        return world

    def ingest(self, info, *claims, world=None, **options):
        world = world or self.world
        world.plugins = [item for item in world.plugins if item.key != info.key] + [info]
        return world.ingest(info, *claims, scope=options.pop("scope", "all"), **options)

    def placed(self, info, native_id, world=None):
        return tuple((world or self.world).identity.select(
            "SELECT subject_id, state FROM claims WHERE plugin = ? AND native_id = ?", (info.manifest.plugin, native_id))[0])

    def assertNoQuestions(self, world=None):
        self.assertEqual((world or self.world).identity.queue_items(which="open"), [], "ingest queues nothing")


class JoinTest(IngestTest):
    """The join matrix: each record joins at its own scope, never through its issuer, a ticker or an underlying."""

    def test_a_share_class_joins_its_own_security_and_another_classes_identifier_is_a_conflict(self):
        classes = source("classes", level="security")
        self.ingest(classes, record(classes, "GOOGL", ("share_class_figi", "BBG009S39JY5")),
                    record(classes, "GOOG", ("share_class_figi", "BBG009S3NB21")))
        self.assertEqual((self.placed(classes, "GOOGL"), self.placed(classes, "GOOG")),
                         ((GOOGL, "joined"), (GOOG, "joined")))
        # GOOG's line by its FIGI, stating class A's share-class FIGI: kept against the line, never re-parented.
        lines = source("lines")
        self.ingest(lines, record(lines, "GOOG.US", ("figi", "BBG009S4MVF2"), ("share_class_figi", "BBG009S39JY5")))
        self.assertEqual(self.placed(lines, "GOOG.US"), (GOOG_LINE, "conflict"))
        self.assertEqual(self.world.subject(GOOG_LINE)["ids"][identity.Level.SECURITY], GOOG)
        self.assertIsNone(device.subject_row(self.world.identity, GOOG_LINE))
        self.assertNoQuestions()

    def test_a_receipt_quoting_its_shares_isin_never_joins_the_share(self):
        lines, securities = source("lines"), source("securities", level="security")
        self.ingest(lines, record(lines, "ERIC", ("figi", "BBG000BB13V0"), ("isin", "SE0000108656", "underlying")))
        self.ingest(securities, record(securities, "ERIC-ADS", ("isin", "SE0000108656", "underlying")))
        self.assertEqual(self.placed(lines, "ERIC"), (ADS_LINE, "joined"))  # its own FIGI; the underlying names nothing
        self.assertEqual(self.placed(securities, "ERIC-ADS"), (None, "unmatched"))
        self.assertEqual(device.assertions(self.world.identity, [ERIC_B, ERIC_B_LINE]), [])

    def test_a_shared_issuer_never_merges_two_instruments(self):
        securities = source("securities", level="security", introduces={"security": ["isin"]})
        done = self.ingest(securities, record(securities, "A", ("isin", "SE0000108649"), ("lei", ERICSSON_LEI)),
                           record(securities, "B", ("isin", "SE0000108656"), ("lei", ERICSSON_LEI)),
                           record(securities, "LEI", ("lei", ERICSSON_LEI), ("cik", "717826")))
        self.assertEqual([self.placed(securities, name) for name in ("A", "B", "LEI")],
                         [(ERIC_A, "joined"), (ERIC_B, "joined"), (None, "unmatched")])
        self.assertEqual((done["joined"], done["unmatched"], done["introduced"]), (2, 1, 0))

    def test_a_ticker_never_joins_or_keys_a_line(self):
        lines = source("lines", introduces={"listing": ["isin", "figi"]})
        self.ingest(lines, record(lines, "ERIC-B", ("ticker_mic", "ERIC B@XSTO"), ticker="ERIC B",
                                  operating_mic="XSTO", currency="SEK", name="Ericsson B"))
        self.assertEqual(self.placed(lines, "ERIC-B"), (None, "unmatched"))
        self.assertIsNone(device.subject_row(self.world.identity, ERIC_B_LINE))

    def test_an_isin_that_contradicts_the_lines_figi_is_a_conflict_and_nothing_moves(self):
        # GSK consolidated in 2022: a stale source still states the former ISIN beside the current line's FIGI.
        lines = source("lines")
        self.ingest(lines, record(lines, "GSK.L", ("figi", "BBG000CT5GJ1"), ("isin", "GB0009252882"),
                                  operating_mic="XLON", currency="GBP"))
        self.assertEqual(self.placed(lines, "GSK.L"), (GSK_LINE, "conflict"))
        view = self.world.subject(GSK_LINE)
        self.assertEqual((view["id"], view["ids"][identity.Level.SECURITY]), (GSK_LINE, GSK))  # never re-keyed
        self.assertEqual(sorted(item.value for item in view["contested"]["isin"]), ["GB0009252882", "GB00BN7SWP63"])
        self.assertNoQuestions()

    def test_an_issuer_record_joins_by_lei_then_cik_and_an_unknown_lei_is_introduced(self):
        issuers = source("issuers", level="issuer", introduces={"issuer": ["lei"]})
        unknown = "5493001KJTIIGC8Y1R12"
        done = self.ingest(issuers, record(issuers, "A", ("lei", ERICSSON_LEI), name="Ericsson"),
                           record(issuers, "B", ("cik", "717826")),
                           record(issuers, "C", ("lei", unknown), name="Nowhere AB"))
        self.assertEqual([self.placed(issuers, name) for name in "ABC"],
                         [(ERICSSON, "joined"), (ERICSSON, "joined"), (f"issuer:lei:{unknown}", "introduced")])
        self.assertEqual((done["joined"], done["introduced"], done["unmatched"]), (2, 1, 0))
        self.assertEqual(self.world.subject(ERICSSON)["view"]["contributors"][0]["stated"],
                         [{"scheme": "cik", "value": "0000717826"}, {"scheme": "lei", "value": ERICSSON_LEI}])
        self.assertNoQuestions()

    def test_the_ericsson_pin_a_shared_cik_never_picks_another_class(self):
        # Ericsson A and B share LEI and CIK; only a class's own share-class FIGI names it.
        classes = source("classes", level="security", introduces={"security": ["figi"], "issuer": ["lei"]})
        self.ingest(classes, record(classes, "ERIC-B", ("share_class_figi", "BBG001S688B5"), ("lei", ERICSSON_LEI),
                                    ("cik", "717826")))
        self.assertEqual(self.placed(classes, "ERIC-B"), (ERIC_B, "joined"))
        # A device that holds only class B and the ADS: class A's record joins neither, and is introduced under the
        # issuer its LEI names.
        world = self.fresh()
        world.ref.close()
        world.ref = store.open_reference(world.release("no-class-a", drop=[ERIC_A_LINE, ERIC_A]))
        self.ingest(classes, record(classes, "ERIC-A", ("share_class_figi", "BBG001SCFF19"), ("lei", ERICSSON_LEI),
                                    ("cik", "717826"), name="Ericsson A"), world=world)
        introduced = "security:figi:BBG001SCFF19"
        self.assertEqual(self.placed(classes, "ERIC-A", world), (introduced, "introduced"))
        self.assertEqual(device.subject_row(world.identity, introduced)["parent_id"], ERICSSON)
        self.assertEqual(world.identity.bindings([ERIC_B, ADS]), [])


class DeterminismTest(IngestTest):
    def batch(self, lines):
        return [record(lines, "SAP", ("isin", SAP_ISIN), ("share_class_figi", SAP_SHARE), scope="security",
                       name="SAP SE"),  # its lines name it by share-class FIGI alone: found in any order
                record(lines, "SAP.DE", ("share_class_figi", SAP_SHARE), ("figi", SAP_FIGI), operating_mic="XETR",
                       currency="EUR", ticker="SAP", name="SAP SE"),
                record(lines, "SAP.F", ("isin", SAP_ISIN), ("figi", SAP_FRANKFURT), operating_mic="XFRA",
                       currency="EUR", name="SAP SE"),
                record(lines, "ERIC-B.ST", ("figi", "BBG000BX2SW5"), ("isin", "SE0000108656"), operating_mic="XSTO",
                       currency="SEK"),
                record(lines, "GSK.L", ("figi", "BBG000CT5GJ1"), ("isin", "GB0009252882")),
                record(lines, "NOWHERE", ("figi", NOWHERE)),
                record(lines, "TICKER", ticker="X", operating_mic="XNYS", currency="USD")]

    @staticmethod
    def lines():
        return source("lines", introduces={"listing": ["isin", "figi"], "security": ["isin", "figi"]},
                      native=({"native_scope": "security", "level": "security"},))

    @staticmethod
    def state(world):
        tables = {"claims": "native_id, subject_id, state", "subjects": "id, parent_id, name, introduced_by",
                  "device_assertions": "subject_id, scheme, value, plugin, native_id", "bindings": "native_id, subject_id",
                  "device_aliases": "old_id, new_id"}
        return {table: sorted(tuple(row) for row in world.identity.select(f"SELECT {columns} FROM {table}"))
                for table, columns in tables.items()}

    def test_shuffled_records_give_identical_ids_and_states(self):
        lines = self.lines()
        seen = []
        for seed in range(6):
            world = self.fresh()
            claims = self.batch(lines)
            random.Random(seed).shuffle(claims)
            self.ingest(lines, *claims, world=world)
            seen.append(self.state(world))
            self.assertNoQuestions(world)
        self.assertTrue(all(state == seen[0] for state in seen))
        placed = {row[0]: row[1:] for row in seen[0]["claims"]}
        self.assertEqual((placed["SAP"], placed["SAP.DE"]), ((f"security:isin:{SAP_ISIN}", "introduced"),
                                                            (f"listing:figi:{SAP_FIGI}", "introduced")))
        self.assertEqual(placed["ERIC-B.ST"], (ERIC_B_LINE, "joined"))
        self.assertEqual((placed["GSK.L"][1], placed["NOWHERE"], placed["TICKER"]),
                         ("conflict", (None, "unmatched"), (None, "unmatched")))
        # Both SAP lines sit under the one security their ISIN introduced.
        self.assertEqual({row[1] for row in seen[0]["subjects"] if row[0].startswith("listing:")}, {f"security:isin:{SAP_ISIN}"})

    def test_an_unchanged_record_writes_nothing(self):
        lines = self.lines()
        first = self.ingest(lines, *self.batch(lines))
        before, generation = self.world.identity.db.total_changes, device.generation(self.world.identity)
        again = self.ingest(lines, *self.batch(lines))
        self.assertEqual((self.world.identity.db.total_changes, device.generation(self.world.identity)),
                         (before, generation))
        self.assertEqual(again, first)


class OrderTest(IngestTest):
    """The same records from several plugins, arriving in either order, give the same subjects, parents and evidence:
    a device subject's parent is the one its records name and agree on, and a parent's identifiers land only on a
    parent they name (#116 review, probes a to c)."""

    @staticmethod
    def outcome(world):
        return (sorted(tuple(row) for row in world.identity.select("SELECT id, parent_id FROM subjects")),
                sorted(tuple(row) for row in world.identity.select(
                    "SELECT subject_id, scheme, value, plugin FROM device_assertions")))

    def both_orders(self, *steps):
        outcomes = []
        for order in (steps, steps[::-1]):
            world = self.fresh()
            for info, claim in order:
                self.ingest(info, claim, world=world)
            outcomes.append(self.outcome(world))
        self.assertEqual(outcomes[0], outcomes[1])
        return outcomes[0]

    def test_a_plugins_security_and_line_records_give_one_security_in_either_order(self):
        lines = source("lines", introduces={"listing": ["isin", "figi"], "security": ["isin", "figi"]},
                       native=({"native_scope": "security", "level": "security"},))
        subjects, _evidence = self.both_orders(
            (lines, record(lines, "SAP", ("isin", SAP_ISIN), ("share_class_figi", SAP_SHARE), scope="security")),
            (lines, record(lines, "SAP.DE", ("share_class_figi", SAP_SHARE), ("figi", SAP_FIGI), operating_mic="XETR",
                           currency="EUR")))
        self.assertEqual(subjects, [(f"listing:figi:{SAP_FIGI}", f"security:isin:{SAP_ISIN}"),
                                    (f"security:isin:{SAP_ISIN}", None)])  # its own statements join its own subject

    def test_two_plugins_records_that_disagree_leave_the_line_without_a_parent_in_either_order(self):
        first, second = (source(name, introduces={"listing": ["figi"], "security": ["figi"]}) for name in ("a", "b"))
        subjects, evidence = self.both_orders(
            (first, record(first, "L", ("figi", SAP_FIGI), ("share_class_figi", SAP_SHARE), operating_mic="XLON",
                           currency="GBP")),
            (second, record(second, "L", ("figi", SAP_FIGI), ("share_class_figi", "BBG000TYSCX0"), operating_mic="XLON",
                            currency="GBP")))
        self.assertEqual(subjects, [(f"listing:figi:{SAP_FIGI}", None), ("security:figi:BBG000TYSCX0", None),
                                    (f"security:figi:{SAP_SHARE}", None)])
        self.assertEqual({(subject, value) for subject, scheme, value, _plugin in evidence if scheme == "share_class_figi"},
                         {(f"security:figi:{SAP_SHARE}", SAP_SHARE), ("security:figi:BBG000TYSCX0", "BBG000TYSCX0")})

    def test_two_plugins_stating_the_same_cgs_area_isin_give_one_subject_in_either_order(self):
        first, second = (source(name, introduces={"listing": ["cgs_isin"], "security": ["cgs_isin"]}) for name in ("a", "b"))
        apple = ("isin", "US0378331005")
        subjects, evidence = self.both_orders(
            (first, record(first, "AAPL", apple, operating_mic="XNAS", currency="USD", name="Apple")),
            (second, record(second, "AAPL.O", apple, operating_mic="XNAS", currency="USD", name="Apple Inc.")))
        self.assertEqual(subjects, [("listing:cgs_isin:US0378331005:XNAS:USD", "security:cgs_isin:US0378331005"),
                                    ("security:cgs_isin:US0378331005", None)])
        self.assertEqual({plugin for _subject, scheme, _value, plugin in evidence if scheme == "isin"}, {"a", "b"})  # both kept


class LifecycleTest(IngestTest):
    def test_a_complete_scope_marks_what_it_no_longer_offers_and_keeps_its_binding(self):
        lines = source("lines", introduces={"listing": ["figi"]})
        pages = [record(lines, "A", ("figi", SAP_FIGI), operating_mic="XETR", currency="EUR"),
                 record(lines, "B", ("figi", SAP_FRANKFURT), operating_mic="XFRA", currency="EUR")]
        self.ingest(lines, *pages)
        done = self.ingest(lines, pages[0], complete=True)
        self.assertEqual((done["not_seen"], self.placed(lines, "B")), (1, (f"listing:figi:{SAP_FRANKFURT}", "not_seen")))
        bound = self.world.identity.bound_subject(identity.ProviderRef("lines", "B", "ref"))
        self.assertEqual(bound, f"listing:figi:{SAP_FRANKFURT}")  # never unbound, never deleted
        self.assertIsNotNone(device.subject_row(self.world.identity, bound))
        # A page of the same scope carried it: the scope's last page does not mark it.
        self.ingest(lines, pages[1])
        self.assertEqual(self.ingest(lines, pages[0], complete=True, seen={("ref", "B")})["not_seen"], 0)

    def test_a_better_key_re_keys_a_device_subject_upward_even_where_another_plugins_record_is_on_it(self):
        for shared in (False, True):
            with self.subTest(shared=shared):
                world = self.fresh()
                lines = source("lines", introduces={"listing": ["isin", "figi"]})
                self.ingest(lines, record(lines, "SAP.DE", ("figi", SAP_FIGI), operating_mic="XETR", currency="EUR"),
                            world=world)
                old, new = f"listing:figi:{SAP_FIGI}", f"listing:isin:{SAP_ISIN}:XETR:EUR"
                self.assertEqual(self.placed(lines, "SAP.DE", world), (old, "introduced"))
                if shared:
                    other = source("other")
                    self.ingest(other, record(other, "SAP", ("figi", SAP_FIGI)), world=world)
                    self.assertEqual(self.placed(other, "SAP", world), (old, "joined"))
                self.ingest(lines, record(lines, "SAP.DE", ("figi", SAP_FIGI), ("isin", SAP_ISIN), operating_mic="XETR",
                                          currency="EUR"), world=world)
                self.assertEqual(device.current_id(world.ref, world.identity, old), new)
                self.assertEqual(world.identity.bound_subject(identity.ProviderRef("lines", "SAP.DE", "ref")), new)
                self.assertEqual(world.subject(old)["id"], new)  # a saved ID reads as the subject it became
                aliases = world.identity.select("SELECT old_id, new_id FROM device_aliases")
                self.assertEqual([tuple(row) for row in aliases], [(old, new)])

    def test_a_changed_identifier_never_merges_two_open_keyed_subjects(self):
        # A plugin's own record first names SAP's security, then GSK's: a conflict, and nothing moves.
        securities = source("securities", level="security", introduces={"security": ["isin"]})
        self.ingest(securities, record(securities, "ACME", ("isin", SAP_ISIN)))
        sap = f"security:isin:{SAP_ISIN}"
        self.assertEqual(self.placed(securities, "ACME"), (sap, "introduced"))
        self.ingest(securities, record(securities, "ACME", ("isin", "GB00BN7SWP63")))
        self.assertEqual(self.placed(securities, "ACME"), (sap, "conflict"))
        self.assertEqual((device.current_id(self.world.ref, self.world.identity, sap), self.world.subject(sap)["id"]),
                         (sap, sap))
        self.assertEqual(self.world.identity.bound_subject(identity.ProviderRef("securities", "ACME", "ref")), sap)
        self.assertEqual(self.world.identity.select("SELECT * FROM device_aliases"), [])

    def test_a_release_that_holds_a_device_subjects_key_covers_it(self):
        lines = source("lines", introduces={"listing": ["figi"]})
        self.ingest(lines, record(lines, "L", ("figi", SAP_FIGI), operating_mic="XETR", currency="EUR"))
        path = self.world.release("holds-the-line")
        with closing(sqlite3.connect(path)) as db, db:
            db.execute("UPDATE assertions SET value = ? WHERE subject_id = ? AND scheme = 'figi'",
                       (SAP_FIGI, "listing:isin:SE0000108656:XSTO:SEK"))  # the release now states that FIGI
        with closing(store.open_reference(path)) as ref:
            self.assertEqual(lifecycle.covered(ref, self.world.identity).get(f"listing:figi:{SAP_FIGI}"),
                             "listing:isin:SE0000108656:XSTO:SEK")

    def test_an_unplaced_record_is_placed_again_once_its_contract_changes(self):
        before = source("lines")
        self.ingest(before, record(before, "SAP.DE", ("figi", SAP_FIGI), operating_mic="XETR", currency="EUR"))
        self.assertEqual(self.placed(before, "SAP.DE"), (None, "unmatched"))
        after = source("lines", introduces={"listing": ["figi"]})  # the same record, a contract that now introduces
        self.ingest(after, record(after, "SAP.DE", ("figi", SAP_FIGI), operating_mic="XETR", currency="EUR"))
        self.assertEqual(self.placed(after, "SAP.DE"), (f"listing:figi:{SAP_FIGI}", "introduced"))


class ConflictQuestionTest(IngestTest):
    def test_a_plugin_conflict_is_asked_once_when_its_subject_becomes_relevant(self):
        stale = source("stale")
        self.ingest(stale, record(stale, "GSK.L", ("figi", "BBG000CT5GJ1"), ("isin", "GB0009252882")))
        self.assertNoQuestions()
        view = self.world.subject(GSK_LINE)["view"]
        self.assertNotIn("isin", view["identifiers"])
        self.assertIn({"value": "GB0009252882", "sources": ["stale"]}, view["contested"]["isin"])
        self.assertEqual(self.world.touch(GSK_LINE), 1)
        [asked] = self.world.identity.queue_items()
        self.assertEqual((asked["reason"], asked["subject_ids"], asked["candidate_ids"]),
                         ("identifier", [GSK], [GSK_BEFORE, GSK]))
        self.assertEqual((self.world.touch(GSK_LINE), self.world.touch(GSK)), (0, 0))  # re-asking never duplicates
        self.assertEqual(len(self.world.identity.queue_items()), 1)


class RelationTest(IngestTest):
    """A plugin relation that contradicts the package's makes it contested: shown, not applied, not folded. One that
    agrees changes nothing, and a disabled plugin's is only shown."""

    def related(self, world, subject):
        return {(item["id"], item["type"], item.get("source"), item.get("contested", False))
                for item in world.subject(subject)["view"]["related"] if item["type"] == "depositary_receipt_of"}

    def folded(self, world):
        contested = relations.contested(world.identity, device.enabled(world.plugins))
        lines = search.Directory(world.ref, contested).instrument_listings(ERIC_B)
        return [line["id"] for line in lines if line["folded"]]

    def test_a_contradiction_contests_the_package_relation_and_agreement_changes_nothing(self):
        cases = {"contradicts": ("SE0000108649", True), "agrees": ("SE0000108656", True),
                 "disabled": ("SE0000108649", False)}
        for case, (share, enabled) in cases.items():
            with self.subTest(case=case):
                world = self.fresh()
                self.assertEqual((self.related(world, ADS), self.folded(world)), (set(), [ADS_LINE]))
                links = replace(source("links", level="security"), enabled=enabled)
                done = self.ingest(links, relation(links, "depositary_receipt_of",
                                                   {"scheme": "share_class_figi", "value": "BBG001S5QXT3"},
                                                   {"scheme": "isin", "value": share}), world=world)
                self.assertEqual(done["conflicts" if case != "agrees" else "joined"], 1)
                shown = self.related(world, ADS)
                if case == "agrees":
                    self.assertEqual((shown, self.folded(world)), (set(), [ADS_LINE]))
                elif case == "disabled":  # shown with its source; the package's still folds
                    self.assertEqual((shown, self.folded(world)), ({(ERIC_A, "depositary_receipt_of", "links", False)},
                                                                   [ADS_LINE]))
                else:
                    self.assertEqual(shown, {(ERIC_B, "depositary_receipt_of", None, True),
                                             (ERIC_A, "depositary_receipt_of", "links", True)})
                    self.assertEqual(self.folded(world), [])  # the receipt's line is no longer listed as the share's
                self.assertNoQuestions(world)


class CryptoKeyTest(IngestTest):
    """A deployment key from any plugin; an asset key only from a canonical-issuance claim; a provisional coin aliased
    to it; a provider's platform list never keys an asset."""

    def test_a_platform_list_never_keys_an_asset_and_a_canonical_claim_aliases_the_provisional_coin(self):
        world = self.fresh(("asml.json", "failures.json", "crypto.json"))
        coins = source("coins", level="security", introduces={"security": ["native", "caip19"]})
        provisional = "security:provisional:coins:ref:ether"
        self.ingest(coins, record(coins, "ether", ("caip19", ETH, "unqualified"), name="Ether",
                                  asset_class="crypto", kind="coin"), world=world)
        self.assertEqual(self.placed(coins, "ether", world), (provisional, "introduced"))
        self.ingest(coins, record(coins, "ether", ("caip19", ETH, "self"), name="Ether", asset_class="crypto",
                                  kind="coin"), world=world)
        expected = (f"security:caip19:{ETH}", "joined")
        self.assertEqual(self.placed(coins, "ether", world), expected)
        self.assertEqual(device.current_id(world.ref, world.identity, provisional), expected[0])

    def test_a_deployment_key_comes_from_any_plugin(self):
        tokens = source("tokens", introduces={"listing": ["caip19"]})
        usdc = "sui:mainnet/coin:0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC"
        done = self.ingest(tokens, record(tokens, "usdc", ("caip19", usdc), name="USDC on Sui"))
        [placed] = done["subjects"]
        self.assertEqual((placed.split(":")[:2], done["introduced"]), (["listing", "caip19"], 1))

    def test_a_single_chain_token_keys_itself_by_its_own_caip19_and_a_bridge_claim_merges_nothing(self):
        # A DeFi source's Sui token states its own coin type; no edit to canonical_assets.json gives it a portable key.
        world = self.fresh(("asml.json", "failures.json", "crypto.json"))
        coins = source("coins", level="security", introduces={"security": ["native", "caip19"]})
        native = "sui:mainnet/coin:0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC"
        bridged = "sui:mainnet/coin:0x" + "ab" * 32 + "::coin::COIN"
        sui_native, sui_bridged = f"security:caip19:{SUI_USDC}", "security:caip19:" + bridged.replace("::", "%3A%3A")
        ends = lambda name: {"provider": "coins", "native_scope": "ref", "native_id": name}  # noqa: E731
        done = self.ingest(  # all three are "USDC" to it; the Sui coin also lists Ethereum's USDC on a platform list
            coins, record(coins, "usdc", ("caip19", USDC, "self"), name="USDC", asset_class="crypto", kind="token"),
            record(coins, "sui-usdc", ("caip19", native, "self"), ("caip19", USDC, "unqualified"), name="USDC",
                   asset_class="crypto", kind="token"),
            record(coins, "sui-wusdc", ("caip19", bridged, "self"), name="USDC", asset_class="crypto", kind="token"),
            relation(coins, "wraps", ends("sui-wusdc"), ends("usdc")),
            relation(coins, "bridged_from", ends("sui-usdc"), ends("usdc")), world=world)
        eth = f"security:caip19:{USDC}"
        self.assertEqual([self.placed(coins, name, world) for name in ("usdc", "sui-usdc", "sui-wusdc")],
                         [(eth, "introduced"), (sui_native, "introduced"), (sui_bridged, "introduced")])
        self.assertEqual((done["introduced"], done["joined"], done["conflicts"], done["unmatched"]), (3, 2, 0, 0))
        # Three subjects that share a name stay three; the platform-list value joined nothing.
        self.assertEqual(sorted(row[0] for row in world.identity.select("SELECT id FROM subjects")),
                         sorted([eth, sui_native, sui_bridged]))
        # The bridge claims show as the plugin's labelled evidence, between the two subjects, and fold nothing.
        self.assertEqual({(item["id"], item["type"], item["direction"], item["source"], item.get("contested", False))
                          for item in world.subject(eth)["view"]["related"]},
                         {(sui_bridged, "wraps", "from", "coins", False), (sui_native, "bridged_from", "from", "coins", False)})
        self.assertEqual(world.subject(sui_bridged)["ids"][identity.Level.SECURITY], sui_bridged)
        self.assertEqual({row["type"] for row in world.identity.select("SELECT type FROM relations")}, {"wraps", "bridged_from"})


class IntroductionTest(IngestTest):
    def test_a_subject_is_introduced_only_under_a_key_scheme_its_contract_declares(self):
        line = ("figi", SAP_FIGI)
        for introduces, placed in ((None, (None, "unmatched")), ({"listing": ["caip19"]}, (None, "unmatched")),
                                   ({"listing": ["figi"]}, (f"listing:figi:{SAP_FIGI}", "introduced"))):
            with self.subTest(introduces=introduces):
                world = self.fresh()
                lines = source("lines", introduces=introduces)
                self.ingest(lines, record(lines, "SAP.DE", line, operating_mic="XETR", currency="EUR"), world=world)
                self.assertEqual(self.placed(lines, "SAP.DE", world), placed)
                self.assertEqual(device.subject_row(world.identity, f"listing:figi:{SAP_FIGI}") is not None,
                                 placed[0] is not None)

    def test_a_line_with_no_venue_is_never_introduced_and_never_searchable(self):
        # A lookup's lines with no mapped exchange: evidence where their FIGI names a line, else unmatched.
        lines = source("lines", introduces={"listing": ["figi"]})
        done = self.ingest(lines, record(lines, "TOKYO?", ("figi", SAP_FIGI), name="SAP SE"),
                           record(lines, "ERIC-B?", ("figi", "BBG000BX2SW5")))
        self.assertEqual((self.placed(lines, "TOKYO?"), self.placed(lines, "ERIC-B?")),
                         ((None, "unmatched"), (ERIC_B_LINE, "joined")))
        self.assertEqual((done["introduced"], device.subject_row(self.world.identity, f"listing:figi:{SAP_FIGI}")), (0, None))
        self.assertEqual(search.Directory(self.world.ref).search(SAP_FIGI, limit=5)["groups"], [])

    def test_a_device_subjects_identifiers_name_the_plugin_that_stated_them(self):
        lines = source("lines", introduces={"listing": ["figi"]})
        self.ingest(lines, record(lines, "SAP.DE", ("figi", SAP_FIGI), operating_mic="XETR", currency="EUR"))
        view = self.world.subject(f"listing:figi:{SAP_FIGI}")["view"]
        self.assertEqual({key: view["provenance"]["figi"][key] for key in ("plugin", "source")},
                         {"plugin": "lines", "source": "lines"})

    def test_device_evidence_about_a_reference_subject_shows_on_its_page_by_plugin(self):
        lines = source("lines")
        self.ingest(lines, record(lines, "ERIC-B.ST", ("figi", "BBG000BX2SW5"), operating_mic="XSTO", currency="SEK",
                                  ticker="ERIC B"))
        view = self.world.subject(ERIC_B_LINE)["view"]
        [contributor] = view["contributors"]
        self.assertEqual((contributor["plugin"], contributor["status"]), ("lines", "enabled"))
        self.assertEqual(contributor["stated"], [{"scheme": "figi", "value": "BBG000BX2SW5"},
                                                 {"scheme": "ticker_mic", "value": "ERIC B@XSTO"}])
        self.assertNotIn("contributors", self.world.subject(GSK_LINE)["view"])  # nothing stated there


if __name__ == "__main__":
    unittest.main()
