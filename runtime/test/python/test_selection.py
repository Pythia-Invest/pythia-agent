"""Source selection in page composition (ADR 0040): order, coverage, notices, combined filings, speed."""
import builtins
import json
import socket
import sqlite3
import tempfile
import time
import types
import unittest
import unittest.mock
from pathlib import Path

from test_concepts import APPLE, MECHANISMS as XBRL_MECHANISMS, PLUGINS, SUBJECTS
from test_identity_contracts import identity, load, load_reference
from pythia_identity_fixture import filings, page, store  # noqa: E402

RIGHTS = {"licence": "personal", "cache": "none", "hostable": False}
FILINGS = page.Section.FILINGS


def shipped(**states):
    """The shipped contracts as installed plugins; `states` per plugin directory: enabled/missing."""
    tools = {"gleif": {"profile": "pythia_gleif_profile"}, "sec": {"filings": "pythia_sec_filings"},
             "xbrl-filings": {"filings": "pythia_xbrl_filings_filings"}}
    out = []
    for path in sorted(PLUGINS.glob("*/contract.json")):
        state = states.get(path.parent.name, {})
        missing = ({"key": "k", "label": "Key", "file": "secrets.json", "status": "missing"},) if state.get("missing") else ()
        out.append(page.PluginInfo(key=f"pythia-{path.parent.name}",
                                   manifest=identity.validate_manifest(json.loads(path.read_text())),
                                   enabled=state.get("enabled", True), missing=missing,
                                   operations=tools.get(path.parent.name, {})))
    return out


def eodhd_live_only_us():
    """EODHD as it would declare a US-only live stream beside global quotes and history."""
    document = json.loads((PLUGINS / "eodhd/contract.json").read_text())
    market = document["concepts"]["market_data"]
    market["operations"]["live"] = "live_market"
    market["coverage"]["operations"] = {"live": {"markets": ["XNAS", "XNYS"]}}
    return page.PluginInfo(key="pythia-eodhd", manifest=identity.validate_manifest(document))


class Reference(unittest.TestCase):
    def setUp(self):
        self.ref = sqlite3.connect(":memory:")
        self.ref.executescript(identity.schema_sql("reference"))
        for fixture in (load("asml.json"), load("crypto.json"), APPLE):
            load_reference(self.ref, fixture)
        self.ref.row_factory = sqlite3.Row
        self.coins = {(r[0], r[1]): r[2] for r in self.ref.execute("SELECT provider, caip19, native_id FROM canonical_assets")}

    def tearDown(self):
        self.ref.close()

    def lookups(self, **extra):
        return {"stored": lambda *_: None, "coins": lambda provider, caip19: self.coins.get((provider, caip19)),
                "queue": [], **extra}

    def sections(self, name, plugins=None, **extra):
        subject = page.load_subject(self.ref, SUBJECTS[name])
        return {s["section"]: s for s in page.compose(subject, plugins or shipped(), **self.lookups(**extra))}


class OneOrderTest(Reference):
    def test_one_order_drives_the_page_quote_chart_and_a_subject_read_identically(self):
        """D1: the page's quote and chart, and a subject read through market-data (the agent's and the markets
        widgets' path) serve from the same first source of the investor's one order, else core's default."""
        from market_data_read_fixtures import Backend, Sources, request, run_read
        subject = page.load_subject(self.ref, SUBJECTS["asml_xams"])
        binding = {"kind": "listing", "id": subject["id"]}
        for order, expected in (((), "yahoo"), (("eodhd",), "eodhd")):
            with self.subTest(order=order), tempfile.TemporaryDirectory() as directory:
                lookups = self.lookups(order=order)
                sections = {s["section"]: s for s in page.compose(subject, shipped(), **lookups)}
                refs = page.price_sources(subject, shipped(), **lookups)
                sources = Sources(refs)
                backend = Backend(directory, subjects=lambda _id: {"asset_class": "equity", "refs": refs, "reason": None},
                                  source_call=sources.call, source_projection=sources.project,
                                  access_scope=lambda: sources.access)
                read = run_read(backend, read_request=request({"kind": "pythia", "subject": binding}))
                self.assertEqual([sections["quote"]["provider"], sections["chart"]["provider"],
                                  read["provenance"]["provider"]], [expected] * 3)
                self.assertEqual(read["series"]["provider_ref"]["native_id"], sections["chart"]["binding"]["native_id"])


