"""SEC content drift probe (`just reference-sec-probe`): the submissions and companyfacts fingerprint of a fixed sample.

The SEC plugin reads `submissions` and `companyfacts` live, so there is no build to fingerprint. This maintainer
probe reads them for the frozen audit sample (`samples/sec-2026-09-28.json`) and fingerprints three kinds of
record with `source_drift`, beside the reference builds:

- `sec_filers`: one record per submissions document, with its top-level keys;
- `sec_filings`: one record per row of `filings.recent`, with its columns, form groups (periodic, current, ownership,
  other known, unknown) and the counts the plugin's filings read would otherwise log one read at a time;
- `sec_facts`: one record per companyfacts fact row, with its keys, the taxonomy, form and `fp` vocabularies, and
  the filers whose companyfacts lacks their latest report with XBRL (the plugin's own `freshness` check).

Each is compared with the newest older good probe. A break (no records, or a key the plugin reads gone) is exit
status 2, another alarm 1, none 0. Field meanings are in docs/sources/sec.md.

Network: two data.sec.gov requests per sample filer, paced below SEC's ten per second, with the User-Agent built
from the configured `sec_identity` (never printed). Responses are cached under `.local/` and never committed.
"""

from __future__ import annotations

import argparse
import importlib
import importlib.util
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import claims, source_drift
from .config import WORK_DIR, load_sec_identity, sec_user_agent
from .fetch import Downloader, HttpError, log

SAMPLE = Path(__file__).resolve().parents[1] / "samples" / "sec-2026-09-28.json"
PLUGIN = Path(__file__).resolve().parents[3] / "runtime" / "managed" / "plugins" / "sec"
PACE = 0.15  # seconds between requests: under seven a second, within SEC's ten
FILERS, FILINGS, FACTS = "sec_filers", "sec_filings", "sec_facts"
# What the plugin reads (filings.REQUIRED and OPTIONAL, `reportDate`, `isXBRL`; the fact row keys): gone is a break.
READ = {
    FILERS: ("cik", "name", "tickers", "exchanges", "formerNames", "stateOfIncorporation", "filings"),
    FILINGS: ("accessionNumber", "form", "filingDate", "primaryDocument", "acceptanceDateTime", "items",
              "primaryDocDescription", "isInlineXBRL", "size", "reportDate", "isXBRL"),
    FACTS: ("accn", "end", "filed", "form", "val", "fy", "fp", "frame"),
}


def plugin(name: str):
    """One module of the SEC plugin, loaded from the checkout without running its Hermes entry point."""
    package = "pythia_sec_plugin"
    if package not in sys.modules:
        spec = importlib.util.spec_from_file_location(package, PLUGIN / "__init__.py", submodule_search_locations=[str(PLUGIN)])
        sys.modules[package] = importlib.util.module_from_spec(spec)
    return importlib.import_module(f"{package}.{name}")


