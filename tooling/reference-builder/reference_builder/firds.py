"""ESMA FIRDS reference data (FULINS + DLTINS deltas) and FITRS equity transparency.

Files are ISO 20022 XML inside zip archives (auth.017 full, auth.036 delta,
auth.044 equity transparency). They are large, so records are located with a
byte-level scan and only matching records are parsed.
"""

from __future__ import annotations

import re
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter
from collections.abc import Iterable, Iterator
from datetime import date
from typing import BinaryIO

from .fetch import Downloader, log, request
from .model import FirdsRecord, Transparency

FIRDS_INDEX = "https://registers.esma.europa.eu/solr/esma_registers_firds_files/select"
FITRS_INDEX = "https://registers.esma.europa.eu/solr/esma_registers_fitrs_files/select"
BLOCK = 8 << 20
DELTA_KINDS = {"NewRcrd": "new", "ModfdRcrd": "modified", "TermntdRcrd": "terminated", "CancRcrd": "cancelled"}


def _index(url: str, user_agent: str, filters: list[str], sort: str, rows: int = 200) -> list[dict]:
    params = [("q", "*"), ("wt", "json"), ("rows", str(rows)), ("sort", sort)] + [("fq", f) for f in filters]
    return request(f"{url}?{urllib.parse.urlencode(params)}", user_agent=user_agent).json()["response"]["docs"]


def _day(value: str) -> str:
    return value[:10]


def file_types(cfi_prefixes: Iterable[str]) -> list[str]:
    """FIRDS and FITRS split files by the CFI category letter (E equities, C collective investment)."""
    return sorted({p[0] for p in cfi_prefixes})


def firds_files(user_agent: str, as_of: date, deltas: bool, cfi_prefixes: Iterable[str]) -> tuple[list[dict], list[dict]]:
    """Latest FULINS files for the wanted CFI categories on or before `as_of`, plus later daily deltas."""
    until = f"{as_of.isoformat()}T23:59:59Z"
    full: list[dict] = []
    for letter in file_types(cfi_prefixes):
        docs = _index(FIRDS_INDEX, user_agent, [f"publication_date:[* TO {until}]", "file_type:FULINS", f"file_name:FULINS_{letter}_*"], "publication_date desc", 20)
        if not docs:
            raise SystemExit(f"ESMA FIRDS index returned no FULINS_{letter} file")
        latest = _day(docs[0]["publication_date"])
        full += sorted((d for d in docs if _day(d["publication_date"]) == latest), key=lambda d: d["file_name"])
    if not deltas:
        return full, []
    since = f"{min(_day(d['publication_date']) for d in full)}T23:59:59Z"
    delta = _index(FIRDS_INDEX, user_agent, [f"publication_date:{{{since} TO {until}]", "file_type:DLTINS"], "publication_date asc", 200)
    return full, sorted(delta, key=lambda d: d["file_name"])


def fitrs_files(user_agent: str, as_of: date, cfi_prefixes: Iterable[str]) -> list[dict]:
    """Latest full equity transparency files: shares `E`, depositary receipts `R`, ETFs `C`."""
    until = f"{as_of.isoformat()}T23:59:59Z"
    docs = _index(FITRS_INDEX, user_agent, [f"creation_date:[* TO {until}]", "file_name:FULECR_*"], "creation_date desc", 20)
    if not docs:
        return []
    latest = _day(docs[0]["creation_date"])
    wanted = "ER" + ("C" if "C" in file_types(cfi_prefixes) else "")
    return [d for d in docs if _day(d["creation_date"]) == latest and re.search(rf"_[{wanted}]_", d["file_name"])]


def download(downloader: Downloader, source: str, doc: dict) -> str:
    version = doc["file_name"].rsplit(".", 1)[0]
    return downloader.get(source, doc["download_link"], doc["file_name"], md5=doc.get("checksum"), version=version).path


def scan(stream: BinaryIO, tag: bytes, want: re.Pattern[bytes]) -> Iterator[bytes]:
    """Yield each complete `<tag>…</tag>` element whose bytes match `want`."""
    opening, closing = b"<" + tag + b">", b"</" + tag + b">"
    carry = b""
    while True:
        chunk = stream.read(BLOCK)
        buffer = carry + chunk
        cut = buffer.rfind(closing)
        if cut < 0:
            if not chunk:
                return
            carry = buffer
            continue
        cut += len(closing)
        complete, carry = buffer[:cut], buffer[cut:]
        for match in want.finditer(complete):
            start = complete.rfind(opening, 0, match.start())
            end = complete.find(closing, match.end())
            if start >= 0 and end >= 0:
                yield complete[start : end + len(closing)]
        if not chunk:
            return


def _members(path: str) -> Iterator[BinaryIO]:
    with zipfile.ZipFile(path) as archive:
        for name in archive.namelist():
            if name.lower().endswith(".xml"):
                with archive.open(name) as member:
                    yield member


def _cfi_pattern(prefixes: Iterable[str]) -> re.Pattern[bytes]:
    alternatives = b"|".join(re.escape(p.encode()) for p in prefixes)
    return re.compile(rb"<ClssfctnTp>(?:" + alternatives + rb")")


