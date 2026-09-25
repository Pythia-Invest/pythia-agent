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
from pythia_identity_fixture import directory, model  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures/identity"
PROVENANCE = {"plugin": "eodhd", "source": "eodhd", "adapter_version": "1", "retrieved_at": "2026-09-25T10:00:00Z",
              "redistribution": "local_only"}

YAHOO = {
    "schema_version": 1, "plugin": "yahoo", "provider": "yahoo", "label": "Yahoo Finance",
    "addressing": {
        "native": [{"native_scope": "symbol", "level": "listing", "asset_classes": ["equity", "fund", "index"]}],
        "schemes": {"listing": ["ticker_mic"], "security": ["isin"]},
        "venues": {"mic_table": {"XAMS": {"suffix": ".AS"}, "XNGS": {"suffix": ""}}, "composites": ["US"]},
        "symbol_rules": {"class_separator": "-", "pad": {"XHKG": 4}, "strip_trailing_dot": ["XLON"]},
    },
    "content": {"quote": {"level": "listing", "via": "listing", "tool": "yahoo_quote"},
                "news": {"level": "security", "via": "listing", "tool": "yahoo_news"}},
    "catalogue": {"mode": "resolve_only", "binding_ttl_seconds": 2592000},
    "resolve": {"tool": "yahoo_resolve", "input_schemes": ["isin"], "echoes": ["ticker_mic"], "cost": {"calls": 1, "credits": 0}},
}
EODHD = {
    "schema_version": 1, "plugin": "eodhd", "provider": "eodhd", "label": "EODHD",
    "addressing": {"native": [{"native_scope": "catalogue", "level": "listing"}, {"native_scope": "composite", "level": "composite"}],
                   "schemes": {"security": ["isin", "cusip", "share_class_figi"], "issuer": ["lei", "cik"]},
                   "venues": {"mic_table": {"XAMS": {"code": "AS"}}, "composites": ["US"]}},
    "content": {"quote": {"level": "listing", "via": "listing", "tool": "eodhd_quote"},
                "fundamentals": {"level": "issuer", "via": "listing", "tool": "eodhd_fundamentals"}},
    "catalogue": {"mode": "bulk", "tool": "eodhd_catalogue", "scopes": ["as", "us"], "max_age_seconds": 86400,
                  "redistribution": "local_only"},
    "resolve": {"tool": "eodhd_resolve", "input_schemes": ["isin", "figi", "lei"], "echoes": ["isin", "figi"],
                "cost": {"calls": 1, "credits": 1}},
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
            "adapter_version": provenance.adapter_version, "retrieved_at": provenance.retrieved_at,
            "redistribution": provenance.redistribution.value}


def load_reference(db, fixture):
    """Construct every fixture record through the types, then store it under the DDL's checks."""
    for row in fixture.get("chains", []):
        insert(db, "chains", row)
    for row in fixture.get("issuers", []):
        issuer = model.Issuer(**row)
        insert(db, "issuers", {"id": issuer.id, "name": issuer.name, "country": issuer.country,
                               "legal_form": issuer.legal_form, "status": issuer.status.value})
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
                                "mic": listing.mic, "operating_mic": listing.operating_mic, "ticker_root": listing.ticker_root,
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
            "retrieved_at": relation.provenance.retrieved_at, "redistribution": relation.provenance.redistribution.value})
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
        self.assertEqual(identity.Store.IDENTITY.schema_version, 2)

    def test_directory_row_type_matches_directory_table(self):
        columns = [row[1] for row in database("directory").execute("PRAGMA table_info(rows)")]
        self.assertEqual(columns, list(directory.DirectoryRow.__annotations__))

    def test_levels_are_enforced_by_types_and_by_sql(self):
        fixture = load("asml.json")
        wrong = copy.deepcopy(fixture["assertions"][2])  # the ordinary share's ISIN
        wrong["subject_id"] = "ref:listing:asmlxams"
        with self.assertRaisesRegex(ValueError, "isin cannot identify a listing"):
            model.IdentifierAssertion(**wrong)
        db = database("reference")
        load_reference(db, fixture)
        row = assertion_row(model.IdentifierAssertion(**fixture["assertions"][2]))
        with self.assertRaises(sqlite3.IntegrityError):
            insert(db, "assertions", {**row, "evidence_id": "ev:wrong-level", "subject_id": "ref:listing:asmlxams", "level": "listing"})

    def test_identifier_check_digits(self):
        for scheme, value in (("isin", "NL0010273216"), ("lei", "724500Y6DUVHQD6OXN28"), ("figi", "BBG000C1HT48")):
            with self.subTest(scheme=scheme), self.assertRaises(identity.IdentifierError):
                identity.normalize_identifier(scheme, value)
        self.assertEqual(identity.normalize_identifier("cik", "937966"), "0000937966")
        self.assertEqual(identity.ticker_mic("BRK", "XNYS", "B"), "BRK/B@XNYS")


