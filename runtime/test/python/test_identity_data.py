"""The identity data explains itself (docs/architecture/identity-data.md): the doc's read-only queries run against a
device with a reference package, plugins, a binding, a contested identifier and a user's answer, the tables the doc
names are the tables the stores have, and the provenance the stores promise is kept."""
import contextlib
import os
import re
import shutil
import sqlite3
import tempfile
import unittest
import unittest.mock as mock
from pathlib import Path

from identity_world import AS_OF, NOW, World, record, vendor
from test_identity_contracts import PROVENANCE, identity
from test_reference_package import make_package
from pythia_identity_fixture import corrections, device, page, queue, reference_package, relations, store  # noqa: E402

DOC = Path(__file__).parents[3] / "docs/architecture/identity-data.md"
AGENT = Path(__file__).parents[2] / "managed/core/skills/identity-data/references/queries.md"  # what the skill ships
TOYOTA, TOYOTA_ISIN = "listing:isin:JP3633400001:XJPX:JPY", "JP3633400001"
REASON = "venue code XV is a trade report (Cboe Europe BOTC), not an order book"
FIX_REASON = "the source names the wrong company's LEI; the company's own filing names the right one"
POOL_ID = "00000002-0000-4000-8000-000000000000"
POOL = f"market:provisional:tidepool:pool:{POOL_ID}"
OLD_ID = identity.provisional_id("listing", "vendor", "line", "OLD1")
POOLS = {"contract_version": 2, "plugin": "tidepool", "provider": "tidepool",
         "addressing": {"native": [{"native_scope": "pool", "level": "market"},
                                   {"native_scope": "protocol", "level": "protocol"}]},
         "catalogue": {"mode": "bulk", "operation": "catalogue", "scopes": ["pools"]},
         "introduces": {"market": ["native"], "protocol": ["native"]},
         "rights": {"licence": "personal", "cache": "none", "hostable": False}, "signoff": {"status": "unsigned"}}


def examples(language: str, path: Path = DOC) -> dict[str, str]:
    """A file's fenced code blocks of a language that open with `example: <name>`, by name."""
    marker, found = "--" if language == "sql" else "#", {}
    for block in re.findall(rf"```{language}\n(.*?)```", path.read_text(encoding="utf-8"), re.S):
        named = re.match(rf"{marker} example: (\S+)\n", block)
        if named:
            found[named.group(1)] = block
    return found


def documented(heading: str) -> set[str]:
    """The table names in the first column of the doc's table under a `### <heading>` section."""
    section = DOC.read_text(encoding="utf-8").partition(f"### {heading}\n")[2].partition("\n#")[0]
    return set(re.findall(r"^\| `(\w+)` \|", section, re.M))


