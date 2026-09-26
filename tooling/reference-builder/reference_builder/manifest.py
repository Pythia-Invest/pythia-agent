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
    "openfigi": "FIGI and associated metadata under the MIT licence (OMG FIGI standard, Annex D.6)",
}

def licence(source: str) -> str:
    return LICENCES.get(source.split(":")[0], "unknown")


def default_canaries(scope) -> list[dict]:
    """Must-resolve subjects per scope; a failing canary fails the build."""
    canaries = []
    if "XAMS" in scope.mics:
        canaries.append({"name": "ASML on Euronext Amsterdam", "isin": "NL0010273215", "mic": "XAMS", "require": ["ticker", "figi", "lei", "primary"] + (["cik"] if scope.sec else [])})
    if scope.sec:
        canaries.append({"name": "Apple on Nasdaq", "ticker": "AAPL", "mic": "XNAS", "require": ["figi", "cik", "primary"]})
        if "XAMS" in scope.mics:
            canaries.append({"name": "ASML Nasdaq line under the same issuer", "ticker": "ASML", "mic": "XNAS", "same_issuer_as_isin": "NL0010273215", "require": ["figi", "cik"]})
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
    for listing in snap.listings.values():
        if listing.mic and listing.operating_mic != canary["mic"] and listing.mic != canary["mic"]:
            continue
        security = snap.securities.get(listing.security_id or "")
        if "isin" in canary and security and security.isin == canary["isin"]:
            return listing
        if "ticker" in canary and listing.ticker == canary["ticker"]:
            return listing
    return None


def write_manifest(path: Path, manifest: dict) -> None:
    manifest.setdefault("environment", {"python": platform.python_version()})
    path.write_text(json.dumps(manifest, indent=2, sort_keys=False) + "\n", encoding="utf-8")
