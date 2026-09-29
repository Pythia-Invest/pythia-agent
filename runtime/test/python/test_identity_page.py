"""Core identity operations over a hand-written reference: page sections, resolve decisions."""
import copy
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from test_identity_contracts import PROVENANCE, identity, load, load_reference
from pythia_identity_fixture import markets, page, store  # noqa: E402

ASML = "listing:isin:NL0010273215:XAMS:EUR"
BTC = "security:caip19:bip122:000000000019d6689c085ae165831e93/slip44:0"
LEI = "724500Y6DUVHQD6OXN27"
OPEN = {"licence": "open", "cache": "unlimited", "hostable": False}
OLD = {"status": "grandfathered"}
QUOTE = {"level": "listing", "via": "listing", "operations": {"quote": "latest"}}
CONTRACTS = {
    "yahoo": {"contract_version": 1, "plugin": "yahoo", "provider": "yahoo",
              "addressing": {"native": [{"native_scope": "symbol", "level": "listing", "asset_classes": ["equity"]}],
                             "schemes": {"listing": ["ticker_mic"]}, "mic_table": {"XAMS": ".AS", "XNAS": ""}},
              "concepts": {"market_data": QUOTE}, "rights": {**OPEN, "licence": "personal", "cache": "none"},
              "signoff": OLD},
    "eodhd": {"contract_version": 1, "plugin": "eodhd", "provider": "eodhd",
              "addressing": {"native": [{"native_scope": "catalogue", "level": "listing", "asset_classes": ["equity"]}],
                             "schemes": {"security": ["isin"]}},
              "concepts": {"market_data": QUOTE},
              "resolve": {"operation": "resolve", "input_schemes": ["isin"], "echoes": ["isin"]},
              "rights": {**OPEN, "licence": "personal"}, "signoff": OLD},
    "gleif": {"contract_version": 1, "plugin": "gleif", "provider": "gleif",
              "addressing": {"native": [{"native_scope": "lei", "level": "issuer"}], "schemes": {"issuer": ["lei"]}},
              "concepts": {"profile": {"level": "issuer", "via": "issuer", "operations": {"fields": "profile"}}},
              "resolve": {"operation": "resolve", "input_schemes": ["lei"], "echoes": ["lei"]}, "rights": OPEN,
              "signoff": OLD},
    "coinmarketcap": {"contract_version": 2, "plugin": "coinmarketcap", "provider": "coinmarketcap",
                      "addressing": {"native": [{"native_scope": "coin", "level": "security", "asset_classes": ["crypto"]}],
                                     "subjects": {BTC: {"native_scope": "coin", "native_id": "1"}}},
                      "catalogue": {"mode": "bulk", "operation": "catalogue", "scopes": ["coins"]},
                      "concepts": {"market_data": {**QUOTE, "level": "security", "via": "security"}},
                      "rights": {**OPEN, "licence": "business"}, "signoff": OLD},
    "coingecko": {"contract_version": 2, "plugin": "coingecko", "provider": "coingecko",
                  "addressing": {"native": [{"native_scope": "coin", "level": "security", "asset_classes": ["crypto"]}],
                                 "subjects": {BTC: {"native_scope": "coin", "native_id": "bitcoin"}}},
                  "catalogue": {"mode": "bulk", "operation": "catalogue", "scopes": ["coins"]},
                  "concepts": {"market_data": {**QUOTE, "level": "security", "via": "security"}},
                  "rights": {**OPEN, "licence": "business"}, "signoff": OLD},
}


def plugin(name, **overrides):
    return page.PluginInfo(key=f"pythia-{name}", manifest=identity.validate_manifest(CONTRACTS[name]), **overrides)


class Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "reference-20260926.sqlite3"
        db = sqlite3.connect(self.path)
        db.executescript(identity.schema_sql("reference"))
        for name in ("asml.json", "crypto.json"):
            load_reference(db, load(name))
        db.commit()
        db.close()
        self.ref = store.open_reference(self.path, "confirm")  # a build the user trusts to confirm
        self.identity = store.IdentityStore(Path(self.tmp.name) / "core")

    def tearDown(self):
        self.ref.close()
        self.tmp.cleanup()

    def lookups(self, subject_id):
        stored = {(r["subject_id"], r["provider"]): r for r in self.identity.bindings([subject_id], ("confirmed",))}
        return {"stored": lambda target, provider: stored.get((target, provider)), "queue": []}

    def compose(self, subject_id, plugins):
        subject = page.load_subject(self.ref, subject_id)
        return subject, {section["section"]: section for section in page.compose(
            subject, plugins, **self.lookups(subject_id))}


class PageTest(Fixture):
    def test_a_security_page_names_the_listing_it_prices(self):
        view = page.load_subject(self.ref, "security:isin:NL0010273215")["view"]
        self.assertEqual((view["subject"]["level"], view["subject"]["listing"]), ("security", ASML))

    def test_sections_use_derived_addresses_without_a_call(self):
        _subject, sections = self.compose(ASML, [plugin("gleif", operations={"profile": "pythia_gleif_profile"}),
                                                 plugin("yahoo")])
        quote, profile = sections["quote"], sections["profile"]
        # Each section says which level its plugin addresses, so a client can resolve issuer data once.
        self.assertEqual((quote["via"], profile["via"]), ("listing", "issuer"))
        self.assertEqual((quote["plugin"], quote["status"], quote["binding"]["native_id"], quote["binding_status"]),
                         ("pythia-yahoo", "ready", "ASML.AS", "derived"))
        # Free sources come first in core's default order: Yahoo serves; EODHD, still needing its lookup, is listed.
        _subject, sections = self.compose(ASML, [plugin("eodhd"), plugin("yahoo")])
        self.assertEqual((sections["quote"]["plugin"], sections["quote"]["status"]), ("pythia-yahoo", "ready"))
        [also] = sections["quote"]["alternatives"]
        self.assertEqual((also["plugin"], also["source"], also["status"]), ("pythia-eodhd", "EODHD", "resolving"))
        self.assertEqual(profile["request"], {"plugin": "pythia-gleif", "operation": "profile", "arguments": {
            "native_ref": {"provider": "gleif", "native_id": LEI, "native_scope": "lei"}}})

    def test_priced_venues_are_the_mic_tables_of_usable_quote_plugins(self):
        self.assertEqual(page.priced_venues([plugin("yahoo"), plugin("eodhd"), plugin("gleif")]),
                         {"XAMS": frozenset({"equity"}), "XNAS": frozenset({"equity"})})
        self.assertEqual(page.priced_venues([plugin("yahoo", enabled=False)]), {})

    def test_a_nordic_class_ticker_becomes_a_dashed_provider_symbol(self):
        contract = {**CONTRACTS["yahoo"], "addressing": {**CONTRACTS["yahoo"]["addressing"], "mic_table": {"XSTO": ".ST"}}}
        yahoo = page.PluginInfo(key="pythia-yahoo", manifest=identity.validate_manifest(contract))
        subject = {"ids": {}, "values": {}, "asset_class": "equity",
                   "listing": {"ticker": "VOLV B", "mic": "XSTO", "operating_mic": "XSTO", "status": "active"}}
        ref, _rule = page.derive(yahoo, identity.Level.LISTING, subject)
        self.assertEqual(ref.native_id, "VOLV-B.ST")
        self.assertEqual(identity.normalize_identifier("ticker_mic", "VOLV B@XSTO"), "VOLV B@XSTO")
        for bloomberg in ("AAPL US@XNAS", "ASML NA@XAMS", "VOLV  B@XSTO"):
            with self.assertRaises(ValueError):
                identity.normalize_identifier("ticker_mic", bloomberg)

    def test_an_old_us_id_resolves_through_its_alias(self):
        old, current = "listing:isin:USN070592100:XNAS:USD", "listing:figi:BBG000K6N6G7"  # before subject_key@1
        self.assertIsNone(page.load_subject(self.ref, old))
        with sqlite3.connect(self.path) as db:  # the builder writes aliases; the reference opens read-only
            db.execute("INSERT INTO id_aliases VALUES (?, ?, 'test')", (old, current))
        ref = store.open_reference(self.path, "confirm")
        self.addCleanup(ref.close)
        subject = page.load_subject(ref, old)
        self.assertEqual((subject["id"], subject["listing"]["ticker"]), (current, "ASML"))

    def test_an_undecided_issuer_says_its_company_sections_need_it(self):
        gleif = plugin("gleif", operations={"profile": "pythia_gleif_profile"})
        with sqlite3.connect(self.path) as db:  # the builder leaves an undecided issuer empty (R2)
            db.execute("UPDATE securities SET issuer_id = NULL")
        ref = store.open_reference(self.path, "confirm")
        self.addCleanup(ref.close)
        subject = page.load_subject(ref, ASML)
        [profile] = [section for section in page.compose(subject, [gleif], **self.lookups(ASML))
                     if section["section"] == "profile"]
        self.assertEqual((profile["plugin"], profile["status"], profile["via"], profile["request"]),
                         ("pythia", "not_addressable", "issuer", None))
        self.assertTrue(profile["reason"].startswith("Needs the issuer"))
        self.assertIsNone(profile["notice"])
        # A crypto asset has no issuer to wait for: its company sections stay absent.
        btc = page.load_subject(self.ref, BTC)
        self.assertEqual([section["section"] for section in page.compose(btc, [gleif], **self.lookups(BTC))], [])

    def test_an_unusable_plugin_yields_to_the_next_and_says_why(self):
        missing = ({"key": "coinmarketcap_api_key", "label": "API key", "file": "secrets.json", "status": "missing"},)
        _subject, sections = self.compose(BTC, [plugin("coinmarketcap", missing=missing), plugin("coingecko"),
                                                plugin("yahoo", enabled=False)])
        quote = sections["quote"]
        self.assertEqual((quote["plugin"], quote["binding"]["native_id"], quote["binding_status"]),
                         ("pythia-coingecko", "bitcoin", "confirmed"))
        self.assertEqual(quote["alternatives"], [])
        self.assertEqual([(item["plugin"], item["code"]) for item in quote["skipped"]],
                         [("pythia-yahoo", "not_addressable"), ("pythia-coinmarketcap", "needs_configuration")])
        self.assertIsNone(quote["notice"])  # a source the investor has not set up is not a warning

    def test_market_data_reads_a_subject_through_its_ready_references_in_core_order(self):
        missing = ({"key": "coinmarketcap_api_key", "label": "API key", "file": "secrets.json", "status": "missing"},)
        btc = page.load_subject(self.ref, BTC)
        self.assertEqual(page.price_sources(btc, [plugin("coinmarketcap", missing=missing), plugin("coingecko")],
                                            **self.lookups(BTC)),
                         [{"provider": "coingecko", "native_id": "bitcoin", "native_scope": "coin"}])
        asml = page.load_subject(self.ref, ASML)  # EODHD still needs a resolve, so it serves nothing yet
        self.assertEqual(page.price_sources(asml, [plugin("eodhd"), plugin("yahoo")], **self.lookups(ASML)),
                         [{"provider": "yahoo", "native_id": "ASML.AS", "native_scope": "symbol"}])

    def test_resolve_binds_unless_identifier_evidence_contradicts(self):
        subject, _ = self.compose(ASML, [])
        eodhd = plugin("eodhd")

        def answer(isin):
            record = {"level": "listing", "provenance": PROVENANCE, "identifiers": [{"scheme": "isin", "value": isin}],
                      "native_ref": {"provider": "eodhd", "native_id": "ASML.AS", "native_scope": "catalogue"}}
            return identity.batch_from_json({"plugin": "eodhd", "provider": "eodhd", "adapter_version": "1",
                                             "origin": "resolve", "claims": [record]})

        sent = page.resolve_input(eodhd, subject)
        binding, item, _ = page.apply_resolve(answer("NL0010273215"), eodhd, identity.Level.LISTING, subject, sent,
                                              now="2026-09-26T10:00:00Z", as_of="2026-09-26")
        self.assertEqual((binding.status, binding.subject_id, item), ("confirmed", ASML, None))
        self.identity.put_binding(binding)
        _subject, sections = self.compose(ASML, [eodhd])
        self.assertEqual((sections["quote"]["status"], sections["quote"]["binding_status"]), ("ready", "confirmed"))

        binding, item, _ = page.apply_resolve(answer("USN070592100"), eodhd, identity.Level.LISTING, subject, sent,
                                              now="2026-09-26T10:00:00Z", as_of="2026-09-26")
        self.assertEqual((binding, item.kind, item.subject_ids), (None, "conflict", (ASML,)))
        self.identity.put_queue_item(item)
        self.identity.put_queue_item(item)  # re-asking the same question keeps one open item
        self.assertEqual(len(self.identity.open_queue([ASML])), 1)


