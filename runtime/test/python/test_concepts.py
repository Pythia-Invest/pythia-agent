"""Core data concepts (ADR 0040): live declarations and snapshots, and page composition on contract v1."""
import copy
import json
import sqlite3
import unittest
from pathlib import Path

from test_identity_contracts import identity, load, load_reference
from pythia_identity_fixture import page  # noqa: E402

PLUGINS = Path(__file__).resolve().parents[2] / "managed/plugins"
MD = identity.Concept.MARKET_DATA
RIGHTS = {"licence": "personal", "cache": "none", "hostable": False}


def contract(provider, concepts):
    addressing = {"native": [{"native_scope": "ref", "level": "listing"}], "mic_table": {"XAMS": ".AS", "XNAS": ""}}
    return identity.validate_manifest({"contract_version": 1, "plugin": provider, "provider": provider,
                                       "addressing": addressing, "concepts": concepts, "rights": RIGHTS})


def prices(classes):
    return {"market_data": {"level": "listing", "via": "listing", "coverage": {"asset_classes": classes},
                            "operations": {"quote": "latest", "daily": "history"}}}


class LiveTest(unittest.TestCase):
    """`live` is declarable today by a 20-level crypto perp venue and a one-level single-venue stock feed alike."""

    HYPERLIQUID = {"book": "snapshot", "book_levels": 20, "trades": True, "trade_side": True, "scope": "venue",
                   "venue": "hyperliquid", "context": ["mark", "oracle", "funding", "open_interest"],
                   "line": "last_trade"}
    EODHD = {"book": "top", "book_levels": 1, "trades": True, "trade_side": False, "scope": "venue", "venue": "XEDX",
             "context": ["session", "venue_status", "reference_close"], "line": "last_trade"}

    def test_both_live_providers_declare_the_operation_without_a_contract_change(self):
        for name, qualities in (("hyperliquid", self.HYPERLIQUID), ("eodhd", self.EODHD)):
            with self.subTest(provider=name):
                concepts = prices(["crypto" if name == "hyperliquid" else "equity"])
                entry = concepts["market_data"]
                entry["operations"]["live"] = "live_market"
                entry["qualities"] = {"live": qualities}
                manifest = contract(name, concepts)
                self.assertEqual(manifest.concepts[MD].qualities["live"]["book_levels"], qualities["book_levels"])
        bad = prices(["equity"])
        bad["market_data"]["operations"]["live"] = "live_market"
        bad["market_data"]["qualities"] = {"live": {**self.EODHD, "book": "l2"}}
        with self.assertRaisesRegex(identity.ManifestError, r"^concepts\.market_data\.qualities\.live\.book"):
            contract("eodhd", bad)

    def test_live_can_cover_fewer_markets_than_the_rest_of_the_concept(self):
        """EODHD streams US listings only (Cboe EDGX) while its quotes and history stay global."""
        concepts = prices(["equity"])
        concepts["market_data"]["operations"]["live"] = "live_market"
        concepts["market_data"]["coverage"]["operations"] = {"live": {"markets": ["XNAS", "XNYS"]}}
        entry = contract("eodhd", concepts).concepts[MD]
        self.assertEqual((entry.coverage_for("daily").markets, entry.coverage_for("live").markets),
                         (None, frozenset({"XNAS", "XNYS"})))
        self.assertEqual(entry.coverage_for("live").asset_classes, frozenset({"equity"}))
        concepts["market_data"]["coverage"]["operations"] = {"intraday": {"markets": ["XNAS"]}}  # not declared
        with self.assertRaisesRegex(identity.ManifestError, r"^concepts\.market_data\.coverage\.operations\.intraday"):
            contract("eodhd", concepts)

    def perp(self):
        return {"schema_version": 1, "subject": {"subject_id": "market:venue:hyperliquid:BTC"},
                "source": {"plugin": "pythia-hyperliquid", "venue": "hyperliquid", "scope": "venue",
                           "market_data_type": "realtime", "delay_seconds": 0},
                "book": {"time": 1790000000250, "depth": "snapshot", "unit": {"kind": "coin", "code": "BTC"},
                         "grouping": {"n_sig_figs": 5},
                         "bids": [[str(60000 - level), "0.5", 3] for level in range(20)],
                         "asks": [[str(60001 + level), "0.25", 1] for level in range(20)]},
                "trades": {"items": [[1790000000100, "60000.5", "0.01", "buy"], [1790000000200, "60000", "0.2", "sell"]],
                           "dropped": 0},
                "line": {"measure": "last_trade", "bucket_ms": 1000, "points": [[1790000000000, "60000.5"]],
                         "seeded_from": "candle_1m"},
                "context": {"kind": "perp", "time": 1790000000250, "mark": "60000.4", "oracle": "59990.1",
                            "funding": {"rate_1h": "0.0000125", "next_time": 1790003600000}, "open_interest": "12345.6"},
                "gaps": [], "issues": [], "retrieved_at": 1790000000260}

    def stock(self):
        return {"schema_version": 1, "subject": {"subject_id": "listing:isin:US0378331005:XNAS:USD"},
                "source": {"plugin": "pythia-eodhd", "venue": "XEDX", "scope": "venue", "market_data_type": "realtime"},
                "book": {"time": 1790000000000, "depth": "top", "unit": {"kind": "shares"},
                         "bids": [["227.41", "300"]], "asks": [["227.43", "200"]]},
                "trades": {"items": [[1790000000000, "227.42", "100", None]], "dropped": 3},
                "context": {"kind": "equity_session", "time": 1790000000000, "session": "regular",
                            "venue_status": "trading",
                            "reference_close": {"value": "225.10", "time": 1789948800000,
                                                "dataset": "EODHD:us-quote-delayed:previousClosePrice",
                                                "market_data_type": "delayed"},
                            "change": {"absolute": "2.32", "percent": "1.03"}},
                "gaps": [{"start": 1789999990000, "end": 1789999995000}],
                "issues": [{"code": "quiet", "severity": "info"}], "retrieved_at": 1790000000100}

    def test_one_snapshot_schema_fits_a_perp_book_and_a_single_venue_stock_feed(self):
        identity.validate_live_market(self.perp())
        identity.validate_live_market(self.stock())

    def test_snapshot_violations_name_their_path(self):
        cases = {
            "book.bids": lambda value: value["book"]["bids"].append(["227.40", "10"]),  # a top-of-book with two levels
            "book.asks[1]": lambda value: value["book"].update(depth="snapshot", asks=[["227.43", "1"], ["227.42", "1"]]),
            "trades.items[0][3]": lambda value: value["trades"]["items"][0].__setitem__(3, "unknown"),
            "context.change": lambda value: value["context"].pop("reference_close"),
            "context.funding": lambda value: value["context"].update(funding={"rate_1h": "0"}),  # perp field on a stock
            "book.bids[0][0]": lambda value: value["book"]["bids"][0].__setitem__(0, 227.41),  # numbers stay strings
            "source.scope": lambda value: value["source"].update(scope="nbbo"),
            "retrieved_at": lambda value: value.update(retrieved_at="2026-09-28T12:00:00Z"),
            "live_market.volume": lambda value: value.update(volume="1"),
            "trades.items[0][2]": lambda value: value["trades"]["items"][0].__setitem__(2, "-100"),
            "book.asks[0][0]": lambda value: value["book"]["asks"][0].__setitem__(0, "-227.43"),
            "book.time": lambda value: value["book"].update(time=1790000000),  # seconds, not milliseconds
        }
        for path, change in cases.items():
            document = copy.deepcopy(self.stock())
            change(document)
            with self.subTest(path=path):
                with self.assertRaises(identity.LiveMarketError) as caught:
                    identity.validate_live_market(document)
                self.assertTrue(str(caught.exception).startswith(path), caught.exception)


