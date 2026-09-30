"""The consequential failures roadmap stage 0 names, tested at the identity level on real identifiers: uncertain data
never silently changes what a record refers to, and ambiguous cases stay unresolved.

Each class is one failure; the world is `identity_world` (Ericsson, Alphabet, GSK, Shell and US Steel from the
identity truth set). The stage 0 slices that add plugin evidence, device subjects, source removal and relevance
add their cases here.
"""
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from identity_world import AS_OF, NOW, World, record, vendor
from test_identity_contracts import identity
from test_identity_page import plugin
from pythia_identity_fixture import device, lifecycle, page, queue, store, subject as subjects  # noqa: E402

ERICSSON, ERICSSON_LEI = "issuer:lei:549300W9JLPW15XIFM52", "549300W9JLPW15XIFM52"
ERIC_A, ERIC_B = "listing:isin:SE0000108649:XSTO:SEK", "listing:isin:SE0000108656:XSTO:SEK"
GOOGL, GOOG, ALPHABET_LEI = "listing:figi:BBG009S4MT03", "listing:figi:BBG009S4MVF2", "5493006MHB84DD0ZWV18"
GSK, GSK_BEFORE = "security:isin:GB00BN7SWP63", "security:isin:GB0009252882"
SHEL = "listing:isin:GB00BP6MXD84:XLON:GBP"
US_STEEL = "listing:provisional:sec:ticker:XNYS.1163302.X"


class FailureTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.world = World(Path(tmp.name))
        self.addCleanup(self.world.close)


class ShareClassTest(FailureTest):
    def test_another_classes_identifier_is_a_conflict_never_a_binding(self):
        # Alphabet A and C, Ericsson A and B: one issuer each, so only a class's own identifiers tell them apart.
        by_isin = vendor("isin")
        for line, native, stated in ((GOOG, "GOOG", ("share_class_figi", "BBG009S39JY5")),
                                     (ERIC_A, "ERIC-A.ST", ("isin", "SE0000108656"))):
            with self.subTest(line=line):
                binding, item = self.world.resolve(by_isin, line, record(by_isin, native, stated))
                self.assertIsNone(binding)
                self.assertEqual((item.kind, item.subject_ids), ("conflict", (line,)))

    def test_an_issuer_identifier_never_picks_a_share_class(self):
        # The measured false match: an issuer fallback matched Ericsson A to a class B line through the shared
        # issuer identifiers. A source asked by LEI answers with class B's line; nothing proves the class.
        by_lei = vendor("lei")
        binding, item = self.world.resolve(by_lei, ERIC_A, record(by_lei, "ERIC-B.ST", ("lei", ERICSSON_LEI)))
        self.assertIsNone(binding)
        self.assertEqual((item.kind, item.reason, item.candidate_ids), ("residual", "no_key", (ERIC_A,)))
        # The class's own ISIN still binds the line, and the LEI still binds the issuer.
        by_isin = vendor("isin", name="other")
        binding, item = self.world.resolve(by_isin, ERIC_A, record(by_isin, "ERIC-A.ST", ("isin", "SE0000108649")))
        self.assertEqual((binding.subject_id, item), (ERIC_A, None))
        gleif = plugin("gleif")
        binding, item = self.world.resolve(gleif, ERIC_A, record(gleif, ERICSSON_LEI, ("lei", ERICSSON_LEI)))
        self.assertEqual((binding.subject_id, item), (ERICSSON, None))