def _text(element: ET.Element | None, path: str) -> str | None:
    if element is None:
        return None
    found = element.find(path)
    return found.text.strip() if found is not None and found.text else None


def parse_record(element: ET.Element, kind: str) -> FirdsRecord | None:
    general = element.find("FinInstrmGnlAttrbts")
    venue = element.find("TradgVnRltdAttrbts")
    isin, mic = _text(general, "Id"), _text(venue, "Id")
    if not isin or not mic:
        return None
    underlying = _text(element, "DerivInstrmAttrbts/UndrlygInstrm/Sngl/ISIN")
    return FirdsRecord(
        kind=kind,
        isin=isin,
        mic=mic,
        cfi=_text(general, "ClssfctnTp") or "",
        full_name=_text(general, "FullNm"),
        short_name=_text(general, "ShrtNm"),
        currency=_text(general, "NtnlCcy"),
        issuer_lei=_text(element, "Issr"),
        relevant_mic=_text(element, "TechAttrbts/RlvntTradgVn"),
        first_trade=(_text(venue, "FrstTradDt") or "")[:10] or None,
        termination=(_text(venue, "TermntnDt") or "")[:10] or None,
        underlying_isin=underlying if underlying and not underlying.startswith("NOISIN") else None,
    )


def full_records(stream: BinaryIO, cfi_prefixes: Iterable[str]) -> Iterator[FirdsRecord]:
    for raw in scan(stream, b"RefData", _cfi_pattern(cfi_prefixes)):
        record = parse_record(ET.fromstring(raw), "full")
        if record:
            yield record


def delta_records(stream: BinaryIO, cfi_prefixes: Iterable[str]) -> Iterator[FirdsRecord]:
    for raw in scan(stream, b"FinInstrm", _cfi_pattern(cfi_prefixes)):
        wrapper = ET.fromstring(raw)
        for child in wrapper:
            kind = DELTA_KINDS.get(child.tag)
            record = parse_record(child, kind) if kind else None
            if record:
                yield record


def apply(admissions: dict[tuple[str, str], FirdsRecord], records: Iterable[FirdsRecord], counts: Counter) -> None:
    """Apply full and delta records in publication order, keyed by (ISIN, venue MIC)."""
    for record in records:
        key = (record.isin, record.mic)
        counts[record.kind] += 1
        if record.kind == "cancelled":
            admissions.pop(key, None)
        else:
            admissions[key] = record


def load_admissions(paths_full: list[str], paths_delta: list[str], cfi_prefixes: tuple[str, ...]) -> tuple[dict, Counter]:
    admissions: dict[tuple[str, str], FirdsRecord] = {}
    counts: Counter = Counter()
    for path in paths_full:
        for member in _members(path):
            apply(admissions, full_records(member, cfi_prefixes), counts)
    for path in paths_delta:
        for member in _members(path):
            apply(admissions, delta_records(member, cfi_prefixes), counts)
    log(f"FIRDS: {len(admissions)} equity admissions after {counts['full']} full and {sum(counts.values()) - counts['full']} delta records")
    return admissions, counts


def transparency_records(stream: BinaryIO) -> Iterator[Transparency]:
    for raw in scan(stream, b"EqtyTrnsprncyData", re.compile(rb"<Id>")):
        element = ET.fromstring(raw)
        stats = element.find("Sttstcs")
        turnover = _text(stats, "AvrgDalyTrnvr")
        transactions = _text(stats, "AvrgDalyNbOfTxs")
        yield Transparency(
            isin=_text(element, "Id") or "",
            classification=_text(element, "FinInstrmClssfctn"),
            turnover_eur=float(turnover) if turnover else None,
            transactions=float(transactions) if transactions else None,
            methodology=_text(element, "Mthdlgy"),
            applies_from=_text(element, "ApplPrd/FrDtToDt/FrDt"),
            applies_to=_text(element, "ApplPrd/FrDtToDt/ToDt"),
            relevant_mic=_text(element, "RlvntMkt/Id"),
        )


def select_transparency(records: Iterable[Transparency], as_of: date) -> dict[str, Transparency]:
    """Keep, per ISIN, the result whose application period started last on or before `as_of`."""
    day = as_of.isoformat()
    chosen: dict[str, Transparency] = {}
    for record in records:
        if not record.isin or (record.applies_from and record.applies_from > day):
            continue
        current = chosen.get(record.isin)
        if current is None or (record.applies_from or "") > (current.applies_from or ""):
            chosen[record.isin] = record
    return chosen


def load_transparency(paths: list[str], as_of: date) -> dict[str, Transparency] | None:
    """Equity transparency results per ISIN, or None when FITRS offered none (unavailable, not all missing)."""

    def all_records() -> Iterator[Transparency]:
        for path in paths:
            for member in _members(path):
                yield from transparency_records(member)

    chosen = select_transparency(all_records(), as_of)
    log(f"FITRS: {len(chosen)} ISINs with an equity transparency result" if chosen else "FITRS: no equity transparency result; activity check skipped")
    return chosen or None
