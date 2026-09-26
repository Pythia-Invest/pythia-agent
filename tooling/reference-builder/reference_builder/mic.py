"""ISO 10383 market identifier codes.

The full list may not be republished (ISO terms); the snapshot keeps only the
MICs that its listings reference, see `assemble.used_venues`.
"""

from __future__ import annotations

import csv
import io
from datetime import timedelta

from .fetch import Downloader
from .model import Venue

MIC_URL = "https://www.iso20022.org/sites/default/files/ISO10383_MIC/ISO10383_MIC.csv"


def fetch(downloader: Downloader, max_age: timedelta) -> bytes:
    record = downloader.get("iso10383_mic", MIC_URL, "ISO10383_MIC.csv", max_age=max_age)
    with open(record.path, "rb") as handle:
        return handle.read()


def parse(data: bytes) -> dict[str, Venue]:
    venues: dict[str, Venue] = {}
    for row in csv.DictReader(io.StringIO(data.decode("utf-8-sig"))):
        mic = (row.get("MIC") or "").strip()
        if not mic:
            continue
        venues[mic] = Venue(
            mic=mic,
            operating_mic=(row.get("OPERATING MIC") or mic).strip(),
            level=(row.get("OPRT/SGMT") or "").strip(),
            name=(row.get("MARKET NAME-INSTITUTION DESCRIPTION") or "").strip(),
            country=(row.get("ISO COUNTRY CODE (ISO 3166)") or "").strip(),
            category=(row.get("MARKET CATEGORY CODE") or "").strip() or None,
            status=(row.get("STATUS") or "").strip(),
        )
    return venues