def unsigned(name, **overrides):
    """A plugin whose source has not signed off (ADR 0042): the investor enabled it explicitly."""
    contract = {**CONTRACTS[name], "signoff": {"status": "unsigned"}}
    return page.PluginInfo(key=f"pythia-{name}", manifest=identity.validate_manifest(contract), **overrides)


class SignOffGateTest(Fixture):
    def sections(self, subject_id, plugins, order=()):
        subject = page.load_subject(self.ref, subject_id)
        return {section["section"]: section
                for section in page.compose(subject, plugins, **self.lookups(subject_id), order=order)}

    def test_an_unsigned_source_is_never_cores_choice_and_is_labelled(self):
        quote = self.sections(BTC, [unsigned("coingecko"), plugin("coinmarketcap")])["quote"]
        self.assertEqual(quote["plugin"], "pythia-coinmarketcap")  # though free sources come first by default
        self.assertNotIn("unaudited", quote)
        [also] = quote["alternatives"]
        self.assertEqual((also["plugin"], also["unaudited"]), ("pythia-coingecko", True))

    def test_the_investor_may_still_use_an_unsigned_source_labelled_not_yet_audited(self):
        for plugins, order in (([unsigned("coingecko"), plugin("coinmarketcap")], ("coingecko",)),
                               ([unsigned("coingecko")], ())):
            with self.subTest(order=order):
                quote = self.sections(BTC, plugins, order)["quote"]
                self.assertEqual((quote["plugin"], quote["unaudited"], quote["source"]["unaudited"]),
                                 ("pythia-coingecko", True, True))

    def test_an_unsigned_source_never_confirms_identity(self):
        subject, _ = self.compose(ASML, [])
        eodhd = unsigned("eodhd")
        record = {"level": "listing", "provenance": PROVENANCE, "identifiers": [{"scheme": "isin", "value": "NL0010273215"}],
                  "native_ref": {"provider": "eodhd", "native_id": "ASML.AS", "native_scope": "catalogue"}}
        batch = identity.batch_from_json({"plugin": "eodhd", "provider": "eodhd", "adapter_version": "1",
                                          "origin": "resolve", "claims": [record]})
        # The same answer binds for an audited source (test_resolve_binds_unless_identifier_evidence_contradicts).
        binding, item, _ = page.apply_resolve(batch, eodhd, identity.Level.LISTING, subject,
                                              page.resolve_input(eodhd, subject), now="2026-09-26T10:00:00Z",
                                              as_of="2026-09-26")
        self.assertIsNone(binding)
        self.assertEqual((item.kind, item.reason, item.candidate_ids), ("residual", "unaudited", (ASML,)))
        self.assertTrue(item.evidence_ids)  # the reviewer sees the identifiers that matched
        # The page says the match waits for review, in words, never that the source has no match.
        self.identity.put_queue_item(item)
        [quote] = page.compose(page.load_subject(self.ref, ASML), [eodhd], queue=self.identity.open_queue([ASML]),
                               stored=lambda *_: None)
        self.assertEqual((quote["status"], quote["queued"]), ("unresolved", "unaudited"))
        self.assertEqual(quote["reason"], "EODHD's answer is queued for review: the source is not yet audited, so its "
                                          "match waits for sign-off")