class SelectionTest(Reference):
    def test_the_investors_one_order_beats_core_order_across_concepts(self):
        core = self.sections("asml_xams")
        self.assertEqual(core["quote"]["plugin"], "pythia-yahoo-discovery")  # free before paid, key or not
        order = ("eodhd", "pythia-coinmarketcap")  # provider names or plugin ids, one list for every concept
        asml = self.sections("asml_xams", order=order)
        self.assertEqual((asml["quote"]["plugin"], [a["plugin"] for a in asml["quote"]["alternatives"]]),
                         ("pythia-eodhd", ["pythia-yahoo-discovery"]))
        btc = self.sections("btc", order=order)
        self.assertEqual(btc["quote"]["source"], {"source": "CoinMarketCap", "provider": "coinmarketcap",
                                                  "plugin": "pythia-coinmarketcap"})

    def test_a_skipped_source_the_investor_named_is_a_notice_a_setup_state_is_not(self):
        plain = self.sections("asml_xams", shipped(eodhd={"missing": True}))
        self.assertIsNone(plain["quote"]["notice"])
        named = self.sections("asml_xams", shipped(eodhd={"missing": True}), order=("eodhd",))
        self.assertEqual((named["quote"]["plugin"], named["quote"]["notice"]["code"]),
                         ("pythia-yahoo-discovery", "needs_configuration"))

    def test_operation_coverage_narrows_one_operation_only(self):
        """A US-only live stream is not offered for ASML in Amsterdam, while its quotes there are."""
        plugins = [eodhd_live_only_us()]
        asml = page.load_subject(self.ref, SUBJECTS["asml_xams"])
        apple = page.load_subject(self.ref, SUBJECTS["apple"])
        quote = page.Section.QUOTE
        self.assertEqual(page.evaluate(plugins[0], quote, asml, **self.lookups())["status"], "ready")
        live = {**page.SERVES, quote: (identity.Concept.MARKET_DATA, ("live",))}  # the page has no Live section yet
        with unittest.mock.patch.object(page, "SERVES", live):
            self.assertEqual(page.evaluate(plugins[0], quote, asml, **self.lookups())["status"], "not_covering")
            self.assertEqual(page.evaluate(plugins[0], quote, apple, **self.lookups())["status"], "ready")

    def test_a_source_is_named_by_id_provider_label_or_common_name(self):
        plugins = shipped()
        for name, key in (("esef", "pythia-xbrl-filings"), ("filings.xbrl.org", "pythia-xbrl-filings"),
                          ("EDGAR", "pythia-sec"), ("sec", "pythia-sec"), ("SEC EDGAR", "pythia-sec"),
                          ("pythia-gleif", "pythia-gleif"), ("yahoo finance", "pythia-yahoo-discovery"),
                          ("bloomberg", None)):
            with self.subTest(name=name):
                self.assertEqual(page.named(name, plugins), key)

    def test_filings_combine_one_source_per_authority_and_use_once_reads_a_mirror(self):
        mirror = json.loads((PLUGINS / "sec/contract.json").read_text())
        mirror.update(plugin="pythia-secmirror", provider="secmirror")
        plugins = [*shipped(), page.PluginInfo(key="pythia-secmirror", manifest=identity.validate_manifest(mirror),
                                               operations={"filings": "mirror_filings"})]
        filings = self.sections("asml_xams", plugins)["filings"]
        self.assertEqual([(item["plugin"], item["authorities"]) for item in filings["sources"]],
                         [("pythia-xbrl-filings", XBRL_MECHANISMS), ("pythia-sec", ["sec"])])
        [also] = filings["alternatives"]
        self.assertEqual((also["plugin"], also["request"]["arguments"]["use"]), ("pythia-secmirror", "pythia-secmirror"))
        self.assertEqual(filings["label"], "filings.xbrl.org + SEC EDGAR")

    def test_select_is_a_plain_filter(self):
        entries = [{"plugin": "a", "status": "disabled", "authorities": ["sec"]},
                   {"plugin": "b", "status": "ready", "authorities": ["oam-nl", "fca"]},
                   {"plugin": "c", "status": "ready", "authorities": ["sec"]},
                   {"plugin": "d", "status": "resolving", "authorities": ["sec"]}]
        chosen, alternatives, skipped = identity.concepts.select(entries, combine=identity.Combine.PER_AUTHORITY)
        self.assertEqual([(entry["plugin"], served) for entry, served in chosen], [("b", ("oam-nl", "fca")), ("c", ("sec",))])
        self.assertEqual(([e["plugin"] for e in alternatives], [e["plugin"] for e in skipped]), (["d"], ["a"]))
        chosen, alternatives, _ = identity.concepts.select(entries)
        self.assertEqual((chosen[0][0]["plugin"], [e["plugin"] for e in alternatives]), ("b", ["c", "d"]))
        self.assertEqual(identity.concepts.parse_order(" EODHD, yahoo  coingecko,eodhd"), ("eodhd", "yahoo", "coingecko"))

    def test_selection_over_realistic_inputs_is_fast_and_does_no_io(self):
        """Every section of 1,000 page opens (ASML twice, Apple, BTC) over the shipped contracts."""
        subjects = [page.load_subject(self.ref, SUBJECTS[name]) for name in SUBJECTS] * 250
        plugins = shipped(eodhd={"missing": True})
        lookups = self.lookups(order=("coinmarketcap",))

        def refuse(*_args, **_kwargs):
            raise AssertionError("selection did I/O")
        with unittest.mock.patch.object(builtins, "open", refuse), unittest.mock.patch.object(socket, "socket", refuse), \
                unittest.mock.patch.object(sqlite3, "connect", refuse):
            started = time.perf_counter()
            count = sum(len(page.compose(subject, plugins, **lookups)) for subject in subjects)
            elapsed = time.perf_counter() - started
        per_page = elapsed / len(subjects)
        print(f"\nselection: {len(subjects)} page compositions ({count} sections), {per_page * 1e6:.0f} us per page, "
              f"{elapsed / count * 1e6:.1f} us per section")
        self.assertLess(per_page, 0.002)  # 2 ms per page on slow CI; typical is far lower


