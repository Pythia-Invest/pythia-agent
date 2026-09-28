"""SEC Form N-CEN data sets: the exchange each US exchange-traded fund lists on.

The SEC fund file names no exchange, and OpenFIGI shows an ETF's lines on every US
exchange alike. Item E.1 of Form N-CEN (`SECURITY_EXCHANGE`) names the exchange a
fund's shares are listed on, with the ticker; `FUND_REPORTED_INFO` gives the fund's
name, series ID, LEI and ETF flag. N-CEN is filed once a year per registrant and the
SEC publishes the filings quarterly, so the latest five quarters cover every filer;
an ETF launched since its registrant last filed is missing until the next filing.
Public domain (SEC); fetched with the SEC contact like the ticker files.
"""

from __future__ import annotations

import csv
import io
import re
import zipfile
from dataclasses import dataclass
from datetime import timedelta

from .fetch import Downloader

INDEX_URL = "https://www.sec.gov/data-research/sec-markets-data/form-n-cen-data-sets"
QUARTERS = 5
# N-CEN's exchange codes (MIC-like, some retired) to (segment MIC, operating MIC).
EXCHANGE = {
    "ARCX": ("ARCX", "XNYS"), "XNYS": ("XNYS", "XNYS"), "XASE": ("XASE", "XNYS"),
    "XNAS": ("XNAS", "XNAS"), "XNMS": ("XNAS", "XNAS"), "NASD": ("XNAS", "XNAS"),
    "BATS": ("BATS", "XCBO"), "CBSX": ("BATS", "XCBO"), "BCXE": ("BATS", "XCBO"), "BATO": ("BATS", "XCBO"),
    "XCBO": ("BATS", "XCBO"),
}


@dataclass(frozen=True)
class NcenListing:
    ticker: str
    mic: str            # segment MIC (ARCX for NYSE Arca)
    operating_mic: str  # XNYS
    name: str
    series_id: str | None
    lei: str | None
    quarter: str        # the data set the line comes from


def fetch(downloader: Downloader, user_agent: str, max_age: timedelta) -> list[tuple[str, str]]:
    """The latest data sets as (quarter, local zip path); the index page is refreshed like the ticker files."""
    page = downloader.get("sec_ncen_index", INDEX_URL, "ncen-data-sets.html", max_age=max_age, user_agent=user_agent)
    with open(page.path, encoding="utf-8", errors="replace") as handle:
        links = sorted(set(re.findall(r'href="(/files/dera/data/form-n-cen-data-sets/(\d{4}q\d)_ncen[^"]*\.zip)"', handle.read())),
                       key=lambda link: link[1])
    latest = links[-QUARTERS:]
    return [(quarter, downloader.get("sec_ncen", f"https://www.sec.gov{path}", path.rsplit("/", 1)[1],
                                     version=quarter, user_agent=user_agent).path) for path, quarter in latest]


def parse(files: list[tuple[str, str]]) -> dict[str, NcenListing]:
    """Exchange-listed fund lines by ticker, the latest filing winning."""
    found: dict[str, NcenListing] = {}
    for quarter, path in sorted(files):
        with zipfile.ZipFile(path) as archive:
            funds = {row["FUND_ID"]: row for row in _rows(archive, "FUND_REPORTED_INFO.tsv")}
            for row in _rows(archive, "SECURITY_EXCHANGE.tsv"):
                ticker, venue = (row.get("FUND_TICKER_SYMBOL") or "").strip().upper(), EXCHANGE.get((row.get("FUND_EXCHANGE") or "").strip())
                fund = funds.get(row["FUND_ID"], {})
                if ticker and venue and fund.get("IS_ETF", "Y") != "N":
                    found[ticker] = NcenListing(ticker, venue[0], venue[1], (fund.get("FUND_NAME") or "").strip(),
                                                fund.get("SERIES_ID") or None, fund.get("LEI") or None, quarter)
    return found


def _rows(archive: zipfile.ZipFile, name: str) -> list[dict]:
    if name not in archive.namelist():
        return []
    with archive.open(name) as raw:
        return list(csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8", errors="replace"), delimiter="\t"))
