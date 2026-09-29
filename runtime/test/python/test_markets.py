"""The markets overview: core's market catalogue, the Yahoo screener adapter and core's market reads.

Screener rows are synthetic, shaped like yahoo-finance2 4.0.2's ScreenerQuote (docs/sources/yahoo-screener.md).
"""
import dataclasses
import importlib.util
import json
import sqlite3
import types
import unittest
import unittest.mock
from pathlib import Path

from test_selection import shipped
from pythia_identity_fixture import markets, page  # noqa: E402

MOVERS = Path(__file__).parents[2] / "managed/plugins/yahoo-discovery/movers.py"
SPEC = importlib.util.spec_from_file_location("pythia_yahoo_movers_fixture", MOVERS)
movers = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(movers)

SP500 = "index:pythia:sp500"
LOOKUPS = {"stored": lambda target, provider: None, "coins": lambda provider, caip19: None, "queue": []}


def quote(symbol="NVDA", **fields):
    row = {"symbol": symbol, "longName": f"{symbol} Corporation", "shortName": symbol, "quoteType": "EQUITY",
           "currency": "USD", "exchange": "NMS", "fullExchangeName": "NasdaqGS", "marketState": "PRE",
           "regularMarketPrice": 225.07, "regularMarketChange": 0.49, "regularMarketChangePercent": 0.22,
           "regularMarketVolume": 89947712, "regularMarketTime": 1790366400}
    return {**row, **fields}


def screen(*quotes):
    return {"source": "yahoo.screener", "retrieved_at": "2026-09-28T12:00:00Z", "result": {"quotes": list(quotes)}}


class CuratedSubjectTest(unittest.TestCase):
    def test_an_index_is_priced_through_its_curated_yahoo_symbol(self):
        subject = markets.load_market(markets.curated(), SP500)
        self.assertEqual((subject["level"], subject["view"]["subject"]["name"]), ("index", "S&P 500"))
        sections = {item["section"]: item for item in page.compose(subject, shipped(), **LOOKUPS)}
        quote_section = sections["quote"]
        self.assertEqual((quote_section["plugin"], quote_section["binding"], quote_section["binding_status"]),
                         ("pythia-yahoo-discovery", {"provider": "yahoo", "native_id": "^GSPC", "native_scope": "symbol"},
                          "derived"))  # core's table names the address; no contributor's evidence states it
        self.assertEqual(set(sections), {"quote", "chart"})  # no profile or filings for an index

    def test_a_pair_without_an_asset_class_is_served_where_a_plugin_addresses_it(self):
        subject = markets.load_market(markets.curated(), "fx:pythia:EURUSD")
        self.assertEqual(page.price_sources(subject, shipped(), **LOOKUPS),
                         [{"provider": "yahoo", "native_id": "EURUSD=X", "native_scope": "symbol"}])
        disabled = shipped(**{"yahoo-discovery": {"enabled": False}})
        self.assertEqual(page.price_sources(subject, disabled, **LOOKUPS), [])
        self.assertEqual({item["status"] for item in page.compose(subject, disabled, **LOOKUPS)}, {"disabled"})

    def test_a_front_month_future_is_a_market_on_its_index(self):
        subject = markets.load_market(markets.curated(), "market:pythia:cme-es-front-month")
        self.assertEqual(subject["view"]["related"][0]["id"], SP500)
        self.assertIn("market:pythia:cme-es-front-month",
                      [item["id"] for item in markets.markets_on(markets.curated(), [SP500])])
        perp = markets.load_market(markets.curated(), "market:pythia:hyperliquid-btc-perp")
        # Yahoo addresses markets, but does not cover a crypto perp (and has no symbol for it).
        self.assertEqual(page.price_sources(perp, shipped(), **LOOKUPS), [])