APPLE = {
    "issuers": [{"id": "issuer:lei:HWUPKR0MPOU8FGXBT394", "name": "Apple Inc.", "country": "US"}],
    "securities": [{"id": "security:isin:US0378331005", "issuer_id": "issuer:lei:HWUPKR0MPOU8FGXBT394",
                    "name": "Apple Inc.", "asset_class": "equity", "kind": "ordinary"}],
    "composites": [{"id": "composite:isin:US0378331005:US", "security_id": "security:isin:US0378331005", "country": "US"}],
    "listings": [{"id": "listing:isin:US0378331005:XNAS:USD", "security_id": "security:isin:US0378331005",
                  "composite_id": "composite:isin:US0378331005:US", "ticker": "AAPL", "mic": "XNGS",
                  "operating_mic": "XNAS", "currency": "USD", "primary": True}],
    "assertions": [{"subject_id": subject, "scheme": scheme, "value": value, "authority": "snapshot",
                    "provenance": {"plugin": "fixture", "source": "fixture", "adapter_version": "1",
                                   "retrieved_at": "2026-09-28T00:00:00Z", "source_record": value}}
                   for subject, scheme, value in (("issuer:lei:HWUPKR0MPOU8FGXBT394", "lei", "HWUPKR0MPOU8FGXBT394"),
                                                  ("issuer:lei:HWUPKR0MPOU8FGXBT394", "cik", "320193"),
                                                  ("security:isin:US0378331005", "isin", "US0378331005"),
                                                  ("listing:isin:US0378331005:XNAS:USD", "ticker_mic", "AAPL@XNAS"))],
}
SUBJECTS = {"asml_xams": "listing:isin:NL0010273215:XAMS:EUR", "asml_nasdaq": "listing:figi:BBG000K6N6G7",
            "btc": "security:caip19:bip122:000000000019d6689c085ae165831e93/slip44:0",
            "apple": "listing:isin:US0378331005:XNAS:USD"}