class FilingsMergeTest(unittest.TestCase):
    SEC = {"plugin": "pythia-sec", "provider": "sec", "label": "SEC EDGAR", "authorities": ["sec"]}
    XBRL = {"plugin": "pythia-xbrl-filings", "provider": "xbrl-filings", "label": "filings.xbrl.org",
            "authorities": ["oam-nl", "fca"]}

    def sec(self):
        return {"schema_version": 1, "outcome": "ok", "data": {"source": {"url": "https://www.sec.gov/x"}, "filings": [
            {"accession": "0000937966-26-000010", "form": "20-F", "title": "Annual report", "filed_at": "2026-02-11",
             "period_end": "2025-12-31", "url": "https://www.sec.gov/a"},
            {"accession": "0000937966-26-000020", "form": "6-K", "title": "Report", "filed_at": "2026-04-15",
             "period_end": None, "url": "https://www.sec.gov/b"}]}}

    def xbrl(self):
        return {"schema_version": 1, "outcome": "ok", "data": {"filings": [
            {"accession": "a" * 64, "report_id": "1", "form": "ESEF", "country": "NL", "title": "ESEF report",
             "filed_at": None, "period_end": "2025-12-31", "url": "https://filings.xbrl.org/r"},
            {"accession": "b" * 64, "report_id": "2", "form": "UKSEF", "country": "GB", "title": "UKSEF report",
             "filed_at": None, "period_end": "2024-12-31", "url": "https://filings.xbrl.org/s"}]}}

    def test_sources_merge_newest_first_each_item_tagged(self):
        merged = filings.merge_filings([(self.XBRL, ("oam-nl", "fca"), self.xbrl(), None), (self.SEC, ("sec",), self.sec(), None)])
        self.assertEqual([(item["form"], item["authority"], item["source"]) for item in merged["filings"]],
                         [("6-K", "sec", "SEC EDGAR"), ("20-F", "sec", "SEC EDGAR"), ("ESEF", "oam-nl", "filings.xbrl.org"),
                          ("UKSEF", "fca", "filings.xbrl.org")])
        self.assertEqual((merged["partial"], merged["skipped"]), (False, []))
        self.assertEqual(set(merged["filings"][0]), {
            "id", "kind", "form", "title", "filed_at", "filed_time", "period_end", "date", "date_basis", "event_codes",
            "basis", "language", "format", "parties", "url", "authority", "report_period", "report_key", "source",
            "provider", "plugin"})

    def test_a_report_is_one_period_under_one_authority_and_parallel_reports_share_the_period(self):
        sec, xbrl = self.sec(), self.xbrl()
        sec["data"]["filings"][0].update(kind="annual", basis="us_gaap")
        sec["data"]["filings"].append({**sec["data"]["filings"][0], "accession": "0000937966-26-000030", "form": "20-F/A"})
        xbrl["data"]["filings"][0]["kind"] = "annual"
        xbrl["data"]["filings"].append({**xbrl["data"]["filings"][0], "report_id": "3", "accession": "c" * 64,
                                        "country": "GB"})  # the same ESEF report collected by the UK mechanism
        merged = filings.merge_filings([(self.XBRL, ("oam-nl", "fca"), xbrl, None), (self.SEC, ("sec",), sec, None)],
                                       issuer="issuer:lei:X")
        items = {(item["form"], item["authority"]): item for item in merged["filings"]}
        annual, amended, esef = items[("20-F", "sec")], items[("20-F/A", "sec")], items[("ESEF", "oam-nl")]
        self.assertEqual(annual["report_key"], "issuer:lei:X|annual|2025-12-31|sec")
        self.assertEqual(amended["report_key"], annual["report_key"])  # an amendment is a version of the report
        self.assertEqual((annual["basis"], esef["basis"]), ("us_gaap", None))  # an attribute, never the identity
        self.assertEqual(esef["report_key"], "issuer:lei:X|annual|2025-12-31|oam-nl")
        self.assertNotEqual(esef["report_key"], items[("ESEF", "fca")]["report_key"])
        self.assertEqual({item["report_period"] for item in (annual, esef, items[("ESEF", "fca")])},
                         {"issuer:lei:X|annual|2025-12-31"})  # parallel reports of one period
        self.assertEqual((items[("6-K", "sec")]["report_key"], items[("6-K", "sec")]["report_period"]), (None, None))
        self.assertEqual(len(merged["filings"]), 6)  # neither versions nor parallels are merged

    def test_kinds_filter_and_an_unknown_kind_or_mechanism(self):
        sec, xbrl = self.sec(), self.xbrl()
        sec["data"]["filings"][0].update(kind="annual", accepted_at="2026-02-11T21:05:00Z")
        sec["data"]["filings"][1]["kind"] = "bulletin"
        xbrl["data"]["filings"][0]["country"] = "UA"  # a country Pythia names no mechanism for
        merged = filings.merge_filings([(self.XBRL, ("oam-nl", "fca"), xbrl, None), (self.SEC, ("sec",), sec, None)])
        self.assertEqual([(item["form"], item["kind"]) for item in merged["filings"]],
                         [("6-K", "other"), ("20-F", "annual"), ("UKSEF", "other")])
        self.assertEqual(merged["filings"][1]["filed_time"], "2026-02-11T21:05:00Z")
        annual = filings.merge_filings([(self.SEC, ("sec",), sec, None)], kinds=["annual"])
        self.assertEqual([item["form"] for item in annual["filings"]], ["20-F"])

    def test_esef_reports_sort_by_their_indexed_date_and_forms_filter_with_aliases(self):
        xbrl = self.xbrl()
        xbrl["data"]["filings"][0]["indexed_at"] = "2026-03-04"  # filings.xbrl.org has no filing date
        merged = filings.merge_filings([(self.XBRL, ("oam-nl", "fca"), xbrl, None), (self.SEC, ("sec",), self.sec(), None)])
        self.assertEqual([(item["form"], item["date"], item["date_basis"]) for item in merged["filings"]],
                         [("6-K", "2026-04-15", "filed"), ("ESEF", "2026-03-04", "indexed"),
                          ("20-F", "2026-02-11", "filed"), ("UKSEF", "2024-12-31", "period_end")])
        annual = filings.merge_filings([(self.XBRL, ("oam-nl", "fca"), xbrl, None), (self.SEC, ("sec",), self.sec(), None)],
                                       forms=["annual"])
        self.assertEqual([item["form"] for item in annual["filings"]], ["ESEF", "20-F", "UKSEF"])
        self.assertEqual([item["form"] for item in filings.merge_filings(
            [(self.XBRL, ("oam-nl",), xbrl, None)], forms=["AFR"])["filings"]], ["ESEF"])
        for form in ("AFR", "annual"):  # the FCA NSM files an annual financial report under its code ACS
            self.assertTrue(filings.form_matches("ACS", [form]))

    def test_a_source_that_does_not_know_the_entity_lists_nothing_and_is_not_a_failure(self):
        unknown = {"schema_version": 1, "outcome": "error", "data": None,
                   "issues": [{"code": "missing_observation", "message": "The provider did not return an observation."}]}
        merged = filings.merge_filings([(self.XBRL, ("oam-nl", "fca"), unknown, None), (self.SEC, ("sec",), self.sec(), None)])
        self.assertEqual((merged["partial"], merged["skipped"], len(merged["sources"])), (False, [], 2))

    def test_an_incomplete_source_keeps_its_rows_and_marks_the_list_partial(self):
        incomplete = {**self.sec(), "issues": [{"code": "incomplete", "severity": "warning",
                                                "message": "Older SEC filings could not be searched."}]}
        merged = filings.merge_filings([(self.SEC, ("sec",), incomplete, None)])
        self.assertEqual((len(merged["filings"]), merged["partial"]), (2, True))
        self.assertEqual([(item["code"], item["reason"]) for item in merged["skipped"]],
                         [("incomplete", "Older SEC filings could not be searched.")])

    def test_a_row_with_an_unreadable_period_end_is_left_out_with_a_reason(self):
        sec = self.sec()
        sec["data"]["filings"][0]["period_end"] = 20251231
        merged = filings.merge_filings([(self.SEC, ("sec",), sec, None)], issuer="issuer:x")
        self.assertEqual([item["form"] for item in merged["filings"]], ["6-K"])
        self.assertEqual([(item["code"], item["plugin"]) for item in merged["skipped"]], [("invalid_rows", "pythia-sec")])

    def test_an_authority_another_source_serves_is_left_out(self):
        merged = filings.merge_filings([(self.XBRL, ("oam-nl",), self.xbrl(), None)])
        self.assertEqual([item["form"] for item in merged["filings"]], ["ESEF"])

    def test_a_failed_source_is_skipped_and_the_list_partial(self):
        failed = {"schema_version": 1, "outcome": "error", "data": None,
                  "issues": [{"code": "rate_limit", "message": "SEC is rate limited."}]}
        merged = filings.merge_filings([(self.XBRL, ("oam-nl", "fca"), self.xbrl(), None), (self.SEC, ("sec",), failed, None)])
        self.assertTrue(merged["partial"])
        self.assertEqual(merged["skipped"], [{"source": "SEC EDGAR", "provider": "sec", "plugin": "pythia-sec",
                                              "code": "failed", "reason": "SEC is rate limited."}])
        self.assertEqual({item["authority"] for item in merged["filings"]}, {"oam-nl", "fca"})


