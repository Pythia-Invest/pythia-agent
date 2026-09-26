"""Core identity operations over a hand-written reference: local search, page sections, resolve decisions."""
import sqlite3
import tempfile
import unittest
import unittest.mock
from pathlib import Path

from test_identity_contracts import PROVENANCE, identity, load, load_reference
from pythia_identity_fixture import page, search, store  # noqa: E402

ASML = "listing:isin:NL0010273215:XAMS:EUR"
BTC = "security:caip19:bip122:000000000019d6689c085ae165831e93/slip44:0"
LEI = "724500Y6DUVHQD6OXN27"
CONTRACTS = {
    "yahoo": {"plugin": "yahoo", "provider": "yahoo",
              "addressing": {"native": [{"native_scope": "symbol", "level": "listing", "asset_classes": ["equity"]}],
                             "schemes": {"listing": ["ticker_mic"]}, "mic_table": {"XAMS": ".AS", "XNAS": ""}},
              "content": {"quote": {"level": "listing", "via": "listing", "tool": "yahoo_latest"}}},
    "eodhd": {"plugin": "eodhd", "provider": "eodhd",
              "addressing": {"native": [{"native_scope": "catalogue", "level": "listing", "asset_classes": ["equity"]}],
                             "schemes": {"security": ["isin"]}},
              "content": {"quote": {"level": "listing", "via": "listing", "tool": "eodhd_latest"}},
              "resolve": {"tool": "eodhd_resolve", "input_schemes": ["isin"], "echoes": ["isin"]}},
    "gleif": {"plugin": "gleif", "provider": "gleif",
              "addressing": {"native": [{"native_scope": "lei", "level": "issuer"}], "schemes": {"issuer": ["lei"]}},
              "content": {"profile": {"level": "issuer", "via": "issuer", "tool": "gleif_profile"}},
              "resolve": {"tool": "gleif_resolve", "input_schemes": ["lei"], "echoes": ["lei"]}},
    "coinmarketcap": {"plugin": "coinmarketcap", "provider": "coinmarketcap",
                      "addressing": {"native": [{"native_scope": "coin", "level": "security", "asset_classes": ["crypto"]}]},
                      "catalogue": {"mode": "bulk", "tool": "cmc_catalogue", "scopes": ["coins"]},
                      "content": {"quote": {"level": "security", "via": "security", "tool": "cmc_latest"}}},
    "coingecko": {"plugin": "coingecko", "provider": "coingecko",
                  "addressing": {"native": [{"native_scope": "coin", "level": "security", "asset_classes": ["crypto"]}]},
                  "catalogue": {"mode": "bulk", "tool": "cg_catalogue", "scopes": ["coins"]},
                  "content": {"quote": {"level": "security", "via": "security", "tool": "cg_latest"}}},
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

    def compose(self, subject_id, plugins):
        subject = page.load_subject(self.ref, subject_id)
        coins = {(r[0], r[1]): r[2] for r in self.ref.execute("SELECT provider, caip19, native_id FROM native_coins")}
        stored = {(r["subject_id"], r["provider"]): r for r in self.identity.bindings([subject_id], ("confirmed",))}
        return subject, {section["section"]: section for section in page.compose(
            subject, plugins, stored=lambda target, provider: stored.get((target, provider)),
            coins=lambda provider, caip19: coins.get((provider, caip19)), queue=[])}


SHELL, SHEL = "listing:isin:GB00BP6MXD84:XAMS:EUR", "listing:figi:BBG0147BN6G2"
SHELL_OTC = "listing:isin:GB00BP6MXD84:OTCM:USD"
BANK = [("common", "ordinary", "BNK"), ("preferred", "preferred", "BNK-PA"), ("note1", "other", "BNKN"),
        ("note2", "other", "BNKO")]


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
        self.directory = search.Directory(self.ref)

    def rows(self, query, **options):
        return [row["id"] for row in self.directory.search(query, limit=5, **options)["rows"]]

    def test_a_receipt_folds_into_the_company_row_shown_through_its_primary_listing(self):
        row, = self.directory.search("asml", limit=5)["rows"]
        self.assertEqual(row, {"id": ASML, "ticker": "ASML", "name": "ASML Holding N.V.", "kind": "ordinary",
                               "mic": "XAMS", "venue": "Euronext Amsterdam", "country": "NL", "listings": 1,
                               "bindings": []})

    def test_the_listing_preference_picks_the_representative_unless_the_query_names_one(self):
        us = "listing:isin:USN070592100:XNAS:USD"
        self.assertEqual(self.rows("asml", prefer="US"), [us])
        self.assertEqual(self.rows("asml", prefer="EU"), [ASML])
        self.assertEqual(self.rows("ASML.AS", prefer="US", suffixes=lambda: {".AS": {"XAMS"}}), [ASML])
        self.assertEqual(self.rows("ASML.US", suffixes=lambda: {".US": {"XNAS", "XNYS"}}), [us])
        self.assertEqual(self.rows("USN070592100"), [us])

    def test_a_typed_ticker_names_its_listing_unless_the_query_is_the_name(self):
        self.assertEqual(self.rows("SHEL")[:1], [SHEL])  # a receipt ticker that only starts the name
        self.assertEqual(self.rows("shell")[:1], [SHELL])

    def test_the_page_lists_what_the_row_counts(self):
        row = self.directory.search("shell", limit=1)["rows"][0]
        listings = self.directory.instrument_listings("security:figi:BBG0147BN6H1")
        # The receipt carries the only primary flag; the company's home line still leads, marked primary.
        self.assertEqual([(item["id"], item["kind"], item["primary"]) for item in listings],
                         [(SHELL, "ordinary", True), (SHELL_OTC, "ordinary", False),
                          (SHEL, "depositary_receipt", False)])
        # The page groups lines by these: the venue's country, OTC and the issuer's home country.
        self.assertEqual([(item["country"], item["otc"], item["home"]) for item in listings], [("NL", False, False), (None, True, False), ("US", False, False)])
        self.assertEqual(row["listings"], len(listings) - 1)

    def test_crypto_rows_address_the_asset_and_carry_stored_bindings(self):
        bound = {BTC: [{"plugin": "coinmarketcap", "ref": "1"}]}
        row = self.directory.search("BTC", limit=5, bindings=lambda ids: bound)["rows"][0]
        self.assertEqual({key: row[key] for key in ("id", "mic", "country", "listings", "bindings")},
                         {"id": BTC, "mic": None, "country": None, "listings": 0, "bindings": bound[BTC]})

    def test_an_issuers_main_share_and_preferred_come_before_its_notes(self):
        self.assertEqual(self.rows("bank corp"), ["listing:bank:common", "listing:bank:preferred"])


class PageTest(Fixture):
    def test_sections_use_derived_addresses_without_a_call(self):
        _subject, sections = self.compose(ASML, [plugin("gleif", operations={"gleif_profile": "gleif-profile"}),
                                                 plugin("eodhd"), plugin("yahoo")])
        quote, profile = sections["quote"], sections["profile"]
        self.assertEqual((quote["plugin"], quote["status"], quote["binding"]["native_id"], quote["binding_status"]),
                         ("pythia-yahoo", "ready", "ASML.AS", "derived"))
        self.assertEqual(quote["alternatives"], [{"plugin": "pythia-eodhd", "label": "EODHD", "status": "resolving"}])
        self.assertEqual(profile["request"], {"plugin": "pythia-gleif", "operation": "gleif-profile", "arguments": {
            "native_ref": {"provider": "gleif", "native_id": LEI, "native_scope": "lei"}}})

    def test_an_unusable_plugin_yields_to_the_next_and_says_why(self):
        missing = ({"key": "coinmarketcap_api_key", "label": "API key", "file": "secrets.json", "status": "missing"},)
        _subject, sections = self.compose(BTC, [plugin("coinmarketcap", missing=missing), plugin("coingecko"),
                                                plugin("yahoo", enabled=False)])
        quote = sections["quote"]
        self.assertEqual((quote["plugin"], quote["binding"]["native_id"], quote["binding_status"]),
                         ("pythia-coingecko", "bitcoin", "confirmed"))
        self.assertEqual(quote["alternatives"], [{"plugin": "pythia-coinmarketcap", "label": "CoinMarketCap",
                                                  "status": "needs_configuration"}])

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
        self.assertEqual(sections["quote"]["alternatives"][0]["status"], "conflict")
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
        builds = Path(self.tmp.name) / "builds"
        builds.mkdir()
        good = builds / "reference-20260925.sqlite3"
        good.write_bytes(self.path.read_bytes())
        with sqlite3.connect(good) as db:
            db.execute("INSERT INTO release (key, value) VALUES ('schema_version', ?)", (store.REFERENCE_SCHEMA_VERSION,))
        (builds / "reference-20260926.sqlite3").write_bytes(b"")
        with unittest.mock.patch.dict("os.environ", {store.REFERENCE_DIR_ENV: str(builds)}):
            self.assertEqual(store.reference_path(Path(self.tmp.name)), good)