class DocFixture(unittest.TestCase):
    """A device: the reference package installed and the identity store copied to `<data root>/store`, as core leaves
    them, built from Toyota and ASML lines, a pricing source that answered for Toyota's Tokyo line, a second source
    that contradicts its ISIN, a DeFi source with a pool and its protocol, and a user's answer to one of two questions."""

    def setUp(self):
        self.tmp = Path(self.enterContext(tempfile.TemporaryDirectory()))
        (self.tmp / "world").mkdir()
        self.world = World(self.tmp / "world", ("toyota.json", "asml.json", "failures.json"))
        self.addCleanup(self.world.close)
        pricing, other = vendor("isin", name="vendor", mic_table={"XJPX": ".T"}), vendor("isin", name="other")
        underlying = [vendor("isin", name=name) for name in ("first", "second")]
        self.tidepool = page.PluginInfo(key="tidepool", manifest=identity.validate_manifest(POOLS))
        with contextlib.closing(sqlite3.connect(self.world.path)) as db, db:  # what the contested query must not return
            for subject, level, scheme, value, source, ended in (
                    ("security:isin:JP3633400001", "security", "share_class_figi", "BBG000TYSCG9", "fixture", None),
                    (TOYOTA, "listing", "figi", "BBG000TYTKX1", "legacy", "2020-01-01"),
                    (TOYOTA, "listing", "ticker_mic", "7203@XJPX", "other", None)):  # a source in both stores
                db.execute("INSERT INTO assertions (evidence_id, subject_id, level, scheme, value, valid_to, authority,"
                           " source, plugin, adapter_version, retrieved_at) VALUES (?, ?, ?, ?, ?, ?,"
                           " 'source_asserted', ?, ?, '1', ?)", (f"ev:{value}", subject, level, scheme, value, ended,
                                                                source, source, NOW))
            db.execute("INSERT INTO source_corrections VALUES ('security:isin:JP3633400001', 'esma_firds', 'Issr',"
                       " '5493000ORIGINALISSUER', '5493000CORRECTEDISSUR', ?)", (FIX_REASON,))  # illustrative LEIs
        self.world.plugins = [pricing, other, *underlying, self.tidepool]
        self.world.resolve(pricing, TOYOTA, record(pricing, "7203.T", ("isin", TOYOTA_ISIN)))
        contesting = record(other, "TM", ("figi", "BBG000TYTKY0"), ("isin", "US0378331005"))  # contests the ISIN
        contesting["attributes"] = {"name": "Toyota Motor Corp.", "source_corrections": [  # and states a name it corrected
            {"field": "name", "original": "TOYOTA MOTOR CORP (TEST)", "reason": FIX_REASON}]}
        self.world.ingest(other, contesting)
        self.unplaced = record(pricing, "7203.XV", ("figi", "BBG000TYHNX8"), ("isin", TOYOTA_ISIN))  # no line to put it on
        self.unplaced["attributes"] = {"provider_venue": "XV", "venue_note": REASON}
        self.world.ingest(pricing, self.unplaced)
        _binding, answered = self.world.resolve(underlying[0], TOYOTA, record(underlying[0], "TM-A", (
            "isin", TOYOTA_ISIN, "underlying")))
        _binding, self.open = self.world.resolve(underlying[1], TOYOTA, record(underlying[1], "TM-B", (
            "isin", TOYOTA_ISIN, "underlying")))
        self.answer = queue.submit(self.world.identity, self.world.ref, item_id=answered.id, resolver="user",
                                   relation="same_listing", chosen_id=TOYOTA, now=NOW, as_of=AS_OF,
                                   user_turn="desk:identity-verdict:test")
        self.world.ingest(self.tidepool, *self.pool_records(), scope="pools", complete=True)
        for kind, subject, scheme, value, turn, at in (  # the investor's fix, and the agent's proposal waiting for them
                ("identifier", "security:isin:JP3633400001", "isin", "US0378331005", "desk:identity-correction:test", NOW),
                ("price_source", TOYOTA, None, "vendor", None, "2026-09-26T11:00:00Z")):
            corrections.put(self.world.identity, {"kind": kind, "subject_id": subject, "scheme": scheme, "value": value},
                            now=at, user_turn=turn, note="a wrong ISIN" if scheme else None)
        device.put_alias(self.world.identity, OLD_ID, TOYOTA, NOW)
        self.root = self.tmp / "root"
        (self.root / "store").mkdir(parents=True)
        shutil.copyfile(self.tmp / "world" / "core" / "identity.sqlite3", self.root / "store" / "identity.sqlite3")
        reference_package.install(make_package(self.tmp / "package", source=self.world.path), self.root / "store")

    @staticmethod
    def pool_records():
        provenance = {**PROVENANCE, "plugin": "tidepool", "source": "tidepool",
                      "source_record": "https://example.test/pools", "source_version": "2026-09-30"}
        ref = lambda scope, native_id: {"provider": "tidepool", "native_scope": scope, "native_id": native_id}  # noqa: E731
        return [{"level": "protocol", "attributes": {"name": "Example Lend"}, "identifiers": [],
                 "provenance": provenance, "native_ref": ref("protocol", "example-lend")},
                {"level": "market", "attributes": {"name": "Example Lend USDC", "asset_class": "crypto"},
                 "identifiers": [], "provenance": provenance, "native_ref": ref("pool", POOL_ID)},
                {"type": "part_of", "from_key": ref("pool", POOL_ID), "to_key": ref("protocol", "example-lend"),
                 "provenance": provenance},
                {"type": "market_asset", "from_key": ref("pool", POOL_ID),  # a token no plugin has introduced yet
                 "to_key": {"scheme": "caip19", "value": "sui:mainnet/coin:0x" + "ab" * 32 + "%3A%3Acoin%3A%3ACOIN"},
                 "provenance": provenance}]

    @contextlib.contextmanager
    def connection(self):
        """The doc's own snippet, run with the device's data root: `db` is identity.sqlite3 read-only, `ref` attached."""
        code = examples("python", AGENT)["open"]  # the snippet the skill ships
        with mock.patch.dict(os.environ, {"PYTHIA_DATA_ROOT": str(self.root)}):
            scope: dict = {}
            exec(code, scope)  # noqa: S102  (the documented snippet, from this repository)
        try:
            yield scope["db"]
        finally:
            scope["db"].close()