class ScreenerAdapterTest(unittest.TestCase):
    def test_rows_keep_the_documented_fields_and_name_their_operating_mic(self):
        data, issues = movers.adapt(screen(quote(), quote("DNN", exchange="ASE", longName=None, shortName="Denison")),
                                    "most_active", 25)
        self.assertEqual(issues, [])
        first, second = data["rows"]
        self.assertEqual((first["rank"], first["ticker"], first["mic"], first["session"], first["time"]),
                         (1, "NVDA", "XNAS", "pre", "2026-09-25T20:00:00Z"))
        self.assertEqual((second["mic"], second["name"]), ("XNYS", "Denison"))  # NYSE American is a segment of XNYS
        self.assertEqual((data["market"], data["retrieved_at"]), ("US", "2026-09-28T12:00:00Z"))

    def test_additive_changes_are_logged_and_unreadable_rows_are_an_issue(self):
        with self.assertLogs(movers.logger, "WARNING") as logged:
            data, issues = movers.adapt(screen(quote(newYahooField=1), quote("OTC", exchange="XYZ"),
                                               quote("GONE", regularMarketPrice=None)), "gainers", 25)
        self.assertEqual([row["symbol"] for row in data["rows"]], ["NVDA", "OTC"])
        self.assertIsNone(data["rows"][1]["mic"])  # an unknown venue is never guessed
        self.assertTrue(any("newYahooField" in line and "XYZ" in line for line in logged.output))
        self.assertEqual([issue["code"] for issue in issues], ["source_drift"])  # only the left-out row
        self.assertIn("1 row ", issues[0]["message"])
        self.assertNotIn("newYahooField", issues[0]["message"])
        self.assertEqual(movers.adapt({"result": {}}, "losers", 25)[0], None)