class ReviewFixesTest(Fixture):
    HEINEKEN = "listing:isin:NL0000009165:XAMS:EUR"

    def answer(self, isin, native_id="ASML.AS"):
        record = {"level": "listing", "provenance": PROVENANCE, "identifiers": [{"scheme": "isin", "value": isin}],
                  "native_ref": {"provider": "eodhd", "native_id": native_id, "native_scope": "catalogue"}}
        return identity.batch_from_json({"plugin": "eodhd", "provider": "eodhd", "adapter_version": "1",
                                         "origin": "resolve", "claims": [record]})

    def resolve(self, subject, batch):
        eodhd = plugin("eodhd")

        def bound_to(ref):
            row = self.identity.binding_for(ref)
            return row["subject_id"] if row is not None and row["status"] == "confirmed" else None

        return page.apply_resolve(batch, eodhd, identity.Level.LISTING, subject, page.resolve_input(eodhd, subject),
                                  now="2026-09-26T10:00:00Z", as_of="2026-09-26", bound_to=bound_to)

    def test_a_confirmed_reference_is_never_repointed_to_another_subject(self):
        asml, _ = self.compose(ASML, [])
        binding, _item, _ = self.resolve(asml, self.answer("NL0010273215"))
        self.assertTrue(self.identity.put_binding(binding))
        heineken = {**asml, "ids": {**asml["ids"], identity.Level.LISTING: self.HEINEKEN}}  # same evidence, other subject
        binding, item, _ = self.resolve(heineken, self.answer("NL0010273215"))
        self.assertEqual((binding, item.kind, set(item.subject_ids)), (None, "conflict", {ASML, self.HEINEKEN}))
        stolen = identity.Binding(provider_ref={"provider": "eodhd", "native_id": "ASML.AS", "native_scope": "catalogue"},
                                  subject_id=self.HEINEKEN, status="confirmed", authority="user_attested",
                                  evidence_ids=["ev:x"], plugin="eodhd")
        self.assertFalse(self.identity.put_binding(stolen))
        self.assertEqual(self.identity.binding_for(stolen.provider_ref)["subject_id"], ASML)

    def test_a_conflict_yields_to_a_ready_fallback_and_clears_after_a_valid_resolve(self):
        asml, _ = self.compose(ASML, [])
        _binding, item, _ = self.resolve(asml, self.answer("USN070592100"))
        self.identity.put_queue_item(item)
        queue = self.identity.open_queue([ASML])
        subject = page.load_subject(self.ref, ASML)
        sections = {s["section"]: s for s in page.compose(subject, [plugin("eodhd"), plugin("yahoo")], queue=queue,
                                                        stored=lambda *_: None)}
        self.assertEqual(sections["quote"]["plugin"], "pythia-yahoo")
        self.assertEqual(sections["quote"]["skipped"][0]["code"], "conflict")
        self.assertIsNone(sections["quote"]["notice"])  # EODHD ranks after the free Yahoo: not a passed-over choice
        binding, _item, _ = self.resolve(asml, self.answer("NL0010273215"))
        self.identity.put_binding(binding)
        _subject, sections = self.compose(ASML, [plugin("eodhd")])
        self.assertEqual(sections["quote"]["status"], "ready")

    def test_a_miss_is_reported_until_it_expires(self):
        self.identity.put_miss(ASML, "pythia-eodhd", "EODHD found no match", 60)
        self.identity.put_miss(ASML, "pythia-gleif", "old", -1)
        self.assertEqual(self.identity.misses(ASML), {"pythia-eodhd": "EODHD found no match"})
        subject = page.load_subject(self.ref, ASML)
        [quote] = page.compose(subject, [plugin("eodhd")], queue=[], stored=lambda *_: None,
                               misses={(ASML, plugin): reason for plugin, reason in self.identity.misses(ASML).items()})
        self.assertEqual((quote["status"], quote["reason"]), ("unresolved", "EODHD found no match"))

    def test_unreadable_stores_degrade(self):
        directory = Path(self.tmp.name) / "broken"
        directory.mkdir()
        (directory / "identity.sqlite3").write_bytes(b"not a database")
        self.assertEqual(store.IdentityStore(directory).bindings([ASML]), [])
        self.assertEqual(len(list(directory.glob("identity.unreadable-*.sqlite3"))), 1)