class ExampleTest(DocFixture):
    def query(self, db, name, **given):
        """One SQL example of the doc with the parameters it names, from `given`: its rows."""
        sql = examples("sql", AGENT)[name]
        names = set(re.findall(r"(?<![:\w]):(\w+)", sql))
        self.assertLessEqual(names, set(given), f"{name} names a parameter the test does not know")
        return [dict(row) for row in db.execute(sql, {key: given[key] for key in names})]

    def family(self, db, subject):
        return self.query(db, "family", subject=subject)[0]["family"]

    def run_examples(self):
        """Every SQL example of the doc, in the doc's order: the rows each returns for the Toyota line, except where an
        example is about something else (an old ID, a pool), and for each plugin where it is about a plugin."""
        results: dict[str, list[dict]] = {}
        with self.connection() as db:
            db.row_factory = sqlite3.Row
            values = {"family": self.family(db, TOYOTA), "subject": TOYOTA, "scheme": "isin", "value": TOYOTA_ISIN,
                      "plugin": "vendor", "source": db.execute("SELECT source FROM ref.assertions LIMIT 1").fetchone()[0]}
            for name in examples("sql", AGENT):
                given = {**values, "plugin": "tidepool"} if name == "waiting-relations" else {**values, "plugin": "other"} if name == "plugin-facts" else {**values, "subject": OLD_ID} if name == "alias" else (
                    {**values, "subject": POOL, "family": self.family(db, POOL)} if name == "relations" else values)
                results[name] = self.query(db, name, **given)
            results["plugin-added:tidepool"] = self.query(db, "plugin-added", **{**values, "plugin": "tidepool"})
            results["placing-records:pool"] = self.query(db, "placing-records", **{**values, "family": self.family(db, POOL)})
        return results

    def test_every_example_runs_and_finds_what_the_device_holds(self):
        found = self.run_examples()
        for name in examples("sql", AGENT):
            with self.subTest(example=name):
                self.assertTrue(found[name], f"the {name} example returned nothing on a device that has its data")
        self.assertIn(TOYOTA, found["family"][0]["family"])
        self.assertIn("security:isin:JP3633400001", found["family"][0]["family"])
        self.assertEqual(found["alias"], [{"store": "device", "new_id": TOYOTA, "since": NOW}])
        self.assertEqual((found["listing"][0]["ticker"], found["listing"][0]["operating_mic"]), ("7203", "XJPX"))

    def test_the_price_source_a_binding_names_is_answerable_from_the_stores(self):
        found = self.run_examples()
        mine = {row["plugin"]: row for row in found["bindings"]}
        # Who, which record, how and when: a pricing source's resolve answer matched the ISIN.
        self.assertEqual({key: mine["vendor"][key] for key in ("native_id", "status", "authority", "rule_id")},
                         {"native_id": "7203.T", "status": "confirmed", "authority": "rule_confirmed",
                          "rule_id": "resolve_answer@1"})
        self.assertEqual(mine["vendor"]["decided_at"], mine["vendor"]["verified_at"])
        self.assertIsNotNone(mine["vendor"]["decided_at"])
        # The user's own answer made a binding of its own, with the answer behind it.
        answered = [row for row in found["bindings"] if row["authority"] == "user_attested"]
        self.assertEqual([(row["plugin"], row["status"]) for row in answered], [("first", "confirmed")])
        self.assertTrue(answered[0]["verdict_id"])

    def test_a_contested_identifier_shows_both_values_and_who_states_each(self):
        # Only a contest between sources over current values: one source's second share-class FIGI and another
        # source's line FIGI whose validity ended are stored but not returned.
        [row] = self.run_examples()["contested"]
        self.assertEqual((row["subject_id"], row["scheme"], set(row["vals"].split(",")), set(row["sources"].split(","))),
                         ("security:isin:JP3633400001", "isin", {TOYOTA_ISIN, "US0378331005"}, {"fixture", "other"}))
        stored = {row["value"] for row in self.run_examples()["family-identifiers"]}
        self.assertLessEqual({"BBG000TYSCG9", "BBG000TYTKX1"}, stored)

    def test_the_agents_copy_holds_the_docs_snippet_and_queries(self):
        for language in ("python", "sql"):
            with self.subTest(language=language):
                self.assertTrue(examples(language))
                self.assertEqual(examples(language, AGENT), examples(language))

    def test_a_record_core_could_not_place_says_why_in_the_words_its_plugin_gave(self):
        rows = {row["native_id"]: row for row in self.run_examples()["unplaced-records"]}
        # The plugin's own words where it gave them; the pricing answer that only bound its line gave none.
        self.assertEqual({key: (row["state"], row["venue_code"], row["why_not_placed"]) for key, row in rows.items()},
                         {"7203.XV": ("unmatched", "XV", REASON), "7203.T": ("unmatched", None, None)})

    def test_the_users_answer_is_listed_and_the_other_question_is_still_open(self):
        found = self.run_examples()
        [answer] = found["user-answers"]
        self.assertEqual((answer["state"], answer["relation"], answer["chosen_id"], answer["user_turn"]),
                         ("resolved", "same_listing", TOYOTA, "desk:identity-verdict:test"))
        self.assertEqual(self.answer["outcome"], "confirmed")
        self.assertEqual([row["id"] for row in found["open-questions"]], [self.open.id])

    def test_the_corrections_of_the_family_are_listed_and_only_the_active_one_applies(self):
        rows = self.run_examples()["corrections"]
        self.assertEqual([(row["kind"], row["subject_id"], row["value"], row["state"], row["proposed_by"])
                          for row in rows],
                         [("identifier", "security:isin:JP3633400001", "US0378331005", "active", None),
                          ("price_source", TOYOTA, "vendor", "proposed", "agent")])
        self.assertTrue(rows[0]["decided_at"] and rows[1]["decided_at"] is None)

    def test_a_corrected_value_is_listed_with_what_its_source_originally_said_and_why(self):
        rows = self.run_examples()["source-corrections"]
        self.assertEqual({(row["store"], row["who"], row["subject_id"], row["field"], row["original"], row["value"])
                          for row in rows},
                         {("device", "other", TOYOTA, "name", "TOYOTA MOTOR CORP (TEST)", "Toyota Motor Corp."),
                          ("reference", "esma_firds", "security:isin:JP3633400001", "Issr", "5493000ORIGINALISSUER",
                           "5493000CORRECTEDISSUR")})
        self.assertEqual({row["reason"] for row in rows}, {FIX_REASON})

    def test_a_plugins_relation_keeps_where_it_was_stated(self):
        found = self.run_examples()
        [edge] = [row for row in found["relations"] if row["store"] == "device"]
        self.assertEqual((edge["type"], edge["from_id"], edge["source"], edge["source_record"]),
                         ("part_of", POOL, "tidepool", "https://example.test/pools"))
        with self.connection() as db:
            [row] = db.execute("SELECT source_version, adapter_version FROM relations WHERE type = 'part_of'").fetchall()
        self.assertEqual(tuple(row), ("2026-09-30", PROVENANCE["adapter_version"]))
        [waiting] = found["waiting-relations"]  # the token edge that has no subject to end at yet
        self.assertEqual((waiting["type"], waiting["waits_for"].split(":")[0], waiting["source_record"]),
                         ("market_asset", "caip19", "https://example.test/pools"))
        added = {row["what"] for row in found["plugin-added:tidepool"]}
        self.assertEqual(added, {"subject introduced", "record introduced", "relation part_of", "binding confirmed"})
        # The record that placed the pool carries its own provenance in the claim as emitted.
        self.assertEqual({row["source_record"] for row in found["placing-records:pool"]}, {"https://example.test/pools"})

    def test_the_facts_one_plugin_stated_about_a_subject_come_from_both_stores(self):
        # "Which facts about Toyota come from `other`?": the build's ticker on the line, and what the plugin stated on
        # the device (an identifier on the line, one on the security above it, its conflicting record). Asking about the
        # security reaches the line below it; a plugin that stated nothing about the subject answers nothing.
        with self.connection() as db:
            db.row_factory = sqlite3.Row
            sql = examples("sql", AGENT)["plugin-facts"]
            facts = lambda subject, plugin: {(row["store"], row["what"], row["subject"], row["fact"]) for row in db.execute(  # noqa: E731
                sql, {"family": self.family(db, subject), "plugin": plugin})}
            security = "security:isin:JP3633400001"
            expected = {("reference", "identifier", TOYOTA, "ticker_mic 7203@XJPX"),
                        ("device", "identifier", TOYOTA, "figi BBG000TYTKY0"),
                        ("device", "identifier", security, "isin US0378331005"),
                        ("device", "record conflict", TOYOTA, "symbol:TM")}
            self.assertEqual(facts(TOYOTA, "other"), expected)
            self.assertEqual(facts(security, "other"), expected)  # the line is below the security
            self.assertEqual(facts(TOYOTA, "tidepool"), set())
            pool = {row[1] for row in facts(POOL, "tidepool")}
            self.assertEqual(pool, {"subject introduced", "record introduced", "relation part_of"})

    def test_the_connection_the_doc_opens_cannot_write(self):
        with self.connection() as db:
            for table in ("main.bindings", "ref.assertions"):
                with self.subTest(table=table), self.assertRaises(sqlite3.OperationalError):
                    db.execute(f"DELETE FROM {table}")


