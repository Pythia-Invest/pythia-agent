"""Identity backbone contracts: store DDL, typed records, fixtures, manifest and claim rules."""
import copy
import importlib.util
import json
from pathlib import Path
import sqlite3
import sys
import unittest

PACKAGE = Path(__file__).parents[2] / "managed/core/identity"
SPEC = importlib.util.spec_from_file_location(
    "pythia_identity_fixture", PACKAGE / "__init__.py", submodule_search_locations=[str(PACKAGE)])
assert SPEC and SPEC.loader
identity = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = identity
SPEC.loader.exec_module(identity)
from pythia_identity_fixture import model, schemes  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures/identity"
PROVENANCE = {"plugin": "eodhd", "source": "eodhd", "adapter_version": "1", "retrieved_at": "2026-09-25T10:00:00Z"}

YAHOO = {
    "contract_version": 1, "plugin": "yahoo", "provider": "yahoo",
    "addressing": {"native": [{"native_scope": "symbol", "level": "listing", "asset_classes": ["equity"]}],
                   "schemes": {"listing": ["ticker_mic"], "security": ["isin"]},
                   "mic_table": {"XAMS": ".AS", "XNAS": ""}},
    "concepts": {"market_data": {"level": "listing", "via": "listing", "operations": {"quote": "latest", "daily": "history"},
                                 "coverage": {"asset_classes": ["equity"]},
                                 "qualities": {"daily": {"adjustment": ["split_dividend"]}}},
                 "news": {"level": "security", "via": "listing", "operations": {"list": "news"}}},
    "resolve": {"operation": "resolve", "input_schemes": ["isin"], "echoes": ["ticker_mic"]},
    "rights": {"licence": "personal", "cache": "none", "hostable": False},
    "signoff": {"status": "grandfathered"},
}
EODHD = {
    "contract_version": 1, "plugin": "eodhd", "provider": "eodhd",
    "addressing": {"native": [{"native_scope": "catalogue", "level": "listing"}, {"native_scope": "composite", "level": "composite"}],
                   "schemes": {"security": ["isin", "share_class_figi"], "issuer": ["lei", "cik"]},
                   "mic_table": {"XAMS": "AS"}},
    "concepts": {"market_data": {"level": "listing", "via": "listing", "operations": {"quote": "latest"}},
                 "fundamentals": {"level": "issuer", "via": "listing", "operations": {"statements": "fundamentals"}}},
    "catalogue": {"mode": "bulk", "operation": "catalogue", "scopes": ["as", "us"]},
    "resolve": {"operation": "resolve", "input_schemes": ["isin", "figi", "lei"], "echoes": ["isin", "figi"]},
    "rights": {"licence": "personal", "cache": {"ttl_seconds": 86400}, "hostable": False},
    "signoff": {"status": "grandfathered"},
    "limits": {"plan": "EOD+Intraday", "unit": "call", "per_day": 100000},
}


