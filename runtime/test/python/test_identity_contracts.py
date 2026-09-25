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
from pythia_identity_fixture import model  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures/identity"
PROVENANCE = {"plugin": "eodhd", "source": "eodhd", "adapter_version": "1", "retrieved_at": "2026-09-25T10:00:00Z"}

YAHOO = {
    "plugin": "yahoo", "provider": "yahoo",
    "addressing": {"native": [{"native_scope": "symbol", "level": "listing", "asset_classes": ["equity"]}],
                   "schemes": {"listing": ["ticker_mic"], "security": ["isin"]},
                   "mic_table": {"XAMS": ".AS", "XNAS": ""}},
    "content": {"quote": {"level": "listing", "via": "listing", "tool": "yahoo_quote"},
                "news": {"level": "security", "via": "listing", "tool": "yahoo_news"}},
    "resolve": {"tool": "yahoo_resolve", "input_schemes": ["isin"], "echoes": ["ticker_mic"]},
}
EODHD = {
    "plugin": "eodhd", "provider": "eodhd",
    "addressing": {"native": [{"native_scope": "catalogue", "level": "listing"}, {"native_scope": "composite", "level": "composite"}],
                   "schemes": {"security": ["isin", "share_class_figi"], "issuer": ["lei", "cik"]},
                   "mic_table": {"XAMS": "AS"}},
    "content": {"quote": {"level": "listing", "via": "listing", "tool": "eodhd_quote"},
                "financials": {"level": "issuer", "via": "listing", "tool": "eodhd_fundamentals"}},
    "catalogue": {"mode": "bulk", "tool": "eodhd_catalogue", "scopes": ["as", "us"]},
    "resolve": {"tool": "eodhd_resolve", "input_schemes": ["isin", "figi", "lei"], "echoes": ["isin", "figi"]},
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
            "valid_to": item.validity.valid_to, "tier": item.tier.value, "authority": item.authority.value,
            "source": provenance.source, "source_record": provenance.source_record,
            "source_version": provenance.source_version, "plugin": provenance.plugin,
            "adapter_version": provenance.adapter_version, "retrieved_at": provenance.retrieved_at}


