"""Text and outline of a filing document, read from a stream: core's document extraction (ADR 0040, the document
reader amendment).

`extract` streams an HTML, inline XBRL or ESEF xhtml body through an HTML parser, so the raw body is never held
whole: visible text with line breaks at blocks, and an outline from the document's own table of contents (internal
links, labelled by their text, in target order), else from "Part I" / "Item 1A." headings, else fixed-size parts.
`search` ranks passages of an extracted document by BM25. Pure standard library; no I/O but the stream.
"""
from __future__ import annotations

import codecs
import math
import re
import zlib
from collections import Counter
from html.parser import HTMLParser
from typing import Any, Callable, Iterator

MAX_BYTES = 64_000_000     # decoded bytes streamed through the parser (ASML's 20-F is 24.9 MB)
MAX_TEXT = 4_000_000       # extracted characters kept per document (ASML's 20-F has 1.3 million)
PASSAGE_CHARS = 1_200      # search passages are paragraphs joined up to about this size
PART_CHARS = 20_000        # fixed-size parts when a document has no usable outline


class TooLarge(RuntimeError):
    """A document past MAX_BYTES or MAX_TEXT; its message is the connectors' `output_limit` failure code."""

    def __init__(self):
        super().__init__("output_limit")


# ---- extraction --------------------------------------------------------------------------------------------------

class _Text(HTMLParser):
    """Visible text with line breaks at blocks, the offset of every id and name, and the document's internal links."""

    SKIP = frozenset({"script", "style", "head", "noscript", "template", "ix:header"})  # ix:header: hidden iXBRL facts
    BLOCK = frozenset({"address", "article", "blockquote", "br", "dd", "div", "dl", "dt", "figcaption", "figure",
                       "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "ol", "p", "pre",
                       "section", "table", "tr", "ul"})

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.size, self.last, self.pending, self.skip = 0, "\n", False, 0
        self.anchors: dict[str, int] = {}
        self.links: list[tuple[str, str]] = []
        self.link: tuple[str, list[str]] | None = None
        self.title: list[str] | None = None
        self.titled = ""

    def _emit(self, text: str) -> None:
        self.parts.append(text)
        self.size += len(text)
        self.last = text[-1]
        if self.size > MAX_TEXT:
            raise TooLarge()

    def _break(self) -> None:
        if self.last != "\n":
            self._emit("\n")
        self.pending = False

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag == "title" and not self.titled:
            self.title = []
        if tag in self.SKIP:
            self.skip += 1
        if self.skip:
            return
        for key, value in attrs:
            if key in ("id", "name") and value and value not in self.anchors:
                self.anchors[value] = self.size + (1 if self.pending and self.last != "\n" else 0)
            elif key == "href" and tag == "a" and value and value.startswith("#") and len(value) > 1:
                self.link = (value[1:], [])
        if tag in self.BLOCK:
            self._break()
        elif tag in ("td", "th"):
            self.pending = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "title" and self.title is not None:
            self.titled, self.title = " ".join("".join(self.title).split())[:200], None
        if tag in self.SKIP:
            self.skip = max(0, self.skip - 1)
            return
        if self.skip:
            return
        if tag == "a" and self.link is not None:
            self.links.append((self.link[0], " ".join(" ".join(self.link[1]).split())))
            self.link = None
        if tag in self.BLOCK:
            self._break()

    def handle_data(self, data: str) -> None:
        if self.title is not None:
            self.title.append(data)
        if self.skip:
            return
        if self.link is not None:
            self.link[1].append(data)
        words = data.split()
        if not words:
            self.pending = self.pending or bool(data)
            return
        text = " ".join(words)
        if (self.pending or data[0].isspace()) and self.last not in " \n":
            text = " " + text
        self._emit(text)
        self.pending = data[-1].isspace()


