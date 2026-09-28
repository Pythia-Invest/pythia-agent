"""The markets overview: core's market catalogue, the Yahoo screener adapter and core's market reads.

Screener rows are synthetic, shaped like yahoo-finance2 4.0.2's ScreenerQuote (docs/sources/yahoo-screener.md).
"""
import importlib.util
import json
import sqlite3
import types
import unittest
import unittest.mock
from pathlib import Path

from test_identity_contracts import identity
from test_selection import shipped
from pythia_identity_fixture import market_catalogue, page  # noqa: E402

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


class CatalogueTest(unittest.TestCase):
    def test_a_market_subject_is_priced_through_its_curated_address(self):
        subject = market_catalogue.load(SP500)
        self.assertEqual((subject["asset_class"], subject["view"]["subject"]["name"]), ("index", "S&P 500"))
        sections = {item["section"]: item for item in page.compose(subject, shipped(), **LOOKUPS)}
        quote_section = sections["quote"]
        self.assertEqual((quote_section["plugin"], quote_section["binding"], quote_section["binding_status"]),
                         ("pythia-yahoo-discovery", {"provider": "yahoo", "native_id": "^GSPC", "native_scope": "symbol"},
                          "confirmed"))
        # EODHD has a curated code but does not declare index coverage: skipped, never silently used.
        self.assertIn(("pythia-eodhd", "not_covering"), [(item["plugin"], item["code"]) for item in quote_section["skipped"]])
        self.assertEqual(set(sections), {"quote", "chart"})  # no profile or filings for an index

    def test_a_disabled_source_leaves_the_subject_without_a_price_and_says_why(self):
        subject = market_catalogue.load(SP500)
        sections = page.compose(subject, shipped(**{"yahoo-discovery": {"enabled": False}}), **LOOKUPS)
        self.assertEqual({item["status"] for item in sections}, {"disabled"})
        self.assertEqual(page.price_sources(subject, shipped(**{"yahoo-discovery": {"enabled": False}}), **LOOKUPS), [])

    def test_the_catalogue_holds_only_pythia_keyed_market_subjects(self):
        self.assertIsNone(market_catalogue.load("security:isin:NL0010273215"))
        for subject_id, item in market_catalogue.entries().items():
            self.assertIn(identity.registered_kind(subject_id), {"index", "future", "fx", "series"})
            self.assertTrue(item.get("yahoo"), subject_id)


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

    def test_a_changed_answer_raises_a_visible_drift_issue(self):
        data, issues = movers.adapt(screen(quote(newYahooField=1), quote("OTC", exchange="XYZ"),
                                           quote("GONE", regularMarketPrice=None)), "gainers", 25)
        self.assertEqual([row["symbol"] for row in data["rows"]], ["NVDA", "OTC"])
        self.assertIsNone(data["rows"][1]["mic"])  # an unknown venue is never guessed
        self.assertEqual([issue["code"] for issue in issues], ["source_drift"])
        for part in ("newYahooField", "XYZ", "1 row "):
            self.assertIn(part, issues[0]["message"])
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

    def movers(self, answer, **arguments):
        self.calls = []

        def dispatch(tool, sent, cancelled=None):
            self.calls.append((tool, sent))
            return json.dumps(answer)
        plugins = [info if info.key != "pythia-yahoo-discovery" else page.PluginInfo(
            key=info.key, manifest=info.manifest, operations={"movers": "pythia_yahoo_movers"}) for info in shipped()]
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
        self.assertEqual([issue["code"] for issue in body["issues"]], ["source_drift"])

    def test_a_failed_source_is_named_and_nothing_else_is_read(self):
        failed = {"schema_version": 1, "outcome": "error", "data": None,
                  "issues": [{"code": "rate_limit", "message": "Yahoo rate limited this read; retry later."}]}
        body = self.movers(failed)
        self.assertEqual((body["outcome"], body["data"]["rows"], len(self.calls)), ("error", [], 1))
        self.assertIn("Yahoo Finance", body["issues"][0]["message"])

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
