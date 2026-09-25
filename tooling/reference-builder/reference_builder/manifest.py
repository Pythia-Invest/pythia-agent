"""Build manifest, per-source attribution NOTICE, and canary gates."""

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

NOTICE_HEAD = """Pythia reference snapshot {build}
This file lists the sources of the reference snapshot and the attribution each requires.
The snapshot is provided as is, without warranty. It is not investment advice.
"""

NOTICE_TEXT = {
    "esma": """ESMA FIRDS and FITRS
  Source: European Securities and Markets Authority (ESMA), Financial Instruments Reference
  Data System (FIRDS) and Financial Instruments Transparency System (FITRS),
  https://registers.esma.europa.eu. The original material is available free of charge
  through the ESMA website.
  This document has been drafted using material downloaded from ESMA's website. ESMA does
  not endorse this publication and in no way is liable for copyright or other intellectual
  property rights infringements nor for any damages caused to third parties through this
  publication.
""",
    "gleif": """GLEIF Legal Entity Identifier data
  Source: Global Legal Entity Identifier Foundation (GLEIF), https://www.gleif.org, made
  available under CC0 1.0. GLEIF does not endorse this dataset or its publisher.
""",
    "sec": """SEC company tickers
  Source: U.S. Securities and Exchange Commission, EDGAR company_tickers_exchange.json,
  https://www.sec.gov. The SEC does not endorse this dataset.
""",
    "openfigi": """OpenFIGI
  Financial Instrument Global Identifiers (FIGI) and associated metadata obtained through
  the OpenFIGI API (https://www.openfigi.com). "FIGI" and "OpenFIGI" are used for
  reference only and imply no endorsement.

  Copyright (c) 2013-2026 Bloomberg LP
  Copyright (c) 2015-2026 Object Management Group

  Permission is hereby granted, free of charge, to any person obtaining a copy of this
  software and associated documentation files (the 'Software'), to deal in the Software
  without restriction, including without limitation the rights to use, copy, modify, merge,
  publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
  to whom the Software is furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all copies or
  substantial portions of the Software.

  THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
  INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
  PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
  FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
  OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
  DEALINGS IN THE SOFTWARE.
""",
    "iso": """ISO 10383 market identifier codes
  Individual MIC codes and names from the ISO 10383 registry (https://www.iso20022.org).
  Only the codes referenced by this snapshot are included; the full list is not.
""",
}


def licence(source: str) -> str:
    return LICENCES.get(source.split(":")[0], "see NOTICE")


def notice(build: str, sources: list[dict]) -> str:
    names = {s["source"].split(":")[0] for s in sources}
    sections = [
        ("esma", {"esma_firds", "esma_fitrs"}), ("gleif", {"gleif_lei_records"}), ("sec", {"sec_company_tickers"}),
        ("openfigi", {"openfigi"}), ("iso", {"iso10383_mic"}),
    ]
    body = [NOTICE_TEXT[key] for key, members in sections if names & members]
    return NOTICE_HEAD.format(build=build) + "\n" + "\n".join(body)


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
