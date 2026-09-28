"""Write `package.json`, which makes the output directory a reference package core can install.

The contract is docs/architecture/reference-package.md; core's `identity/reference_package.py` is its reader.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

FORMAT = "pythia-reference-package"

# What to show when citing each source family, per its published terms (ADR 0039 table).
NOTICES = {
    "iso10383_mic": "Market identifier codes from ISO 10383; individual codes only, not the full list.",
    "esma_firds": "Source: ESMA Financial Instruments Reference Data System (FIRDS), transformed by Pythia. "
                  "ESMA does not endorse this data.",
    "esma_fitrs": "Source: ESMA Financial Instruments Transparency System (FITRS), transformed by Pythia. "
                  "ESMA does not endorse this data.",
    "gleif_lei_records": "LEI records from GLEIF under CC0 1.0. GLEIF does not endorse this data.",
    "sec_company_tickers": "Source: U.S. Securities and Exchange Commission, company tickers file.",
    "sec_fund_tickers": "Source: U.S. Securities and Exchange Commission, mutual fund and ETF tickers file.",
    "openfigi": "FIGIs from OpenFIGI (public domain); associated metadata under the MIT licence "
                "(OMG FIGI standard, Annex D.6).",
}


def notice(source: str) -> str | None:
    return NOTICES.get(source.split(":")[0])


def write(out_dir: Path, manifest: dict) -> Path:
    """Write `package.json` beside the snapshot from the build manifest, atomically."""
    package = {
        "format": FORMAT,
        "format_version": int(manifest["schema_version"]),
        "build_id": manifest["build_id"],
        "built_at": manifest["finished_at"],
        "as_of": manifest["as_of"],
        "builder_version": manifest["builder_version"],
        "scope": manifest["scope"],
        "database": {key: manifest["snapshot"][key] for key in ("file", "bytes", "sha256")},
        "sources": [
            {"source": entry["source"], "url": entry.get("url"), "version": entry.get("version"),
             "as_of": (entry.get("retrieved_at") or "")[:10] or None, "retrieved_at": entry.get("retrieved_at"),
             "licence": entry.get("licence"), "notice": notice(entry["source"])}
            for entry in manifest["sources"]
        ],
        "quality": {key: manifest.get(key) for key in ("tables", "canaries", "audit", "truth_audit")},
    }
    path = out_dir / "package.json"
    staging = path.with_name(".package.json.part")
    staging.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")
    os.replace(staging, path)
    return path
