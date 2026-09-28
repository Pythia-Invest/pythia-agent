"""Core identity operations over a hand-written reference: local search, page sections, resolve decisions."""
import sqlite3
import tempfile
import unittest
from pathlib import Path

from test_identity_contracts import PROVENANCE, identity, load, load_reference
from pythia_identity_fixture import page, search, store  # noqa: E402

ASML = "listing:isin:NL0010273215:XAMS:EUR"
BTC = "security:caip19:bip122:000000000019d6689c085ae165831e93/slip44:0"
LEI = "724500Y6DUVHQD6OXN27"
OPEN = {"licence": "open", "cache": "unlimited", "hostable": False}
QUOTE = {"level": "listing", "via": "listing", "operations": {"quote": "latest"}}
CONTRACTS = {
    "yahoo": {"contract_version": 1, "plugin": "yahoo", "provider": "yahoo",
              "addressing": {"native": [{"native_scope": "symbol", "level": "listing", "asset_classes": ["equity"]}],
                             "schemes": {"listing": ["ticker_mic"]}, "mic_table": {"XAMS": ".AS", "XNAS": ""}},
              "concepts": {"market_data": QUOTE}, "rights": {**OPEN, "licence": "personal", "cache": "none"}},
    "eodhd": {"contract_version": 1, "plugin": "eodhd", "provider": "eodhd",
              "addressing": {"native": [{"native_scope": "catalogue", "level": "listing", "asset_classes": ["equity"]}],
                             "schemes": {"security": ["isin"]}},
              "concepts": {"market_data": QUOTE},
              "resolve": {"operation": "resolve", "input_schemes": ["isin"], "echoes": ["isin"]},
              "rights": {**OPEN, "licence": "personal"}},
    "gleif": {"contract_version": 1, "plugin": "gleif", "provider": "gleif",
              "addressing": {"native": [{"native_scope": "lei", "level": "issuer"}], "schemes": {"issuer": ["lei"]}},
              "concepts": {"profile": {"level": "issuer", "via": "issuer", "operations": {"fields": "profile"}}},
              "resolve": {"operation": "resolve", "input_schemes": ["lei"], "echoes": ["lei"]}, "rights": OPEN},
    "coinmarketcap": {"contract_version": 1, "plugin": "coinmarketcap", "provider": "coinmarketcap",
                      "addressing": {"native": [{"native_scope": "coin", "level": "security", "asset_classes": ["crypto"]}]},
                      "catalogue": {"mode": "bulk", "operation": "catalogue", "scopes": ["coins"]},
                      "concepts": {"market_data": {**QUOTE, "level": "security", "via": "security"}},
                      "rights": {**OPEN, "licence": "business"}},
    "coingecko": {"contract_version": 1, "plugin": "coingecko", "provider": "coingecko",
                  "addressing": {"native": [{"native_scope": "coin", "level": "security", "asset_classes": ["crypto"]}]},
                  "catalogue": {"mode": "bulk", "operation": "catalogue", "scopes": ["coins"]},
                  "concepts": {"market_data": {**QUOTE, "level": "security", "via": "security"}},
                  "rights": {**OPEN, "licence": "business"}},
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
        self.ref = store.open_reference(self.path)
        self.identity = store.IdentityStore(Path(self.tmp.name) / "core")

    def tearDown(self):
        self.ref.close()
        self.tmp.cleanup()

    def lookups(self, subject_id):
        coins = {(r[0], r[1]): r[2] for r in self.ref.execute("SELECT provider, caip19, native_id FROM native_coins")}
        stored = {(r["subject_id"], r["provider"]): r for r in self.identity.bindings([subject_id], ("confirmed",))}
        return {"stored": lambda target, provider: stored.get((target, provider)),
                "coins": lambda provider, caip19: coins.get((provider, caip19)), "queue": []}

    def compose(self, subject_id, plugins):
        subject = page.load_subject(self.ref, subject_id)
        return subject, {section["section"]: section for section in page.compose(
            subject, plugins, **self.lookups(subject_id))}


SHELL, SHEL = "listing:isin:GB00BP6MXD84:XAMS:EUR", "listing:figi:BBG0147BN6G2"
SHELL_OTC = "listing:isin:GB00BP6MXD84:OTCM:USD"
BANK = [("common", "ordinary", "BNK"), ("preferred", "preferred", "BNK-PA"), ("note1", "other", "BNKN"),
        ("note2", "other", "BNKO"), ("etn", "fund", "BNKX")]


class SearchTest(Fixture):
    def setUp(self):
        super().setUp()
        with sqlite3.connect(self.path) as db:
            db.executemany("INSERT INTO venues VALUES (?, ?, ?, ?)", [
                ("XAMS", "XAMS", "Euronext Amsterdam", "NL"), ("XNGS", "XNAS", "Nasdaq", "US"),
                ("XNYS", "XNYS", "NYSE", "US")])
            # Shell: home line on Amsterdam, a receipt on NYSE whose ticker starts the name; a bank with a
            # preferred and two notes.
            db.executemany("INSERT INTO issuers (id, name, country) VALUES (?, ?, ?)",
                           [("issuer:lei:21380068P1DRHMJ8KU70", "Shell plc", "GB"), ("issuer:cik:1", "Bank Corp", "US")])
            securities = [("security:isin:GB00BP6MXD84", "issuer:lei:21380068P1DRHMJ8KU70", "ordinary"),
                          ("security:figi:BBG0147BN6H1", "issuer:lei:21380068P1DRHMJ8KU70", "depositary_receipt"),
                          *((f"security:bank:{key}", "issuer:cik:1", kind) for key, kind, _ in BANK)]
            db.executemany("INSERT INTO securities (id, issuer_id, name, asset_class, kind) VALUES (?, ?, 'x', 'equity', ?)",
                           securities)
            listings = [(SHELL, "security:isin:GB00BP6MXD84", "XAMS", "SHELL", "EUR", 0),
                        (SHELL_OTC, "security:isin:GB00BP6MXD84", "OTCM", "RYDAF", "USD", 0),
                        (SHEL, "security:figi:BBG0147BN6H1", "XNYS", "SHEL", "USD", 1),
                        *((f"listing:bank:{key}", f"security:bank:{key}", "XNYS", ticker, "USD", 1)
                          for key, _, ticker in BANK)]
            db.executemany("INSERT INTO listings (id, security_id, mic, operating_mic, ticker, currency, is_primary)"
                           " VALUES (?, ?, ?, ?3, ?, ?, ?)", listings)
            db.execute("INSERT INTO relations (evidence_id, type, from_id, to_id, authority, source, plugin, adapter_version,"
                       " retrieved_at) VALUES ('ev:shel', 'depositary_receipt_of', 'security:figi:BBG0147BN6H1',"
                       " 'security:isin:GB00BP6MXD84', 'snapshot', 'fixture', 'pythia', '1', '2026-09-28T00:00:00Z')")
        self.directory = search.Directory(self.ref)

    def rows(self, query, **options):
        """The lead listing of each company group."""
        return [group["rows"][0]["id"] for group in self.directory.search(query, limit=5, **options)["groups"]]

    def test_a_company_groups_its_listings_receipts_included(self):
        group, = self.directory.search("asml", limit=5)["groups"]
        us = "listing:figi:BBG000K6N6G7"
        self.assertEqual({key: group[key] for key in ("name", "kind", "listings")},
                         {"name": "ASML Holding N.V.", "kind": "ordinary", "listings": 2})
        self.assertEqual(group["rows"][0], {"id": ASML, "instrument": "security:isin:NL0010273215", "ticker": "ASML",
                                            "name": "ASML Holding N.V.", "kind": "ordinary", "mic": "XAMS",
                                            "venue": "Euronext Amsterdam", "country": "NL", "currency": "EUR"})
        # The registry shares are a listing row of the same company, with their own type; the page they open is
        # the share's instrument, which they fold into.
        self.assertEqual({key: group["rows"][1][key] for key in ("id", "kind", "instrument")},
                         {"id": us, "kind": "depositary_receipt", "instrument": "security:isin:NL0010273215"})

    def test_another_securitys_row_is_its_own_primary_listing(self):
        # A registry share line elsewhere would win on the foreign-on-US penalty; the row shows the primary.
        with sqlite3.connect(self.path) as db:
            db.execute("INSERT INTO listings (id, security_id, mic, operating_mic, ticker, currency, is_primary)"
                       " VALUES ('listing:asml-nyrs:XMUN', 'security:figi:BBG001SCG0R3', 'XMUN', 'XMUN', 'ASMF', 'USD', 0)")
        group, = search.Directory(self.ref).search("asml", limit=5)["groups"]
        self.assertEqual([row["id"] for row in group["rows"]], [ASML, "listing:figi:BBG000K6N6G7"])
        self.assertEqual(group["listings"], 3)

    def test_the_listing_preference_picks_the_representative_unless_the_query_names_one(self):
        us = "listing:figi:BBG000K6N6G7"
        self.assertEqual(self.rows("asml", prefer="US"), [us])
        self.assertEqual(self.rows("asml", prefer="EU"), [ASML])
        self.assertEqual(self.rows("ASML.AS", prefer="US", suffixes=lambda: {".AS": {"XAMS"}}), [ASML])
        self.assertEqual(self.rows("ASML.US", suffixes=lambda: {".US": {"XNAS", "XNYS"}}), [us])
        self.assertEqual(self.rows("USN070592100"), [us])

    def test_a_typed_ticker_names_its_listing_unless_the_query_is_the_name(self):
        self.assertEqual(self.rows("SHEL")[:1], [SHEL])  # a receipt ticker that only starts the name
        self.assertEqual(self.rows("shell")[:1], [SHELL])

    def test_a_group_carries_its_relevant_listings_and_a_group_read_all_of_them(self):
        group = self.directory.search("shell", limit=1)["groups"][0]
        # Home line, then the receipt the name starts; the OTC line waits for "all listings".
        self.assertEqual(([row["id"] for row in group["rows"]], group["listings"]), ([SHELL, SHEL], 3))
        everything, = self.directory.group(group["id"])["groups"]
        self.assertEqual(([row["id"] for row in everything["rows"]], everything["listings"]),
                         ([SHELL, SHELL_OTC, SHEL], 3))
        self.assertEqual(self.directory.group("issuer:unknown")["groups"], [])

    def test_only_a_flagged_primary_fills_the_primary_slot(self):
        # No Shell line is flagged primary: the OTC query's group shows that line, not an unflagged "primary".
        group, = self.directory.search("RYDAF", limit=1)["groups"]
        self.assertEqual([row["id"] for row in group["rows"]], [SHELL_OTC])

    def test_a_type_filter_narrows_a_groups_listings(self):
        group, = self.directory.search("shell", limit=1, kinds=["depositary_receipt"])["groups"]
        self.assertEqual(([row["id"] for row in group["rows"]], group["listings"]), ([SHEL], 1))
        everything, = self.directory.group(group["id"], kinds=["depositary_receipt"])["groups"]
        self.assertEqual([row["id"] for row in everything["rows"]], [SHEL])

    def test_the_page_lists_the_instruments_lines(self):
        listings = self.directory.instrument_listings("security:figi:BBG0147BN6H1")
        # The receipt carries the only primary flag: the company's home line still leads, but no line is marked
        # primary, since none of the share's own lines is flagged.
        self.assertEqual([(item["id"], item["kind"], item["primary"]) for item in listings],
                         [(SHELL, "ordinary", False), (SHELL_OTC, "ordinary", False),
                          (SHEL, "depositary_receipt", False)])
        # The receipt's line is folded in: the page sets it apart from the share's own lines.
        self.assertEqual([item["folded"] for item in listings], [False, False, True])

    def test_a_security_page_prices_the_selectors_first_line(self):
        from test_identity_queue import load_core
        load_core()
        from pythia_core_queue_fixture import identity_ops
        shell = "security:isin:GB00BP6MXD84"
        self.assertEqual(page.load_subject(self.ref, shell)["listing"]["id"], SHELL_OTC)  # id order alone: OTC
        default = identity_ops.Identity._default_listing(Path(self.path), page.load_subject(self.ref, shell))
        self.assertEqual(default, SHELL)
        self.assertEqual(page.load_subject(self.ref, shell, default)["view"]["subject"]["listing"], SHELL)
        # A line of another security is not the security's to price through.
        self.assertEqual(page.load_subject(self.ref, shell, SHEL)["listing"]["id"], SHELL_OTC)
        self.assertIsNone(identity_ops.Identity._default_listing(Path(self.path), page.load_subject(self.ref, SHELL)))

    def test_only_a_fold_relation_folds_a_receipt_and_the_issuer_still_groups_it(self):
        with sqlite3.connect(self.path) as db:
            db.execute("DELETE FROM relations WHERE evidence_id = 'ev:shel'")
        directory = search.Directory(self.ref)
        self.assertEqual([item["id"] for item in directory.instrument_listings("security:figi:BBG0147BN6H1")], [SHEL])
        self.assertEqual(self.rows("shell")[:1], [SHELL])
        groups = dict(directory.db.execute("SELECT security, grp FROM doc WHERE ticker IN ('SHELL', 'SHEL')"))
        self.assertEqual(set(groups.values()), {"issuer:lei:21380068P1DRHMJ8KU70"})

    def test_the_search_group_is_the_company_for_its_equity_and_the_product_for_a_fund(self):
        groups = dict(self.directory.db.execute("SELECT security, grp FROM doc WHERE security LIKE 'security:bank:%'"))
        self.assertEqual(groups.pop("security:bank:etn"), "security:bank:etn")  # an ETN is its own group
        self.assertEqual(set(groups.values()), {"issuer:cik:1"})

    def test_other_securities_are_the_groups_other_instruments_each_with_a_line(self):
        others = self.directory.other_instruments("security:bank:common")
        self.assertEqual([(item["id"], item["ticker"], item["kind"]) for item in others],
                         [("security:bank:note1", "BNKN", "other"), ("security:bank:note2", "BNKO", "other"),
                          ("security:bank:preferred", "BNK-PA", "preferred")])
        # A receipt folds into its share, so the share's other securities never list it, and a fund lists none.
        self.assertEqual(self.directory.other_instruments("security:figi:BBG0147BN6H1"), [])
        self.assertEqual(self.directory.other_instruments("security:bank:etn"), [])

    def test_crypto_rows_address_the_asset(self):
        group = self.directory.search("BTC", limit=5)["groups"][0]
        row, = group["rows"]  # one asset, however many chain deployments
        self.assertEqual(group["listings"], 1)
        self.assertEqual({key: row[key] for key in ("id", "instrument", "mic", "country")},
                         {"id": BTC, "instrument": BTC, "mic": None, "country": None})

    def test_an_issuers_main_share_and_preferred_come_before_its_notes(self):
        # The bank's ETN is a product: its own group, after the company's.
        company, etn = self.directory.search("bank corp", limit=5)["groups"]
        self.assertEqual([row["id"] for row in company["rows"]][:2], ["listing:bank:common", "listing:bank:preferred"])
        self.assertEqual([row["id"] for row in etn["rows"]], ["listing:bank:etn"])


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

    def test_an_old_us_id_resolves_through_its_alias(self):
        old, current = "listing:isin:USN070592100:XNAS:USD", "listing:figi:BBG000K6N6G7"  # before subject_key@1
        self.assertIsNone(page.load_subject(self.ref, old))
        with sqlite3.connect(self.path) as db:  # the builder writes aliases; the reference opens read-only
            db.execute("INSERT INTO id_aliases VALUES (?, ?, 'test')", (old, current))
        ref = store.open_reference(self.path)
        self.addCleanup(ref.close)
        subject = page.load_subject(ref, old)
        self.assertEqual((subject["id"], subject["listing"]["ticker"]), (current, "ASML"))

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
                                                        stored=lambda *_: None, coins=lambda *_: None)}
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
        [quote] = page.compose(subject, [plugin("eodhd")], queue=[], stored=lambda *_: None, coins=lambda *_: None,
                               misses=self.identity.misses(ASML))
        self.assertEqual((quote["status"], quote["reason"]), ("unresolved", "EODHD found no match"))

    def test_unreadable_stores_degrade(self):
        directory = Path(self.tmp.name) / "broken"
        directory.mkdir()
        (directory / "identity.sqlite3").write_bytes(b"not a database")
        self.assertEqual(store.IdentityStore(directory).bindings([ASML]), [])
        self.assertEqual(len(list(directory.glob("identity.unreadable-*.sqlite3"))), 1)
