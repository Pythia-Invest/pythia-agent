"""Core's document reader over synthetic HTML: extraction, outline, search, caps and the disk cache. No provider."""
import gzip
import importlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import tracemalloc
import unittest
from pathlib import Path
from unittest import mock

from test_agent_tools import ASML, AgentToolFixture, agent_reads, envelope, filing_rows, identity_ops

MANAGED = Path(__file__).resolve().parents[2] / "managed"
if "pythia_core_fixture" not in sys.modules:
    spec = importlib.util.spec_from_file_location("pythia_core_fixture", MANAGED / "core/__init__.py",
                                                  submodule_search_locations=[str(MANAGED / "core")])
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
document_text = importlib.import_module("pythia_core_fixture.document_text")
documents = importlib.import_module("pythia_core_fixture.documents")


class Response(io.BytesIO):
    def __init__(self, content, headers=None):
        super().__init__(content)
        self.headers = headers or {}


def read(html, headers=None):
    return document_text.extract(Response(html.encode(), headers))


TEN_K = ('<html><head><title>exa-20250927</title><style>p {}</style></head><body>'
         '<div style="display:none"><ix:header><ix:hidden>HIDDEN FACT</ix:hidden></ix:header></div>'
         '<table><tr><td><a href="#p1">Part I</a></td></tr>'
         '<tr><td><a href="#i1">Item 1.</a></td><td><a href="#i1">Business</a></td><td><a href="#i1">1</a></td></tr>'
         '<tr><td><a href="#i1a">Item 1A.</a></td><td><a href="#i1a">Risk Factors</a></td><td><a href="#i1a">5</a></td></tr>'
         '</table><script>var x = 1;</script>'
         '<div id="p1">PART I</div><div id="i1"><span>Item 1.</span> Business</div><p>We make&nbsp;phones.</p>'
         '<div id="i1a">Item 1A. Risk Factors</div><p>Sales in <b>China</b> may fall.</p>'
         '<p><a href="#i1a">Read more in Risk Factors</a> <a href="#top">Back to top</a></p></body></html>')


class Chunked(Response):
    """A body read a few bytes at a time, so text and links are cut across chunks."""

    def read1(self, size=-1):
        return self.read(3)


DESIGNED = ('<table><tr><td><a href="#sr">STRATEGIC REPORT</a></td><td><a href="#ceo">Q&amp;A with the CEO</a></td>'
            '<td><span>Financial p</span><a href="#fp">erformance</a></td></tr></table>'
            '<p><a href="#r1">Our future success depends</a></p><p><a href="#r2">We face intense competition</a></p>'
            '<div id="sr">STRATEGIC REPORT</div><div id="ceo">Q&amp;A with the CEO</div><p>Welcome.</p>'
            '<p><a href="#ceo">Read more in Strategic report – In conversation with </a></p>'
            '<p><a href="#ceo">our C</a><a href="#ceo">EO</a></p>'
            '<div id="fp">Financial performance</div><p>Sales grew.</p><p><a href="#fp">Financial performance</a></p>'
            '<p>Our marketplace</p><div id="mk"></div>'
            '<p>Tariffs weighed.</p><p><a href="#mk">Read more in Strategic report – Our marketplace</a></p>'
            '<p>R<a href="#ce">ead more in </a><a href="#ce">Sustainability statements – </a></p>'
            '<p><a href="#ce">Circular economy – Systems</a></p><p>Circular economy: Systems</p><p id="ce">Reuse.</p>'
            '<table><tr><td rowspan="2">Strategic</td><td colspan="2"><span id="r1"></span>Our future success '
            'depends</td><td><span id="r2"></span>We face intense competition</td></tr>'
            '<tr><td>Body one begins.</td><td>Body one continues.</td><td>Body two.</td></tr></table>'
            '<table><tr><td>Sales</td><td>1</td></tr><tr><td>Costs</td><td>2</td></tr></table>')


