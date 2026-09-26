"""Nasdaq Trader symbol directory: every security listed on a US exchange, with its exchange and ETF flag.

The SEC company file leaves most exchange-traded funds out, and the SEC fund file
(`company_tickers_mf.json`) carries only CIK, series, class and symbol: no fund
name and no exchange. This directory names both, so it places US ETFs on a venue
and corrects the SEC's "NYSE" label, which also covers NYSE American and NYSE Arca.
"""

from __future__ import annotations

from datetime import timedelta
from pathlib import Path

from .fetch import Downloader
from .model import UsListing

BASE_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/"
FILES = ("nasdaqlisted.txt", "otherlisted.txt")
# `otherlisted.txt` exchange codes to MICs; every `nasdaqlisted.txt` row is on Nasdaq.
EXCHANGE_MIC = {"N": "XNYS", "A": "XASE", "P": "ARCX", "Z": "BATS", "V": "IEXG", "M": "XCHI", "F": "TXSE"}


def fetch(downloader: Downloader, max_age: timedelta) -> list[bytes]:
    records = [downloader.get("nasdaqtrader_symbols", BASE_URL + name, name, max_age=max_age) for name in FILES]
    return [Path(record.path).read_bytes() for record in records]


def parse(nasdaq_listed: bytes, other_listed: bytes) -> dict[str, UsListing]:
    """Listed lines by SEC-style ticker (`BRK-B`); test issues are dropped."""
    found: dict[str, UsListing] = {}
    for data, symbol_field in ((nasdaq_listed, "Symbol"), (other_listed, "ACT Symbol")):
        lines = data.decode("utf-8", "replace").splitlines()
        header = lines[0].split("|")
        for line in lines[1:]:
            row = dict(zip(header, line.split("|")))
            if line.startswith("File Creation Time") or row.get("Test Issue") != "N":
                continue
            mic = EXCHANGE_MIC.get(row.get("Exchange", "")) if symbol_field == "ACT Symbol" else "XNAS"
            ticker = (row.get(symbol_field) or "").strip().upper().replace(".", "-")
            if mic and ticker:
                found[ticker] = UsListing(ticker, (row.get("Security Name") or "").strip(), mic, row.get("ETF") == "Y")
    return found
