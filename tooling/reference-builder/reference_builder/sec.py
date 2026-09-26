"""SEC `company_tickers_exchange.json`: ticker, CIK, company title and exchange."""

from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path

from .config import sec_user_agent
from .fetch import Downloader
from .model import SecTicker

SEC_URL = "https://www.sec.gov/files/company_tickers_exchange.json"

# SEC exchange labels to operating MICs. "NYSE" also covers NYSE American and
# NYSE Arca listings in this file, so XNYS is recorded with that caveat. "CBOE"
# does not name the Cboe exchange, so it maps to Cboe's operating MIC, not a segment.
EXCHANGE_MIC = {"Nasdaq": "XNAS", "NYSE": "XNYS", "CBOE": "XCBO", "OTC": "OTCM"}
# Operating MICs of US exchanges (a listing there, unlike OTC, can be a primary line).
LISTED_MICS = frozenset({"XNAS", "XNYS", "XCBO", "IEXG", "TXSE"})


def fetch(downloader: Downloader, contact: str | None, local: Path | None, max_age: timedelta) -> bytes:
    if local is not None:
        record = downloader.register_local("sec_company_tickers", local)
    else:
        agent = sec_user_agent(contact)
        if agent is None:
            raise SystemExit(
                "SEC requires a name and email in the User-Agent: set `sec_identity` in "
                "<config>/pythia/settings.json (the SEC plugin's contact), pass --sec-file with a "
                "downloaded company_tickers_exchange.json, or build with --no-sec."
            )
        record = downloader.get("sec_company_tickers", SEC_URL, "company_tickers_exchange.json", max_age=max_age, user_agent=agent)
    return Path(record.path).read_bytes()


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