class Extraction(unittest.TestCase):
    def test_text_leaves_out_hidden_facts_scripts_and_styles_and_breaks_at_blocks(self):
        document = read(TEN_K)
        self.assertEqual(document["title"], "exa-20250927")
        self.assertNotIn("HIDDEN", document["text"])
        self.assertNotIn("var x", document["text"])
        self.assertIn("Item 1. Business\nWe make phones.\n", document["text"])
        self.assertIn("Sales in China may fall.", document["text"])

    def test_the_contents_links_give_the_outline_with_anchors(self):
        document = read(TEN_K)
        self.assertEqual(document["outline_method"], "contents_links")
        self.assertEqual([(item["title"], item.get("anchor")) for item in document["sections"]],
                         [("Cover and contents", None), ("PART I", "p1"), ("Item 1. Business", "i1"),
                          ("Item 1A. Risk Factors", "i1a")])
        risk = document["sections"][-1]
        self.assertTrue(document["text"][risk["start"]:risk["end"]].startswith("Item 1A. Risk Factors\nSales"))

    def test_a_page_of_columns_is_read_column_by_column_and_titles_are_the_printed_headings(self):
        # Shaped by ASML's 2025 20-F and ESEF report (Workiva): three risk headings in one table row, their bodies in
        # the row below; a link cut mid-word; a heading printed before its anchor; a link on part of a heading
        # ("erformance") next to one on all of it; a target named only by a split "Read more in" reference.
        document = document_text.extract(Chunked(DESIGNED.encode()))
        titles = {item.get("anchor"): item["title"] for item in document["sections"]}
        self.assertEqual(titles, {None: "Cover and contents", "sr": "STRATEGIC REPORT", "ceo": "Q&A with the CEO",
                                  "fp": "Financial performance", "mk": "Our marketplace",
                                  "ce": "Sustainability statements – Circular economy – Systems",
                                  "r1": "Our future success depends", "r2": "We face intense competition"})
        body = {item.get("anchor"): document["text"][item["start"]:item["end"]] for item in document["sections"]}
        self.assertEqual(body["r1"], "Our future success depends\nBody one begins.\nBody one continues.\n")
        self.assertEqual(body["r2"], "We face intense competition\nBody two.\nSales 1\nCosts 2\n")  # rows kept
        self.assertTrue(body["mk"].startswith("Our marketplace\nTariffs"))
        self.assertIn("Strategic\nOur future", document["text"])

    def test_data_tables_keep_their_rows_even_with_linked_cells(self):
        contents = '<p><a href="#a">A</a></p><p><a href="#b">B</a></p><p><a href="#c">C</a></p>'
        balance = ('<p>See <a href="#ta">total assets</a> and <a href="#te">total equity</a>.</p><table>'
                   '<tr><td></td><td>2024</td><td>2025</td></tr><tr><td id="ta">Total assets</td><td>48,000</td>'
                   '<td id="te">50,000</td></tr><tr><td>Total equity</td><td>18,000</td><td>19,000</td></tr></table>')
        kpis = ('<p><a href="#k">Key figures</a> <a href="#o">Outlook</a></p><table><tr><td colspan="3">'
                '<span id="k"></span>Key figures</td><td><span id="o"></span>Outlook</td></tr><tr><td>Net sales</td>'
                '<td>28,263</td><td>32,667</td><td rowspan="2">We expect growth.</td></tr><tr><td>Gross margin</td>'
                '<td>51.3%</td><td>52.8%</td></tr></table>')
        text = read(contents + '<p id="a">a</p><p id="b">b</p><p id="c">c</p>' + balance + kpis)["text"]
        self.assertIn("Total assets 48,000 50,000\nTotal equity 18,000 19,000", text)
        self.assertIn("Net sales 28,263 32,667 We expect growth.\nGross margin 51.3% 52.8%", text)

    def test_without_contents_links_headings_then_fixed_parts_are_the_outline(self):
        headings = read("<p>Item 1. Business</p><p>Item 1A. Risk Factors</p><p>PART I</p><p>Item 1. Business</p>"
                        "<p>About us.</p><p>Item 1A. Risk Factors</p><p>Risks.</p><p>Item 2. Properties</p>")
        self.assertEqual(headings["outline_method"], "headings")
        self.assertEqual([item["title"] for item in headings["sections"]],  # the contents' repeats are passed over
                         ["Cover and contents", "PART I", "Item 1. Business", "Item 1A. Risk Factors",
                          "Item 2. Properties"])
        parts = read("<p>" + "word " * 9000 + "</p>" * 3)
        self.assertEqual(parts["outline_method"], "fixed_parts")
        self.assertGreater(len(parts["sections"]), 1)
        self.assertEqual(parts["sections"][-1]["end"], len(parts["text"]))

    def test_gzip_and_a_declared_charset_are_decoded(self):
        html = '<p id="a">Café</p>'.encode("latin-1")
        document = document_text.extract(Response(gzip.compress(html), {"Content-Encoding": "gzip",
                                                                      "Content-Type": "text/html; charset=latin-1"}))
        self.assertEqual(document["text"].strip(), "Café")
        with self.assertRaises(ValueError):
            document_text.extract(Response(b"x", {"Content-Encoding": "br"}))

    def test_embedded_images_and_scripts_stream_in_small_bounded_memory(self):
        blob = "QUFB" * 2_500_000  # 10 MB, as a base64 image or an ixbrl-viewer fact script
        body = Response((f'<p id="a">Before</p><img alt="x" src = "data:image/png;base64,{blob}"/>'
                         f'<script type="application/json">{blob}</script><p>After</p>').encode())
        tracemalloc.start()
        try:
            document = document_text.extract(body)
            peak = tracemalloc.get_traced_memory()[1]
        finally:
            tracemalloc.stop()
        self.assertEqual(document["text"].split(), ["Before", "After"])
        self.assertLess(peak, 4_000_000)  # the parser never holds the 10 MB construct
        for table in ('<tr>' + '<td colspan="100" rowspan="100"></td>' * 200 + '</tr>', '<tr>' + '<td></td>' * 20_000):
            tracemalloc.start()  # a table's grid is capped: spans and empty cells cost no memory past TABLE_CELLS
            try:
                read(f'<table>{table}</table><p>After</p>')
                peak = tracemalloc.get_traced_memory()[1]
            finally:
                tracemalloc.stop()
            self.assertLess(peak, 2_000_000)
        closed = read('<p>Before</p><script src="viewer.js"/><style/><p>After</p><script>x</script><p>End</p>')
        self.assertEqual(closed["text"].split(), ["Before", "After", "End"])  # self-closing tags drop nothing
        html = '<p>a</p><img src="data:x,Q"/><style>p{}</style><p title=\'data:y\'>b</p>'
        strip = document_text._Strip()  # a marker cut at any chunk boundary is still found
        self.assertEqual("".join(strip.feed(char) for char in html) + strip.feed("", final=True),
                         document_text._Strip().feed(html, final=True))

    def test_bytes_and_text_past_the_caps_stop_the_read(self):
        with mock.patch.object(document_text, "MAX_BYTES", 100), self.assertRaisesRegex(RuntimeError, "output_limit"):
            read("<p>" + "x" * 200 + "</p>")
        with mock.patch.object(document_text, "MAX_TEXT", 10), self.assertRaisesRegex(RuntimeError, "output_limit"):
            read("<p>" + "y " * 20 + "</p>")