class _Strip:
    """Drops what a reader never sees before the parser gets it: a `data:` URI attribute value (an embedded image)
    and the body of a script or style element. HTMLParser buffers an unfinished construct and rebuilds it on every
    feed, so one 20 MB image would otherwise cost memory quadratic in its size; this keeps it linear and small."""

    MARK = re.compile(r"""=\s*(["'])\s*data:|<(script|style)\b""", re.I)
    KEEP = 16  # the end of a chunk, carried over in case a marker is cut there

    def __init__(self) -> None:
        self.carry, self.until = "", None  # `until`: what ends the part being dropped

    def feed(self, text: str, final: bool = False) -> str:
        text, self.carry, out, at = self.carry + text, "", [], 0
        while True:
            if self.until is not None:
                found = self.until.search(text, at)
                if not found:
                    self.carry = "" if final else text[max(at, len(text) - self.KEEP):]
                    return "".join(out)
                at, self.until = found.start(), None  # the closing quote or end tag stays for the parser
                continue
            found = self.MARK.search(text, at)
            if not found:
                cut = len(text) if final else max(at, len(text) - self.KEEP)
                out.append(text[at:cut])
                self.carry = text[cut:]
                return "".join(out)
            if found[1]:  # keep the attribute's opening quote; drop its value up to the closing quote
                out.append(text[at:found.start(1) + 1])
                self.until, at = re.compile(re.escape(found[1])), found.end()
                continue
            close = text.find(">", found.end())
            if close < 0:  # the start tag goes on in the next chunk
                out.append(text[at:found.start()])
                self.carry = "" if final else text[found.start():]
                return "".join(out)
            out.append(text[at:close + 1])
            self.until, at = re.compile("</" + found[2], re.I), close + 1


def _chunks(response: Any, inflate: Any, check: Callable[[], None]) -> Iterator[bytes]:
    """The body in pieces of at most about a megabyte, a gzip body inflated as it streams."""
    read = getattr(response, "read1", response.read)
    while True:
        check()
        chunk = read(65536)
        if not chunk:
            return
        while chunk:
            if inflate is None:
                yield chunk
                break
            yield inflate.decompress(chunk, 1 << 20)
            chunk = inflate.unconsumed_tail


def extract(response: Any, check: Callable[[], None] = lambda: None) -> dict:
    """A document's text and outline, read from an open HTTP response (or any object with `read`) in chunks.

    A gzip body is decoded as it streams; at most MAX_BYTES decoded bytes and MAX_TEXT characters are read, else
    TooLarge. `check` runs between chunks and may raise to stop (cancellation, a deadline)."""
    headers = getattr(response, "headers", None) or {}
    encoding = (headers.get("Content-Encoding") or "identity").strip().lower()
    if encoding not in ("identity", "gzip"):
        raise ValueError("invalid_response")
    inflate = zlib.decompressobj(zlib.MAX_WBITS | 16) if encoding == "gzip" else None
    charset = re.search(r"charset=([\w-]+)", headers.get("Content-Type") or "")
    try:
        decoder = codecs.getincrementaldecoder(charset[1] if charset else "utf-8")("replace")
    except LookupError:
        decoder = codecs.getincrementaldecoder("utf-8")("replace")
    parser, strip, size = _Text(), _Strip(), 0
    for chunk in _chunks(response, inflate, check):
        size += len(chunk)
        if size > MAX_BYTES:
            raise TooLarge()
        parser.feed(strip.feed(decoder.decode(chunk)))
    if inflate is not None and not inflate.eof:
        raise ValueError("invalid_response")
    parser.feed(strip.feed(decoder.decode(b"", final=True), final=True))
    parser.close()
    text = "".join(parser.parts)
    sections, method = outline(text, parser.anchors, parser.links)
    return {"title": parser.titled or None, "text": text, "bytes": size, "sections": sections,
            "outline_method": method}


# ---- outline -----------------------------------------------------------------------------------------------------

# Page numbers, navigation and "Read more in …" cross-references are no section titles.
NOT_A_TITLE = re.compile(r"^(?:page\s*)?[\divxlc]+(?:\s*[-–]\s*[\divxlc]+)?$|^(?:back|top|back to top|table of contents|"
                         r"contents|index|return to .*|go to .*)$|\bmore\b", re.I)
HEADING = re.compile(r"^(?:part\s+[ivx]+\b|item\s+\d{1,2}[a-c]?\b\.?)", re.I)


def _sections(text: str, starts: list[tuple[int, str, str | None]]) -> list[dict]:
    """Sections from (offset, title, anchor) starts, ordered, with a leading section for text before the first."""
    starts = sorted({offset: (offset, title, anchor) for offset, title, anchor in reversed(starts)}.values())
    if not starts or starts[0][0] > 0:
        starts.insert(0, (0, "Cover and contents", None))
    ends = [offset for offset, _title, _anchor in starts[1:]] + [len(text)]
    return [{"id": f"s{index}", "title": title[:120], "start": offset, "end": end,
             **({"anchor": anchor} if anchor else {})}
            for index, ((offset, title, anchor), end) in enumerate(zip(starts, ends)) if end > offset]


