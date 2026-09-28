"""Core data concepts (ADR 0040): source selection, live declarations and snapshots, and page parity on contract v1."""
import copy
import json
import sqlite3
import sys
import time
import types
import unittest
import unittest.mock
from pathlib import Path

from test_identity_contracts import identity, load, load_reference
from pythia_identity_fixture import page  # noqa: E402

PLUGINS = Path(__file__).resolve().parents[2] / "managed/plugins"
MD, FILINGS = identity.Concept.MARKET_DATA, identity.Concept.FILINGS
RIGHTS = {"licence": "personal", "cache": "none", "hostable": False}


def contract(provider, concepts, **extra):
    addressing = {"native": [{"native_scope": "ref", "level": "listing"}, {"native_scope": "lei", "level": "issuer"},
                             {"native_scope": "coin", "level": "security"}],
                  "schemes": {"issuer": ["lei"]}, "mic_table": {"XAMS": ".AS"}}
    return identity.validate_manifest({"contract_version": 1, "plugin": provider, "provider": provider,
                                       "addressing": addressing, "concepts": concepts, "rights": RIGHTS,
                                       "resolve": {"operation": "resolve", "input_schemes": ["lei"], "echoes": []}, **extra})


def prices(classes, markets=None, level="listing"):
    coverage = {"asset_classes": classes, **({"markets": markets} if markets else {})}
    return {"market_data": {"level": level, "via": level, "coverage": coverage,
                            "operations": {"quote": "latest", "daily": "history"}}}


def filings(*authorities):
    return {"filings": {"level": "issuer", "via": "issuer", "operations": {"list": "filings"},
                        "authorities": list(authorities)}}


# A synthetic installation: two equity sources, two crypto sources, an EU-only source and three filing sources.
SOURCES = {
    "yahoo": prices(["equity"]), "eodhd": prices(["equity"]), "euronly": prices(["equity"], ["XAMS", "XPAR"]),
    "coingecko": prices(["crypto"], level="security"), "coinmarketcap": prices(["crypto"], level="security"),
    "sec": filings("sec"), "xbrl-filings": filings("esma", "fca"), "secmirror": filings("sec"),
}
INDEX = identity.build_index((f"pythia-{name}", contract(name, concepts)) for name, concepts in SOURCES.items())
READY = {f"pythia-{name}": "ready" for name in SOURCES}


def select(concept=MD, operation="quote", asset_class="equity", market="XAMS", **options):
    options.setdefault("address", READY)
    options.setdefault("states", {})
    return identity.select(INDEX, concept, operation, asset_class=asset_class, market=market, **options)


def chosen(selection):
    return [(choice.plugin.removeprefix("pythia-"), choice.authorities) for choice in selection.chosen]


def skipped(selection):
    return {skip.plugin.removeprefix("pythia-"): str(skip.reason) for skip in selection.skipped}