class ReceiptTest(FailureTest):
    def test_a_receipt_record_never_binds_as_the_share(self):
        # Ericsson's ADS answering a lookup of class B's ISIN: a receipt and its share are never one instrument.
        by_isin = vendor("isin")
        binding, item = self.world.resolve(by_isin, ERIC_B, record(by_isin, "ERIC", kind="depositary_receipt"))
        self.assertIsNone(binding)
        self.assertEqual((item.kind, item.subject_ids), ("conflict", (ERIC_B,)))

    def test_a_record_quoting_the_share_as_its_underlying_is_a_residual(self):
        by_isin = vendor("isin")
        binding, item = self.world.resolve(by_isin, ERIC_B, record(by_isin, "ERIC", ("isin", "SE0000108656", "underlying")))
        self.assertIsNone(binding)
        self.assertEqual((item.kind, item.reason, item.candidate_ids), ("residual", "underlying_identifier", (ERIC_B,)))
        quote = self.world.compose(ERIC_B, [by_isin])["quote"]
        self.assertEqual((quote["status"], quote["queued"]), ("unresolved", "underlying_identifier"))
        # The record's own ISIN binds. A source that cannot tell (`unqualified`, EODHD's ISIN field) still binds: a
        # known gap, only labelled by read checks.
        for role in ("self", "unqualified"):
            with self.subTest(role=role):
                source = vendor("isin", name=f"source-{role}")
                binding, item = self.world.resolve(source, ERIC_B, record(source, "ERIC-B.ST", ("isin", "SE0000108656", role)))
                self.assertEqual((binding.subject_id, item), (ERIC_B, None))