class FixtureTest(unittest.TestCase):
    def test_asml_lines_are_two_securities_of_one_issuer_joined_by_a_receipt_relation(self):
        fixture, db = load("asml.json"), database("reference")
        evidence = load_reference(db, fixture)
        securities = db.execute("SELECT id, kind FROM securities WHERE issuer_id='ref:issuer:asml0001' ORDER BY id").fetchall()
        self.assertEqual(securities, [("ref:security:asmlnyrs", "depositary_receipt"), ("ref:security:asmlord1", "ordinary")])
        self.assertEqual(db.execute("SELECT type, ratio FROM relations").fetchall(), [("depositary_receipt_of", "1")])
        levels = {binding.provider_ref.native_id: binding.level for binding in bindings(fixture, evidence)}
        self.assertEqual(levels, {"ASML.AS": identity.Level.LISTING, "ASML": identity.Level.LISTING,
                                  "ASML.US": identity.Level.COMPOSITE})

    def test_fixture_bindings_rows_and_search_fit_the_stores(self):
        rows = []
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
                    "rule_id": binding.rule_id, "evidence_ids": list(binding.evidence_ids),
                    "record_digest": model.evidence_id({"binding": ref.wire(), "subject": binding.subject_id}), "revision": 1})
            rows += fixture["directory_rows"]
        found = database("directory")
        for row in rows:
            self.assertEqual(set(row), set(directory.DirectoryRow.__annotations__))
            insert(found, "rows", row)
            insert(found, "rows_text", {"row_id": row["row_id"], "name": row["name"], "issuer_name": row["issuer_name"],
                                        "aliases": " ".join(row["aliases"]), "tickers": row["ticker_display"]})
        hits = [hit for (hit,) in found.execute("SELECT row_id FROM rows_text WHERE rows_text MATCH 'asm*' ORDER BY row_id")]
        self.assertEqual(hits, ["ref:listing:asmlxams", "ref:listing:asmlxngs"])
        hits = [hit for (hit,) in found.execute("SELECT row_id FROM rows_text WHERE rows_text MATCH 'ethereum'")]
        self.assertEqual(hits, ["ref:security:eth00001"])
        self.assertEqual(state.execute("SELECT count(*) FROM bindings WHERE status='confirmed'").fetchone()[0], 10)


class ManifestTest(unittest.TestCase):
    def test_accepts_resolve_only_and_bulk_catalogue_plugins(self):
        yahoo = identity.validate_manifest(YAHOO)
        self.assertIs(yahoo.catalogue.mode, identity.CatalogueMode.RESOLVE_ONLY)
        self.assertEqual(yahoo.addressing.mic_table["XAMS"].suffix, ".AS")
        eodhd = identity.validate_manifest(EODHD)
        self.assertIs(eodhd.content[identity.Section.FUNDAMENTALS].level, identity.Level.ISSUER)

    def test_rejects_contract_violations(self):
        cases = {
            "provider search is not part of": lambda value: value.update(search={"tool": "yahoo_search"}),
            "isin identifies a security": lambda value: value["addressing"]["schemes"].update(listing=["isin"]),
            "broader reference cannot address": lambda value: value["content"].update(
                chart={"level": "listing", "via": "security", "tool": "yahoo_chart"}),
            "resolve_only requires a resolve": lambda value: value.pop("resolve"),
            "unknown field": lambda value: value["catalogue"].update(tool="yahoo_catalogue"),
        }
        for message, change in cases.items():
            document = copy.deepcopy(YAHOO)
            change(document)
            with self.subTest(message=message), self.assertRaisesRegex(identity.ManifestError, message):
                identity.validate_manifest(document)


class ClaimTest(unittest.TestCase):
    def record(self, **overrides):
        value = {"level": "listing", "provenance": PROVENANCE,
                 "native_ref": {"provider": "eodhd", "native_id": "ASML.AS", "native_scope": "catalogue"},
                 "identifiers": [{"scheme": "isin", "value": "NL0010273215"}],
                 "attributes": {"ticker_root": "ASML", "provider_venue": "AS", "currency": "EUR"}}
        return identity.RecordClaim(**{**value, **overrides})

    def batch(self, *claims):
        return identity.ClaimBatch("eodhd", "eodhd", "1", "catalogue", claims, scope="as")

    def test_catalogue_page_is_accepted(self):
        identity.check_batch(self.batch(self.record()), identity.validate_manifest(EODHD))

    def test_plugins_cannot_reconcile_or_republish_licensed_rows(self):
        manifest = identity.validate_manifest(EODHD)
        foreign = self.record(native_ref={"provider": "yahoo", "native_id": "ASML.AS", "native_scope": "symbol"})
        with self.assertRaisesRegex(identity.ClaimError, "binds only its own"):
            identity.check_batch(self.batch(foreign), manifest)
        opened = self.record(provenance={**PROVENANCE, "redistribution": "open"})
        with self.assertRaisesRegex(identity.ClaimError, "republishable"):
            identity.check_batch(self.batch(opened), manifest)
        with self.assertRaisesRegex(ValueError, "cannot assert figi"):
            self.record(level="security", native_ref=None, identifiers=[{"scheme": "figi", "value": "BBG000C1HT47"}])


class ResolutionTest(unittest.TestCase):
    item = None

    def setUp(self):
        self.item = identity.QueueItem(id="q1", kind="residual", reason="no_key", subject_ids=["local:listing:adyey001"],
                                       candidate_ids=["ref:security:adyen001"], evidence_ids=[], state="open",
                                       opened_at="2026-09-25T10:00:00Z")

    def verdict(self, **overrides):
        value = {"item_id": "q1", "resolver": "plugin", "authority": "model_confirmed", "relation": "same_security",
                 "chosen_id": "ref:security:adyen001", "confidence": 0.97, "model": "jev-1.13.0", "prompt_version": "p1",
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