class SelectionTest(unittest.TestCase):
    def test_zero_configuration_uses_core_default_order_and_drops_sources_that_do_not_cover(self):
        selection = select()
        self.assertEqual(chosen(selection), [("yahoo", ())])
        self.assertEqual(selection.alternatives, ("pythia-eodhd", "pythia-euronly"))
        self.assertEqual(skipped(selection), {"coingecko": "not_covering", "coinmarketcap": "not_covering"})
        crypto = select(asset_class="crypto", market=None)
        self.assertEqual(chosen(crypto), [("coinmarketcap", ())])
        self.assertEqual(skipped(crypto)["yahoo"], "not_covering")

    def test_a_connected_keyed_source_ranks_ahead_of_keyless_ones_and_the_investors_order_beats_both(self):
        connected = {"pythia-eodhd": identity.SourceState(connected=True)}
        self.assertEqual(chosen(select(states=connected)), [("eodhd", ())])
        self.assertEqual(chosen(select(states=connected, order=["pythia-euronly", "pythia-coingecko"])), [("euronly", ())])
        # One list across concepts: a crypto source in it does not disturb equities, and vice versa.
        self.assertEqual(chosen(select(asset_class="crypto", market=None, order=["pythia-euronly", "pythia-coingecko"])),
                         [("coingecko", ())])

    def test_every_skip_has_its_reason_and_the_next_eligible_source_serves(self):
        selection = select(
            order=["pythia-euronly", "pythia-eodhd", "pythia-yahoo"], market="XNAS",
            states={"pythia-eodhd": identity.SourceState(configured=False)})
        self.assertEqual(chosen(selection), [("yahoo", ())])
        self.assertEqual(skipped(selection)["euronly"], "not_covering")  # its markets exclude Nasdaq
        self.assertEqual(skipped(selection)["eodhd"], "needs_configuration")
        cases = {"disabled": {"states": {"pythia-yahoo": identity.SourceState(enabled=False)}},
                 "not_entitled": {"not_entitled": {("pythia-yahoo", MD)}},
                 "not_addressable": {"address": {**READY, "pythia-yahoo": None}},
                 "conflict": {"address": {**READY, "pythia-yahoo": "conflict"}},
                 "unresolved": {"address": {**READY, "pythia-yahoo": "unresolved"}}}
        for reason, options in cases.items():
            with self.subTest(reason=reason):
                selection = select(**options)
                self.assertEqual(chosen(selection), [("eodhd", ())])
                self.assertEqual(skipped(selection)["yahoo"], reason)
        # A lookup still to run is choosable: the page shows it as resolving.
        self.assertEqual(chosen(select(address={**READY, "pythia-yahoo": "resolving"})), [("yahoo", ())])

    def test_nothing_eligible_chooses_nothing_and_says_why(self):
        off = {f"pythia-{name}": identity.SourceState(enabled=False) for name in SOURCES}
        selection = select(states=off)
        self.assertEqual((selection.chosen, selection.alternatives), ((), ()))
        self.assertEqual(set(skipped(selection).values()), {"disabled", "not_covering"})

    def test_filings_combine_one_source_per_authority_in_the_investors_order(self):
        both = select(FILINGS, "list", market=None)
        self.assertEqual(chosen(both), [("xbrl-filings", ("esma", "fca")), ("sec", ("sec",))])
        self.assertEqual(both.alternatives, ("pythia-secmirror",))  # a second SEC source is never merged in
        mirror = select(FILINGS, "list", market=None, order=["pythia-secmirror"])
        self.assertEqual(chosen(mirror), [("secmirror", ("sec",)), ("xbrl-filings", ("esma", "fca"))])
        no_lei = select(FILINGS, "list", market=None, address={"pythia-sec": "ready", "pythia-secmirror": "ready"})
        self.assertEqual(chosen(no_lei), [("sec", ("sec",))])
        self.assertEqual(skipped(no_lei), {"xbrl-filings": "not_addressable"})
        # Prices never combine: one source serves.
        self.assertEqual(len(select().chosen), 1)

    def test_selection_is_a_pure_lookup_well_under_a_millisecond(self):
        """1,000 subjects x every concept operation the page and agent use, over the shipped contracts."""
        shipped = [(f"pythia-{path.parent.name}", identity.validate_manifest(json.loads(path.read_text())))
                   for path in sorted(PLUGINS.glob("*/contract.json"))]
        started = time.perf_counter()
        index = identity.build_index(shipped + list((f"pythia-{n}", contract(n, c)) for n, c in SOURCES.items()))
        built = time.perf_counter() - started
        keys = [key for key, _ in shipped] + [f"pythia-{name}" for name in SOURCES]
        address = {key: "ready" for key in keys}
        states = {key: identity.SourceState(connected=key.endswith("eodhd")) for key in keys}
        order = ["pythia-coingecko", "pythia-sec"]
        subjects = [("equity", mic) for mic in ("XAMS", "XNAS", "XPAR", "XETR", "XLON")] * 100
        subjects += [("crypto", None)] * 400 + [(None, None)] * 100  # 1,000 subjects
        operations = [(MD, "quote"), (MD, "daily"), (MD, "intraday"), (MD, "live"),
                      (identity.Concept.PROFILE, "fields"), (FILINGS, "list")]
        count, started = 0, time.perf_counter()
        for asset_class, market in subjects:
            for concept, operation in operations:
                identity.select(index, concept, operation, asset_class=asset_class, market=market, address=address,
                                states=states, order=order, not_entitled={("pythia-eodhd", MD)})
                count += 1
        per = (time.perf_counter() - started) / count
        print(f"\nselection: {count} selections, {per * 1e6:.1f} us each; index built in {built * 1e3:.2f} ms")
        self.assertLess(per, 0.0002)  # 0.2 ms: a generous bound for slow CI; typical is far lower


class LiveTest(unittest.TestCase):
    """`live` is declarable today by a 20-level crypto perp venue and a one-level single-venue stock feed alike."""

    HYPERLIQUID = {"book": "snapshot", "book_levels": 20, "trades": True, "trade_side": True, "scope": "venue",
                   "venue": "hyperliquid", "context": ["mark", "oracle", "funding", "open_interest"],
                   "line": "last_trade", "min_publish_ms": 250, "auth": "none"}
    EODHD = {"book": "top", "book_levels": 1, "trades": True, "trade_side": False, "scope": "venue", "venue": "XEDX",
             "context": ["session", "venue_status", "reference_close"], "line": "last_trade", "min_publish_ms": 1000,
             "auth": "key", "opt_in": "eodhd-streaming", "symbol_budget": 50}

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


def ready_equity(name):
    yahoo, eodhd = EQUITY_ADDRESS[name]
    rest = {"profile": ("gleif", "ready", []), "filings": ("xbrl-filings", "ready", [("sec", "ready")])}
    return {"quote": ("yahoo-discovery", "ready", [("eodhd", "ready")]),
            "chart": ("yahoo-discovery", "ready", [("eodhd", "ready")]), **rest}, [("yahoo", yahoo), ("eodhd", eodhd)]