def observe(documents: list[tuple[dict, dict | None]], observed_at: str) -> dict[str, source_drift.Fingerprint]:
    """Fingerprints of `(submissions, companyfacts)` pairs; companyfacts is None where SEC has none (404)."""
    filings, financials = plugin("filings"), plugin("financials")
    known = set(filings.FILING_TITLES) | set(filings.OWNERSHIP_FORMS) | set(filings.UNTITLED_FORMS)
    prints = {source: source_drift.Fingerprint(source) for source in (FILERS, FILINGS, FACTS)}
    filers, rows, facts = prints[FILERS], prints[FILINGS], prints[FACTS]
    for name in ("columns_unequal", "unknown_form", "unknown_8k_item", "malformed_acceptance", "periodic_without_report_date"):
        rows.count(name, by=0)
    for name in ("lei_present", "tickers_exchanges_unequal"):
        filers.count(name, by=0)
    for name in ("companyfacts_missing", "latest_report_missing", "fp_missing", "unreadable"):
        facts.count(name, by=0)
    for submissions, companyfacts in documents:
        cik = str(submissions.get("cik", "?")).lstrip("0")
        filers.record(f"cik:{cik}", [key for key, value in submissions.items() if value not in (None, "", [], {})],
                      {"entityType": submissions.get("entityType")})
        if submissions.get("lei"):
            filers.count("lei_present", f"cik:{cik}")
        if len(submissions.get("tickers") or []) != len(submissions.get("exchanges") or []):
            filers.count("tickers_exchanges_unequal", f"cik:{cik}")
        recent = (submissions.get("filings") or {}).get("recent") or {}
        width = {len(column) for column in recent.values() if isinstance(column, list)}
        if len(width) > 1:  # a broken shape: the plugin refuses the whole read, so no row is fingerprinted
            rows.count("columns_unequal", f"cik:{cik}")
            width = set()
        for index in range(max(width, default=0)):
            row = {key: column[index] for key, column in recent.items() if isinstance(column, list)}
            accession, form = row.get("accessionNumber"), row.get("form") or ""
            base = filings.base_form(form)
            # Form groups, not the 170-odd native forms: a filer's first S-8 is no drift, a rename is (`unknown_form`).
            kind = ("periodic" if base in financials.PERIODIC_FORMS else "current" if base == "8-K"
                    else "ownership" if filings.ownership(form) else "known" if base in known else "unknown")
            rows.record(f"{accession}", [key for key, value in row.items() if value not in (None, "")], {"form_group": kind})
            if base not in known:
                rows.count("unknown_form", f"{accession} {form}")
            if form in financials.PERIODIC_FORMS and form != "6-K" and not row.get("reportDate"):
                rows.count("periodic_without_report_date", accession)
            if row.get("acceptanceDateTime") and not financials.ACCEPTED.fullmatch(row["acceptanceDateTime"]):
                rows.count("malformed_acceptance", accession)
            if filings.base_form(form) == "8-K" and row.get("items"):
                items = [item.strip() for item in str(row["items"]).split(",") if item.strip()]
                for item in filings.unknown_8k_items(items, str(row.get("filingDate") or "")):
                    rows.count("unknown_8k_item", f"{accession} {item}")
        if companyfacts is None:
            facts.count("companyfacts_missing", f"cik:{cik}")
            continue
        for taxonomy, concepts in (companyfacts.get("facts") or {}).items():
            for concept, item in (concepts or {}).items():
                for unit, values in ((item or {}).get("units") or {}).items():
                    for value in values:
                        if not isinstance(value, dict):
                            facts.count("unreadable", f"cik:{cik}")
                            continue
                        facts.record(f"cik:{cik} {taxonomy}:{concept}", sorted(value), {"taxonomy": taxonomy,
                                     "form": value.get("form"), "fp": value.get("fp")})
                        if value.get("fp") is None:
                            facts.count("fp_missing")
        try:
            state = financials.freshness(submissions, companyfacts, cik, observed_at)
        except ValueError:
            facts.count("unreadable", f"cik:{cik}")
            continue
        if state and state["status"] == "stale":
            filing = state["latest_filing"]
            label = f"cik:{cik} {filing['form']} {filing['accession']} filed {filing['filed_at']}"
            facts.count("latest_report_missing", label)
            facts.cache.setdefault("stale", []).append(label)
    return prints


def fetch(downloader: Downloader, url: str, name: str, max_age: timedelta, agent: str) -> dict | None:
    time.sleep(PACE)
    try:
        record = downloader.get("sec_probe", url, name, max_age=max_age, user_agent=agent)
    except HttpError as error:
        if error.status == 404:
            return None
        raise
    return json.loads(Path(record.path).read_bytes())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    parser.add_argument("--sample", type=Path, default=SAMPLE)
    parser.add_argument("--out", type=Path, default=WORK_DIR / "out", help="where the probe records are kept")
    parser.add_argument("--cache", type=Path, default=WORK_DIR / "sec-probe")
    parser.add_argument("--max-age-hours", type=float, default=20, help="reuse cached responses younger than this")
    args = parser.parse_args(argv)
    agent = sec_user_agent(load_sec_identity())
    if agent is None:
        print("SEC requires a name and email in the User-Agent: set `sec_identity` in <config>/pythia/settings.json.")
        return 2
    sample = json.loads(args.sample.read_text(encoding="utf-8"))
    ciks = [entry["cik"] for entries in sample["strata"].values() for entry in entries]
    downloader, max_age = Downloader(args.cache, agent), timedelta(hours=args.max_age_hours)
    observed_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    documents = []
    try:
        for cik in ciks:
            number = f"{int(cik):010d}"
            submissions = fetch(downloader, f"https://data.sec.gov/submissions/CIK{number}.json", f"submissions-{number}.json", max_age, agent)
            companyfacts = fetch(downloader, f"https://data.sec.gov/api/xbrl/companyfacts/CIK{number}.json", f"companyfacts-{number}.json", max_age, agent)
            if submissions is not None:
                documents.append((submissions, companyfacts))
    except (HttpError, ValueError) as error:
        print(f"SEC could not be read: {str(error).split(' for ')[0]}")
        return 2
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    args.out.mkdir(parents=True, exist_ok=True)
    status = 0
    prints = observe(documents, observed_at)
    for source, fingerprint in prints.items():
        found = fingerprint.to_dict()
        path = claims.record_path(args.out, source, stamp)
        report = claims.drift(path, found, READ[source])
        claims.write(path, {"good": not report["broken"], "fingerprint": found, "report": report})
        for line in source_drift.format_alarms(report["alarms"], report["baseline"]):
            print(f"{source}{line}")
        print(f"{source}: {found['records']} records; " + ", ".join(f"{k} {v}" for k, v in found["metrics"].items()))
        for label in fingerprint.cache.get("stale", []):
            print(f"  companyfacts lacks the latest report with XBRL: {label}")
        status = max(status, 2 if report["broken"] else 1 if report["alarms"] else 0)
    log(f"probed {len(documents)} of {len(ciks)} filers")
    return status


if __name__ == "__main__":
    sys.exit(main())