class MarketReadsTest(unittest.TestCase):
    def setUp(self):
        from test_identity_queue import load_core
        load_core()
        from pythia_core_queue_fixture import concept_ops, identity_ops, markets_ops
        self.ops, self.identity_ops = markets_ops, identity_ops
        self.reference = sqlite3.connect(":memory:", check_same_thread=False)
        self.reference.execute("CREATE TABLE assertions (subject_id TEXT, scheme TEXT, value TEXT, valid_to TEXT)")
        self.reference.executemany("INSERT INTO assertions VALUES (?, 'ticker_mic', ?, NULL)", [
            ("listing:figi:BBG000BBK0R0", "NVDA@XNAS"), ("listing:figi:A", "TWIN@XNYS"), ("listing:figi:B", "TWIN@XNYS")])
        core = types.SimpleNamespace(ctx=None, order=lambda: (),
                                     reference=lambda: (None, _Borrowed(self.reference)))
        self.reads = markets_ops.MarketReads(core)
        patcher = unittest.mock.patch.object(concept_ops.ConceptReads, "eligible", staticmethod(lambda: None))
        patcher.start()
        self.addCleanup(patcher.stop)

    def movers(self, answer, *more, **arguments):
        self.calls = []

        def dispatch(tool, sent, cancelled=None):
            self.calls.append((tool, sent))
            return json.dumps(answer if tool == "pythia_yahoo_movers" else more[0])
        plugins = [info if info.key != "pythia-yahoo-discovery" else page.PluginInfo(
            key=info.key, manifest=info.manifest, operations={"movers": "pythia_yahoo_movers"}) for info in shipped()]
        yahoo = next(info for info in plugins if info.key == "pythia-yahoo-discovery")
        other = dataclasses.replace(yahoo.manifest, signoff=type(yahoo.manifest.signoff).UNSIGNED)  # not yet audited
        plugins += [page.PluginInfo(key="pythia-other", manifest=other, operations={"movers": "other_movers"})
                    for _ in more]
        registry = types.SimpleNamespace(dispatch=dispatch)
        with unittest.mock.patch.dict("sys.modules", {"tools": types.ModuleType("tools"),
                                                      "tools.registry": types.SimpleNamespace(registry=registry)}), \
                unittest.mock.patch.object(self.identity_ops, "installed", lambda: plugins):
            return json.loads(self.reads.movers({"list": "most_active", **arguments}))

    def test_rows_are_named_by_their_one_reference_listing_or_say_why_not(self):
        data, issues = movers.adapt(screen(quote(), quote("TWIN", exchange="NYQ"), quote("NEW"),
                                           quote("ODD", exchange="XYZ")), "most_active", 25)
        body = self.movers({"schema_version": 1, "outcome": "partial", "data": data, "issues": issues}, limit=4)
        self.assertEqual(self.calls, [("pythia_yahoo_movers", {"list": "most_active", "limit": 4})])
        rows = body["data"]["rows"]
        self.assertEqual([row["subject_id"] for row in rows], ["listing:figi:BBG000BBK0R0", None, None, None])
        self.assertEqual([row["unresolved"] for row in rows[1:]],
                         [self.ops.UNRESOLVED["ambiguous"], self.ops.UNRESOLVED["not_in_reference"],
                          self.ops.UNRESOLVED["no_venue"]])
        self.assertEqual(body["data"]["source"]["source"], "Yahoo Finance")
        self.assertNotIn("issues", body)  # an unknown venue is the maintainer's signal, not an issue

    def test_a_failed_source_is_named_and_nothing_else_is_read(self):
        failed = {"schema_version": 1, "outcome": "error", "data": None,
                  "issues": [{"code": "rate_limit", "message": "Yahoo rate limited this read; retry later."}]}
        body = self.movers(failed)
        self.assertEqual((body["outcome"], body["data"]["rows"], len(self.calls)), ("error", [], 1))
        self.assertIn("Yahoo Finance", body["issues"][0]["message"])

    def test_a_source_that_does_not_cover_the_list_gives_way_to_the_next(self):
        data, issues = movers.adapt(screen(quote()), "most_active", 25)
        uncovered = {"schema_version": 1, "outcome": "empty", "data": None, "issues": [
            {"code": "not_covered", "severity": "warning", "message": "Yahoo has no such list here."}]}
        self.reads.identity.order = lambda: ("pythia-yahoo-discovery", "pythia-other")
        body = self.movers(uncovered, {"schema_version": 1, "outcome": "ok", "data": data, "issues": issues})
        self.assertEqual([tool for tool, _ in self.calls], ["pythia_yahoo_movers", "other_movers"])
        self.assertEqual((body["outcome"], body["data"]["source"]["plugin"], body["data"]["skipped"][-1]["code"]),
                         ("ok", "pythia-other", "not_covering"))
        self.assertTrue(body["data"]["source"]["unaudited"])  # labelled wherever its data appears (ADR 0042)

    def test_an_unreadable_reference_leaves_rows_unlinked_and_keeps_the_list(self):
        data, issues = movers.adapt(screen(quote()), "most_active", 25)

        class Broken:
            def execute(self, *_args):
                raise sqlite3.OperationalError("disk I/O error")

            def close(self):
                pass
        self.reads.identity.reference = lambda: (None, Broken())
        body = self.movers({"schema_version": 1, "outcome": "ok", "data": data, "issues": issues})
        self.assertEqual(body["outcome"], "ok")
        self.assertEqual([(row["subject_id"], row["unresolved"]) for row in body["data"]["rows"]],
                         [(None, self.ops.UNRESOLVED["reference_failed"])])

    def test_the_overview_says_when_it_shows_only_the_first_subjects(self):
        from pythia_core_queue_fixture.platform import configuration
        many = " ".join(f"index:pythia:test{number}" for number in range(30))
        values = {"markets_cards": ("configured", many), "markets_watchlist": ("missing", None)}
        with unittest.mock.patch.object(configuration, "value", lambda _ctx, key: values[key]):
            body = json.loads(self.reads.overview({}))
        self.assertEqual(len(body["data"]["cards"]), self.ops.MAX_SUBJECTS)
        self.assertIn("lists 30 subjects", body["issues"][0]["message"])

    def test_the_overview_lists_configured_subjects_or_the_defaults(self):
        from pythia_core_queue_fixture.platform import configuration
        values = {"markets_cards": ("configured", "index:pythia:dax, not-an-id  fx:pythia:EURUSD"),
                  "markets_watchlist": ("missing", None)}
        with unittest.mock.patch.object(configuration, "value", lambda _ctx, key: values[key]):
            body = json.loads(self.reads.overview({}))
        self.assertEqual(body["data"]["cards"], [{"subject": "index:pythia:dax", "group": "Europe"},
                                                 {"subject": "fx:pythia:EURUSD", "group": "Rates & FX"}])
        self.assertEqual(body["data"]["watchlist"], list(self.ops.DEFAULT_WATCHLIST))
        self.assertIn("not-an-id", body["issues"][0]["message"])

    def test_the_overview_names_subjects_from_core_tables(self):
        from pythia_core_queue_fixture.platform import configuration
        bitcoin = "security:caip19:bip122:000000000019d6689c085ae165831e93/slip44:0"
        values = {"markets_cards": ("configured", f"index:pythia:dax {bitcoin}"),
                  "markets_watchlist": ("configured", "listing:figi:BBG000B9Y5X2")}
        with unittest.mock.patch.object(configuration, "value", lambda _ctx, key: values[key]):
            body = json.loads(self.reads.overview({}))
        # Names come from core's own tables, so they show without reference data; others have none.
        self.assertEqual(body["data"]["names"], {"index:pythia:dax": "DAX", bitcoin: "Bitcoin"})


class _Borrowed:
    """A test reference connection that survives the read closing it."""

    def __init__(self, connection):
        self.connection = connection

    def execute(self, *args):
        return self.connection.execute(*args)

    def close(self):
        pass


if __name__ == "__main__":
    unittest.main()
