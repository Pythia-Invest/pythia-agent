"""Synthetic normalized equity assertions; no provider payloads or connections.

EODHD native catalogue/ISIN assertions do not establish cross-reference identity.
Qualified fixtures add synthetic OpenFIGI share-class evidence shaped by
https://www.openfigi.com/api/documentation. IBKR ContractDetails supplies
conId/secIdList. ZZ ISINs and FIGIs here are invented, never provider responses.
"""
import json
import tempfile
import unittest

from test_market_data_identity import identity, matching, wire, native, evidence, isin

VERSIONS = {'ibkr': 'ib-7', 'eodhd': 'eod-2'}
PAIR = 'ibkr_eodhd_instrument_isin'


def catalogue(symbol='SYNTH.US', currency='USD'):
    return {'provider': 'eodhd', 'native_scope': 'catalogue', 'native_id': symbol,
            'qualifiers': {'currency': currency}}


def records(ref, standard=None, *, version=None, suffix='', share_class=None, native_authority='source_asserted', isin_authority='source_asserted'):
    # Reuse the existing source-shaped fixture, then bind exact EOD catalogue ref.
    temporary = ref if ref['provider'] == 'ibkr' else native(501)
    rows = evidence(temporary, standard=standard, share_class=share_class,
                    version=version or VERSIONS[ref['provider']], suffix=suffix)
    for row in rows:
        row['provider_ref'] = ref
        row['id'] += '-' + ref['provider'] + '-' + ref['native_id']
        if row['scheme'] == 'native':
            row['value'], row['authority'] = ref['native_id'], native_authority
        else:
            row['authority'] = isin_authority
    if standard and native_authority == isin_authority == 'source_asserted':
        rows.append({**rows[0], 'id': rows[0]['id'] + '-share-class', 'scope': 'instrument',
                     'scheme': 'figi', 'value': 'BBG' + standard[2:11],
                     'identifier_context': {'authority': 'openfigi', 'level': 'share_class',
                         'security_type': 'Common Stock', 'market_sector': 'Equity',
                         'adapter_version': '1', 'reference_id': 'BBG' + standard[2:11]}})
    return rows


class OldCrossClassDefect(matching.EquityRules):
    versions = {**matching.RULE_VERSIONS, PAIR: 'old-class-defect'}

    def evaluate(self, left, rows, right, target_rows, scope):
        if matching.pair_rule(left, right, scope):
            def omit(items):
                return [{**e, 'qualifiers': {k: v for k, v in e['qualifiers'].items() if k != 'share_class'}} for e in items]
            rows, target_rows = omit(rows), omit(target_rows)
        return super().evaluate(left, rows, right, target_rows, scope)


class EquityMatchingTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = identity.IdentityStore(self.directory.name, evidence_versions=VERSIONS)

    def save(self, ref, rows=None, *, store=None, scope='instrument'):
        store = store or self.store
        return store.save(ref, scope, store.ingest(ref, rows if rows is not None else records(ref, isin(301))))

    def test_bare_catalogue_isin_cannot_merge_receipt_or_another_provider(self):
        a, b = catalogue('ORDINARY.US'), catalogue('RECEIPT.BA')
        rows_a, rows_b = records(a, isin(401))[:2], records(b, isin(401))[:2]
        self.assertEqual(matching.compare(a, rows_a, b, rows_b, 'instrument'), 'candidate')
        self.assertEqual(matching.compare(native(401), records(native(401), isin(401))[:2], b, rows_b, 'instrument'), 'candidate')
        self.assertEqual(matching.compare(a, rows_a, a, rows_a, 'instrument'), 'confirmed')

    def test_share_class_proof_rejects_composite_wrong_type_and_stale_reference_version(self):
        a, b = catalogue(), native(401)
        left, right = records(a, isin(401)), records(b, isin(401))
        right[-1]['identifier_context']['level'] = 'composite'
        self.assertNotEqual(matching.compare(a, left, b, right, 'instrument'), 'confirmed')
        right[-1]['identifier_context']['level'] = 'share_class'
        right[-1]['identifier_context']['security_type'] = 'Depositary Receipt'
        self.assertEqual(matching.compare(a, left, b, right, 'instrument'), 'conflicting')
        saved = self.save(a, left)
        updated = identity.IdentityStore(self.directory.name, evidence_versions={**VERSIONS, 'openfigi': '2'})
        self.assertEqual(updated.inspect(saved['mapping']['id'])['repair'], 'pending_evidence_refresh')

    def test_retired_isin_rule_rechecks_existing_cross_provider_mapping(self):
        class OldISINRule(matching.EquityRules):
            versions = {**matching.RULE_VERSIONS, PAIR: 'old', 'eodhd_instrument_isin': 'old'}
            def evaluate(self, native_ref, rows, target, target_rows, scope):
                if scope == 'instrument' and {r['value'] for r in rows if r['scheme'] == 'isin'} & {r['value'] for r in target_rows if r['scheme'] == 'isin'}:
                    return 'confirmed'
                return super().evaluate(native_ref, rows, target, target_rows, scope)
        old = identity.IdentityStore(self.directory.name, rules=OldISINRule(), evidence_versions=VERSIONS)
        a, b = catalogue(), native(402)
        first = self.save(a, records(a, isin(402))[:2], store=old)
        merged = self.save(b, records(b, isin(402))[:2], store=old)
        self.assertEqual(first['mapping']['target'], merged['mapping']['target'])
        repaired = self.store.inspect(merged['mapping']['id'])
        self.assertEqual(repaired['mapping']['status'], 'candidate')
        self.assertEqual(repaired['intent_subject'], merged['intent_subject'])
        self.assertEqual(self.store.history(merged['mapping']['id'])[0], merged['mapping'])

    def test_both_save_orders_join_same_instrument_but_never_listing_or_reference(self):
        for reverse in (False, True):
            with self.subTest(reverse=reverse), tempfile.TemporaryDirectory() as directory:
                store = identity.IdentityStore(directory, evidence_versions=VERSIONS)
                refs = [native(501), catalogue(currency='EUR')]
                if reverse:
                    refs.reverse()
                first, second = [self.save(ref, store=store) for ref in refs]
                self.assertEqual(first['mapping']['target'], second['mapping']['target'])
                self.assertEqual(second['mapping']['status'], 'confirmed')
                reopened = identity.IdentityStore(directory, evidence_versions=VERSIONS)
                bindings = reopened.bindings(first['mapping']['target'])['mappings']
                self.assertEqual({m['provider_ref']['provider'] for m in bindings}, {'ibkr', 'eodhd'})
                self.assertEqual(reopened.inspect(second['mapping']['id'])['native_ref'], refs[1])
                listing = self.save(catalogue(currency='EUR'), store=store, scope='listing')
                self.assertEqual(listing['mapping']['status'], 'candidate')
                self.assertEqual(store.bindings(listing['mapping']['target'])['mappings'], [])
                self.assertNotIn('venue', catalogue()['qualifiers'])

    def test_eod_catalogue_instrument_equivalence_needs_no_ibkr_bridge(self):
        for reverse in (False, True):
            with self.subTest(reverse=reverse), tempfile.TemporaryDirectory() as directory:
                store = identity.IdentityStore(directory, evidence_versions=VERSIONS)
                refs = [catalogue('SYNTH.US', 'USD'), catalogue('SYNTH.XETRA', 'EUR')]
                if reverse:
                    refs.reverse()
                first, second = [self.save(ref, store=store) for ref in refs]
                self.assertEqual(first['mapping']['target'], second['mapping']['target'])
                self.assertEqual(second['mapping']['status'], 'confirmed')
                self.assertNotEqual(first['native_ref'], second['native_ref'])
                self.assertEqual(len(store.bindings(first['mapping']['target'])['mappings']), 2)
                self.assertEqual(self.save(refs[1], store=store, scope='listing')['mapping']['status'], 'candidate')
                missing = self.save(catalogue('OTHER.US'), records(catalogue('OTHER.US')), store=store)
                self.assertNotEqual(missing['mapping']['target'], first['mapping']['target'])

    def test_missing_query_only_invalid_and_contradictory_evidence_never_cross_confirms(self):
        left, right = native(502), catalogue()
        actual = records(left, isin(302), share_class='A')
        variants = [records(right), records(right, isin(302), isin_authority='query_only'),
                    records(right, isin(303)), records(right, isin(302), share_class='B'),
                    records(right, isin(302), native_authority='query_only'),
                    records(right, isin(302))[1:2]]
        conflicting = records(right, isin(302))
        conflicting.append({**conflicting[1], 'id': conflicting[1]['id'] + '-other', 'value': isin(303)})
        variants.append(conflicting)
        self.assertEqual(matching.compare(left, actual, right, conflicting, 'instrument'), 'conflicting')
        for rows in variants:
            self.assertNotEqual(matching.compare(left, actual, right, rows, 'instrument'), 'confirmed')
        self.assertEqual(matching.compare(left, actual, right, [], 'instrument'), 'candidate')
        for scope in ('listing', 'company', 'crypto'):
            self.assertNotEqual(matching.compare(left, actual, right, records(right, isin(302)), scope), 'confirmed')
        wrong_scope = {**right, 'native_scope': 'contract'}
        self.assertEqual(matching.compare(left, actual, wrong_scope, records(wrong_scope, isin(302))[:2], 'instrument'), 'candidate')
        bad = records(right, isin(302))
        bad[1]['value'] = bad[1]['value'][:-1] + str((int(bad[1]['value'][-1]) + 1) % 10)
        with self.assertRaises(wire.WireError):
            self.store.ingest(right, bad)
        for scope in ('company', 'crypto'):
            with self.assertRaises(wire.WireError):
                self.save(right, scope=scope)
        # Unsupported/absent Type is represented by no qualified assertions.
        unsupported = self.save(right, [])
        self.assertEqual(unsupported['mapping']['status'], 'candidate')
        self.assertEqual(self.store.bindings(unsupported['mapping']['target'])['mappings'], [])

    def test_target_or_source_eod_version_change_repairs_only_participating_records(self):
        for reverse in (False, True):
            with self.subTest(reverse=reverse), tempfile.TemporaryDirectory() as directory:
                store = identity.IdentityStore(directory, evidence_versions=VERSIONS)
                a, b, unrelated = native(510), catalogue(), native(511)
                refs = [a, b] if not reverse else [b, a]
                saved = {ref['provider']: self.save(ref, store=store) for ref in refs}
                untouched = self.save(unrelated, records(unrelated, isin(310)), store=store)
                before = store.cache_token()
                updated = identity.IdentityStore(directory, evidence_versions={**VERSIONS, 'eodhd': 'eod-3'})
                affected = updated.inspect(saved['eodhd']['mapping']['id'])
                self.assertEqual(affected['repair'], 'pending_evidence_refresh')
                self.assertGreater(affected['generation'], before)
                self.assertEqual(updated.inspect(untouched['mapping']['id'])['mapping'], untouched['mapping'])
                if reverse:
                    self.assertEqual(updated.inspect(saved['ibkr']['mapping']['id'])['repair'], 'pending_evidence_refresh')
                    self.assertEqual(updated.bindings(saved['eodhd']['mapping']['target'])['mappings'], [])
                with self.assertRaises(wire.WireError):
                    with updated.current_generation(before):
                        pass
                fresh = updated.ingest(b, records(b, isin(301), version='eod-3', suffix='fresh'))
                updated.refresh(saved['eodhd']['mapping']['id'], fresh)
                bindings = updated.bindings(saved['ibkr']['mapping']['target'])['mappings']
                self.assertEqual({m['provider_ref']['provider'] for m in bindings}, {'ibkr', 'eodhd'})
                self.assertEqual(updated.history(saved['eodhd']['mapping']['id'])[0], saved['eodhd']['mapping'])

    def test_pair_rule_update_both_directions_and_positive_override_closure(self):
        for reverse in (False, True):
            with self.subTest(reverse=reverse), tempfile.TemporaryDirectory() as directory:
                store = identity.IdentityStore(directory, evidence_versions=VERSIONS)
                refs = [native(520), catalogue()]
                if reverse:
                    refs.reverse()
                first, linked = [self.save(ref, store=store) for ref in refs]
                # Distinct adapter versions must not invalidate cited positive proof.
                overridden = store.apply_override(linked['mapping']['id'], 'positive', linked['mapping']['evidence_ids'])
                self.assertIsNotNone(overridden['mapping']['active_override'])
                class Corrected(matching.EquityRules):
                    versions = {**matching.RULE_VERSIONS, PAIR: '3'}
                changed = identity.IdentityStore(directory, rules=Corrected(), evidence_versions=VERSIONS)
                current = changed.inspect(linked['mapping']['id'])
                self.assertIsNone(current['mapping']['active_override'])
                self.assertEqual(changed.overrides(linked['mapping']['id'])[0]['state'], 'retired')
                self.assertEqual(current['mapping']['status'], 'confirmed')
                self.assertEqual(changed.inspect(first['mapping']['id'])['mapping'], first['mapping'])

    def test_stale_target_evidence_cannot_authorize_positive_override(self):
        eod, ibkr = self.save(catalogue()), self.save(native(530))
        updated = identity.IdentityStore(self.directory.name, evidence_versions={**VERSIONS, 'eodhd': 'next'})
        with self.assertRaises(wire.WireError):
            updated.apply_override(ibkr['mapping']['id'], 'positive', ibkr['mapping']['evidence_ids'])
        self.assertEqual(updated.bindings(eod['mapping']['target'])['mappings'], [])

    def test_seeded_false_cross_merge_quarantined_and_negative_override_retired(self):
        old = identity.IdentityStore(self.directory.name, rules=OldCrossClassDefect(), evidence_versions=VERSIONS)
        a, b, unrelated = catalogue(), native(540), native(541)
        first = self.save(a, records(a, isin(340), share_class='A'), store=old)
        bad = self.save(b, records(b, isin(340), share_class='B'), store=old)
        untouched = self.save(unrelated, records(unrelated, isin(341)), store=old)
        self.assertEqual(first['mapping']['target'], bad['mapping']['target'])
        # Persist the concrete obsolete rule's false confirmation, while current
        # proof checks intentionally refuse to manufacture it through public API.
        seeded = {**bad['mapping'], 'status': 'confirmed'}
        with old.database.transaction() as db:
            db.execute("UPDATE mappings SET status='confirmed',reason='supported_evidence' WHERE id=?", (seeded['id'],))
            db.execute('UPDATE revisions SET data=? WHERE mapping_id=? AND revision=?', (json.dumps(seeded), seeded['id'], seeded['revision']))
        negative = old.apply_override(seeded['id'], 'negative', seeded['evidence_ids'])
        self.assertEqual(negative['mapping']['status'], 'rejected')
        with self.assertRaises(wire.WireError):
            old.apply_override(seeded['id'], 'positive', seeded['evidence_ids'])
        repaired = self.store.inspect(seeded['id'])
        self.assertEqual(repaired['mapping']['status'], 'conflicting')
        self.assertEqual(self.store.overrides(seeded['id'])[0]['state'], 'retired')
        self.assertEqual(repaired['native_ref'], b)
        self.assertEqual(self.store.history(seeded['id'])[0], seeded)
        self.assertEqual(self.store.inspect(untouched['mapping']['id'])['mapping'], untouched['mapping'])
        self.assertEqual([m['id'] for m in self.store.bindings(first['mapping']['target'])['mappings']], [first['mapping']['id']])

    def test_unsupported_old_eod_candidate_joins_proven_ibkr_without_losing_intent(self):
        eod = self.save(catalogue(), records(catalogue(), native_authority='query_only'))
        ibkr = self.save(native(550), records(native(550), isin(350)))
        # Seed an older unqualified EOD row with the same subsequently supported
        # actual ISIN proof. It had its own retained subject and no rule ID.
        fresh = self.store.ingest(catalogue(), records(catalogue(), isin(350), suffix='known'))
        with self.store.database.transaction() as db:
            db.execute("UPDATE mappings SET rule_id=NULL,rule_version=NULL,status='candidate',reason='unqualified_source_or_scope',evidence_ids=? WHERE id=?",
                       (json.dumps(fresh), eod['mapping']['id']))
        repaired = self.store.inspect(eod['mapping']['id'])
        self.assertEqual(repaired['mapping']['target'], ibkr['mapping']['target'])
        self.assertEqual(repaired['intent_subject'], eod['mapping']['target'])
        # Original query-only evidence is not an alias for the new correction.
        self.assertEqual(self.store.bindings(eod['mapping']['target'])['mappings'], [])
        self.assertEqual(self.store.history(eod['mapping']['id'])[0], eod['mapping'])

    def test_pair_repair_transaction_rolls_back_all_rows_on_interruption(self):
        original = self.save(native(560))
        peers = [self.save(catalogue(symbol)) for symbol in ('ONE.US', 'TWO.XETRA')]
        self.assertTrue(all(item['mapping']['target'] == original['mapping']['target'] for item in peers))
        before = self.store.cache_token()
        class Interrupted(matching.EquityRules):
            versions = {**matching.RULE_VERSIONS, PAIR: 'interrupted-fix'}
            calls = 0
            def evaluate(self, *args):
                self.calls += 1
                if self.calls == 2:
                    raise InterruptedError('synthetic interruption after one pair repair')
                return super().evaluate(*args)
        broken = identity.IdentityStore(self.directory.name, rules=Interrupted(), evidence_versions=VERSIONS)
        with self.assertRaises(InterruptedError):
            broken.cache_token()
        self.assertEqual(self.store.cache_token(), before)
        for peer in peers:
            self.assertEqual(self.store.inspect(peer['mapping']['id'])['mapping'], peer['mapping'])
            self.assertEqual(len(self.store.history(peer['mapping']['id'])), 1)
        self.assertEqual(self.store.inspect(original['mapping']['id'])['mapping'], original['mapping'])

    def test_cross_provider_correction_never_routes_original_wrong_class(self):
        original_ref, selected_ref, new_ref = catalogue(), native(570), catalogue('OTHER.US')
        original = self.save(original_ref, records(original_ref, isin(370), share_class='A'))
        selected = self.save(selected_ref, records(selected_ref, isin(370), share_class='A'))
        replacement = self.save(new_ref, records(new_ref, isin(371), share_class='B'))
        ids = self.store.ingest(selected_ref, records(selected_ref, isin(371), share_class='B', suffix='corrected'))
        self.store.refresh(selected['mapping']['id'], ids)
        corrected = self.store.apply_override(selected['mapping']['id'], 'positive', ids, replacement['mapping']['target'])
        self.assertEqual(corrected['mapping']['status'], 'confirmed')
        self.assertEqual(corrected['intent_subject'], original['mapping']['target'])
        self.assertEqual([m['id'] for m in self.store.bindings(original['mapping']['target'])['mappings']], [original['mapping']['id']])
        self.assertIn(selected['mapping']['id'], [m['id'] for m in self.store.bindings(replacement['mapping']['target'])['mappings']])
        self.assertEqual(self.store.history(selected['mapping']['id'])[0], selected['mapping'])

    def test_target_refresh_quarantines_override_then_recovers_fresh_pair(self):
        eod, ibkr = self.save(catalogue()), self.save(native(580))
        active = self.store.apply_override(ibkr['mapping']['id'], 'positive', ibkr['mapping']['evidence_ids'])
        updated = identity.IdentityStore(self.directory.name, evidence_versions={**VERSIONS, 'eodhd': 'next'})
        pending = updated.inspect(ibkr['mapping']['id'])
        self.assertEqual(pending['repair'], 'pending_evidence_refresh')
        self.assertIsNone(pending['mapping']['active_override'])
        self.assertEqual(updated.overrides(ibkr['mapping']['id'])[0]['state'], 'quarantined')
        ids = updated.ingest(catalogue(), records(catalogue(), isin(301), version='next', suffix='current'))
        updated.refresh(eod['mapping']['id'], ids)
        repaired = updated.inspect(ibkr['mapping']['id'])
        self.assertEqual(repaired['mapping']['status'], 'confirmed')
        self.assertIsNone(repaired['mapping']['active_override'])
        self.assertIn(active['mapping'], updated.history(ibkr['mapping']['id']))

    def test_pending_refresh_cannot_turn_contradicted_old_intent_into_automatic_redirect(self):
        a, b = catalogue(), native(590)
        selected = self.save(b, records(b, isin(390), share_class='A'))
        replacement = self.save(a, records(a, isin(391), share_class='B'))
        updated = identity.IdentityStore(self.directory.name, evidence_versions={**VERSIONS, 'ibkr': 'next'})
        self.assertEqual(updated.inspect(selected['mapping']['id'])['mapping']['status'], 'candidate')
        ids = updated.ingest(b, records(b, isin(391), share_class='B', version='next', suffix='changed'))
        refreshed = updated.refresh(selected['mapping']['id'], ids)
        self.assertEqual(refreshed['mapping']['target'], selected['mapping']['target'])
        self.assertNotEqual(refreshed['mapping']['target'], replacement['mapping']['target'])
        self.assertNotEqual(refreshed['mapping']['status'], 'confirmed')
        self.assertEqual(updated.bindings(selected['mapping']['target'])['mappings'], [])


if __name__ == '__main__':
    unittest.main()
