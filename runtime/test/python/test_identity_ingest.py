"""Core's ingest of plugin claims (roadmap stage 0; ADR 0037, amendment "ingest"): every record joins by identifier
agreement at its own scope, a contradiction is kept as a conflict and asked about only when relevant, a subject is
introduced only under a key scheme its contract declares, and keys move up only on confirm-level evidence.

The world is `identity_world` (Ericsson, Alphabet, GSK, Shell and US Steel from the identity truth set); the plugins
are fixtures core never names. Sources as they emit, and the operations, are test_identity_ingest_sources's.
"""
import random
import tempfile
import unittest
from pathlib import Path

from identity_world import World
from test_identity_contracts import PROVENANCE, identity
from pythia_identity_fixture import device, page, relations, search, store, trust  # noqa: E402

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


def source(name, *, level="listing", introduces=None, display=False, scopes=("all",), native=(), resolve=()):
    """A plugin core never names: a bulk catalogue of records at `level` (and a resolve by `resolve` schemes),
    introducing what `introduces` declares."""
    contract = {"contract_version": 2, "plugin": name, "provider": name,
                "addressing": {"native": [{"native_scope": "ref", "level": level}, *native]},
                "catalogue": {"mode": "bulk", "operation": "catalogue", "scopes": list(scopes)},
                **({"introduces": introduces} if introduces else {}),
                **({"resolve": {"operation": "resolve", "input_schemes": list(resolve), "echoes": []}} if resolve else {}),
                "rights": {"licence": "personal", "cache": "none", "hostable": False},
                "signoff": {"status": "grandfathered"}}
    manifest = identity.validate_manifest(contract)
    return page.PluginInfo(key=f"pythia-{name}", manifest=identity.vouched(manifest, trust.DISPLAY) if display else manifest)


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
        world.ref = store.open_reference(world.release("no-class-a", drop=[ERIC_A_LINE, ERIC_A]), "confirm")
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

    def test_a_better_key_re_keys_upward_with_an_alias_only_at_confirm_level(self):
        for level in (trust.CONFIRM, trust.DISPLAY):
            with self.subTest(level=level):
                world = self.fresh()
                lines = source("lines", introduces={"listing": ["isin", "figi"]}, display=level == trust.DISPLAY)
                self.ingest(lines, record(lines, "SAP.DE", ("figi", SAP_FIGI), operating_mic="XETR", currency="EUR"),
                            world=world)
                old, new = f"listing:figi:{SAP_FIGI}", f"listing:isin:{SAP_ISIN}:XETR:EUR"
                self.assertEqual(self.placed(lines, "SAP.DE", world), (old, "introduced"))
                self.ingest(lines, record(lines, "SAP.DE", ("figi", SAP_FIGI), ("isin", SAP_ISIN), operating_mic="XETR",
                                          currency="EUR"), world=world)
                expected = new if level == trust.CONFIRM else old
                self.assertEqual(device.current_id(world.ref, world.identity, old), expected)
                self.assertEqual(world.identity.bound_subject(identity.ProviderRef("lines", "SAP.DE", "ref")), expected)
                self.assertEqual(world.subject(old)["id"], expected)  # a saved ID reads as the subject it became
                aliases = world.identity.select("SELECT old_id, new_id FROM device_aliases")
                self.assertEqual([tuple(row) for row in aliases], [(old, new)] if level == trust.CONFIRM else [])


class ConflictQuestionTest(IngestTest):
    def test_a_plugin_conflict_is_asked_once_when_its_subject_becomes_relevant(self):
        for level in (trust.CONFIRM, trust.DISPLAY):
            with self.subTest(level=level):
                world = self.fresh()
                stale = source("stale", display=level == trust.DISPLAY)
                self.ingest(stale, record(stale, "GSK.L", ("figi", "BBG000CT5GJ1"), ("isin", "GB0009252882")),
                            world=world)
                self.assertNoQuestions(world)
                view = world.subject(GSK_LINE)["view"]
                if level == trust.DISPLAY:  # shown with its source, deciding nothing and never asked
                    self.assertEqual((view["identifiers"]["isin"], world.touch(GSK_LINE)), ("GB00BN7SWP63", 0))
                    self.assertIn({"scheme": "isin", "value": "GB0009252882", "source": "stale"}, view["shown"])
                    continue
                self.assertNotIn("isin", view["identifiers"])
                self.assertIn({"value": "GB0009252882", "sources": ["stale"]}, view["contested"]["isin"])
                self.assertEqual(world.touch(GSK_LINE), 1)
                [asked] = world.identity.queue_items()
                self.assertEqual((asked["reason"], asked["subject_ids"], asked["candidate_ids"]),
                                 ("identifier", [GSK], [GSK_BEFORE, GSK]))
                self.assertEqual((world.touch(GSK_LINE), world.touch(GSK)), (0, 0))  # re-asking never duplicates
                self.assertEqual(len(world.identity.queue_items()), 1)


