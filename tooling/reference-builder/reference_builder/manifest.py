"""Build manifest, per-source licence labels, and canary gates."""

from __future__ import annotations

import json
import platform
from pathlib import Path

from .model import Snapshot

LICENCES = {
    "iso10383_mic": "ISO 10383 terms: individual codes only; the full list is not redistributed",
    "esma_firds": "ESMA legal notice: reuse with acknowledgement",
    "esma_fitrs": "ESMA legal notice: reuse with acknowledgement",
    "gleif_lei_records": "CC0 1.0",
    "sec_company_tickers": "US federal government work (public domain)",
    "nasdaqtrader_symbols": "Nasdaq Trader symbol directory, Nasdaq terms of use: read on the device, not redistributed",
    "openfigi": "FIGI and associated metadata under the MIT licence (OMG FIGI standard, Annex D.6)",
}

def licence(source: str) -> str:
    return LICENCES.get(source.split(":")[0], "unknown")


# EU home lines that must resolve when the build covers their venue: (name, ISIN, operating MIC).
EU_CANARIES = (
    ("ASML on Euronext Amsterdam", "NL0010273215", "XAMS"),
    ("SAP on Xetra", "DE0007164600", "XETR"),
    ("LVMH on Euronext Paris", "FR0000121014", "XPAR"),
    ("Nokia on Nasdaq Helsinki", "FI0009000681", "XHEL"),
)


def default_canaries(scope) -> list[dict]:
    """Must-resolve subjects per scope; a failing canary fails the build."""
    canaries = [
        {"name": name, "isin": isin, "mic": mic, "require": ["ticker", "figi", "lei", "primary"]}
        for name, isin, mic in EU_CANARIES if scope.covers(mic)
    ]
    if scope.sec:
        if scope.covers("XAMS"):
            canaries[0]["require"].append("cik")
            canaries.append({"name": "ASML Nasdaq line under the same issuer", "ticker": "ASML", "mic": "XNAS", "same_issuer_as_isin": "NL0010273215", "require": ["figi", "cik"]})
        canaries.append({"name": "Apple on Nasdaq", "ticker": "AAPL", "mic": "XNAS", "require": ["figi", "cik", "primary"]})
        canaries.append({"name": "Direxion Daily TSLA Bull 2X ETF", "ticker": "TSLL", "mic": "XNAS", "require": ["figi", "primary"]})
    return canaries


def check_canaries(snap: Snapshot, canaries: list[dict]) -> list[dict]:
    results = []
    for canary in canaries:
        listing = _find(snap, canary)
        issuer = snap.issuers.get(listing.issuer_id or "") if listing else None
        facts = {
            "ticker": bool(listing and listing.ticker),
            "figi": bool(listing and listing.figi),
            "lei": bool(issuer and issuer.lei),
            "cik": bool(issuer and issuer.cik),
            "primary": bool(listing and listing.is_primary),
        }
        missing = [need for need in canary["require"] if not facts[need]]
        if listing and canary.get("same_issuer_as_isin"):
            anchor = snap.securities.get(f"isin:{canary['same_issuer_as_isin']}")
            if not anchor or anchor.issuer_id != listing.issuer_id:
                missing.append("same_issuer")
        results.append({"name": canary["name"], "found": listing is not None, "missing": missing, "ok": listing is not None and not missing})
    return results


def _find(snap: Snapshot, canary: dict):
    """The canary's line on its venue, the primary one first when there are several."""
    found = []
    for listing in snap.listings.values():
        if listing.mic and listing.operating_mic != canary["mic"] and listing.mic != canary["mic"]:
            continue
        security = snap.securities.get(listing.security_id or "")
        if ("isin" in canary and security and security.isin == canary["isin"]) or ("ticker" in canary and listing.ticker == canary["ticker"]):
            found.append(listing)
    return min(found, key=lambda l: (not l.is_primary, l.listing_id), default=None)


def write_manifest(path: Path, manifest: dict) -> None:
    manifest.setdefault("environment", {"python": platform.python_version()})
    path.write_text(json.dumps(manifest, indent=2, sort_keys=False) + "\n", encoding="utf-8")