TOOLS = {"gleif": {"profile": "pythia_gleif_profile"}, "sec": {"filings": "pythia_sec_filings"},
         "xbrl-filings": {"filings": "pythia_xbrl_filings_filings"}}
EQUITY_ADDRESS = {"asml_xams": ("ASML.AS", "ASML.AS"), "asml_nasdaq": ("ASML", "ASML.US"), "apple": ("AAPL", "AAPL.US")}
CRYPTO_SOURCES = [("coinmarketcap", "not_covering"), ("coingecko", "not_covering")]
EQUITY_SOURCES = [("eodhd", "not_covering"), ("yahoo-discovery", "not_covering")]
# Filings combine one source per authority into core's read, whatever the price configuration.
FILINGS = {"profile": ("gleif", "ready", [], []),
           "filings": ("xbrl-filings", "ready", [], [], [("xbrl-filings", ["esma", "fca"]), ("sec", ["sec"])])}


def equity(config, name):
    yahoo, eodhd = EQUITY_ADDRESS[name]
    prices = {"all_ready": (("eodhd", "ready", ["yahoo-discovery"], CRYPTO_SOURCES), [("eodhd", eodhd), ("yahoo", yahoo)]),
              "yahoo_off_keys_missing": (("eodhd", "needs_configuration", [],
                                          [("coinmarketcap", "not_covering"), ("yahoo-discovery", "disabled"),
                                           ("coingecko", "not_covering")]), []),
              "no_keys": (("yahoo-discovery", "ready", [], [("eodhd", "needs_configuration"), *CRYPTO_SOURCES]),
                          [("yahoo", yahoo)])}[config]
    return {"quote": prices[0], "chart": prices[0], **FILINGS}, prices[1]


