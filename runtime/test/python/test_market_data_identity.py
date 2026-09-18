"""Synthetic identity records, never provider responses.

Shaped by IB API 10.50.2 Contract/ContractDetails conId, primaryExchange and
optional secIdList; https://www.interactivebrokers.com/docs/tws-api/ref/contract-details
Invented ZZ-prefixed checksummed ISINs test scope, not real securities.
"""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from types import ModuleType

ROOT = Path(__file__).resolve().parents[2] / "managed/plugins/market-data"
PACKAGE = "market_identity_fixture"
spec = importlib.util.spec_from_file_location(PACKAGE, ROOT / "__init__.py", submodule_search_locations=[str(ROOT)])
module = importlib.util.module_from_spec(spec)
sys.modules[PACKAGE] = module
# Isolated dependency injection for provider-free domain tests. The assembled
# qualification exercises actual native discovery and dependency ownership.
PLATFORM = 'pythia_platform_fixture'
platform_root = ROOT.parents[1] / 'plugin' / 'platform'
platform_spec = importlib.util.spec_from_file_location(PLATFORM, platform_root / '__init__.py',
                                                     submodule_search_locations=[str(platform_root)])
platform_module = importlib.util.module_from_spec(platform_spec)
sys.modules[PLATFORM] = platform_module
platform_spec.loader.exec_module(platform_module)
dependency = ModuleType(PACKAGE + '._platform')
dependency.platform = lambda: platform_module
sys.modules[dependency.__name__] = dependency
# Identity modules are provider-free: don't execute the native plugin initializer.
from importlib import import_module
identity = import_module(f"{PACKAGE}.identity")
matching = import_module(f"{PACKAGE}.identity_matching")
wire = import_module(f"{PACKAGE}.wire")


def isin(seed):
    prefix = f"ZZ{seed:09d}"
    return next(prefix + str(i) for i in range(10) if matching.valid_isin(prefix + str(i)))


def native(conid, venue="VENUE_A", currency="USD", route="SMART"):
    return {"provider": "ibkr", "native_scope": "contract", "native_id": str(conid),
            "qualifiers": {"venue": venue, "currency": currency, "route": route}}


def evidence(ref, *, standard=None, share_class=None, listing=False, version="adapter-1", suffix="", authority="source_asserted"):
    qualifiers = {}
    if share_class:
        qualifiers["share_class"] = share_class
    if listing:
        qualifiers.update({key: ref["qualifiers"][key] for key in ("venue", "currency")})
    base = {"schema_version": 1, "provider_ref": ref, "scope": "listing" if listing else "instrument",
            "scheme": "native", "value": ref["native_id"], "qualifiers": qualifiers,
            "adapter_version": version, "observed_at": None, "retrieved_at": "2026-01-05T12:00:00Z",
            "effective": {"start": None, "end": None}, "authority": authority}
    key = ref["native_id"] + ref["qualifiers"]["venue"] + ref["qualifiers"]["route"] + suffix
    records = [{**base, "id": "evidence:native-" + key}]
    if standard:
        records.append({**base, "scope": "instrument", "scheme": "isin", "value": standard,
                        "id": "evidence:isin-" + key})
    return records


class CautiousOldRule(matching.EquityRules):
    versions = {**matching.RULE_VERSIONS, "ibkr_instrument_isin": "old-overrestrictive"}

    def evaluate(self, *args):
        native_ref, records, _, _, scope = args
        if scope == "instrument" and any(e["scheme"] == "isin" for e in records) and native_ref["qualifiers"]["route"] == "DIRECT":
            return "candidate"
        return super().evaluate(*args)


class OldClassDefect(matching.EquityRules):
    versions = {**matching.RULE_VERSIONS, "ibkr_instrument_isin": "old-class-defect"}

    def evaluate(self, native_ref, records, target_ref, target_records, scope):
        # A narrow historical defect: same ISIN wrongly trumped contradictory
        # share-class metadata. Production current rule must quarantine it.
        def omit_class(items):
            return [{**e, "qualifiers": {k: v for k, v in e["qualifiers"].items() if k != "share_class"}} for e in items]
        return super().evaluate(native_ref, omit_class(records), target_ref, omit_class(target_records), scope)


class IdentityTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = identity.IdentityStore(self.directory.name)

    def save(self, ref, records, scope="instrument", store=None):
        store = store or self.store
        ids = store.ingest(ref, records)
        result = store.save(ref, scope, ids)
        self.assertEqual(wire.validate("mapping", result["mapping"]), result["mapping"])
        return result

    def seed_old_confirmation(self, store, result):
        # Simulate the persisted output of the obsolete same-ISIN-over-class bug.
        # Current proof checks deliberately cannot manufacture this unsafe state.
        result = json.loads(json.dumps(result))
        result["mapping"]["status"] = "confirmed"
        with store.database.transaction() as db:
            db.execute("UPDATE mappings SET status='confirmed',reason='supported_evidence' WHERE id=?", (result["mapping"]["id"],))
            db.execute("UPDATE revisions SET data=? WHERE mapping_id=? AND revision=?",
                       (json.dumps(result["mapping"]), result["mapping"]["id"], result["mapping"]["revision"]))
        return result

    def test_refreshed_candidate_with_two_proven_peers_remains_ambiguous(self):
        peers = []
        for number in (101, 102):
            ref = native(number)
            peers.append(self.save(ref, evidence(ref)))
        for number, peer in zip((101, 102), peers):
            ref = native(number)
            self.store.refresh(peer['mapping']['id'], self.store.ingest(ref, evidence(ref, standard=isin(1), suffix='fresh')))
        ref = native(103)
        candidate = self.save(ref, [])
        intent = self.store.subject(candidate['mapping']['target'])
        token = self.store.cache_token()
        ids = self.store.ingest(ref, evidence(ref, standard=isin(1), suffix='qualified'))
        current = self.store.refresh(candidate['mapping']['id'], ids)
        self.assertEqual(current['mapping']['status'], 'conflicting')
        self.assertEqual(current['repair'], 'ambiguous_existing_subjects')
        self.assertEqual(current['mapping']['target'], candidate['mapping']['target'])
        self.assertEqual(self.store.subject(candidate['mapping']['target']), intent)
        self.assertEqual(self.store.bindings(candidate['mapping']['target'])['mappings'], [])
        self.assertGreater(current['generation'], token)
        self.assertEqual(self.store.history(candidate['mapping']['id'])[0], candidate['mapping'])
        reopened = identity.IdentityStore(self.directory.name)
        self.assertEqual(reopened.inspect(candidate['mapping']['id'])['mapping'], current['mapping'])
        self.assertEqual(reopened.bindings(candidate['mapping']['target'])['mappings'], [])

    def test_negative_override_with_replaced_or_recovered_proof_does_not_block_refresh(self):
        for recovered in (False, True):
            with self.subTest(recovered=recovered), tempfile.TemporaryDirectory() as directory:
                store = identity.IdentityStore(directory)
                a, b = native(201), native(202)
                first = self.save(a, evidence(a, standard=isin(2)), store=store)
                linked = self.save(b, evidence(b, standard=isin(2)), store=store)
                different = store.ingest(b, evidence(b, standard=isin(3), suffix='different'))
                store.refresh(linked['mapping']['id'], different)
                overridden = store.apply_override(linked['mapping']['id'], 'negative', different)
                intent = store.subject(first['mapping']['target'])
                token = store.cache_token()
                fresh = store.ingest(b, evidence(b, standard=isin(2 if recovered else 3), suffix='replacement'))
                result = store.refresh(linked['mapping']['id'], fresh)
                self.assertIsNone(result['mapping']['active_override'])
                self.assertEqual(result['mapping']['evidence_ids'], fresh)
                self.assertEqual(result['mapping']['status'], 'confirmed' if recovered else 'conflicting')
                self.assertEqual(store.overrides(linked['mapping']['id'])[0]['state'], 'quarantined' if recovered else 'retired')
                self.assertIn(overridden['mapping'], store.history(linked['mapping']['id']))
                self.assertEqual(store.subject(first['mapping']['target']), intent)
                self.assertGreater(result['generation'], token)
                self.assertEqual(len(store.bindings(first['mapping']['target'])['mappings']), 2 if recovered else 1)

    def test_positive_override_cannot_reuse_replaced_evidence_ids(self):
        store = identity.IdentityStore(self.directory.name, rules=CautiousOldRule())
        a, b = native(301), native(302, route='DIRECT')
        first = self.save(a, evidence(a, standard=isin(4)), store=store)
        candidate = self.save(b, evidence(b, standard=isin(4)), store=store)
        overridden = store.apply_override(candidate['mapping']['id'], 'positive', candidate['mapping']['evidence_ids'], first['mapping']['target'])
        replacement = store.ingest(b, evidence(b, standard=isin(4), suffix='replacement'))
        result = store.refresh(candidate['mapping']['id'], replacement)
        self.assertIsNone(result['mapping']['active_override'])
        self.assertEqual(result['mapping']['status'], 'candidate')
        self.assertEqual(store.overrides(candidate['mapping']['id'])[0]['state'], 'quarantined')
        self.assertIn(overridden['mapping'], store.history(candidate['mapping']['id']))
        self.assertNotIn(candidate['mapping']['id'], [m['id'] for m in store.bindings(first['mapping']['target'])['mappings']])

    def test_native_and_instrument_scopes_survive_restart_without_listing_merge(self):
        a, b = native(101), native(102, venue="VENUE_B", currency="EUR")
        first = self.save(a, evidence(a, standard=isin(1), listing=True))
        second = self.save(b, evidence(b, standard=isin(1), listing=True))
        self.assertEqual(first["mapping"]["target"], second["mapping"]["target"])
        la = self.store.save(a, "listing", first["mapping"]["evidence_ids"])
        lb = self.store.save(b, "listing", second["mapping"]["evidence_ids"])
        self.assertNotEqual(la["mapping"]["target"], lb["mapping"]["target"])
        restarted = identity.IdentityStore(self.directory.name)
        self.assertEqual(restarted.inspect(first["mapping"]["id"])["mapping"], first["mapping"])
        self.assertEqual(len(restarted.bindings(first["mapping"]["target"])["mappings"]), 2)
        for listing in (la, lb):
            self.assertEqual(listing["mapping"]["status"], "confirmed")
            self.assertEqual(len(restarted.bindings(listing["mapping"]["target"])["mappings"]), 1)

    def test_names_query_ids_smart_and_classes_do_not_create_false_matches(self):
        a, b = native(111), native(112)
        first = self.save(a, evidence(a, standard=isin(2), share_class="A"))
        second = self.save(b, evidence(b, standard=isin(2), share_class="B"))
        self.assertNotEqual(first["mapping"]["target"], second["mapping"]["target"])
        query = native(113)
        records = evidence(query, standard=isin(2), authority="query_only")
        result = self.save(query, records)
        self.assertEqual(result["mapping"]["status"], "candidate")
        self.assertEqual(self.store.bindings(result["mapping"]["target"])["mappings"], [])
        guessed = native(114, venue="SMART")
        self.assertEqual(self.save(guessed, evidence(guessed, listing=True), "listing")["mapping"]["status"], "candidate")
        missing = native(115)
        name = evidence(missing)[0]
        name.update(scheme="name", value="Fictional Same Company")
        unknown = self.save(missing, [name])
        self.assertEqual(unknown["mapping"]["status"], "candidate")
        with self.assertRaises(wire.WireError):
            self.store.save(missing, "company", [name["id"]])

    def test_evidence_is_immutable_scoped_and_requires_valid_isin(self):
        ref = native(120)
        records = evidence(ref, standard=isin(3))
        ids = self.store.ingest(ref, records)
        changed = [{**records[0], "value": "999"}]
        with self.assertRaisesRegex(wire.WireError, "immutable"):
            self.store.ingest(ref, changed)
        with self.assertRaises(wire.WireError):
            self.store.save(native(121), "instrument", ids)
        invalid = evidence(ref, standard="ZZ0000000000", suffix="invalid")
        self.assertFalse(matching.valid_isin(invalid[-1]["value"]))
        with self.assertRaisesRegex(wire.WireError, "ISIN"):
            self.store.ingest(ref, invalid)

    def test_positive_override_and_relevant_fix_retire_without_rematching(self):
        old = identity.IdentityStore(self.directory.name, rules=CautiousOldRule())
        a, b, unrelated = native(130), native(131, route="DIRECT"), native(132)
        good = self.save(a, evidence(a, standard=isin(4)), store=old)
        pending = self.save(b, evidence(b, standard=isin(4)), store=old)
        separate = self.save(unrelated, evidence(unrelated), store=old)
        self.assertEqual(pending["mapping"]["status"], "candidate")
        fixed = old.apply_override(pending["mapping"]["id"], "positive", pending["mapping"]["evidence_ids"], good["mapping"]["target"])
        self.assertEqual(fixed["mapping"]["status"], "confirmed")
        wire.validate("mapping", fixed["mapping"])
        token = old.cache_token()
        current = identity.IdentityStore(self.directory.name)
        repaired = current.inspect(fixed["mapping"]["id"])
        self.assertIsNone(repaired["mapping"]["active_override"])
        self.assertEqual(current.overrides(fixed["mapping"]["id"])[0]["state"], "retired")
        self.assertEqual(current.inspect(separate["mapping"]["id"])["mapping"], separate["mapping"])
        self.assertGreater(repaired["generation"], token)
        with self.assertRaisesRegex(wire.WireError, "stale"):
            with current.current_generation(token):
                self.fail("old read was admitted")
        self.assertEqual(current.history(pending["mapping"]["id"])[0], pending["mapping"])

    def test_rule_fix_joins_newly_proven_candidate_without_investor_rematching(self):
        old = identity.IdentityStore(self.directory.name, rules=CautiousOldRule())
        a, b = native(135), native(136, route="DIRECT")
        good = self.save(a, evidence(a, standard=isin(13)), store=old)
        pending = self.save(b, evidence(b, standard=isin(13)), store=old)
        original = pending["mapping"]["target"]
        repaired = self.store.inspect(pending["mapping"]["id"])
        self.assertEqual(repaired["mapping"]["status"], "confirmed")
        self.assertEqual(repaired["mapping"]["target"], good["mapping"]["target"])
        self.assertEqual(repaired["intent_subject"], original)
        self.assertEqual(self.store.bindings(original)["mappings"][0]["id"], pending["mapping"]["id"])
        c = native(137)
        third = self.save(c, evidence(c, standard=isin(13)))
        self.assertEqual(third["mapping"]["target"], good["mapping"]["target"])

    def test_corrected_rule_quarantines_wrong_class_preserving_original_intent(self):
        old = identity.IdentityStore(self.directory.name, rules=OldClassDefect())
        a, b = native(140), native(141)
        first = self.save(a, evidence(a, standard=isin(5), share_class="A"), store=old)
        bad = self.seed_old_confirmation(old, self.save(b, evidence(b, standard=isin(5), share_class="B"), store=old))
        self.assertEqual(first["mapping"]["target"], bad["mapping"]["target"])
        self.assertEqual(bad["mapping"]["status"], "confirmed")
        corrected = self.store.inspect(bad["mapping"]["id"])
        self.assertEqual(corrected["mapping"]["status"], "conflicting")
        self.assertEqual(corrected["intent_subject"], bad["intent_subject"])
        self.assertEqual(corrected["native_ref"], b)
        self.assertEqual(self.store.history(bad["mapping"]["id"])[0], bad["mapping"])
        self.assertNotIn(bad["mapping"]["id"], [m["id"] for m in self.store.bindings(first["mapping"]["target"])["mappings"]])

    def test_negative_override_needs_contradiction_and_cannot_invent_replacement(self):
        old = identity.IdentityStore(self.directory.name, rules=OldClassDefect())
        a, b = native(150), native(151)
        first = self.save(a, evidence(a, standard=isin(6), share_class="A"), store=old)
        bad = self.seed_old_confirmation(old, self.save(b, evidence(b, standard=isin(6), share_class="B"), store=old))
        blocked = old.apply_override(bad["mapping"]["id"], "negative", bad["mapping"]["evidence_ids"])
        self.assertEqual(blocked["mapping"]["status"], "rejected")
        with self.assertRaises(wire.WireError):
            old.apply_override(bad["mapping"]["id"], "positive", bad["mapping"]["evidence_ids"], first["mapping"]["target"])
        with self.assertRaises(wire.WireError):
            old.apply_override(first["mapping"]["id"], "negative", first["mapping"]["evidence_ids"])
        repaired = self.store.inspect(bad["mapping"]["id"])
        self.assertEqual(repaired["mapping"]["status"], "conflicting")
        self.assertIsNone(repaired["mapping"]["active_override"])
        self.assertEqual(self.store.overrides(bad["mapping"]["id"])[0]["state"], "retired")

    def test_positive_correction_does_not_route_a_different_class_for_retained_intent(self):
        a, b, c = native(155), native(156), native(157)
        original = self.save(a, evidence(a, standard=isin(20), share_class="A"))
        selected = self.save(b, evidence(b, standard=isin(20), share_class="A"))
        replacement = self.save(c, evidence(c, standard=isin(21), share_class="C"))
        self.assertEqual(selected["mapping"]["target"], original["mapping"]["target"])
        corrected_ids = self.store.ingest(b, evidence(b, standard=isin(21), share_class="C", suffix="corrected"))
        refreshed = self.store.refresh(selected["mapping"]["id"], corrected_ids)
        self.assertEqual(refreshed["mapping"]["status"], "conflicting")
        corrected = self.store.apply_override(selected["mapping"]["id"], "positive", corrected_ids, replacement["mapping"]["target"])
        self.assertEqual(corrected["mapping"]["status"], "confirmed")
        self.assertEqual(corrected["intent_subject"], original["mapping"]["target"])
        self.assertEqual(corrected["mapping"]["target"], replacement["mapping"]["target"])
        old_routes = self.store.bindings(original["mapping"]["target"])["mappings"]
        self.assertEqual([m["id"] for m in old_routes], [original["mapping"]["id"]])
        new_routes = self.store.bindings(replacement["mapping"]["target"])["mappings"]
        self.assertIn(selected["mapping"]["id"], [m["id"] for m in new_routes])
        self.assertEqual(self.store.history(selected["mapping"]["id"])[0], selected["mapping"])

    def test_unknown_original_evidence_is_lineage_not_alias_authority(self):
        b, c = native(158), native(159)
        pending = self.save(b, evidence(b, authority="query_only"))
        replacement = self.save(c, evidence(c, standard=isin(22)))
        fresh_ids = self.store.ingest(b, evidence(b, standard=isin(22), suffix="asserted"))
        self.store.refresh(pending["mapping"]["id"], fresh_ids)
        corrected = self.store.apply_override(pending["mapping"]["id"], "positive", fresh_ids, replacement["mapping"]["target"])
        self.assertEqual(corrected["mapping"]["status"], "confirmed")
        self.assertEqual(self.store.bindings(pending["mapping"]["target"])["mappings"], [])
        self.assertEqual(corrected["intent_subject"], pending["mapping"]["target"])

    def test_adapter_revision_requires_refresh_offline_and_preserves_history(self):
        ref = native(160)
        saved = self.save(ref, evidence(ref, standard=isin(7)))
        updated = identity.IdentityStore(self.directory.name, evidence_versions={"ibkr": "adapter-2"})
        pending = updated.inspect(saved["mapping"]["id"])
        self.assertEqual(pending["repair"], "pending_evidence_refresh")
        self.assertEqual(updated.bindings(saved["mapping"]["target"])["mappings"], [])
        self.assertEqual(updated.inspect(saved["mapping"]["id"])["mapping"]["revision"], pending["mapping"]["revision"])
        fresh_ids = updated.ingest(ref, evidence(ref, standard=isin(8), version="adapter-2", suffix="new"))
        refreshed = updated.refresh(saved["mapping"]["id"], fresh_ids)
        # Retained intent needs a supported repair, not silent reassignment.
        self.assertNotEqual(refreshed["mapping"]["status"], "confirmed")
        self.assertEqual(updated.history(saved["mapping"]["id"])[0], saved["mapping"])

    def test_optional_identifier_enrichment_and_same_listing_routes(self):
        a = native(165)
        selected = self.save(a, evidence(a, listing=True))
        original = selected["mapping"]["target"]
        richer_ids = self.store.ingest(a, evidence(a, standard=isin(10), listing=True, suffix="enriched"))
        enriched = self.store.refresh(selected["mapping"]["id"], richer_ids)
        self.assertEqual(enriched["mapping"]["target"], original)
        other = native(166, venue="VENUE_B", currency="EUR")
        linked = self.save(other, evidence(other, standard=isin(10)))
        self.assertEqual(linked["mapping"]["target"], original)
        direct = native(165, route="DIRECT")
        direct_ids = self.store.ingest(direct, evidence(direct, standard=isin(10), listing=True))
        routed = self.store.save(direct, "listing", direct_ids)
        smart = self.store.save(a, "listing", richer_ids)
        self.assertEqual(routed["mapping"]["target"], smart["mapping"]["target"])
        self.assertNotEqual(routed["native_ref"], smart["native_ref"])
        self.assertEqual(self.store.subject(original)["original_evidence_ids"], selected["mapping"]["evidence_ids"])

    def test_fresh_evidence_recovers_pending_without_rewriting_original_intent(self):
        a = native(167)
        selected = self.save(a, evidence(a, standard=isin(11)))
        updated = identity.IdentityStore(self.directory.name, evidence_versions={"ibkr": "adapter-2"})
        self.assertEqual(updated.inspect(selected["mapping"]["id"])["repair"], "pending_evidence_refresh")
        ids = updated.ingest(a, evidence(a, standard=isin(11), version="adapter-2", suffix="fresh"))
        refreshed = updated.refresh(selected["mapping"]["id"], ids)
        self.assertEqual(refreshed["mapping"]["status"], "confirmed")
        wire.validate("mapping", refreshed["mapping"])
        for mapping in updated.bindings(selected["mapping"]["target"])["mappings"]:
            wire.validate("mapping", mapping)
        self.assertEqual(refreshed["mapping"]["target"], selected["mapping"]["target"])

    def test_ambiguous_subjects_do_not_self_confirm_after_version_update(self):
        # Two independently retained identities acquire the same identifier;
        # no generic merge or arbitrary first-match is permitted.
        a, b = native(180), native(181)
        first = self.save(a, evidence(a))
        second = self.save(b, evidence(b))
        for ref, selected in ((a, first), (b, second)):
            ids = self.store.ingest(ref, evidence(ref, standard=isin(14), suffix="added"))
            self.store.refresh(selected["mapping"]["id"], ids)
        c = native(182)
        ambiguous = self.save(c, evidence(c, standard=isin(14)))
        self.assertEqual(ambiguous["repair"], "ambiguous_existing_subjects")
        class Updated(matching.EquityRules):
            versions = {**matching.RULE_VERSIONS, "ibkr_instrument_isin": "next"}
        changed = identity.IdentityStore(self.directory.name, rules=Updated())
        after = changed.inspect(ambiguous["mapping"]["id"])
        self.assertEqual(after["mapping"]["status"], "conflicting")
        self.assertEqual(after["repair"], "ambiguous_existing_subjects")
        self.assertEqual(changed.bindings(after["mapping"]["target"])["mappings"], [])
        for record in changed.history(after["mapping"]["id"]):
            wire.validate("mapping", record)

    def test_private_state_rejects_links_shared_modes_and_nonregular_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            external = root / "outside"
            external.write_text("untouched")
            profile = root / "profile"
            profile.mkdir(mode=0o700)
            (profile / "identity.sqlite3").symlink_to(external)
            with self.assertRaises(PermissionError):
                identity.IdentityStore(profile)
            self.assertEqual(external.read_text(), "untouched")
            (profile / "identity.sqlite3").unlink()
            profile.chmod(0o755)
            with self.assertRaises(PermissionError):
                identity.IdentityStore(profile)
            profile.chmod(0o700)
            (profile / "identity.sqlite3").mkdir()
            with self.assertRaises(PermissionError):
                identity.IdentityStore(profile)

    def test_concurrent_save_and_interrupted_repair_are_atomic(self):
        ref = native(170)
        ids = self.store.ingest(ref, evidence(ref, standard=isin(9)))
        barrier = threading.Barrier(2)
        def concurrent_save():
            other = identity.IdentityStore(self.directory.name)
            barrier.wait(timeout=3)
            return other.save(ref, "instrument", ids)
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(concurrent_save) for _ in range(2)]
            results = [future.result(timeout=5) for future in futures]
        self.assertEqual(results[0]["mapping"], results[1]["mapping"])
        saved = results[0]
        another_ref = native(171)
        another = self.save(another_ref, evidence(another_ref, standard=isin(12)))
        token = self.store.cache_token()
        class Interrupted(matching.EquityRules):
            versions = {**matching.RULE_VERSIONS, "ibkr_instrument_isin": "next"}
            calls = 0
            def evaluate(self, *args):
                self.calls += 1
                if self.calls == 2:
                    raise InterruptedError("synthetic interrupted transaction after first row")
                return super().evaluate(*args)
        broken = identity.IdentityStore(self.directory.name, rules=Interrupted())
        with self.assertRaises(InterruptedError):
            broken.inspect(saved["mapping"]["id"])
        self.assertEqual(self.store.cache_token(), token)
        self.assertEqual(self.store.inspect(saved["mapping"]["id"])["mapping"], saved["mapping"])
        self.assertEqual(len(self.store.history(saved["mapping"]["id"])), 1)
        self.assertEqual(self.store.inspect(another["mapping"]["id"])["mapping"], another["mapping"])
        class Repaired(matching.EquityRules):
            versions = Interrupted.versions
        repair_barrier = threading.Barrier(2)
        def concurrent_repair():
            store = identity.IdentityStore(self.directory.name, rules=Repaired())
            repair_barrier.wait(timeout=3)
            return store.cache_token()
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(concurrent_repair) for _ in range(2)]
            tokens = [future.result(timeout=5) for future in futures]
        self.assertEqual(tokens, [token + 2, token + 2])


if __name__ == "__main__":
    unittest.main()