def load(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def database(store):
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys=ON")
    db.executescript(identity.schema_sql(store))
    return db


def insert(db, table, row):
    names = list(row)
    db.execute(f"INSERT INTO {table} ({','.join(names)}) VALUES ({','.join('?' * len(names))})",
               [json.dumps(value) if isinstance(value, (list, dict)) else value for value in row.values()])


def assertion_row(item):
    provenance = item.provenance
    return {"evidence_id": item.evidence_id, "subject_id": item.subject_id, "level": item.level.value,
            "scheme": item.scheme.value, "value": item.value, "valid_from": item.validity.valid_from,
            "valid_to": item.validity.valid_to, "authority": item.authority.value,
            "source": provenance.source, "source_record": provenance.source_record,
            "source_version": provenance.source_version, "plugin": provenance.plugin,
            "adapter_version": provenance.adapter_version, "retrieved_at": provenance.retrieved_at}


def load_reference(db, fixture):
    """Construct every fixture record through the types, then store it under the DDL's checks."""
    for row in fixture.get("chains", []):
        insert(db, "chains", row)
    for row in fixture.get("issuers", []):
        issuer = model.Issuer(**row)
        insert(db, "issuers", {"id": issuer.id, "name": issuer.name, "country": issuer.country,
                               "status": issuer.status.value})
    for row in fixture["securities"]:
        security = model.Security(**row)
        insert(db, "securities", {"id": security.id, "issuer_id": security.issuer_id, "name": security.name,
                                  "asset_class": security.asset_class.value, "kind": security.kind.value,
                                  "status": security.status.value})
    for row in fixture.get("composites", []):
        composite = model.Composite(**row)
        insert(db, "composites", {"id": composite.id, "security_id": composite.security_id, "country": composite.country})
    for row in fixture["listings"]:
        # The currency the line trades in where its venue decides it: a reference column, not a typed field.
        listing = model.Listing(**{key: value for key, value in row.items() if key != "trading_currency"})
        insert(db, "listings", {"id": listing.id, "security_id": listing.security_id, "composite_id": listing.composite_id,
                                "mic": listing.mic, "operating_mic": listing.operating_mic, "ticker": listing.ticker,
                                "currency": listing.currency, "trading_currency": row.get("trading_currency"),
                                "chain": listing.chain, "is_primary": int(listing.primary), "status": listing.status.value})
    evidence = {}
    for row in fixture["assertions"]:
        item = model.IdentifierAssertion(**row)
        insert(db, "assertions", assertion_row(item))
        evidence[(item.subject_id, item.scheme.value)] = item.evidence_id
    for row in fixture.get("relations", []):
        relation = model.Relation(**row)
        insert(db, "relations", {
            "evidence_id": relation.evidence_id,
            "type": relation.type.value, "from_id": relation.from_id, "to_id": relation.to_id, "ratio": relation.ratio,
            "authority": relation.authority.value, "source": relation.provenance.source,
            "plugin": relation.provenance.plugin, "adapter_version": relation.provenance.adapter_version,
            "retrieved_at": relation.provenance.retrieved_at})
    return evidence


def bindings(fixture, evidence):
    """Fixture bindings cite assertions by (subject, scheme); resolve those to evidence IDs."""
    result = []
    for row in fixture["bindings"]:
        fields = {key: value for key, value in row.items() if key not in {"note", "evidence_refs"}}
        result.append(model.Binding(**fields, evidence_ids=[evidence[tuple(ref)] for ref in row["evidence_refs"]]))
    return result


class StoreSchemaTest(unittest.TestCase):
    def test_every_store_schema_executes(self):
        for store in identity.Store:
            with self.subTest(store=store):
                tables = {row[0] for row in database(store).execute("SELECT name FROM sqlite_master WHERE type='table'")}
                self.assertTrue(tables)

    def test_levels_are_enforced_by_types_and_by_sql(self):
        fixture = load("asml.json")
        wrong = copy.deepcopy(fixture["assertions"][2])  # the ordinary share's ISIN
        wrong["subject_id"] = "listing:isin:NL0010273215:XAMS:EUR"
        with self.assertRaisesRegex(ValueError, "cannot identify a listing"):
            model.IdentifierAssertion(**wrong)
        db = database("reference")
        load_reference(db, fixture)
        row = assertion_row(model.IdentifierAssertion(**fixture["assertions"][2]))
        with self.assertRaises(sqlite3.IntegrityError):
            insert(db, "assertions", {**row, "evidence_id": "ev:wrong-level", "subject_id": "listing:isin:NL0010273215:XAMS:EUR", "level": "listing"})
        # A reference row states the kind of evidence it is, never where it came from (format 6).
        for origin in ("snapshot", "curated"):
            with self.subTest(origin=origin), self.assertRaises(sqlite3.IntegrityError):
                insert(db, "assertions", {**row, "evidence_id": f"ev:{origin}", "authority": origin})

    def test_identifier_check_digits(self):
        for scheme, value in (("isin", "NL0010273216"), ("lei", "724500Y6DUVHQD6OXN28"), ("figi", "BBG000C1HT48")):
            with self.subTest(scheme=scheme), self.assertRaises(identity.IdentifierError):
                identity.normalize_identifier(scheme, value)
        self.assertEqual(identity.normalize_identifier("cik", "937966"), "0000937966")
        for scheme, value in (("cik", "0000937966\n"), ("isin", "NL0010273215\n")):
            with self.subTest(scheme=scheme), self.assertRaises(identity.IdentifierError):
                identity.normalize_identifier(scheme, value)
        usdc = "eip155:1/erc20:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
        self.assertEqual(identity.normalize_identifier("caip19", usdc), identity.normalize_identifier("caip19", usdc.lower()))

    def test_sui_coin_types_follow_the_pythia_local_profile(self):
        normalize, address = (lambda value: identity.normalize_identifier("caip19", value)), "0x" + "dba3" * 16
        usdc = f"sui:mainnet/coin:{address}%3A%3Ausdc%3A%3AUSDC"
        for spelling in (f"sui:mainnet/coin:{address}::usdc::USDC", usdc, usdc.replace("%3A", "%3a"),
                         f"sui:mainnet/coin:{address.upper().replace('0X', '0x')}::usdc::USDC"):
            with self.subTest(spelling=spelling):
                self.assertEqual(normalize(spelling), usdc)
        # Every character outside CAIP-19's reference set is encoded, a Move `_` too; a short address is long-formed.
        self.assertEqual(normalize("sui:mainnet/coin:0x6::my_coin::MY_COIN"),
                         f"sui:mainnet/coin:0x{'6':0>64}%3A%3Amy%5Fcoin%3A%3AMY%5FCOIN")
        for native in ("sui:mainnet/coin:0x2::sui::SUI", f"sui:mainnet/coin:0x{'2':0>64}::sui::SUI",
                       "sui:mainnet/slip44:784"):
            with self.subTest(native=native):
                self.assertEqual(normalize(native), "sui:mainnet/slip44:784")
        self.assertEqual(identity.subject_id("listing", {"caip19": f"sui:mainnet/coin:{address}::usdc::USDC"}),
                         f"listing:caip19:{usdc}")
        long = f"sui:mainnet/coin:{address}::m::{'A' * 60}"  # 139 encoded characters: stays provisional
        generic = f"sui:mainnet/coin:{address}::lp::LP<0x2::sui::SUI,{address}::usdc::USDC>"
        for refused in (long, generic, f"sui:mainnet/coin:{address}::m::S<<>>", f"sui:mainnet/coin:{address}::m::S<,>",
                        f"sui:mainnet/coin:{address}::usdc:: USDC", "sui:mainnet/coin:usdc", "sui:mainnet/slip44:60",
                        f"sui:mainnet/erc20:{address}"):
            with self.subTest(refused=refused), self.assertRaises(identity.IdentifierError):
                normalize(refused)

    def test_the_sui_helper_keys_a_coin_type_as_that_profile_does_and_gives_none_where_it_refuses(self):
        # What the plugins that state Sui coins share (`pythia_platform.identifiers.sui_caip19`).
        address = "0x" + "dba3" * 16
        self.assertEqual(schemes.sui_caip19(f"{address}::usdc::USDC"), f"sui:mainnet/coin:{address}%3A%3Ausdc%3A%3AUSDC")
        self.assertEqual(schemes.sui_caip19("0x2::sui::SUI"), "sui:mainnet/slip44:784")
        for refused in (f"{address}::lp::LP<0x2::sui::SUI,{address}::usdc::USDC>",  # a generic type
                        f"{address}::m::{'A' * 60}",  # a key past CAIP-19's 128 characters
                        "dba3::usdc::USDC", "usdc", ""):  # no address, or none at all
            with self.subTest(coin=refused):
                self.assertIsNone(schemes.sui_caip19(refused))


class FixtureTest(unittest.TestCase):
    def test_subject_ids_are_derived_from_open_identifiers(self):
        fixture = load("asml.json")
        keys = {}
        for row in fixture["assertions"]:
            keys.setdefault(row["subject_id"], {})[row["scheme"]] = row["value"]
        derive = identity.subject_id
        countries = {row["id"]: row["country"] for row in fixture["composites"]}
        for listing in fixture["listings"]:
            security = keys[listing["security_id"]]
            self.assertEqual(derive("listing", {**security, **keys[listing["id"]]}, operating_mic=listing["operating_mic"],
                                    currency=listing["currency"]), listing["id"])
            self.assertEqual(derive("security", security), listing["security_id"])
            self.assertEqual(derive("composite", security, country=countries[listing["composite_id"]]),
                             listing["composite_id"])
        self.assertEqual(derive("issuer", keys["issuer:lei:724500Y6DUVHQD6OXN27"]), "issuer:lei:724500Y6DUVHQD6OXN27")
        self.assertEqual(derive("issuer", {"cik": "937966"}), "issuer:cik:0000937966")
        self.assertEqual(derive("listing", {"figi": "BBG000K6N6G7"}), "listing:figi:BBG000K6N6G7")
        # A CGS-area ISIN (here ASML's New York registry shares) never keys a portable subject. Without a FIGI it
        # keys a device-local one (subject_key@2), the same whichever source supplies it, and never a composite.
        self.assertEqual(identity.KEY_RULE, "subject_key@2")
        self.assertEqual(derive("security", {"isin": "USN070592100", "share_class_figi": "BBG001SCG0R3"}),
                         "security:figi:BBG001SCG0R3")
        self.assertEqual(derive("security", {"isin": "US0378331005"}), "security:cgs_isin:US0378331005")
        self.assertIsNone(derive("composite", {"isin": "US0378331005"}, country="US"))
        self.assertEqual(derive("listing", {"isin": "USN070592100", "figi": "BBG000K6N6G7"}, operating_mic="XNAS",
                                currency="USD"), "listing:figi:BBG000K6N6G7")
        self.assertEqual(derive("listing", {"isin": "USN070592100"}, operating_mic="XNAS", currency="USD"),
                         "listing:cgs_isin:USN070592100:XNAS:USD")
        self.assertIsNone(derive("listing", {"isin": "USN070592100"}, operating_mic="XNAS"))
        self.assertIs(identity.subject_level("listing:cgs_isin:USN070592100:XNAS:USD"), identity.Level.LISTING)
        for row in load("crypto.json")["listings"]:
            caip19 = next(item["value"] for item in load("crypto.json")["assertions"] if item["subject_id"] == row["id"])
            self.assertEqual(derive("listing", {"caip19": caip19}), row["id"])
            self.assertEqual(derive("security", {"caip19": caip19}), row["security_id"])
        self.assertIsNone(derive("security", {}))
        index = identity.provisional_id("index", "eodhd", "catalogue", "GSPC.INDX")
        self.assertEqual(index, "index:provisional:eodhd:catalogue:GSPC.INDX")
        spaced = identity.provisional_id("listing", "ibkr", "contract", "BRK B")
        self.assertEqual(spaced, identity.provisional_id("listing", "ibkr", "contract", "BRK B"))
        self.assertIs(identity.subject_level(spaced), identity.Level.LISTING)

    def test_coins_bind_where_their_plugins_contract_declares_its_coin_id(self):
        fixture = load("crypto.json")
        for binding in bindings(fixture, load_reference(database("reference"), fixture)):
            ref = binding.provider_ref
            contract = PACKAGE.parents[1] / "plugins" / ref.provider / "contract.json"
            declared = identity.validate_manifest(json.loads(contract.read_text(encoding="utf-8"))).subjects
            self.assertEqual((declared[binding.subject_id].native_scope, declared[binding.subject_id].native_id),
                             (ref.native_scope, ref.native_id))

    def test_fixture_bindings_fit_the_identity_store(self):
        state = database("identity")
        for name in ("asml.json", "crypto.json"):
            fixture = load(name)
            evidence = load_reference(database("reference"), fixture)
            for index, binding in enumerate(bindings(fixture, evidence)):
                ref = binding.provider_ref
                insert(state, "bindings", {
                    "id": f"{name}:{index}", "plugin": binding.plugin, "provider": ref.provider, "native_id": ref.native_id,
                    "native_scope": ref.native_scope, "subject_id": binding.subject_id, "kind": binding.kind,
                    "status": binding.status.value, "authority": binding.authority.value,
                    "rule_id": binding.rule_id, "evidence_ids": list(binding.evidence_ids)})


class ManifestTest(unittest.TestCase):
    def test_accepts_resolve_only_and_bulk_catalogue_plugins(self):
        yahoo = identity.validate_manifest(YAHOO)
        self.assertIs(yahoo.catalogue, identity.CatalogueMode.RESOLVE_ONLY)
        self.assertEqual(yahoo.concepts[identity.Concept.MARKET_DATA].qualities, {"daily": {"adjustment": ("split_dividend",)}})
        eodhd = identity.validate_manifest(EODHD)
        self.assertIs(eodhd.concepts[identity.Concept.FUNDAMENTALS].level, identity.Level.ISSUER)
        self.assertEqual((eodhd.catalogue_operation, eodhd.rights.cache_seconds, eodhd.limits.per_day),
                         ("catalogue", 86400, 100000))
        self.assertEqual(eodhd.plugin_operations, {"latest", "fundamentals", "catalogue", "resolve"})

    def test_rejects_contract_violations_at_their_path(self):
        market = lambda value: value["concepts"]["market_data"]  # noqa: E731
        cases = {
            "manifest.search": lambda value: value.update(search={"tool": "yahoo_search"}),
            "manifest.contract_version": lambda value: value.pop("contract_version"),
            "addressing.schemes.listing": lambda value: value["addressing"]["schemes"].update(listing=["isin"]),
            "concepts.market_data.via": lambda value: market(value).update(via="security"),
            "concepts.prices": lambda value: value["concepts"].update(prices=market(value)),
            "concepts: object required": lambda value: value.update(concepts=5),
            "concepts: object required ": lambda value: value.update(concepts=[{}]),
            "limits.cost": lambda value: value.update(limits={"plan": "Free", "unit": "call", "cost": [{}]}),
            "limits: object required": lambda value: value.update(limits=[{}]),
            "addressing.mic_table": lambda value: value["addressing"].update(mic_table=[{}]),
            "concepts.market_data.coverage.asset_classes": lambda value: market(value)["coverage"].update(asset_classes=[]),
            "concepts.market_data.qualities.quote.delay_minutes": lambda value: market(value)["qualities"].update(
                quote={"delay": "realtime", "delay_minutes": 15}),
            "concepts.market_data.operations.stream": lambda value: market(value)["operations"].update(stream="live"),
            "concepts.market_data.operations.quote": lambda value: market(value)["operations"].update(quote="Yahoo Quote"),
            "concepts.market_data.qualities.daily.speed": lambda value: market(value)["qualities"]["daily"].update(speed=1),
            "concepts.market_data.qualities.daily.adjustment": lambda value: market(value)["qualities"].update(
                daily={"adjustment": ["dividend"]}),
            "concepts.market_data.qualities.intraday": lambda value: market(value)["qualities"].update(
                intraday={"delay": "eod"}),
            "concepts.market_data.coverage.asset_classes ": lambda value: market(value)["coverage"].update(
                asset_classes=["bond"]),
            "concepts.filings.authorities": lambda value: value["concepts"].update(
                filings={"level": "issuer", "via": "security", "operations": {"list": "filings"}}),
            "concepts.news.tool": lambda value: value["concepts"]["news"].update(tool="yahoo_news"),
            "rights.licence": lambda value: value["rights"].update(licence="professional"),
            "rights.attribution.url": lambda value: value["rights"].update(attribution={"text": "Yahoo", "url": "http://x"}),
            "manifest.signoff": lambda value: value.pop("signoff"),
            "signoff.status": lambda value: value.update(signoff={"status": "trusted"}),
            "signoff.record": lambda value: value.update(signoff={"status": "signed_off"}),
            "signoff.record ": lambda value: value.update(signoff={"status": "unsigned", "record": "notes.txt"}),
            "manifest.functions": lambda value: value.update(functions=[]),
            "addressing.native[0]": lambda value: (value.pop("resolve"), value["addressing"].pop("mic_table")),
            "catalogue": lambda value: value.update(catalogue={"mode": "resolve_only", "scopes": ["all"]}),
            "addressing.native": lambda value: value["addressing"].update(native=5),
        }
        for path, change in cases.items():
            document = copy.deepcopy(YAHOO)
            change(document)
            with self.subTest(path=path):
                with self.assertRaises(identity.ManifestError) as caught:
                    identity.validate_manifest(document)
                self.assertNotIsInstance(caught.exception, identity.ManifestNeedsUpdate)
                self.assertTrue(str(caught.exception).startswith(path.strip()), caught.exception)

    def test_a_newer_contract_needs_an_update_rather_than_being_invalid(self):
        # A future shape: fields this core has never seen are not reported as invalid.
        future = identity.CONTRACT_VERSION + 1
        document = {**copy.deepcopy(YAHOO), "contract_version": future, "concepts": {"orderbook": {}}, "entitlements": {}}
        with self.assertRaises(identity.ManifestNeedsUpdate) as caught:
            identity.validate_manifest(document)
        self.assertEqual(caught.exception.version, future)
        self.assertEqual(identity.contract_version(document), future)


class ClaimTest(unittest.TestCase):
    def record(self, **overrides):
        value = {"level": "listing", "provenance": PROVENANCE,
                 "native_ref": {"provider": "eodhd", "native_id": "ASML.AS", "native_scope": "catalogue"},
                 "identifiers": [{"scheme": "isin", "value": "NL0010273215"}],
                 "attributes": {"ticker": "ASML", "provider_venue": "AS", "currency": "EUR"}}
        return identity.RecordClaim(**{**value, **overrides})

    def batch(self, *claims):
        return identity.ClaimBatch("eodhd", "eodhd", "1", "catalogue", claims, scope="as")

    def test_catalogue_page_is_accepted(self):
        identity.check_batch(self.batch(self.record()), identity.validate_manifest(EODHD))

    def test_plugins_bind_only_their_own_references(self):
        manifest = identity.validate_manifest(EODHD)
        foreign = self.record(native_ref={"provider": "yahoo", "native_id": "ASML.AS", "native_scope": "symbol"})
        with self.assertRaises(identity.ClaimError):
            identity.check_batch(self.batch(foreign), manifest)
        with self.assertRaises(ValueError):
            self.record(level="security", native_ref=None, identifiers=[{"scheme": "figi", "value": "BBG000C1HT47"}])

    def test_a_record_has_one_own_value_per_single_valued_scheme(self):
        underlying = {"scheme": "isin", "value": "US0378331005", "role": "underlying"}
        self.record(identifiers=[{"scheme": "isin", "value": "NL0010273215"}, underlying])
        self.record(identifiers=[{"scheme": "isin", "value": "NL0010273215", "role": "unqualified"}])
        with self.assertRaises(ValueError):
            self.record(identifiers=[{"scheme": "isin", "value": "NL0010273215"}, {**underlying, "role": "self"}])

    def test_crypto_records_carry_provider_deployments_not_identity_guesses(self):
        coin = {"provider": "coingecko", "native_id": "usd-coin", "native_scope": "coin"}
        self.record(level="security", identifiers=[], native_ref=coin,
                    deployments=[{"chain": "ethereum", "contract": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"}])
        with self.assertRaises(ValueError):
            self.record(native_of="ethereum")

    def test_a_crypto_asset_record_names_at_most_one_canonical_issuance(self):
        usdc = "eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
        base = "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
        coin = {"provider": "coingecko", "native_id": "usd-coin", "native_scope": "coin"}
        canonical = [{"scheme": "caip19", "value": usdc, "role": "self"},
                     {"scheme": "caip19", "value": base, "role": "unqualified"}]
        record = self.record(level="security", native_ref=coin, identifiers=canonical)
        with self.assertRaises(ValueError):
            self.record(level="security", native_ref=coin, identifiers=[canonical[0], {**canonical[1], "role": "self"}])
        # On the wire the role is never implied: a platform list left unmarked would default to canonical issuance.
        wire = identity.batch_to_json(self.batch(record))
        self.assertEqual(identity.batch_from_json(wire), self.batch(record))
        del wire["claims"][0]["identifiers"][1]["role"]
        with self.assertRaisesRegex(identity.ClaimError, r"^claims\[0\]: .*role"):
            identity.batch_from_json(wire)

    def test_batches_round_trip_through_the_wire_form(self):
        relation = identity.RelationClaim(
            "depositary_receipt_of", {"scheme": "isin", "value": "USN070592100"},
            {"scheme": "isin", "value": "NL0010273215"}, PROVENANCE, ratio="1")
        batch = self.batch(self.record(attributes={"ticker": "ASML", "rank": {"volume": 2.5}}), relation)
        wire = json.loads(json.dumps(identity.batch_to_json(batch)))
        self.assertEqual(identity.batch_from_json(wire), batch)
        self.assertEqual(wire["claims"][0]["identifiers"][0], {"scheme": "isin", "value": "NL0010273215", "role": "self"})

    def test_aliases_are_a_short_list_of_names_and_survive_the_wire_form(self):
        batch = self.batch(self.record(attributes={"name": "ASML", "aliases": ["ASML Holding", "Veldhoven"]}))
        wire = json.loads(json.dumps(identity.batch_to_json(batch)))
        self.assertEqual(wire["claims"][0]["attributes"]["aliases"], ["ASML Holding", "Veldhoven"])
        self.assertEqual(identity.batch_from_json(wire).claims[0].attributes.aliases, ("ASML Holding", "Veldhoven"))
        for refused in ("ASML", {"ASML": 1}, [""], [None], [7], ["x" * 513], ["name"] * 33):
            wire["claims"][0]["attributes"]["aliases"] = refused
            with self.subTest(aliases=str(refused)[:20]), self.assertRaisesRegex(identity.ClaimError, r"^claims\[0\].*aliases"):
                identity.batch_from_json(wire)

    def test_a_malformed_wire_batch_names_the_bad_claim(self):
        wire = identity.batch_to_json(self.batch(self.record()))
        wire["claims"][0]["identifiers"][0]["value"] = "NL0010273216"
        with self.assertRaisesRegex(identity.ClaimError, r"^claims\[0\]"):
            identity.batch_from_json(wire)
        with self.assertRaisesRegex(identity.ClaimError, r"^batch"):
            identity.batch_from_json({**wire, "claims": [], "surprise": 1})


class ResolutionTest(unittest.TestCase):
    LISTING = "listing:isin:NL0010273215:XAMS:EUR"
    ADYEN = "security:isin:NL0012969182"

    def item(self, subject, candidate):
        return identity.QueueItem(id="q1", kind="residual", reason="no_key", subject_ids=[subject],
                                  candidate_ids=[candidate], evidence_ids=[], state="open",
                                  opened_at="2026-09-25T10:00:00Z", plugins=["eodhd"])

    def verdict(self, **overrides):
        value = {"item_id": "q1", "resolver": "plugin", "authority": "model_confirmed", "relation": "same_listing",
                 "chosen_id": self.LISTING, "confidence": 0.97, "model": "jev-1.13.0", "prompt_version": "p1",
                 "input_digest": "sha256:" + "0" * 64, "provenance": {**PROVENANCE, "plugin": "jev", "source": "jev"}}
        return identity.Verdict(**{**value, **overrides})

    def figi(self, value, authority="source_asserted", source="openfigi"):
        return identity.IdentifierAssertion(subject_id=self.LISTING, scheme="figi", value=value, authority=authority,
                                            provenance={**PROVENANCE, "plugin": source, "source": source})

    def decide(self, verdict, claimed_figi="BBG000C1HT47", evidence=None, **facts):
        item = self.item("listing:provisional:eodhd:catalogue:ASML.AS", self.LISTING)
        facts = {"as_of": "2026-09-25", "record_kind": None, "subject_kind": None, "threshold": 0.95, **facts}
        claimed = [identity.IdentifierValue("figi", claimed_figi)]
        return identity.decide(verdict, item, claimed=claimed, evidence=evidence or [self.figi("BBG000C1HT47")], **facts)

    def test_one_authority_rule_for_every_resolver(self):
        outcome = identity.VerdictOutcome
        self.assertIs(self.decide(self.verdict()), outcome.CONFIRMED)
        self.assertIs(self.decide(self.verdict(), threshold=0.99), outcome.SUGGESTED)
        self.assertIs(self.decide(self.verdict(), threshold=None), outcome.SUGGESTED)
        self.assertIs(self.decide(self.verdict(), claimed_figi="BBG000K6N6G7"), outcome.BLOCKED)
        user = self.verdict(resolver="user", authority="user_attested", confidence=None, model=None, prompt_version=None,
                            input_digest=None, user_turn="desk:turn-1",
                            provenance={**PROVENANCE, "plugin": "pythia", "source": "user"})
        self.assertIs(self.decide(user, threshold=None), outcome.CONFIRMED)
        self.assertIs(self.decide(user, claimed_figi="BBG000K6N6G7"), outcome.BLOCKED)
        other = self.verdict(relation="unrelated")
        self.assertIs(self.decide(self.verdict(), prior=[other]), outcome.AMBIGUOUS)
        self.assertIs(self.decide(self.verdict(relation="ambiguous", chosen_id=None)), outcome.AMBIGUOUS)

    def test_two_sources_values_block_every_answer_but_the_users(self):
        # No source outranks another: where sources disagree, no rule or model answer confirms.
        outcome = identity.VerdictOutcome
        other = self.figi("BBG000K6N6G7", source="vendor")
        user = self.verdict(resolver="user", authority="user_attested", confidence=None, model=None,
                            prompt_version=None, input_digest=None, user_turn="desk:turn-1",
                            provenance={**PROVENANCE, "plugin": "pythia", "source": "user"})
        for claimed in ("BBG000C1HT47", "BBG000K6N6G7"):
            with self.subTest(claimed=claimed):
                evidence = [self.figi("BBG000C1HT47"), other]
                self.assertIs(self.decide(self.verdict(), claimed, evidence), outcome.BLOCKED)
                self.assertIs(self.decide(user, claimed, evidence, threshold=None), outcome.CONFIRMED)
                self.assertIs(self.decide(user, claimed, [self.figi(claimed)], threshold=None), outcome.CONFIRMED)
        # Unanimous proof refuses the user too, both a match against it and "none" against it.
        self.assertIs(self.decide(user, "BBG000K6N6G7", [self.figi("BBG000C1HT47")], threshold=None), outcome.BLOCKED)
        none = self.verdict(resolver="user", authority="user_attested", confidence=None, model=None,
                            prompt_version=None, input_digest=None, user_turn="desk:turn-1", relation="none",
                            chosen_id=None, provenance={**PROVENANCE, "plugin": "pythia", "source": "user"})
        self.assertIs(self.decide(none, "BBG000C1HT47", [self.figi("BBG000C1HT47")]), outcome.BLOCKED)
        self.assertIs(self.decide(none, "BBG000C1HT47", [self.figi("BBG000C1HT47"), other]), outcome.NO_MATCH)

    def test_one_sources_several_values_contest_nothing(self):
        # OpenFIGI gives a German composite two composite FIGIs: either names it, and neither contradicts the other.
        outcome = identity.VerdictOutcome
        both = [self.figi("BBG000C1HT47"), self.figi("BBG000K6N6G7")]
        user = self.verdict(resolver="user", authority="user_attested", confidence=None, model=None,
                            prompt_version=None, input_digest=None, user_turn="desk:turn-1",
                            provenance={**PROVENANCE, "plugin": "pythia", "source": "user"})
        for claimed in ("BBG000C1HT47", "BBG000K6N6G7"):
            with self.subTest(claimed=claimed):
                self.assertIs(self.decide(self.verdict(), claimed, both), outcome.CONFIRMED)
        self.assertIs(self.decide(user, "BBG000BDTBL9", both, threshold=None), outcome.BLOCKED)  # one source, unanimous

    def test_a_receipt_is_never_the_same_security_as_its_underlying(self):
        outcome = identity.VerdictOutcome
        item = self.item("composite:provisional:eodhd:catalogue:ADYEY.US", self.ADYEN)
        facts = {"claimed": [], "evidence": [], "as_of": "2026-09-25", "threshold": 0.95,
                 "record_kind": "depositary_receipt", "subject_kind": "ordinary"}
        same = self.verdict(relation="same_security", chosen_id=self.ADYEN)
        self.assertIs(identity.decide(same, item, **facts), outcome.BLOCKED)
        receipt = self.verdict(relation="depositary_receipt_of", chosen_id=self.ADYEN)
        self.assertIs(identity.decide(receipt, item, **facts), outcome.CONFIRMED)

    def test_verdicts_are_well_formed(self):
        for overrides in ({"authority": "user_attested"}, {"relation": "same_security"}):
            with self.subTest(overrides=overrides), self.assertRaises(ValueError):
                self.verdict(**overrides)


if __name__ == "__main__":
    unittest.main()