class TickerReuseTest(FailureTest):
    def test_a_delisted_lines_ticker_addresses_nothing(self):
        # US Steel's X@XNYS was delisted in 2025, so X may be reassigned: a saved reference to the line must not
        # quote whoever trades X now, whether a source is addressed through a MIC suffix table or by ticker@MIC.
        steel, goog = self.world.subject(US_STEEL), self.world.subject(GOOG)
        for source, trading in ((vendor(mic_table={"XNYS": "", "XNAS": ""}), "GOOG"),
                                (vendor("ticker_mic", name="by-ticker", scope="ticker_mic"), "GOOG@XNAS")):
            with self.subTest(source=source.key):
                self.assertEqual(page.price_sources(steel, [source], **self.world.lookups(steel)), [])
                quote = self.world.compose(US_STEEL, [source])["quote"]
                self.assertEqual((quote["binding"], quote["reason"], [item["code"] for item in quote["skipped"]]),
                                 (None, "This line no longer trades, so its ticker is not used for a price",
                                  ["not_addressable"]))
                self.assertEqual(page.resolve_input(source, steel), {})
                # A line that trades is addressed from its ticker as before.
                [address] = page.price_sources(goog, [source], **self.world.lookups(goog))
                self.assertEqual(address["native_id"], trading)

    def bind(self, source, subject_id, native_id):
        ref = identity.ProviderRef(source.manifest.provider, native_id, source.manifest.native[0].native_scope)
        self.world.identity.put_binding(identity.Binding(
            provider_ref=ref, subject_id=subject_id, status="confirmed", authority="user_attested",
            evidence_ids=["ev:x"], plugin=source.manifest.plugin))
        return ref

    def test_a_confirmed_ticker_binding_on_a_delisted_line_is_kept_and_not_used(self):
        # Only positive evidence ends a binding (ADR 0037, rule 5), so the row stays; but the ticker may be reassigned,
        # and a saved line would then quote the new company. The binding is suspended: not ready, not routed.
        for source, native_id in ((vendor(mic_table={"XNYS": ""}), "X"),
                                  (vendor("ticker_mic", name="by-ticker", scope="ticker_mic"), "X@XNYS")):
            with self.subTest(scope=source.manifest.native[0].native_scope):
                ref = self.bind(source, US_STEEL, native_id)
                steel = self.world.subject(US_STEEL)
                quote = self.world.compose(US_STEEL, [source])["quote"]
                self.assertEqual((quote["status"], quote["binding"], quote["reason"]),
                                 ("suspended", None, "This line no longer trades; its ticker may now name another company"))
                self.assertEqual(quote["notice"], None)  # the suspended source leads: nothing ranked ahead of it
                self.assertEqual(page.price_sources(steel, [source], **self.world.lookups(steel)), [])
                [answer] = page.answers(steel, [source], page.Section.QUOTE, **self.world.lookups(steel))
                self.assertEqual(answer["status"], "suspended")
                row = self.world.identity.binding_for(ref)
                self.assertEqual((row["status"], row["subject_id"]), ("confirmed", US_STEEL))

    def test_a_suspended_binding_is_a_notice_when_another_source_serves(self):
        # The investor's own binding stops being used: a source ranked behind it serving shows the amber notice.
        suspended = vendor(mic_table={"XNYS": ""}, name="first")
        serving = vendor("figi", scope="figi", name="second")
        self.bind(suspended, US_STEEL, "X")
        self.bind(serving, US_STEEL, "BBG000000000")
        quote = self.world.compose(US_STEEL, [suspended, serving])["quote"]
        self.assertEqual((quote["status"], quote["plugin"], quote["notice"]["plugin"], quote["notice"]["code"]),
                         ("ready", "pythia-second", "pythia-first", "suspended"))

    def test_a_binding_through_a_permanent_identifier_serves_after_the_delisting(self):
        # A FIGI or a CAIP-19 is not reassigned with a ticker, so a binding addressed by one keeps serving. The scope is
        # named after the identifier scheme, as page addressing names it.
        for scope, native_id in (("figi", "BBG000000000"), ("caip19", "eip155:1/erc20:0x0000000000000000000000000000000000000000")):
            with self.subTest(scope=scope):
                source = vendor(scope, scope=scope, name=f"by-{scope}")
                ref = self.bind(source, US_STEEL, native_id)
                steel = self.world.subject(US_STEEL)
                quote = self.world.compose(US_STEEL, [source])["quote"]
                self.assertEqual((quote["status"], quote["binding_status"], quote["binding"]["native_id"]),
                                 ("ready", "confirmed", native_id))
                self.assertEqual(page.price_sources(steel, [source], **self.world.lookups(steel)), [ref.wire()])

    def test_a_confirmed_binding_on_a_line_that_trades_is_used(self):
        source = vendor(mic_table={"XNAS": ""})
        self.bind(source, GOOG, "GOOG")
        goog = self.world.subject(GOOG)
        quote = self.world.compose(GOOG, [source])["quote"]
        self.assertEqual((quote["status"], quote["binding_status"], quote["binding"]["native_id"]), ("ready", "confirmed", "GOOG"))
        self.assertEqual(len(page.price_sources(goog, [source], **self.world.lookups(goog))), 1)

    def test_a_binding_on_a_line_the_reference_dropped_routes_nothing(self):
        # A build that no longer holds the line leaves the subject unknown, so nothing is served through its binding;
        # the binding row stays, and lifecycle flags the subject as vanished.
        ref = self.bind(vendor(mic_table={"XNYS": ""}), US_STEEL, "X")
        later = self.world.release("reference-20261001", drop=[US_STEEL])
        done = self.world.rekey(later)
        self.assertEqual(done["vanished"], 1)
        with closing(store.open_reference(later)) as dropped:
            self.assertIsNone(device.load_subject(dropped, self.world.identity, US_STEEL, []))
        self.assertEqual(self.world.identity.bound_subject(ref), US_STEEL)


class CurrencyTest(FailureTest):
    def test_a_line_quoting_in_pence_gets_no_guessed_currency(self):
        # Shell trades in pence in London, so the venue decides no trading currency: the page asserts none (the quote
        # states its own) and never shows GBP, the key's currency. Nasdaq decides USD for Alphabet's line.
        for line, currency in ((SHEL, None), (GOOG, "USD")):
            with self.subTest(line=line):
                view = self.world.subject(line)["view"]
                self.assertEqual((view["identifiers"].get("currency"), [item["currency"] for item in view["listings"]]),
                                 (currency, [currency]))
        # An ISIN keys a listing only with its operating MIC and a currency.
        self.assertIsNone(identity.subject_id("listing", {"isin": "GB00BP6MXD84"}, operating_mic="XLON"))
        self.assertEqual(identity.subject_id("listing", {"isin": "GB00BP6MXD84"}, operating_mic="XLON", currency="GBP"),
                         SHEL)