class SearchAndCache(unittest.TestCase):
    def test_search_ranks_the_phrase_first_and_passages_keep_to_their_section(self):
        document = read('<a href="#a">Alpha</a><a href="#b">Beta</a><a href="#c">Gamma</a>'
                        '<p id="a">Net sales grew. Sales by region below.</p>'
                        '<p id="b">Net sales by segment were strong.</p><p id="c">Nothing here.</p>')
        found, matched = document_text.search(document, "net sales by", 5)
        self.assertEqual(matched, 2)
        self.assertEqual(found[0][1]["title"], "Beta")
        for _score, section, start, end in found:
            self.assertTrue(section["start"] <= start < end <= section["end"])

    def test_the_cache_keeps_recently_read_documents_within_its_size(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = documents.Cache(Path(directory), limit=5000)
            for index in range(4):
                cache.put({"id": f"doc-{index}", "text": "z" * 2000})
                os.utime(cache.path(f"doc-{index}"), (index, index))
            cache.put({"id": "doc-4", "text": "z" * 2000})
            self.assertEqual([cache.get(f"doc-{index}") is not None for index in range(5)],
                             [False, False, False, True, True])



class DocumentToolTest(AgentToolFixture):
    """pythia_document over core's read, with the fixture's reference and a fake source."""

    def setUp(self):
        super().setUp()
        self.eligible.add(agent_reads.READ_DOCUMENT)
        self.handlers[agent_reads.READ_DOCUMENT] = documents.Reader(identity_ops.CURRENT).read
        self.enterContext(mock.patch.object(documents, "_listed", documents.OrderedDict()))

    def read(self, **arguments):
        return json.loads(agent_reads.document(self.ctx, arguments))

    def test_document_reads_a_listed_report_by_its_key_with_citations_and_caches_it(self):
        report = "issuer:lei:724500Y6DUVHQD6OXN27|annual|2025-12-31|oam-nl"
        rows = filing_rows(["AFR", "AFR"])
        for row, digest in zip(rows, ("a" * 64, "b" * 64)):
            row["accession"] = digest
        rows[1]["period_end"] = "2024-12-31"
        xbrl = {"dataset": "filings", "provider": "xbrl-filings", "filings": rows}
        html = ('<html><head><title>ASML 2025</title></head><body><p><a href="#r">Risk factors</a></p>'
                '<p><a href="#s">Segments</a></p><p><a href="#n">Notes</a></p>'
                '<h2 id="r">Risk factors</h2><p>Export controls on China may limit sales.</p>'
                '<h2 id="s">Segments</h2><p>One segment: net sales by product.</p>'
                '<h2 id="n">Notes</h2><p>' + "Other text. " * 2000 + "</p></body></html>")
        fetched = []

        def read(args, **_):
            fetched.append(args)
            return envelope({**document_text.extract(io.BytesIO(html.encode())), "url": "https://example.org/r.xhtml",
                             "observed_at": "2026-09-28T10:00:00Z"})
        self.handlers["pythia_xbrl_filings_filings"] = lambda args, **_: envelope(xbrl)
        self.handlers["pythia_sec_filings"] = lambda args, **_: envelope({"dataset": "filings", "filings": []})
        self.handlers["pythia_xbrl_filings_document"] = read
        outline = self.read(subject_id=ASML, report_key=report)
        self.assertEqual(fetched, [{"native_ref": {"provider": "xbrl-filings", "native_id": "724500Y6DUVHQD6OXN27",
                                                   "native_scope": "lei"}, "id": "a" * 64}])  # no url: not its parameter
        self.assertEqual([item["title"] for item in outline["data"]["sections"]],
                         ["Cover and contents", "Risk factors", "Segments", "Notes"])
        self.assertEqual(outline["data"]["document"]["id"], "a" * 64)
        self.assertEqual(self.read(subject_id=ASML, report_key=report)["data"]["document"]["id"], "a" * 64)
        section = self.read(subject_id=ASML, id="a" * 64, section="s1")
        self.assertEqual(section["data"]["text"].strip(), "Risk factors\nExport controls on China may limit sales.")
        self.assertEqual(section["data"]["citation"]["url"], "https://example.org/r.xhtml#r")
        self.assertEqual(len(fetched), 1)  # by report_key or id, read again from the disk cache
        found = self.read(subject_id=ASML, id="a" * 64, query="net sales by")
        self.assertEqual(found["data"]["passages"][0]["citation"]["section_title"], "Segments")
        long = self.read(subject_id=ASML, id="a" * 64, section="s3", max_chars=1000)
        self.assertLessEqual(len(long["data"]["text"]), 1000)
        rest = self.read(subject_id=ASML, id="a" * 64, section="s3",
                         start=long["data"]["continue_from"])
        self.assertGreater(rest["data"]["citation"]["offsets"][0], long["data"]["citation"]["offsets"][0])
        self.assertIn("continue_from", long["next"])
        # Several versions of one report are named, never picked; an unlisted filing is refused.
        rows[1]["period_end"] = "2025-12-31"
        agent_reads.filings(self.ctx, {"subject_id": ASML})
        several = self.read(subject_id=ASML, report_key=report)
        self.assertEqual(several["issues"][0]["code"], "several_versions")
        self.assertEqual([item["id"] for item in several["data"]["versions"]], ["a" * 64, "b" * 64])
        missing = self.read(subject_id=ASML, id="c" * 64)
        self.assertEqual(missing["issues"][0]["code"], "not_listed")
        self.handlers["pythia_xbrl_filings_document"] = lambda args, **_: json.dumps({
            "schema_version": 1, "outcome": "error", "data": None,
            "issues": [{"code": "output_limit", "severity": "error", "message": "The data response exceeded."}]})
        large = self.read(subject_id=ASML, report_key=report, id="b" * 64)
        self.assertIn("larger than Pythia reads", large["issues"][0]["message"])

    def test_a_filing_listed_only_by_a_form_filter_is_readable(self):
        form4 = {**filing_rows(["4"])[0], "accession": "0000937966-26-000004", "kind": "ownership",
                 "url": "https://www.sec.gov/Archives/edgar/data/937966/000093796626000004/form4.htm"}
        self.handlers["pythia_xbrl_filings_filings"] = lambda args, **_: envelope({"filings": []})
        self.handlers["pythia_sec_filings"] = lambda args, **_: envelope(  # a default list leaves Forms 4 out
            {"dataset": "filings", "filings": [form4] if "forms" in args else []})
        fetched = []
        self.handlers["pythia_sec_document"] = lambda args, **_: fetched.append(args) or envelope(
            {**document_text.extract(io.BytesIO(b"<p>Item 1. Shares</p>")), "url": form4["url"]})
        self.assertEqual(self.read(subject_id=ASML, id=form4["accession"])["issues"][0]["code"], "not_listed")
        agent_reads.filings(self.ctx, {"subject_id": ASML, "forms": ["4"]})
        outline = self.read(subject_id=ASML, id=form4["accession"])
        self.assertEqual(outline["data"]["document"]["form"], "4")
        self.assertEqual([args["url"] for args in fetched], [form4["url"]])


if __name__ == "__main__":
    unittest.main()