def off_equity(_name):
    rest = {"profile": ("gleif", "ready", []), "filings": ("xbrl-filings", "ready", [("sec", "ready")])}
    return {"quote": ("yahoo-discovery", "disabled", [("eodhd", "needs_configuration")]),
            "chart": ("yahoo-discovery", "disabled", [("eodhd", "needs_configuration")]), **rest}, []


# What page composition chose on the shipped contracts before contract v1 (origin/identity-backbone f2575c1).
BEFORE = {
    "all_ready": {**{name: ready_equity(name) for name in EQUITY_ADDRESS},
                  "btc": ({"quote": ("coinmarketcap", "ready", [("coingecko", "ready")]),
                           "chart": ("coinmarketcap", "ready", [("coingecko", "ready")])},
                          [("coinmarketcap", "1"), ("coingecko", "bitcoin")])},
    "yahoo_off_keys_missing": {**{name: off_equity(name) for name in EQUITY_ADDRESS},
                               "btc": ({"quote": ("coingecko", "ready", [("coinmarketcap", "needs_configuration")]),
                                        "chart": ("coingecko", "ready", [("coinmarketcap", "needs_configuration")])},
                                       [("coingecko", "bitcoin")])},
}
CONFIGS = {"all_ready": {}, "yahoo_off_keys_missing": {"yahoo-discovery": {"enabled": False},
                                                       "eodhd": {"missing": True}, "coinmarketcap": {"missing": True}}}


class PageParityTest(unittest.TestCase):
    """Contract v1 changes no page: the same plugin, status and alternatives per section as before."""

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

    def test_sections_and_price_sources_match_the_pre_v1_composition(self):
        lookups = {"stored": lambda *_: None, "coins": lambda provider, caip19: self.coins.get((provider, caip19)),
                   "queue": []}
        for config, expected in BEFORE.items():
            plugins = self.plugins(CONFIGS[config])
            for name, (sections, refs) in expected.items():
                with self.subTest(config=config, subject=name):
                    subject = page.load_subject(self.ref, SUBJECTS[name])
                    got = {s["section"]: (s["plugin"].removeprefix("pythia-"), s["status"],
                                          [(a["plugin"].removeprefix("pythia-"), a["status"]) for a in s["alternatives"]])
                           for s in page.compose(subject, plugins, **lookups)}
                    self.assertEqual(got, sections)
                    self.assertEqual([(ref["provider"], ref["native_id"])
                                      for ref in page.price_sources(subject, plugins, **lookups)], refs)
        subject = page.load_subject(self.ref, SUBJECTS["asml_xams"])
        profile = next(s for s in page.compose(subject, self.plugins({}), **lookups) if s["section"] == "profile")
        self.assertEqual(profile["request"]["operation"], "profile")


class HermesAdapterTest(unittest.TestCase):
    """Contracts name operations; the adapter finds the tool each owning plugin declares for it."""

    def test_operations_map_to_the_owning_plugins_declared_tools_only(self):
        from test_identity_queue import load_core
        load_core()
        from pythia_core_queue_fixture import identity_ops
        from pythia_core_queue_fixture.platform import access

        def schema(**marks):
            return {"parameters": {"$comment": json.dumps(marks)}}
        contribution = {"operations": [{"operation": "latest", "tool": "cg_latest"},
                                       {"operation": "history", "tool": "cg_history"}]}
        schemas = {"gleif_profile": schema(pythia_http_operation={"plugin": "pythia-gleif", "operation": "profile"}),
                   "gleif_resolve": schema(pythia_http_operation={"plugin": "pythia-gleif", "operation": "resolve"}),
                   "cg_latest": schema(pythia_market_data=contribution), "cg_history": schema(pythia_market_data=contribution),
                   "rogue_profile": schema(pythia_http_operation={"plugin": "pythia-gleif", "operation": "profile"})}
        owners = {"gleif_profile": ("pythia-gleif", None), "gleif_resolve": ("pythia-gleif", None),
                  "cg_latest": ("pythia-coingecko", None), "cg_history": ("pythia-coingecko", None),
                  "rogue_profile": ("pythia-rogue", None)}
        registry = types.SimpleNamespace(get_all_tool_names=lambda: list(schemas), get_schema=schemas.get)
        with unittest.mock.patch.dict(sys.modules, {"tools": types.ModuleType("tools"),
                                                    "tools.registry": types.SimpleNamespace(registry=registry)}), \
                unittest.mock.patch.object(access, "native_tool_owners", lambda: owners):
            found = identity_ops.native_operations({"pythia-gleif", "pythia-coingecko"})
        self.assertEqual(found, {"pythia-gleif": {"profile": "gleif_profile", "resolve": "gleif_resolve"},
                                 "pythia-coingecko": {"latest": "cg_latest", "history": "cg_history"}})


if __name__ == "__main__":
    unittest.main()