class RelationTest(IngestTest):
    """A confirm-level plugin relation that contradicts the package's makes it contested: shown, not applied, not
    folded. One that agrees changes nothing, and a display-level one is only shown."""

    def related(self, world, subject):
        return {(item["id"], item["type"], item.get("source"), item.get("contested", False))
                for item in world.subject(subject)["view"]["related"] if item["type"] == "depositary_receipt_of"}

    def folded(self, world):
        contested = relations.contested(world.identity, device.levels(world.plugins))
        lines = search.Directory(world.ref, contested).instrument_listings(ERIC_B)
        return [line["id"] for line in lines if line["folded"]]

    def test_a_contradiction_contests_the_package_relation_and_agreement_changes_nothing(self):
        cases = {"contradicts": ("SE0000108649", trust.CONFIRM), "agrees": ("SE0000108656", trust.CONFIRM),
                 "display": ("SE0000108649", trust.DISPLAY)}
        for case, (share, level) in cases.items():
            with self.subTest(case=case):
                world = self.fresh()
                self.assertEqual((self.related(world, ADS), self.folded(world)), (set(), [ADS_LINE]))
                links = source("links", level="security", display=level == trust.DISPLAY)
                done = self.ingest(links, relation(links, "depositary_receipt_of",
                                                   {"scheme": "share_class_figi", "value": "BBG001S5QXT3"},
                                                   {"scheme": "isin", "value": share}), world=world)
                self.assertEqual(done["conflicts" if case != "agrees" else "joined"], 1)
                shown = self.related(world, ADS)
                if case == "agrees":
                    self.assertEqual((shown, self.folded(world)), (set(), [ADS_LINE]))
                elif case == "display":  # shown with its source; the package's still folds
                    self.assertEqual((shown, self.folded(world)), ({(ERIC_A, "depositary_receipt_of", "links", False)},
                                                                   [ADS_LINE]))
                else:
                    self.assertEqual(shown, {(ERIC_B, "depositary_receipt_of", None, True),
                                             (ERIC_A, "depositary_receipt_of", "links", True)})
                    self.assertEqual(self.folded(world), [])  # the receipt's line is no longer listed as the share's
                self.assertNoQuestions(world)


class CryptoKeyTest(IngestTest):
    """A deployment key from any plugin; an asset key only from a canonical-issuance claim; a provisional coin aliased
    to it only at confirm level; a provider's platform list never keys an asset."""

    def test_a_platform_list_never_keys_an_asset_and_only_a_confirm_level_canonical_claim_aliases(self):
        for level in (trust.CONFIRM, trust.DISPLAY):
            with self.subTest(level=level):
                world = self.fresh(("asml.json", "failures.json", "crypto.json"))
                coins = source("coins", level="security", introduces={"security": ["native", "caip19"]},
                               display=level == trust.DISPLAY)
                provisional = "security:provisional:coins:ref:ether"
                self.ingest(coins, record(coins, "ether", ("caip19", ETH, "unqualified"), name="Ether",
                                          asset_class="crypto", kind="coin"), world=world)
                self.assertEqual(self.placed(coins, "ether", world), (provisional, "introduced"))
                self.ingest(coins, record(coins, "ether", ("caip19", ETH, "self"), name="Ether", asset_class="crypto",
                                          kind="coin"), world=world)
                expected = (f"security:caip19:{ETH}", "joined") if level == trust.CONFIRM else (provisional, "conflict")
                self.assertEqual(self.placed(coins, "ether", world), expected)
                self.assertEqual(device.current_id(world.ref, world.identity, provisional), expected[0])

    def test_a_deployment_key_comes_from_any_plugin(self):
        tokens = source("tokens", introduces={"listing": ["caip19"]}, display=True)
        usdc = "sui:mainnet/coin:0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC"
        done = self.ingest(tokens, record(tokens, "usdc", ("caip19", usdc), name="USDC on Sui"))
        [placed] = done["subjects"]
        self.assertEqual((placed.split(":")[:2], done["introduced"]), (["listing", "caip19"], 1))


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
