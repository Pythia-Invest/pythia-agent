"""Core's local search over a hand-written reference: search groups, their lead lines and the page's listings."""
import contextlib
import sqlite3
import types
import unittest.mock
from pathlib import Path

from test_identity_page import ASML, BTC, Fixture
from pythia_identity_fixture import page, search  # noqa: E402


SHELL, SHEL = "listing:isin:GB00BP6MXD84:XAMS:EUR", "listing:figi:BBG0147BN6G2"
SHELL_OTC = "listing:isin:GB00BP6MXD84:OTCM:USD"
BANK = [("common", "ordinary", "BNK"), ("preferred", "preferred", "BNK-PA"), ("note1", "other", "BNKN"),
        ("note2", "other", "BNKO"), ("etn", "fund", "BNKX")]


def leads(directory, query, limit=5, **options):
    """The lead listing of each search group: the line that represents the group's best instrument."""
    return [group["rows"][0]["id"] for group in directory.search(query, limit=limit, **options)["groups"]]


class SearchTest(Fixture):
    def setUp(self):
        super().setUp()
        with sqlite3.connect(self.path) as db:
            db.executemany("INSERT INTO venues (mic, operating_mic, name, country, category) VALUES (?, ?, ?, ?, ?)", [
                ("XAMS", "XAMS", "Euronext Amsterdam", "NL", "RMKT"), ("XNGS", "XNAS", "Nasdaq", "US", "RMKT"),
                ("XNYS", "XNYS", "NYSE", "US", "NSPD")])
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
                       " 'security:isin:GB00BP6MXD84', 'source_asserted', 'fixture', 'pythia', '1', '2026-09-28T00:00:00Z')")
        self.directory = search.Directory(self.ref)

    def rows(self, query, **options):
        """The lead listing of each company group."""
        return leads(self.directory, query, **options)

    def test_a_company_groups_its_listings_receipts_included(self):
        group, = self.directory.search("asml", limit=5)["groups"]
        us = "listing:figi:BBG000K6N6G7"
        self.assertEqual({key: group[key] for key in ("name", "kind", "listings")},
                         {"name": "ASML Holding N.V.", "kind": "ordinary", "listings": 2})
        self.assertEqual(group["rows"][0], {"id": ASML, "instrument": "security:isin:NL0010273215", "ticker": "ASML",
                                            "name": "ASML Holding N.V.", "kind": "ordinary", "mic": "XAMS",
                                            "venue": "Euronext Amsterdam", "country": "NL", "currency": None})
        # The registry shares are a listing row of the same company, with their own type and the company's name
        # (not the security's FIRDS short name); the page they open is the share's instrument, which they fold into.
        self.assertEqual({key: group["rows"][1][key] for key in ("id", "kind", "instrument", "name")},
                         {"id": us, "kind": "depositary_receipt", "instrument": "security:isin:NL0010273215",
                          "name": "ASML Holding N.V."})

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
        ops = identity_ops.Identity(types.SimpleNamespace(), data_dir=Path(self.path).parent / "core")
        self.addCleanup(lambda: ops.store.db.close())
        self.enterContext(unittest.mock.patch.object(identity_ops, "installed", lambda: []))
        shell = "security:isin:GB00BP6MXD84"
        self.assertEqual(page.load_subject(self.ref, shell)["listing"]["id"], SHELL_OTC)  # id order alone: OTC
        default = ops._default_listing(Path(self.path), page.load_subject(self.ref, shell))
        self.assertEqual(default, SHELL)
        self.assertEqual(page.load_subject(self.ref, shell, default)["view"]["subject"]["listing"], SHELL)
        # A line of another security is not the security's to price through.
        self.assertEqual(page.load_subject(self.ref, shell, SHEL)["listing"]["id"], SHELL_OTC)
        self.assertIsNone(ops._default_listing(Path(self.path), page.load_subject(self.ref, SHELL)))

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

    def lines(self, issuer, country, *lines):
        """A company with lines (id, operating MIC, primary); the venues are added when missing."""
        with contextlib.closing(sqlite3.connect(self.path)) as db, db:
            db.executemany("INSERT OR IGNORE INTO venues (mic, operating_mic, name, country) VALUES (?1, ?1, ?1, ?2)",
                           [("XETR", "DE"), ("XMUN", "DE"), ("XDUS", "DE"), ("XBUD", "HU")])
            db.execute("INSERT INTO issuers (id, name, country) VALUES (?, ?, ?)", (f"issuer:lei:{issuer}", issuer, country))
            db.execute("INSERT INTO securities (id, issuer_id, name, asset_class, kind) VALUES (?, ?, 'x', 'equity', 'ordinary')",
                       (f"security:{issuer}", f"issuer:lei:{issuer}"))
            db.executemany("INSERT INTO listings (id, security_id, mic, operating_mic, ticker, currency, is_primary)"
                           " VALUES (?1, ?2, ?3, ?3, ?4, 'EUR', ?5)",
                           [(listing, f"security:{issuer}", mic, ticker, primary) for listing, mic, ticker, primary in lines])
        return search.Directory(self.ref)

    def test_a_priceable_line_is_preferred_only_among_non_home_non_primary_lines(self):
        directory = self.lines("TOYOTA", "JP", ("listing:t:dus", "XDUS", "TOM", 0), ("listing:t:mun", "XMUN", "TOM", 0),
                               ("listing:t:xetr", "XETR", "TOM", 0))
        row = lambda query, priced: leads(directory, query, limit=1, priced=lambda: priced)[0]  # noqa: E731
        self.assertEqual(row("toyota", {}), "listing:t:xetr")  # the fixed venue order: Xetra before the floors
        self.assertEqual(row("toyota", {"XMUN": frozenset()}), "listing:t:mun")
        self.assertEqual(row("TOM", {"XMUN": frozenset()}), "listing:t:mun")  # the same pick for any phrasing
        self.assertEqual(row("toyota", {"XMUN": frozenset({"crypto"})}), "listing:t:xetr")  # not for equities

    def test_a_regulated_listing_outranks_open_market_trading_on_a_bigger_venue(self):
        with contextlib.closing(sqlite3.connect(self.path)) as db, db:
            db.executemany("INSERT OR IGNORE INTO venues (mic, operating_mic, name, country, category) VALUES (?, ?, ?, ?, ?)",
                           [("XETB", "XETR", "Xetra", "DE", "MLTF"), ("XAMS", "XAMS", "Euronext Amsterdam", "NL", "RMKT")])
            db.execute("UPDATE venues SET category = 'RMKT' WHERE mic = 'XAMS'")
            db.execute("INSERT INTO issuers (id, name, country) VALUES ('issuer:lei:SHEL2', 'Shelf plc', 'GB')")
            db.execute("INSERT INTO securities (id, issuer_id, name, asset_class, kind)"
                       " VALUES ('security:shelf', 'issuer:lei:SHEL2', 'x', 'equity', 'ordinary')")
            db.executemany("INSERT INTO listings (id, security_id, mic, operating_mic, ticker, currency, is_primary)"
                           " VALUES (?1, 'security:shelf', ?2, ?3, ?4, 'EUR', 0)",
                           [("listing:shelf:xetb", "XETB", "XETR", "SHF0"), ("listing:shelf:xams", "XAMS", "XAMS", "SHELF")])
        directory = search.Directory(self.ref)
        priced = {"XETR": frozenset(), "XAMS": frozenset()}
        for query in ("shelf", "SHELF", "SHF0"):
            row = leads(directory, query, limit=1, priced=lambda: priced)[0]
            self.assertEqual(row, "listing:shelf:xetb" if query == "SHF0" else "listing:shelf:xams", query)

    def test_a_listing_shows_a_currency_only_where_its_venue_decides_it(self):
        # FIRDS gives IWDA and Apple their notional USD everywhere: the key currency, never shown. Xetra quotes in euros;
        # Amsterdam decides nothing, so IWDA there claims no currency and the page takes the quote's.
        with contextlib.closing(sqlite3.connect(self.path)) as db, db:
            db.execute("INSERT OR IGNORE INTO venues (mic, operating_mic, name, country, category)"
                       " VALUES ('XETR', 'XETR', 'Xetra', 'DE', 'RMKT')")
            db.execute("INSERT INTO issuers (id, name, country) VALUES ('issuer:lei:ISHR', 'iShares plc', 'IE')")
            db.executemany("INSERT INTO securities (id, issuer_id, name, asset_class, kind) VALUES (?, ?, ?, 'equity', ?)",
                           [("security:isin:IE00B4L5Y983", "issuer:lei:ISHR", "iShares Core MSCI World", "etf"),
                            ("security:figi:BBG001S5N8V8", None, "Apple Inc.", "ordinary")])
            db.executemany("INSERT INTO listings (id, security_id, mic, operating_mic, ticker, currency, trading_currency,"
                           " is_primary) VALUES (?, ?, ?, ?, ?, 'USD', ?, 0)",
                           [("listing:isin:IE00B4L5Y983:XAMS:USD", "security:isin:IE00B4L5Y983", "XAMS", "XAMS", "IWDA", None),
                            ("listing:figi:BBG000BPCGF6", "security:figi:BBG001S5N8V8", "XETR", "XETR", "APC", "EUR")])
        directory = search.Directory(self.ref)
        row = lambda query: directory.search(query, limit=1)["groups"][0]["rows"][0]  # noqa: E731
        self.assertEqual((row("IWDA")["id"], row("IWDA")["currency"]), ("listing:isin:IE00B4L5Y983:XAMS:USD", None))
        self.assertEqual((row("APC")["id"], row("APC")["currency"]), ("listing:figi:BBG000BPCGF6", "EUR"))
        iwda = page.load_subject(self.ref, "listing:isin:IE00B4L5Y983:XAMS:USD")["view"]
        self.assertNotIn("currency", iwda["identifiers"])
        self.assertEqual([line["currency"] for line in iwda["listings"]], [None])
        apple = page.load_subject(self.ref, "listing:figi:BBG000BPCGF6")["view"]
        self.assertEqual((apple["identifiers"]["currency"], apple["listings"][0]["currency"]), ("EUR", "EUR"))

    def test_an_unspecified_iso_category_is_a_listing_only_outside_the_eea(self):
        with contextlib.closing(sqlite3.connect(self.path)) as db, db:
            db.executemany("INSERT OR IGNORE INTO venues (mic, operating_mic, name, country, category) VALUES (?, ?, ?, ?, ?)",
                           [("XETB", "XETR", "Xetra", "DE", "MLTF"), ("XTSE", "XTSE", "Toronto", "CA", "NSPD"),
                            ("XFRA", "XFRA", "Frankfurt", "DE", "NSPD")])
            db.executemany("INSERT INTO issuers (id, name, country) VALUES (?, ?, 'GB')",
                           [("issuer:lei:MAPL", "Maple plc"), ("issuer:lei:OPCO", "Opco plc")])
            db.executemany("INSERT INTO securities (id, issuer_id, name, asset_class, kind) VALUES (?, ?, 'x', 'equity', 'ordinary')",
                           [("security:mapl", "issuer:lei:MAPL"), ("security:opco", "issuer:lei:OPCO")])
            db.executemany("INSERT INTO listings (id, security_id, mic, operating_mic, ticker, currency, is_primary)"
                           " VALUES (?, ?, ?, ?, ?, ?, 0)",
                           [("listing:mapl:xetb", "security:mapl", "XETB", "XETR", "MPL", "EUR"),
                            ("listing:mapl:xtse", "security:mapl", "XTSE", "XTSE", "MPL", "CAD"),
                            ("listing:opco:xfra", "security:opco", "XFRA", "XFRA", "OPC", "EUR"),
                            ("listing:opco:xetb", "security:opco", "XETB", "XETR", "OPC", "EUR")])
        directory = search.Directory(self.ref)
        self.assertEqual(leads(directory, "maple", limit=1), ["listing:mapl:xtse"])  # Toronto is an exchange
        self.assertEqual(leads(directory, "opco", limit=1), ["listing:opco:xetb"])  # Frankfurt's operator MIC is not

    def test_a_receipt_never_represents_the_shares_it_folds_into(self):
        # A Toronto CDR is its own issuer's home and primary line; Tencent's Singapore SDR is regulated while its
        # shares trade only on an open market. The shares' line leads both, but an ADR still beats an OTC line.
        with contextlib.closing(sqlite3.connect(self.path)) as db, db:
            db.executemany("INSERT INTO venues (mic, operating_mic, name, country, category) VALUES (?, ?1, ?, ?, ?)",
                           [("XTSE", "Toronto Stock Exchange", "CA", "NSPD"), ("XSES", "Singapore Exchange", "SG", "NSPD"),
                            ("TGAT", "Tradegate", "DE", "MLTF"), ("OTCM", "OTC Markets", "US", "MLTF")])
            db.executemany("INSERT INTO issuers (id, name, country) VALUES (?, ?, ?)",
                           [("issuer:cibc", "CIBC", "CA"), ("issuer:tencent", "Tencent", "CN"), ("issuer:toyota", "Toyota", "JP")])
            db.executemany("INSERT INTO securities (id, issuer_id, name, asset_class, kind) VALUES (?, ?, ?, 'equity', ?)", [
                ("security:shell-cdr", "issuer:cibc", "Shell plc CDR", "depositary_receipt"),
                ("security:tencent", "issuer:tencent", "x", "ordinary"),
                ("security:tencent-sdr", "issuer:tencent", "x", "depositary_receipt"),
                ("security:toyota", "issuer:toyota", "x", "ordinary"),
                ("security:toyota-adr", "issuer:toyota", "x", "depositary_receipt")])
            db.executemany("INSERT INTO listings (id, security_id, mic, operating_mic, ticker, currency, is_primary)"
                           " VALUES (?, ?, ?, ?3, ?, ?, ?)", [
                               ("listing:shell-cdr", "security:shell-cdr", "XTSE", "SHLS", "CAD", 1),
                               ("listing:tencent", "security:tencent", "TGAT", "NNND", "EUR", 0),
                               ("listing:tencent-sdr", "security:tencent-sdr", "XSES", "HTCD", "SGD", 1),
                               ("listing:toyota", "security:toyota", "OTCM", "TOYOF", "USD", 0),
                               ("listing:toyota-adr", "security:toyota-adr", "XNYS", "TM", "USD", 1)])
            db.executemany("INSERT INTO relations (evidence_id, type, from_id, to_id, authority, source, plugin,"
                           " adapter_version, retrieved_at) VALUES ('ev:' || ?1, 'depositary_receipt_of', ?1, ?2,"
                           " 'source_asserted', 'fixture', 'pythia', '1', '2026-09-28T00:00:00Z')",
                           [("security:shell-cdr", "security:isin:GB00BP6MXD84"),
                            ("security:tencent-sdr", "security:tencent"), ("security:toyota-adr", "security:toyota")])
        directory = search.Directory(self.ref)
        self.assertEqual(leads(directory, "shell", limit=1), [SHELL])
        self.assertEqual(leads(directory, "tencent", limit=1), ["listing:tencent"])
        self.assertEqual(leads(directory, "toyota", limit=1), ["listing:toyota-adr"])
        self.assertEqual(leads(directory, "SHLS", limit=1), ["listing:shell-cdr"])  # unless the query names it

    def test_a_build_without_venue_categories_ranks_no_line_as_regulated(self):
        with contextlib.closing(sqlite3.connect(self.path)) as db, db:
            db.execute("ALTER TABLE venues DROP COLUMN category")
        self.assertEqual(leads(search.Directory(self.ref), "shell", limit=1), [SHELL])

    def test_the_home_and_primary_market_outrank_a_priceable_line(self):
        directory = self.lines("OTP", "HU", ("listing:otp:bud", "XBUD", "OTP", 1), ("listing:otp:dus", "XDUS", "OTP", 0))
        for query in ("OTP", "otp"):
            self.assertEqual(leads(directory, query, limit=1, priced=lambda: {"XDUS": frozenset()}), ["listing:otp:bud"])
        self.assertEqual(self.rows("shell", priced=lambda: {"OTCM": frozenset()})[:1], [SHELL])  # an OTC line stays below

    def test_a_foreign_companys_primary_us_line_represents_it(self):
        directory = self.lines("LINDE", "IE", ("listing:linde:xetr", "XETR", "LIN", 0), ("listing:linde:xnys", "XNYS", "LIN", 1))
        self.assertEqual(leads(directory, "linde", priced=lambda: {"XETR": frozenset(), "XNYS": frozenset()}),
                         ["listing:linde:xnys"])

    def test_an_issuers_main_share_and_preferred_come_before_its_notes(self):
        # The bank's ETN is a product: its own group, after the company's.
        company, etn = self.directory.search("bank corp", limit=5)["groups"]
        self.assertEqual([(row["id"], row["name"]) for row in company["rows"]][:2],
                         [("listing:bank:common", "Bank Corp"), ("listing:bank:preferred", "x")])  # its own name
        self.assertEqual([row["id"] for row in etn["rows"]], ["listing:bank:etn"])
