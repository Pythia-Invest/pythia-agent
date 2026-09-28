"""ESMA FIRDS reference data (FULINS + DLTINS deltas) and FITRS equity transparency.

Files are ISO 20022 XML inside zip archives (auth.017 full, auth.036 delta,
auth.044 equity transparency). They are large, so records are located with a
byte-level scan and only matching records are parsed.

`claims()` is the FIRDS adapter: each field it reads becomes a claim in the one
meaning RTS 23 gives it (`FIELDS`; see the README's field table). The full files
also feed a drift fingerprint (`drift.py`).
"""

from __future__ import annotations

import hashlib
import re
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter
from collections.abc import Iterable, Iterator
from datetime import date
from pathlib import Path
from typing import BinaryIO

from .drift import Fingerprint
from .fetch import Downloader, log, request
from .model import FirdsRecord, Transparency

FIRDS_INDEX = "https://registers.esma.europa.eu/solr/esma_registers_firds_files/select"
FITRS_INDEX = "https://registers.esma.europa.eu/solr/esma_registers_fitrs_files/select"
BLOCK = 8 << 20
DELTA_KINDS = {"NewRcrd": "new", "ModfdRcrd": "modified", "TermntdRcrd": "terminated", "CancRcrd": "cancelled"}
SOURCE = "esma_firds"
UNDERLYING = "DerivInstrmAttrbts/UndrlygInstrm/Sngl/ISIN"
# Every field the adapter reads (path within a record): the slot its claim is evidence for, and its one meaning.
FIELDS = {
    "FinInstrmGnlAttrbts/FullNm": ("name", "instrument_full_name"),  # RTS 23 field 2
    "FinInstrmGnlAttrbts/ClssfctnTp": ("kind", "cfi"),  # 3
    "Issr": ("issuer", "issuer_or_venue_operator_lei"),  # 5
    "TradgVnRltdAttrbts/Id": ("listing", "admitted_to_trading"),  # 6
    "FinInstrmGnlAttrbts/ShrtNm": ("name", "fisn"),  # 7
    "TradgVnRltdAttrbts/IssrReq": ("listing", "issuer_requested_admission"),  # 8
    "TradgVnRltdAttrbts/AdmssnApprvlDtByIssr": ("listing", "issuer_approval_date"),  # 9
    "TradgVnRltdAttrbts/ReqForAdmssnDt": ("listing", "admission_request_date"),  # 10
    "TradgVnRltdAttrbts/FrstTradDt": ("listing", "first_trade_date"),  # 11
    "TradgVnRltdAttrbts/TermntnDt": ("listing", "termination_date"),  # 12
    "FinInstrmGnlAttrbts/NtnlCcy": ("currency", "notional_currency"),  # 13
    UNDERLYING: ("underlying", "underlying_isin"),  # 26
    "TechAttrbts/RlvntTradgVn": ("primary", "most_liquid_eu_market"),  # RTS 22 Art. 16
}
READ_PATHS = frozenset(FIELDS) | {"FinInstrmGnlAttrbts/Id"}


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


def _day_of(value: str | None) -> str | None:
    return (value or "")[:10] or None


def placeholder_date(value: str | None) -> bool:
    """FIRDS writes `9999-12-31` where no termination date is known."""
    return bool(value and value.startswith("9999"))


def parse_record(element: ET.Element, kind: str, published: str | None = None, digest: str | None = None) -> FirdsRecord | None:
    general = element.find("FinInstrmGnlAttrbts")
    venue = element.find("TradgVnRltdAttrbts")
    isin, mic = _text(general, "Id"), _text(venue, "Id")
    if not isin or not mic:
        return None
    underlying = _text(element, UNDERLYING)
    requested = (_text(venue, "IssrReq") or "").lower()
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
        issuer_requested={"true": True, "false": False}.get(requested),
        approval_date=_day_of(_text(venue, "AdmssnApprvlDtByIssr")),
        request_date=_day_of(_text(venue, "ReqForAdmssnDt")),
        published=published,
        digest=digest,
    )


def _digest(raw: bytes) -> str:
    return hashlib.blake2b(raw, digest_size=8).hexdigest()


def full_records(stream: BinaryIO, cfi_prefixes: Iterable[str], published: str | None = None,
                 fingerprint: Fingerprint | None = None) -> Iterator[FirdsRecord]:
    for raw in scan(stream, b"RefData", _cfi_pattern(cfi_prefixes)):
        element = ET.fromstring(raw)
        record = parse_record(element, "full", published, _digest(raw))
        if fingerprint is not None:
            observe(fingerprint, element, record)
        if record:
            yield record


def delta_records(stream: BinaryIO, cfi_prefixes: Iterable[str], published: str | None = None) -> Iterator[FirdsRecord]:
    for raw in scan(stream, b"FinInstrm", _cfi_pattern(cfi_prefixes)):
        wrapper = ET.fromstring(raw)
        for child in wrapper:
            kind = DELTA_KINDS.get(child.tag)
            record = parse_record(child, kind, published, _digest(raw)) if kind else None
            if record:
                yield record


def _paths(element: ET.Element, prefix: str = "") -> Iterator[str]:
    for child in element:
        path = prefix + child.tag
        yield path
        if len(child):
            yield from _paths(child, path + "/")


_SHAPES: dict[tuple, tuple[str, ...]] = {}


def _shape(element: ET.Element) -> tuple[str, ...]:
    """The record's element paths. Records share a few shapes; tags with child counts in document order
    identify one exactly."""
    key = tuple((e.tag, len(e)) for e in element.iter())
    if key not in _SHAPES:
        _SHAPES[key] = tuple(_paths(element))
    return _SHAPES[key]