class MarketPages(Fixture):
    """A curated perp market composes its own page with a live section; it never joins its underlying's page."""

    PERP = "market:pythia:hyperliquid-btc-perp"

    def setUp(self):
        super().setUp()
        core = Path(page.__file__).parent
        self.table = markets.curated()
        contract = json.loads((core.parents[1] / "plugins/hyperliquid/contract.json").read_text())
        self.hyperliquid = page.PluginInfo(key="pythia-hyperliquid", manifest=identity.validate_manifest(contract),
                                           operations={"live_market": "pythia_hyperliquid_live_market"})

    def test_the_perp_page_is_one_live_section_addressed_by_the_plugins_own_reference(self):
        subject = markets.load_market(self.table, self.PERP)
        self.assertEqual(subject["view"]["related"][0], {"id": BTC, "type": "derivative_on", "direction": "to",
                                                         "kind": "security", "name": "Bitcoin"})
        sections = page.compose(subject, [self.hyperliquid, plugin("yahoo"), plugin("coingecko")],
                                stored=lambda *_: None, queue=[])
        self.assertEqual([section["section"] for section in sections], ["live"])
        live = sections[0]
        # Unsigned (opt-in, display-only): once the investor enables it, the live view serves at the address its own
        # contract declares, labelled; a display plugin's declaration is an address, never confirmed.
        self.assertEqual((live["status"], live["binding_status"], live["unaudited"]), ("ready", "derived", True))
        self.assertEqual(live["request"], {"plugin": "pythia-hyperliquid", "operation": "live_market", "arguments": {
            "native_ref": {"provider": "hyperliquid", "native_id": "BTC", "native_scope": "perp"},
            "subject_id": self.PERP}})
        disabled = page.PluginInfo(key="pythia-hyperliquid", manifest=self.hyperliquid.manifest, enabled=False)
        self.assertEqual(page.compose(subject, [disabled], stored=lambda *_: None,
                                      queue=[])[0]["status"], "disabled")
        self.assertIsNone(markets.load_market(self.table, "market:pythia:unknown"))

    def test_every_underlying_is_a_canonical_asset_subject(self):
        """A re-key of the curated crypto assets must not leave a market pointing at a dead subject."""
        core = Path(page.__file__).parent
        canonical = {f"security:caip19:{asset['caip19']}"
                     for asset in json.loads((core / "canonical_assets.json").read_text())["assets"]}
        for entry in self.table.values():
            with self.subTest(market=entry["id"]):
                if entry.get("derivative_on"):  # a perp's asset, or a future's curated index
                    self.assertIn(entry["derivative_on"]["id"], canonical | set(self.table))
        self.assertIn(BTC, canonical)

    def test_the_underlying_links_to_its_perp_but_composes_without_it(self):
        _subject, sections = self.compose(BTC, [self.hyperliquid, plugin("coingecko")])
        self.assertNotIn("live", sections)
        self.assertEqual(markets.markets_on(self.table, [BTC]), [{"id": self.PERP, "type": "derivative_on",
                                                               "direction": "from", "kind": "market",
                                                               "name": "BTC perp · Hyperliquid"}])

    def test_a_market_is_addressed_only_as_itself(self):
        contract = copy.deepcopy(CONTRACTS["yahoo"])
        contract["concepts"] = {"market_data": {"level": "market", "via": "listing", "operations": {"live": "live"}}}
        with self.assertRaisesRegex(identity.ManifestError, r"^concepts\.market_data\.via"):
            identity.validate_manifest(contract)
        contract["concepts"] = {"profile": {"level": "market", "via": "market", "operations": {"fields": "p"}}}
        with self.assertRaisesRegex(identity.ManifestError, r"^concepts\.profile\.level"):
            identity.validate_manifest(contract)