def outline(text: str, anchors: dict[str, int], links: list[tuple[str, str]]) -> tuple[list[dict], str]:
    """(sections, method): the table of contents' link targets, else Part and Item headings, else fixed parts."""
    labels: dict[str, list[str]] = {}
    for target, label in links:
        if target in anchors and label and not NOT_A_TITLE.search(label) and re.search(r"[A-Za-z]{2}", label):
            if label not in labels.setdefault(target, []):
                labels[target].append(label)
    starts = [(anchors[target], " ".join(name for name in names  # "Item 1A." and "Risk Factors"; not a repeat
                                         if not any(name != other and name.lower() in other.lower()
                                                    for other in names)), target)
              for target, names in labels.items()]
    if len({offset for offset, _title, _anchor in starts}) >= 3:
        return _sections(text, starts), "contents_links"
    found: dict[str, tuple[int, str, None]] = {}  # the last "Item 1A." heading wins: earlier ones are the contents
    offset = 0
    for line in text.split("\n"):
        if len(line) <= 160 and (match := HEADING.match(line.strip())):
            found[" ".join(match[0].lower().rstrip(".").split())] = (offset, line.strip(), None)
        offset += len(line) + 1
    if len(found) >= 3:
        return _sections(text, list(found.values())), "headings"
    starts, offset = [], 0
    while offset < len(text):
        starts.append((offset, f"Part {len(starts) + 1}", None))
        cut = text.rfind("\n", offset + PART_CHARS // 2, offset + PART_CHARS)
        offset = cut + 1 if cut > offset else offset + PART_CHARS
    return _sections(text, starts), "fixed_parts"


# ---- search ------------------------------------------------------------------------------------------------------

TOKEN = re.compile(r"[a-z0-9]+")


def passages(document: dict) -> Iterator[tuple[dict, int, int]]:
    """(section, start, end) of paragraphs joined up to about PASSAGE_CHARS, never across sections."""
    text = document["text"]
    for section in document["sections"]:
        start = offset = section["start"]
        while offset < section["end"]:
            cut = text.find("\n", offset, section["end"])
            offset = section["end"] if cut < 0 else cut + 1
            if offset - start >= PASSAGE_CHARS or offset >= section["end"]:
                while offset - start > 2 * PASSAGE_CHARS:  # one very long paragraph: cut it at a space
                    cut = (text.rfind(" ", start + PASSAGE_CHARS // 2, start + PASSAGE_CHARS) + 1
                           or start + PASSAGE_CHARS)
                    yield section, start, cut
                    start = cut
                if text[start:offset].strip():
                    yield section, start, offset
                start = offset


def search(document: dict, query: str, limit: int) -> tuple[list[tuple[float, dict, int, int]], int]:
    """The best `limit` passages for the query by BM25 (k1 1.2, b 0.75), a passage holding the whole query as a
    phrase ranked up, and how many passages match at all."""
    terms = list(dict.fromkeys(TOKEN.findall(query.lower())))
    phrase = " ".join(query.lower().split())
    rows = []
    for section, start, end in passages(document):
        lowered = document["text"][start:end].lower()
        words = TOKEN.findall(lowered)
        counts = Counter(word for word in words if word in terms)
        rows.append((section, start, end, counts, len(words), phrase in " ".join(lowered.split())))
    if not rows or not terms:
        return [], 0
    average = sum(row[4] for row in rows) / len(rows) or 1
    frequency = Counter(term for row in rows for term in row[3])
    weight = {term: math.log(1 + (len(rows) - frequency[term] + 0.5) / (frequency[term] + 0.5)) for term in terms}
    scored = []
    for section, start, end, counts, length, whole in rows:
        if not counts:
            continue
        score = sum(weight[term] * counts[term] * 2.2 / (counts[term] + 1.2 * (0.25 + 0.75 * length / average))
                    for term in counts)
        scored.append((score + (sum(weight.values()) if whole and len(terms) > 1 else 0), section, start, end))
    scored.sort(key=lambda row: -row[0])
    return scored[:limit], len(scored)