def observe(fingerprint: Fingerprint, element: ET.Element, record: FirdsRecord | None) -> None:
    """What one full-file record delivered: its element paths, categorical values and placeholders."""
    if record is None:
        fingerprint.count("records_without_isin_or_venue", _text(element, "FinInstrmGnlAttrbts/Id") or "?")
        return
    fingerprint.record(record.isin, _shape(element), {
        "cfi_category": record.cfi[:2] or None,
        "venue": record.mic,
        "notional_currency": record.currency,
        "issuer_requested": _text(element, "TradgVnRltdAttrbts/IssrReq"),  # raw, so an unknown value shows
    })
    ident = record.isin
    if placeholder_date(record.termination):
        fingerprint.count("termination_placeholder", ident)
    if (_text(element, UNDERLYING) or "").startswith("NOISIN"):
        fingerprint.count("underlying_placeholder", ident)


def claims(admissions: dict[tuple[str, str], FirdsRecord]) -> Iterator[tuple]:
    """The FIRDS adapter: typed claims only. Instrument attributes are keyed by ISIN, admission attributes by
    ISIN@segment MIC. A missing element or a placeholder is no claim."""
    seen: set[tuple] = set()  # instrument attributes repeat on every venue record: emit each value once
    for record in admissions.values():
        isin = f"isin:{record.isin}"
        venue = f"{isin}@{record.mic}"
        requested = None if record.issuer_requested is None else str(record.issuer_requested).lower()
        for path, value in (
            ("FinInstrmGnlAttrbts/FullNm", record.full_name),
            ("FinInstrmGnlAttrbts/ClssfctnTp", record.cfi or None),
            ("Issr", record.issuer_lei),
            ("FinInstrmGnlAttrbts/ShrtNm", record.short_name),
            ("FinInstrmGnlAttrbts/NtnlCcy", record.currency),
            (UNDERLYING, record.underlying_isin),
            ("TechAttrbts/RlvntTradgVn", record.relevant_mic),
        ):
            if value and (isin, path, value) not in seen:
                seen.add((isin, path, value))
                slot, meaning = FIELDS[path]
                yield isin, slot, value, SOURCE, path, meaning, record.published, record.digest
        for subject, path, value in (
            (isin, "TradgVnRltdAttrbts/Id", record.mic),
            (venue, "TradgVnRltdAttrbts/IssrReq", requested),
            (venue, "TradgVnRltdAttrbts/AdmssnApprvlDtByIssr", record.approval_date),
            (venue, "TradgVnRltdAttrbts/ReqForAdmssnDt", record.request_date),
            (venue, "TradgVnRltdAttrbts/FrstTradDt", record.first_trade),
            (venue, "TradgVnRltdAttrbts/TermntnDt", None if placeholder_date(record.termination) else record.termination),
        ):
            if value:
                slot, meaning = FIELDS[path]
                yield subject, slot, value, SOURCE, path, meaning, record.published, record.digest


# Identifiers a field should carry one value for (measured: none carries two). A count above 0 is drift.
SINGLE_VALUED = {"issuer_or_venue_operator_lei": "isins_with_two_issuer_leis",
                 "notional_currency": "isins_with_two_notional_currencies",
                 "most_liquid_eu_market": "isins_with_two_relevant_venues",
                 "underlying_isin": "receipts_with_two_underlyings"}


def measure(fingerprint: Fingerprint, db) -> None:
    """Per-identifier counts from the build's FIRDS claims (`db` is the claims connection)."""
    for meaning, name in SINGLE_VALUED.items():
        fingerprint.metrics.setdefault(name, 0)
        for (subject,) in db.execute("SELECT subject_key FROM claims WHERE source = ? AND meaning = ? GROUP BY subject_key "
                                     "HAVING count(*) > 1", (SOURCE, meaning)):
            fingerprint.count(name, subject)
    isins = "SELECT DISTINCT subject_key FROM claims WHERE source = ? AND meaning = 'admitted_to_trading'"
    fingerprint.metrics["isins"] = db.execute(f"SELECT count(*) FROM ({isins})", (SOURCE,)).fetchone()[0]
    fingerprint.metrics["isins_without_issuer_lei"] = 0
    for (subject,) in db.execute(f"{isins} EXCEPT SELECT subject_key FROM claims WHERE meaning = 'issuer_or_venue_operator_lei'", (SOURCE,)):
        fingerprint.count("isins_without_issuer_lei", subject)


def apply(admissions: dict[tuple[str, str], FirdsRecord], records: Iterable[FirdsRecord], counts: Counter) -> None:
    """Apply full and delta records in publication order, keyed by (ISIN, venue MIC)."""
    for record in records:
        key = (record.isin, record.mic)
        counts[record.kind] += 1
        if record.kind == "cancelled":
            admissions.pop(key, None)
        else:
            admissions[key] = record


def published_on(path: str) -> str | None:
    """The publication date in an ESMA file name (`FULINS_E_20260926_01of02.zip`)."""
    found = re.search(r"_(\d{4})(\d{2})(\d{2})", Path(path).name)
    return "-".join(found.groups()) if found else None


def load_admissions(paths_full: list[str], paths_delta: list[str], cfi_prefixes: tuple[str, ...],
                    fingerprint: Fingerprint | None = None) -> tuple[dict, Counter]:
    admissions: dict[tuple[str, str], FirdsRecord] = {}
    counts: Counter = Counter()
    for path in paths_full:
        for member in _members(path):
            apply(admissions, full_records(member, cfi_prefixes, published_on(path), fingerprint), counts)
    for path in paths_delta:
        for member in _members(path):
            apply(admissions, delta_records(member, cfi_prefixes, published_on(path)), counts)
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