def crypto(config):
    keyed = config == "all_ready"
    quote = (("coinmarketcap", "ready", ["coingecko"], EQUITY_SOURCES) if keyed else
             ("coingecko", "ready", [], [("eodhd", "not_covering"), ("coinmarketcap", "needs_configuration"),
                                         ("yahoo-discovery", "not_covering")]))
    return {"quote": quote, "chart": quote}, [("coinmarketcap", "1"), ("coingecko", "bitcoin")] if keyed else [
        ("coingecko", "bitcoin")]


# Paid sources come first in core's default order: with an EODHD token EODHD serves prices, without one Yahoo does.
# Every source that declares the concept and does not serve is listed as skipped with its reason.
CONFIGS = {"all_ready": {}, "yahoo_off_keys_missing": {"yahoo-discovery": {"enabled": False},
                                                       "eodhd": {"missing": True}, "coinmarketcap": {"missing": True}},
           "no_keys": {"eodhd": {"missing": True}, "coinmarketcap": {"missing": True}}}
EXPECTED = {config: {**{name: equity(config, name) for name in EQUITY_ADDRESS}, "btc": crypto(config)}
            for config in CONFIGS}


def short(plugin):
    return plugin.removeprefix("pythia-")


class PageCompositionTest(unittest.TestCase):
    """Page sections on contract v1: paid sources first in core's default order, an unconfigured one never chosen."""

    def setUp(self):
        self.ref = sqlite3.connect(":memory:")
        self.ref.executescript(identity.schema_sql("reference"))
        for fixture in (load("asml.json"), load("crypto.json"), APPLE):
            load_reference(self.ref, fixture)
        self.ref.row_factory = sqlite3.Row
        self.coins = {(r[0], r[1]): r[2] for r in self.ref.execute("SELECT provider, caip19, native_id FROM native_coins")}

    def tearDown(self):
        self.ref.close()

    def plugins(self, config):
        out = []
        for path in sorted(PLUGINS.glob("*/contract.json")):
            state = config.get(path.parent.name, {})
            missing = ({"key": "key", "label": "Key", "file": "secrets.json", "status": "missing"},) if state.get("missing") else ()
            out.append(page.PluginInfo(key=f"pythia-{path.parent.name}",
                                       manifest=identity.validate_manifest(json.loads(path.read_text())),
                                       enabled=state.get("enabled", True), missing=missing,
                                       operations=TOOLS.get(path.parent.name, {})))
        return out

    def test_sections_and_price_sources_follow_the_default_order(self):
        lookups = {"stored": lambda *_: None, "coins": lambda provider, caip19: self.coins.get((provider, caip19)),
                   "queue": []}
        for config, expected in EXPECTED.items():
            plugins = self.plugins(CONFIGS[config])
            for name, (sections, refs) in expected.items():
                with self.subTest(config=config, subject=name):
                    subject = page.load_subject(self.ref, SUBJECTS[name])
                    got = {}
                    for s in page.compose(subject, plugins, **lookups):
                        row = (short(s["plugin"]), s["status"], [short(a["plugin"]) for a in s["alternatives"]],
                               [(short(k["plugin"]), k["code"]) for k in s["skipped"]])
                        got[s["section"]] = (*row, [(short(x["plugin"]), x["authorities"]) for x in s["sources"]]) \
                            if "sources" in s else row
                        self.assertIsNone(s["notice"])
                    self.assertEqual(got, sections)
                    self.assertEqual([(ref["provider"], ref["native_id"])
                                      for ref in page.price_sources(subject, plugins, **lookups)], refs)
        subject = page.load_subject(self.ref, SUBJECTS["asml_xams"])
        sections = {s["section"]: s for s in page.compose(subject, self.plugins({}), **lookups)}
        self.assertEqual(sections["profile"]["request"]["operation"], "profile")
        self.assertEqual(sections["filings"]["request"], {"plugin": "pythia", "operation": "filings",
                                                          "arguments": {"subject_id": SUBJECTS["asml_xams"]}})


if __name__ == "__main__":
    unittest.main()
