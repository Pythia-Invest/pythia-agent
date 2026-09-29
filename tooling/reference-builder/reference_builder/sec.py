"""SEC ticker files: `company_tickers_exchange.json` (ticker, CIK, company title, exchange)
and `company_tickers_mf.json` (fund CIK, series, class and ticker: no name, no exchange).

SEC documents neither file beyond "ticker/CIK/Company name associations … we periodically
update the file but do not guarantee accuracy or scope" (webmaster FAQ). The meaning of each
field read is in docs/sources/sec.md; `observe` fingerprints each file before it is parsed.
"""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import timedelta
from pathlib import Path

from .config import sec_user_agent
from .fetch import Downloader, offline
from .model import SecFund, SecTicker
from .source_drift import Fingerprint

SEC_URL = "https://www.sec.gov/files/company_tickers_exchange.json"
FUNDS_URL = "https://www.sec.gov/files/company_tickers_mf.json"

# SEC exchange labels to operating MICs. "NYSE" also covers NYSE American and
# NYSE Arca listings in this file, so XNYS is recorded with that caveat. "CBOE"
# does not name the Cboe exchange, so it maps to Cboe's operating MIC, not a segment.
EXCHANGE_MIC = {"Nasdaq": "XNAS", "NYSE": "XNYS", "CBOE": "XCBO", "OTC": "OTCM"}
# Operating MICs of US exchanges (a listing there, unlike OTC, can be a primary line).
LISTED_MICS = frozenset({"XNAS", "XNYS", "XCBO"})

TICKERS, FUNDS = "sec_tickers", "sec_funds"  # fingerprint sources, one record each beside the snapshot
# The columns each file's parse reads: one that stops arriving breaks that file's stage.
READ = {TICKERS: ("cik", "name", "ticker", "exchange"), FUNDS: ("symbol",)}
# SEC's own spelling: capitals and digits, `-` before a class or series suffix (BRK-B, WPAC-UN).
TICKER_SHAPE = re.compile(r"[A-Z0-9]{1,10}(-[A-Z0-9]{1,4})?")


def fetch(downloader: Downloader, contact: str | None, local: Path | None, max_age: timedelta) -> bytes:
    if local is not None:
        record = downloader.register_local("sec_company_tickers", local)
    else:
        record = downloader.get("sec_company_tickers", SEC_URL, "company_tickers_exchange.json", max_age=max_age, user_agent=_agent(contact))
    return Path(record.path).read_bytes()


def fetch_funds(downloader: Downloader, contact: str | None, max_age: timedelta) -> bytes:
    record = downloader.get("sec_fund_tickers", FUNDS_URL, "company_tickers_mf.json", max_age=max_age, user_agent=_agent(contact))
    return Path(record.path).read_bytes()


def _agent(contact: str | None) -> str | None:
    agent = sec_user_agent(contact)
    if agent is None and not offline():  # an offline build sends nothing
        raise SystemExit(
            "SEC requires a name and email in the User-Agent: set `sec_identity` in "
            "<config>/pythia/settings.json (the SEC plugin's contact), pass --sec-file with a "
            "downloaded company_tickers_exchange.json, or build with --no-sec."
        )
    return agent


def observe(source: str, data: bytes) -> Fingerprint:
    """The drift fingerprint of one ticker file, taken before it is parsed.

    Each row is a record carrying its non-empty columns. The exchange label is the vocabulary. The
    counts are what the parse would otherwise absorb silently: a ticker on two rows (the parse keeps
    the first), a CIK under two titles, a malformed CIK or ticker, a row of another width, a missing
    exchange. A file that is not the documented `{"fields", "data"}` shape has no records, which
    breaks the stage.
    """
    fingerprint = Fingerprint(source)
    try:
        payload = json.loads(data)
    except ValueError:
        payload = None
    if not isinstance(payload, dict) or not isinstance(payload.get("fields"), list) or not isinstance(payload.get("data"), list):
        fingerprint.count("unexpected_shape")
        return fingerprint
    fields = [str(name) for name in payload["fields"]]
    key = "ticker" if source == TICKERS else "symbol"
    named = ["malformed_row", "malformed_cik", f"{key}_missing", f"malformed_{key}", f"{key}_on_several_rows"]
    if source == TICKERS:
        named += ["exchange_missing", "class_suffix_ticker", "cik_several_titles"]
    for name in named:  # reported even at zero, so a first occurrence is a change against the last build
        fingerprint.count(name, by=0)
    rows_per_ticker: Counter = Counter()
    names: dict[str, set[str]] = defaultdict(set)
    tickers_per_cik: Counter = Counter()
    for values in payload["data"]:
        if not isinstance(values, list) or len(values) != len(fields):
            fingerprint.count("malformed_row")
            continue
        row = dict(zip(fields, values))
        cik, ticker = row.get("cik"), row.get(key)
        ident = f"{key}:{ticker}" if ticker else f"cik:{cik}"
        fingerprint.record(ident, [name for name, value in row.items() if value not in (None, "")],
                           {"exchange": row.get("exchange")} if source == TICKERS else {})
        if type(cik) is not int or cik <= 0:
            fingerprint.count("malformed_cik", ident)
        if not ticker:
            fingerprint.count(f"{key}_missing", f"cik:{cik}")
            continue
        if not isinstance(ticker, str) or not TICKER_SHAPE.fullmatch(ticker):
            fingerprint.count(f"malformed_{key}", ident)
        ticker = str(ticker)
        rows_per_ticker[ticker] += 1
        tickers_per_cik[str(cik)] += 1
        if source == TICKERS:
            names[str(cik)].add(str(row.get("name")))
            if not row.get("exchange"):
                fingerprint.count("exchange_missing", ident)
            if "-" in ticker:
                fingerprint.count("class_suffix_ticker")
    for ticker, rows in rows_per_ticker.items():
        if rows > 1:
            fingerprint.count(f"{key}_on_several_rows", f"{key}:{ticker}")
    for cik, found in names.items():
        if len(found) > 1:
            fingerprint.count("cik_several_titles", f"cik:{cik}")
    if source == TICKERS:  # a fund trust always has many classes, so only the company file's count means anything
        fingerprint.count("ciks_with_several_tickers", by=sum(1 for rows in tickers_per_cik.values() if rows > 1))
    return fingerprint


def parse(data: bytes) -> list[SecTicker]:
    payload = json.loads(data)
    fields = payload["fields"]
    index = {name: fields.index(name) for name in ("cik", "name", "ticker", "exchange")}
    rows: list[SecTicker] = []
    seen: set[str] = set()
    for position, values in enumerate(payload["data"]):
        ticker = str(values[index["ticker"]] or "").strip().upper()
        if not ticker or ticker in seen:
            continue
        seen.add(ticker)
        exchange = values[index["exchange"]]
        rows.append(
            SecTicker(
                cik=str(int(values[index["cik"]])),
                name=str(values[index["name"]] or "").strip(),
                ticker=ticker,
                exchange=str(exchange).strip() if exchange else None,
                position=position,
            )
        )
    return rows


def parse_funds(data: bytes) -> list[SecFund]:
    payload = json.loads(data)
    symbol = payload["fields"].index("symbol")
    tickers = dict.fromkeys(str(values[symbol] or "").strip().upper() for values in payload["data"])
    return [SecFund(ticker) for ticker in tickers if ticker]