class CorporateActionTest(FailureTest):
    """GSK's 2022 consolidation replaced GB0009252882 with GB00BN7SWP63; a source states `successor_of`."""

    def bind_before(self):
        ref = identity.ProviderRef("vendor", "GSK-2021", "symbol")
        self.world.identity.put_binding(identity.Binding(
            provider_ref=ref, subject_id=GSK_BEFORE, status="confirmed", authority="user_attested",
            evidence_ids=["ev:x"], plugin="vendor"))
        return ref

    def test_a_successor_is_shown_as_a_link_and_never_followed(self):
        before = self.world.subject(GSK_BEFORE)
        self.assertEqual(before["id"], GSK_BEFORE)
        self.assertEqual([(item["id"], item["type"], item["direction"]) for item in before["view"]["related"]],
                         [(GSK, "successor_of", "from")])
        self.assertEqual(subjects.current_id(self.world.ref, GSK_BEFORE), GSK_BEFORE)
        ref = self.bind_before()
        done = self.world.rekey(self.world.release("reference-20261001"))
        self.assertEqual((done["moved"], done["vanished"]), (0, 0))
        self.assertEqual(self.world.identity.bound_subject(ref), GSK_BEFORE)

    def test_a_source_still_quoting_the_former_isin_is_a_conflict(self):
        by_isin = vendor("isin")
        gsk_line = self.world.subject(GSK)["listing"]["id"]
        binding, item = self.world.resolve(by_isin, gsk_line, record(by_isin, "GSK.L", ("isin", "GB0009252882")))
        self.assertIsNone(binding)
        self.assertEqual((item.kind, item.subject_ids), ("conflict", (gsk_line,)))
        self.assertIsNone(self.world.identity.binding_for(item.provider_ref))

    def test_a_former_isin_keeps_its_rows_when_a_release_drops_it(self):
        # No alias from a former ISIN: a release that no longer holds it flags the saved rows and moves none of them
        # to the successor.
        ref = self.bind_before()
        self.world.identity.put_miss(GSK_BEFORE, "pythia-vendor", "no match", 3600)
        done = self.world.rekey(self.world.release("reference-20261001", drop=[GSK_BEFORE]))
        self.assertEqual((done["moved"], done["vanished"]), (0, 1))
        self.assertEqual(lifecycle.vanished(self.world.identity), [GSK_BEFORE])
        self.assertEqual(self.world.identity.bound_subject(ref), GSK_BEFORE)
        self.assertEqual(self.world.identity.misses(GSK_BEFORE), {"pythia-vendor": "no match"})
        self.assertEqual(self.world.identity.bindings([GSK]), [])


class AmbiguityTest(FailureTest):
    def test_several_records_for_one_lookup_stay_unresolved_and_the_agent_only_suggests(self):
        # Asked by Alphabet's LEI, a source returns both classes.
        by_lei = vendor("lei")
        binding, item = self.world.resolve(by_lei, GOOGL, record(by_lei, "GOOGL", ("lei", ALPHABET_LEI)),
                                           record(by_lei, "GOOG", ("lei", ALPHABET_LEI)))
        self.assertIsNone(binding)
        self.assertEqual((item.kind, item.reason), ("residual", "ambiguous"))
        agent = queue.submit(self.world.identity, self.world.ref, item_id=item.id, resolver="agent",
                             relation="same_listing", chosen_id=GOOGL, now=NOW, as_of=AS_OF)
        self.assertEqual((agent["outcome"], agent["state"]), ("suggested", "open"))
        self.assertIsNone(self.world.identity.binding_for(item.provider_ref))


if __name__ == "__main__":
    unittest.main()