class CoreReadsTest(Reference):
    """The combined filings operation over a fake native registry."""

    def setUp(self):
        super().setUp()
        from test_identity_queue import load_core
        load_core()
        from pythia_core_queue_fixture import concept_ops, identity_ops
        self.ops, self.identity_ops = concept_ops, identity_ops
        self.tmp = tempfile.TemporaryDirectory()
        self.store = store.IdentityStore(Path(self.tmp.name))
        subject = page.load_subject(self.ref, SUBJECTS["asml_xams"])
        core = types.SimpleNamespace(store=self.store)
        core._load = lambda _id: (None, subject, self.lookups(), None)
        self.reads = concept_ops.ConceptReads(core)
        self.reads.eligible = lambda: None  # no native registry here: every source may run unless a test says not
        self.addCleanup(self.store.db.close)
        self.addCleanup(self.tmp.cleanup)

    def read(self, answers, cancelled=None, plugins=shipped, handler="filings", **arguments):
        self.sent = {}

        def dispatch(tool, sent, cancelled=None):
            self.sent[tool] = sent
            return json.dumps(answers[tool])
        schemas = {"pythia_sec_filings": {"parameters": {"properties": {"native_ref": {}, "limit": {"maximum": 50},
                                                                        "forms": {}, "kinds": {}}}}}
        registry = types.SimpleNamespace(dispatch=dispatch, get_schema=schemas.get)
        with unittest.mock.patch.dict("sys.modules", {"tools": types.ModuleType("tools"),
                                                      "tools.registry": types.SimpleNamespace(registry=registry)}), \
                unittest.mock.patch.object(self.identity_ops, "installed", plugins):
            context = {"cancelled": cancelled} if cancelled else {}
            return json.loads(getattr(self.reads, handler)({"subject_id": SUBJECTS["asml_xams"], **arguments}, **context))

    def test_forms_reach_a_source_that_searches_by_form_and_filter_every_answer(self):
        merge = FilingsMergeTest()
        body = self.read({"pythia_xbrl_filings_filings": merge.xbrl(), "pythia_sec_filings": merge.sec()},
                         forms=["annual"])
        self.assertEqual(self.sent["pythia_sec_filings"]["forms"], ["10-K", "20-F", "40-F", "ESEF", "UKSEF", "ACS"])
        self.assertNotIn("forms", self.sent["pythia_xbrl_filings_filings"])  # its schema takes no forms
        self.assertEqual([item["form"] for item in body["data"]["filings"]], ["20-F", "ESEF", "UKSEF"])
        by_kind = self.read({"pythia_xbrl_filings_filings": merge.xbrl(), "pythia_sec_filings": merge.sec()},
                            kinds=["quarterly"])
        self.assertEqual(self.sent["pythia_sec_filings"]["kinds"], ["quarterly"])
        self.assertNotIn("kinds", self.sent["pythia_xbrl_filings_filings"])
        self.assertEqual(by_kind["outcome"], "empty")  # core filters every answer by kind
        named = self.read({"pythia_sec_filings": merge.sec(), "pythia_xbrl_filings_filings": merge.xbrl()}, use="edgar")
        self.assertEqual(named["outcome"], "ok")
        self.assertEqual(self.read({}, use="bloomberg")["outcome"], "empty")

    def test_combined_read_is_partial_when_a_source_fails(self):
        merge = FilingsMergeTest()
        failed = {"schema_version": 1, "outcome": "error", "data": None,
                  "issues": [{"code": "rate_limit", "severity": "error", "message": "SEC is rate limited."}]}
        body = self.read({"pythia_xbrl_filings_filings": merge.xbrl(), "pythia_sec_filings": failed})
        self.assertEqual((body["outcome"], body["data"]["partial"]), ("partial", True))
        self.assertEqual([item["plugin"] for item in body["data"]["skipped"]], ["pythia-sec", "pythia-nsm"])

    def test_a_source_pythia_may_not_run_here_is_skipped_and_cancellation_reaches_the_sources(self):
        merge = FilingsMergeTest()
        with unittest.mock.patch.object(self.reads, "eligible", lambda: {"pythia_xbrl_filings_filings"}):
            body = self.read({"pythia_xbrl_filings_filings": merge.xbrl()})
        self.assertEqual(body["outcome"], "ok")
        self.assertEqual([(item["plugin"], item["code"]) for item in body["data"]["skipped"]],
                         [("pythia-sec", "unavailable"), ("pythia-nsm", "unresolved")])
        self.assertNotIn("pythia_sec_filings", self.sent)
        body = self.read({}, cancelled=lambda: True)
        self.assertEqual((body["outcome"], self.sent), ("error", {}))

    def test_a_source_still_to_be_looked_up_is_listed_not_awaited(self):
        """An EU issuer without a CIK: SEC would need a lookup; the ESEF list is read at once, and not partial."""
        subject = page.load_subject(self.ref, SUBJECTS["asml_xams"])
        subject = {**subject, "values": {key: value for key, value in subject["values"].items() if key != "cik"}}
        self.reads.identity._load = lambda _id: (None, subject, self.lookups(), None)
        sections = {s["section"]: s for s in page.compose(subject, shipped(), **self.lookups())}
        filings_section = sections["filings"]
        self.assertEqual((filings_section["status"], filings_section["plugin"]), ("ready", "pythia-xbrl-filings"))
        self.assertEqual([(item["plugin"], item["code"]) for item in filings_section["skipped"]],
                         [("pythia-sec", "resolving"), ("pythia-nsm", "unresolved")])
        body = self.read({"pythia_xbrl_filings_filings": FilingsMergeTest().xbrl()})
        self.assertEqual((body["outcome"], body["data"]["partial"]), ("ok", False))
        self.assertEqual([item["code"] for item in body["data"]["skipped"]], ["resolving", "unresolved"])

    # ---- sources work together (ADR 0040 amendment) ----------------------------------------------------------------

    def test_not_covered_moves_to_the_next_source_and_an_error_does_not(self):
        mirror = json.loads((PLUGINS / "sec/contract.json").read_text())
        mirror.update(plugin="pythia-secmirror", provider="secmirror")
        plugins = lambda: [*shipped(), page.PluginInfo(key="pythia-secmirror", manifest=identity.validate_manifest(
            mirror), operations={"filings": "mirror_filings"})]
        merge = FilingsMergeTest()
        uncovered = {"schema_version": 1, "outcome": "empty", "data": None, "issues": [
            {"code": "not_covered", "severity": "warning", "message": "SEC EDGAR does not list this company."}]}
        body = self.read({"pythia_xbrl_filings_filings": merge.xbrl(), "pythia_sec_filings": uncovered,
                          "mirror_filings": merge.sec()}, plugins=plugins)
        self.assertEqual((body["outcome"], body["data"]["partial"]), ("ok", False))
        self.assertEqual({item["plugin"] for item in body["data"]["filings"] if item["authority"] == "sec"},
                         {"pythia-secmirror"})
        self.assertEqual([(item["plugin"], item["code"]) for item in body["data"]["skipped"]],
                         [("pythia-sec", "not_covering"), ("pythia-nsm", "unresolved")])
        failed = {"schema_version": 1, "outcome": "error", "data": None,
                  "issues": [{"code": "rate_limit", "severity": "error", "message": "SEC is rate limited."}]}
        body = self.read({"pythia_xbrl_filings_filings": merge.xbrl(), "pythia_sec_filings": failed,
                          "mirror_filings": merge.sec()}, plugins=plugins)
        self.assertNotIn("mirror_filings", self.sent)  # a failure never switches source: the mirror stays "Also:"
        self.assertEqual((body["outcome"], [item["plugin"] for item in body["data"]["alternatives"]]),
                         ("partial", ["pythia-secmirror"]))

    def test_news_from_two_sources_is_one_feed_without_the_exact_duplicate(self):
        plugins = lambda: [provider("pythia-yahoo-discovery", "yahoo"), provider("pythia-eodhd", "eodhd")]
        yahoo = news(("Q3 results beat", "https://example.com/asml-q3", "2026-09-27T08:00:00Z"),
                     ("ASML ships", "https://example.com/ship", "2026-09-26T08:00:00Z"))
        eodhd = news(("Q3 results beat", "https://EXAMPLE.com/asml-q3/", "2026-09-27T08:00:00Z"),  # the same link
                     ("Q3 Results Beat!", "https://other.example/q3", "2026-09-27T10:00:00Z"),  # the same headline
                     ("Chip demand rises", "https://other.example/demand", "2026-09-28T07:00:00Z"))
        body = self.read({"yahoo_news": yahoo, "eodhd_news": eodhd}, plugins=plugins, handler="news")
        self.assertEqual(body["outcome"], "ok")
        self.assertEqual([(item["title"], item["plugin"]) for item in body["data"]["news"]],
                         [("Chip demand rises", "pythia-eodhd"), ("Q3 results beat", "pythia-yahoo-discovery"),
                          ("ASML ships", "pythia-yahoo-discovery")])
        self.assertEqual([item["plugin"] for item in body["data"]["sources"]], ["pythia-yahoo-discovery", "pythia-eodhd"])

    def test_one_sources_own_items_are_never_dropped_as_duplicates(self):
        """A daily recurring headline and two announcements under one title, from one source, all stay; the other
        source's copy of one of them (same headline, under a day apart) goes."""
        plugins = lambda: [provider("pythia-yahoo-discovery", "yahoo"), provider("pythia-eodhd", "eodhd")]
        daily = [("Transaction in Own Shares", f"https://example.com/tios-{day}", f"2026-09-{day}T07:00:00Z")
                 for day in range(20, 26)]
        yahoo = news(*daily, ("Director/PDMR Shareholding", "https://example.com/pdmr-1", "2026-09-25T07:00:00Z"),
                     ("Director/PDMR Shareholding", "https://example.com/pdmr-2", "2026-09-25T15:00:00Z"))
        eodhd = news(("Transaction in own shares", "https://other.example/tios", "2026-09-25T09:00:00Z"),
                     ("!!!", "https://other.example/a", "2026-09-25T09:00:00Z"))
        yahoo["data"]["news"].append({"title": "???", "url": "https://example.com/b", "published_at": "2026-09-25T09:00:00Z"})
        body = self.read({"yahoo_news": yahoo, "eodhd_news": eodhd}, plugins=plugins, handler="news")
        titles = [(item["title"], item["plugin"]) for item in body["data"]["news"]]
        self.assertEqual(titles.count(("Transaction in Own Shares", "pythia-yahoo-discovery")), 6)
        self.assertEqual(titles.count(("Director/PDMR Shareholding", "pythia-yahoo-discovery")), 2)
        self.assertNotIn(("Transaction in own shares", "pythia-eodhd"), titles)
        self.assertIn(("!!!", "pythia-eodhd"), titles)  # a headline without words matches nothing

    def test_only_a_whole_not_covered_answer_gives_way(self):
        concepts = identity.concepts
        issue = {"code": "not_covered", "severity": "warning", "message": "not here"}
        self.assertEqual(concepts.not_covered({"outcome": "empty", "data": None, "issues": [issue]}), "not here")
        for answer in ({"outcome": "partial", "data": None, "issues": [{"code": "rate_limit"}, issue]},
                       {"outcome": "ok", "data": {"news": [{"title": "t"}]}, "issues": [issue]},
                       {"outcome": "empty", "data": {"news": [{"title": "t"}]}, "issues": [issue]},
                       {"outcome": "error", "data": None, "issues": [issue]}):
            with self.subTest(answer=answer):
                self.assertIsNone(concepts.not_covered(answer))
        mirror = json.loads((PLUGINS / "sec/contract.json").read_text())
        mirror.update(plugin="pythia-secmirror", provider="secmirror")
        plugins = lambda: [*shipped(), page.PluginInfo(key="pythia-secmirror", manifest=identity.validate_manifest(
            mirror), operations={"filings": "mirror_filings"})]
        merge = FilingsMergeTest()
        partial = {**merge.sec(), "outcome": "partial", "issues": [issue]}
        body = self.read({"pythia_xbrl_filings_filings": merge.xbrl(), "pythia_sec_filings": partial,
                          "mirror_filings": merge.sec()}, plugins=plugins)
        self.assertNotIn("mirror_filings", self.sent)
        self.assertEqual({item["plugin"] for item in body["data"]["filings"] if item["authority"] == "sec"},
                         {"pythia-sec"})

    def test_single_values_take_every_eligible_source_side_by_side(self):
        entries = [{"plugin": "a", "provider": "a", "status": "ready"}, {"plugin": "b", "provider": "b", "status": "ready"},
                   {"plugin": "u", "provider": "u", "status": "ready", "unaudited": True},
                   {"plugin": "d", "provider": "d", "status": "disabled"}]
        chosen, alternatives, skipped = identity.concepts.select(entries, combine=identity.Combine.SIDE_BY_SIDE)
        self.assertEqual(([e["plugin"] for e, _ in chosen], [e["plugin"] for e in alternatives],
                          [e["plugin"] for e in skipped]), (["a", "b", "u"], [], ["d"]))

    def test_an_enabled_unaudited_source_merges_labelled_without_being_named(self):
        # ADR 0044 ruling 10: a display source serves once enabled; it needs no place in the investor's order.
        plugins = [provider("pythia-yahoo-discovery", "yahoo"), provider("acme", "acme", signoff="unsigned")]
        answers = {"yahoo_news": news(("A", "https://example.com/a", "2026-09-27T08:00:00Z")),
                   "acme_news": news(("B", "https://example.com/b", "2026-09-27T09:00:00Z"))}
        body = self.read(answers, plugins=lambda: plugins, handler="news")
        self.assertEqual([(item["plugin"], item.get("unaudited")) for item in body["data"]["news"]],
                         [("acme", True), ("pythia-yahoo-discovery", None)])
        self.assertEqual(body["data"]["alternatives"], [])


def provider(plugin, name, concept="news", operations=None, signoff="grandfathered"):
    """A plugin that serves one issuer-level concept through a listing symbol (Amsterdam: `.AS`), built with the
    loaded core's own identity modules, since core compares levels by identity."""
    from pythia_core_queue_fixture.identity import page, validate_manifest
    operations = operations or {"list": "news"}
    document = {"contract_version": 1, "plugin": plugin, "provider": name, "rights": RIGHTS,
                "addressing": {"native": [{"native_scope": "symbol", "level": "listing"}], "mic_table": {"XAMS": ".AS"}},
                "concepts": {concept: {"level": "issuer", "via": "listing", "operations": operations}},
                "signoff": {"status": signoff}}
    return page.PluginInfo(key=plugin, manifest=validate_manifest(document),
                           operations={operation: f"{name}_{operation}" for operation in operations.values()})


def news(*items):
    return {"schema_version": 1, "outcome": "ok", "data": {"news": [
        {"title": title, "url": url, "published_at": at} for title, url, at in items]}}


if __name__ == "__main__":
    unittest.main()
