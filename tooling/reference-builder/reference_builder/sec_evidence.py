"""Evidence for the SEC onboarding audit (`sec_audit.py`): cached EDGAR reads and the XBRL instance reader.

Every file is cached under the audit's `.local/` directory; a read that is not cached needs a User-Agent (the
configured `sec_identity`) and is paced under five requests a second. A 404 is cached as absence.
"""

from __future__ import annotations

import gzip
import json
import random
import re
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

PERIODIC = ("10-K", "20-F", "40-F", "10-Q")
XBRLI = "{http://www.xbrl.org/2003/instance}"
MISSING = b"__404__"


class Fetcher:
    """Cached GETs; `None` for a 404. Network only when the file is not cached."""

    def __init__(self, cache: Path, agent: str | None):
        self.cache, self.agent, self.last = cache, agent, 0.0
        cache.mkdir(parents=True, exist_ok=True)

    def get(self, url: str, name: str, agent: str | None = None) -> bytes | None:
        path = self.cache / name
        if not path.exists():
            if self.agent is None and agent is None:
                raise LookupError(f"{name} is not cached; run `fetch` first")
            time.sleep(max(0.0, self.last + 0.2 - time.monotonic()))
            self.last = time.monotonic()
            path.write_bytes(_download(url, agent or self.agent))
        body = path.read_bytes()
        return None if body == MISSING else body

    def json(self, url: str, name: str, agent: str | None = None):
        body = self.get(url, name, agent)
        return None if body is None else json.loads(body)


def _download(url: str, agent: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": agent, "Accept-Encoding": "gzip"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                body = response.read()
                return gzip.decompress(body) if response.headers.get("Content-Encoding") == "gzip" else body
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return MISSING
            if error.code not in (429, 500, 502, 503) or attempt == 3:
                raise
        except (TimeoutError, OSError):
            if attempt == 3:
                raise
        time.sleep(5 * (attempt + 1))
    raise AssertionError("unreachable")


def submissions(fetch: Fetcher, cik: int) -> dict:
    return fetch.json(f"https://data.sec.gov/submissions/CIK{cik:010d}.json", f"sub_{cik}.json")


def companyfacts(fetch: Fetcher, cik: int) -> dict | None:
    return fetch.json(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json", f"cf_{cik}.json")


def evidence(fetch: Fetcher, cik: int) -> list[tuple[str, str, bool]]:
    """(form, accession, has XBRL) of the filings labelled for one filer: its latest 10-K, 20-F, 40-F and 10-Q,
    and three random filings of its latest 200 (seeded by the CIK)."""
    recent = submissions(fetch, cik)["filings"]["recent"]
    picks = [next(i for i, form in enumerate(recent["form"]) if form == wanted) for wanted in PERIODIC if wanted in recent["form"]]
    others = [i for i in range(min(len(recent["form"]), 200)) if i not in picks]
    picks += random.Random(cik).sample(others, min(3, len(others)))
    return [(recent["form"][i], recent["accessionNumber"][i], bool((recent.get("isXBRL") or [0] * len(recent["form"]))[i]))
            for i in picks]


def header(fetch: Fetcher, cik: int, accession: str) -> dict | None:
    body = fetch.get(f"https://www.sec.gov/Archives/edgar/data/{cik}/{accession.replace('-', '')}/{accession}-index-headers.html",
                     f"hdr_{accession}.html")
    if body is None:
        return None
    text = body.decode("utf-8", "replace")
    field = lambda tag: (re.search(rf"<{tag}>([^\n<]+)", text) or [None, None])[1]  # noqa: E731
    return {"accepted": field("ACCEPTANCE-DATETIME"), "filed": field("FILING-DATE"), "period": field("PERIOD"),
            "type": (field("TYPE") or "").strip() or None}


def instance(fetch: Fetcher, cik: int, accession: str) -> list[dict] | None:
    """The filing's XBRL instance facts (the inline document's extracted `_htm.xml`, else the instance file)."""
    folder = f"https://www.sec.gov/Archives/edgar/data/{cik}/{accession.replace('-', '')}/"
    listing = fetch.json(folder + "index.json", f"idx_{accession}.json") or {}
    names = [item["name"] for item in listing.get("directory", {}).get("item", [])]
    found = [n for n in names if n.endswith("_htm.xml")] or [
        n for n in names if n.endswith(".xml") and not n.startswith(("Financial_Report", "FilingSummary"))
        and not n.endswith(("_cal.xml", "_def.xml", "_lab.xml", "_pre.xml"))]
    body = fetch.get(folder + found[0], f"inst_{accession}.xml") if found else None
    return None if body is None else parse_instance(body)


def parse_instance(body: bytes) -> list[dict]:
    root = ET.fromstring(body)
    contexts = {}
    for context in root.iter(XBRLI + "context"):
        period = context.find(XBRLI + "period")
        segment = context.find(f"{XBRLI}entity/{XBRLI}segment")
        instant = period.find(XBRLI + "instant")
        start = None if instant is not None else period.find(XBRLI + "startDate").text.strip()[:10]
        end = (instant if instant is not None else period.find(XBRLI + "endDate")).text.strip()[:10]
        contexts[context.get("id")] = (start, end, segment is not None and len(segment) > 0)
    units = {unit.get("id"): "/".join(m.text.split(":")[-1] for m in unit.iter(XBRLI + "measure")) for unit in root.iter(XBRLI + "unit")}
    facts = []
    for element in root:
        if not element.tag.startswith("{") or element.get("contextRef") is None:
            continue
        uri, concept = element.tag[1:].split("}")
        lowered = uri.lower()
        taxonomy = ("us-gaap" if "fasb.org/us-gaap" in lowered else "ifrs-full" if "ifrs-full" in lowered
                    else "dei" if "xbrl.sec.gov/dei" in lowered else "srt" if "fasb.org/srt" in lowered else "ext")
        start, end, dimensional = contexts[element.get("contextRef")]
        facts.append({"taxonomy": taxonomy, "concept": concept, "start": start, "end": end, "dims": dimensional,
                      "unit": units.get(element.get("unitRef")), "context": element.get("contextRef"),
                      "nil": element.get("{http://www.w3.org/2001/XMLSchema-instance}nil") == "true",
                      "text": (element.text or "").strip()})
    return facts