class SchemaTest(DocFixture):
    def tables(self, path: Path) -> dict[str, str]:
        with contextlib.closing(sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True)) as db:
            return dict(db.execute("SELECT name, sql FROM sqlite_master WHERE type = 'table'"))

    def test_the_tables_the_doc_names_are_the_tables_the_stores_have(self):
        self.assertEqual(documented("The identity store"), set(self.tables(self.root / "store" / "identity.sqlite3")))
        self.assertEqual(documented("The reference file"), set(self.tables(self.world.path)))

    def test_each_table_carries_its_own_explanation(self):
        # The store explains itself: SQLite keeps the comments inside a CREATE statement, which is what the doc points to.
        for path in (self.root / "store" / "identity.sqlite3", self.world.path):
            for name, sql in self.tables(path).items():
                with self.subTest(store=path.name, table=name):
                    self.assertIn("--", sql.partition("(")[2].partition("\n")[0], "the table's summary")


class ProvenanceTest(unittest.TestCase):
    """The provenance columns the model promises for facts added within schema 6."""

    def setUp(self):
        self.tmp = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.store = store.IdentityStore(self.tmp)
        self.addCleanup(self.store.db.close)

    def bind(self, *, subject="listing:figi:BBG000000001", authority="rule_confirmed", status="confirmed"):
        ref = identity.ProviderRef("vendor", "X", "symbol")
        self.store.put_binding(identity.Binding(
            provider_ref=ref, subject_id=subject, status=status, authority=authority, evidence_ids=["ev:x"],
            plugin="vendor", rule_id="resolve_answer@1" if authority == "rule_confirmed" else None))
        return ref, self.store.binding_for(ref)

    def test_a_bindings_decision_time_survives_what_does_not_change_the_decision(self):
        with mock.patch.object(store, "now", side_effect=["t1", "t2", "t3", "t4", "t5"]):
            ref, first = self.bind()
            self.assertEqual((first["decided_at"], first["verified_at"]), ("t1", "t1"))
            _ref, again = self.bind()  # the same decision asked again: verified, not re-decided
            self.assertEqual((again["decided_at"], again["verified_at"]), ("t1", "t2"))
            self.store.put_read_check(first["subject_id"], ref, "vendor", {}, [], None)  # an agreeing read
            self.assertEqual(tuple(self.store.binding_for(ref)[key] for key in ("decided_at", "verified_at")), ("t1", "t3"))
            _ref, user = self.bind(authority="user_attested")  # another kind of evidence decides it: a new decision
            self.assertEqual((user["decided_at"], user["authority"]), ("t4", "user_attested"))

    def test_a_relation_kept_before_its_provenance_columns_gains_them_when_stated_again(self):
        start, end = "market:provisional:tidepool:pool:p1", "protocol:provisional:tidepool:protocol:x"
        ref = lambda scope, native_id: {"provider": "tidepool", "native_scope": scope, "native_id": native_id}  # noqa: E731
        claim = identity.RelationClaim(
            type="part_of", from_key=ref("pool", "p1"), to_key=ref("protocol", "x"), provenance={
                **PROVENANCE, "plugin": "tidepool", "source": "tidepool", "source_record": "https://example.test/p1",
                "source_version": "v2"})
        row = {"type": "part_of", "from_id": start, "to_id": end, "valid_from": None, "source": "tidepool"}
        self.store.db.execute(  # as an earlier core kept it: no record, version or adapter
            "INSERT INTO relations (evidence_id, type, from_id, to_id, authority, source, plugin, retrieved_at)"
            " VALUES (?, 'part_of', ?, ?, 'source_asserted', 'tidepool', 'tidepool', ?)",
            (relations.relation_id(row), start, end, NOW))
        columns = "SELECT source_record, source_version, adapter_version FROM relations"
        self.assertEqual(tuple(self.store.select(columns)[0]), (None, None, None))
        self.assertEqual(relations.keep(self.store, None, "tidepool", claim, start, end), ("joined", True))
        self.assertEqual(tuple(self.store.select(columns)[0]), ("https://example.test/p1", "v2", PROVENANCE["adapter_version"]))
        self.assertEqual(relations.keep(self.store, None, "tidepool", claim, start, end), ("joined", False))  # nothing more

    def test_a_store_made_before_the_added_columns_gains_them_keeping_its_rows(self):
        ref, _row = self.bind()
        self.store.db.execute("INSERT INTO relations (evidence_id, type, from_id, to_id, authority, source, plugin,"
                              " retrieved_at) VALUES ('ev:r', 'part_of', 'market:pythia:a', 'protocol:pythia:b',"
                              " 'source_asserted', 'tidepool', 'tidepool', ?)", (NOW,))
        fresh = {table: [row[1] for row in self.store.db.execute(f"PRAGMA table_info({table})")]
                 for table in ("relations", "bindings")}
        for table, column in identity.ADDED_COLUMNS[identity.Store.IDENTITY]:  # an older store: without them
            self.store.db.execute(f"ALTER TABLE {table} DROP COLUMN {column.split()[0]}")
        self.store.db.close()
        reopened = store.IdentityStore(self.tmp)
        self.addCleanup(reopened.db.close)
        upgraded = {table: [row[1] for row in reopened.db.execute(f"PRAGMA table_info({table})")] for table in fresh}
        self.assertEqual({table: sorted(names) for table, names in upgraded.items()},
                         {table: sorted(names) for table, names in fresh.items()})
        [relation] = reopened.select("SELECT source_record, adapter_version FROM relations")
        self.assertEqual(tuple(relation), (None, None))  # unknown, not guessed
        self.assertEqual((reopened.binding_for(ref)["decided_at"], reopened.binding_for(ref)["subject_id"]),
                         (None, "listing:figi:BBG000000001"))


if __name__ == "__main__":
    unittest.main()