def load_reference(db, fixture):
    """Construct every fixture record through the types, then store it under the DDL's checks."""
    for table in ("chains", "provider_chains", "native_coins"):
        for row in fixture.get(table, []):
            insert(db, table, row)
    for row in fixture.get("issuers", []):
        issuer = model.Issuer(**row)
        insert(db, "issuers", {"id": issuer.id, "name": issuer.name, "country": issuer.country,
                               "status": issuer.status.value})
    for row in fixture["securities"]:
        security = model.Security(**row)
        insert(db, "securities", {"id": security.id, "issuer_id": security.issuer_id, "name": security.name,
                                  "asset_class": security.asset_class.value, "kind": security.kind.value})
    for row in fixture.get("composites", []):
        composite = model.Composite(**row)
        insert(db, "composites", {"id": composite.id, "security_id": composite.security_id, "country": composite.country})
    for row in fixture["listings"]:
        listing = model.Listing(**row)
        insert(db, "listings", {"id": listing.id, "security_id": listing.security_id, "composite_id": listing.composite_id,
                                "mic": listing.mic, "operating_mic": listing.operating_mic, "ticker": listing.ticker,
                                "currency": listing.currency, "chain": listing.chain, "is_primary": int(listing.primary)})
    evidence = {}
    for row in fixture["assertions"]:
        item = model.IdentifierAssertion(**row)
        insert(db, "assertions", assertion_row(item))
        evidence[(item.subject_id, item.scheme.value)] = item.evidence_id
    for row in fixture.get("relations", []):
        relation = model.Relation(**row)
        insert(db, "relations", {
            "evidence_id": model.evidence_id({"kind": "relation", "type": relation.type, "from": relation.from_id,
                                              "to": relation.to_id, "source": relation.provenance.source}),
            "type": relation.type.value, "from_id": relation.from_id, "to_id": relation.to_id, "ratio": relation.ratio,
            "tier": "T4", "authority": relation.authority.value, "source": relation.provenance.source,
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
        with self.assertRaises(ValueError):
            model.IdentifierAssertion(**wrong)
        db = database("reference")
        load_reference(db, fixture)
        row = assertion_row(model.IdentifierAssertion(**fixture["assertions"][2]))
        with self.assertRaises(sqlite3.IntegrityError):
            insert(db, "assertions", {**row, "evidence_id": "ev:wrong-level", "subject_id": "listing:isin:NL0010273215:XAMS:EUR", "level": "listing"})

    def test_identifier_check_digits(self):
        for scheme, value in (("isin", "NL0010273216"), ("lei", "724500Y6DUVHQD6OXN28"), ("figi", "BBG000C1HT48")):
            with self.subTest(scheme=scheme), self.assertRaises(identity.IdentifierError):
                identity.normalize_identifier(scheme, value)
        self.assertEqual(identity.normalize_identifier("cik", "937966"), "0000937966")


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
            self.assertEqual(derive("listing", security, operating_mic=listing["operating_mic"],
                                    currency=listing["currency"]), listing["id"])
            self.assertEqual(derive("security", security), listing["security_id"])
            self.assertEqual(derive("composite", security, country=countries[listing["composite_id"]]),
                             listing["composite_id"])
        self.assertEqual(derive("issuer", keys["issuer:lei:724500Y6DUVHQD6OXN27"]), "issuer:lei:724500Y6DUVHQD6OXN27")
        self.assertEqual(derive("issuer", {"cik": "937966"}), "issuer:cik:0000937966")
        self.assertEqual(derive("listing", {"figi": "BBG000K6N6G7"}), "listing:figi:BBG000K6N6G7")
        for row in load("crypto.json")["listings"]:
            caip19 = next(item["value"] for item in load("crypto.json")["assertions"] if item["subject_id"] == row["id"])
            self.assertEqual(derive("listing", {"caip19": caip19}), row["id"])
            self.assertEqual(derive("security", {"caip19": caip19}), row["security_id"])
        self.assertIsNone(derive("security", {}))
        index = identity.provisional_id("security", "eodhd", "catalogue", "GSPC.INDX")
        self.assertEqual(index, "security:provisional:eodhd:catalogue:GSPC.INDX")
        spaced = identity.provisional_id("listing", "ibkr", "contract", "BRK B")
        self.assertEqual(spaced, identity.provisional_id("listing", "ibkr", "contract", "BRK B"))
        self.assertIs(identity.subject_level(spaced), identity.Level.LISTING)

    def test_native_coins_bind_only_through_the_curated_table(self):
        fixture, db = load("crypto.json"), database("reference")
        evidence = load_reference(db, fixture)
        for binding in bindings(fixture, evidence):
            ref = binding.provider_ref
            (caip19,) = db.execute("SELECT caip19 FROM native_coins WHERE provider=? AND native_scope=? AND native_id=?",
                                   (ref.provider, ref.native_scope, ref.native_id)).fetchone()
            self.assertEqual(identity.subject_id("security", {"caip19": caip19}), binding.subject_id)

    def test_fixture_bindings_fit_the_identity_store(self):
        state = database("identity")
        for name in ("asml.json", "crypto.json"):
            fixture = load(name)
            evidence = load_reference(database("reference"), fixture)
            for index, binding in enumerate(bindings(fixture, evidence)):
                ref = binding.provider_ref
                insert(state, "bindings", {
                    "id": f"{name}:{index}", "provider": ref.provider, "native_id": ref.native_id,
                    "native_scope": ref.native_scope, "subject_id": binding.subject_id, "level": binding.level.value,
                    "status": binding.status.value, "tier": binding.tier.value, "authority": binding.authority.value,
                    "rule_id": binding.rule_id, "evidence_ids": list(binding.evidence_ids)})


class ManifestTest(unittest.TestCase):
    def test_accepts_resolve_only_and_bulk_catalogue_plugins(self):
        yahoo = identity.validate_manifest(YAHOO)
        self.assertIs(yahoo.catalogue, identity.CatalogueMode.RESOLVE_ONLY)
        eodhd = identity.validate_manifest(EODHD)
        self.assertIs(eodhd.content[identity.Section.FINANCIALS].level, identity.Level.ISSUER)

    def test_rejects_contract_violations_at_their_path(self):
        cases = {
            "manifest.search": lambda value: value.update(search={"tool": "yahoo_search"}),
            "addressing.schemes.listing": lambda value: value["addressing"]["schemes"].update(listing=["isin"]),
            "content.chart.via": lambda value: value["content"].update(
                chart={"level": "listing", "via": "security", "tool": "yahoo_chart"}),
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
                self.assertTrue(str(caught.exception).startswith(path), caught.exception)


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

    def test_crypto_records_carry_provider_deployments_not_identity_guesses(self):
        coin = {"provider": "coingecko", "native_id": "usd-coin", "native_scope": "coin"}
        self.record(level="security", identifiers=[], native_ref=coin,
                    deployments=[{"chain": "ethereum", "contract": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"}])
        with self.assertRaises(ValueError):
            self.record(native_of="ethereum")


class ResolutionTest(unittest.TestCase):
    item = None

    def setUp(self):
        self.item = identity.QueueItem(id="q1", kind="residual", reason="no_key", subject_ids=["listing:provisional:eodhd:catalogue:ADYEY.US"],
                                       candidate_ids=["security:isin:NL0012969182"], evidence_ids=[], state="open",
                                       opened_at="2026-09-25T10:00:00Z")

    def verdict(self, **overrides):
        value = {"item_id": "q1", "resolver": "plugin", "authority": "model_confirmed", "relation": "same_security",
                 "chosen_id": "security:isin:NL0012969182", "confidence": 0.97, "model": "jev-1.13.0", "prompt_version": "p1",
                 "input_digest": "sha256:" + "0" * 64,
                 "provenance": {**PROVENANCE, "plugin": "jev", "source": "jev"}}
        return identity.Verdict(**{**value, **overrides})

    def test_one_authority_rule_for_every_resolver(self):
        decide, outcome = identity.decide, identity.VerdictOutcome
        verdict = self.verdict()
        self.assertIs(decide(verdict, self.item, contradicted=False, guarded=False, threshold=0.99), outcome.SUGGESTED)
        self.assertIs(decide(verdict, self.item, contradicted=False, guarded=False, threshold=None), outcome.SUGGESTED)
        self.assertIs(decide(verdict, self.item, contradicted=False, guarded=False, threshold=0.95), outcome.CONFIRMED)
        self.assertIs(decide(verdict, self.item, contradicted=False, guarded=True, threshold=0.95), outcome.BLOCKED)
        user = self.verdict(resolver="user", authority="user_attested", confidence=None, model=None, prompt_version=None,
                            input_digest=None, provenance={**PROVENANCE, "plugin": "pythia", "source": "user"})
        self.assertIs(decide(user, self.item, contradicted=False, guarded=False, threshold=None), outcome.CONFIRMED)
        self.assertIs(decide(user, self.item, contradicted=True, guarded=False, threshold=None), outcome.BLOCKED)
        with self.assertRaisesRegex(ValueError, "cannot claim user_attested"):
            self.verdict(authority="user_attested")


if __name__ == "__main__":
    unittest.main()
