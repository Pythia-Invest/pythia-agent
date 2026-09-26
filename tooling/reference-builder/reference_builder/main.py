"""Command line entry: download, parse, assemble, gate and write one snapshot."""

from __future__ import annotations

import argparse
import sys
import time
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from . import firds, manifest, mic, schema, sec, writer
from .assemble import Inputs
from .config import BUILDER_VERSION, USER_AGENT, BuildConfig, Scope, load_openfigi_key, load_sec_identity, parse_mics
from .fetch import Downloader, log, utc_now
from .gleif import GleifClient
from .openfigi import MAPPING_URL, OpenFigi
from .pipeline import build_snapshot


def parse_args(argv: list[str]) -> BuildConfig:
    parser = argparse.ArgumentParser(prog="reference-builder", description="Build the open reference snapshot.")
    parser.add_argument("--mics", default="XAMS", help="comma-separated operating MICs (default XAMS)")
    parser.add_argument("--no-sec", action="store_true", help="skip SEC ticker lines")
    parser.add_argument("--as-of", type=date.fromisoformat, default=datetime.now(timezone.utc).date())
    parser.add_argument("--out", type=Path, help="output directory")
    parser.add_argument("--cache", type=Path, help="download cache directory")
    parser.add_argument("--deltas", action="store_true", help="also apply FIRDS daily deltas (DLTINS) since the weekly file")
    parser.add_argument("--no-fitrs", action="store_true", help="skip the FITRS activity and turnover check")
    parser.add_argument("--sec-file", type=Path, help="use a downloaded company_tickers_exchange.json")
    parser.add_argument("--no-gates", action="store_true", help="write the snapshot even if a canary fails")
    args = parser.parse_args(argv)
    defaults = BuildConfig(scope=Scope(), as_of=args.as_of)
    return BuildConfig(
        scope=Scope(mics=parse_mics(args.mics), sec=not args.no_sec),
        as_of=args.as_of,
        out_dir=args.out or defaults.out_dir,
        cache_dir=args.cache or defaults.cache_dir,
        deltas=args.deltas,
        fitrs=not args.no_fitrs,
        gates=not args.no_gates,
        contact=load_sec_identity() if not args.no_sec and not args.sec_file else None,
        sec_file=args.sec_file,
    )


def run(config: BuildConfig) -> int:
    started, clock = utc_now(), time.monotonic()
    downloads = Downloader(config.cache_dir, USER_AGENT)
    day = timedelta(days=config.listing_file_max_age_days)
    venues = mic.parse(mic.fetch(downloads, day))

    full_docs, delta_docs = firds.firds_files(USER_AGENT, config.as_of, config.deltas)
    full = [firds.download(downloads, "esma_firds", d) for d in full_docs]
    deltas = [firds.download(downloads, "esma_firds", d) for d in delta_docs]
    admissions, record_counts = firds.load_admissions(full, deltas, config.scope.cfi_prefixes)
    transparency = None
    if config.fitrs:
        transparency = firds.load_transparency([firds.download(downloads, "esma_fitrs", d) for d in firds.fitrs_files(USER_AGENT, config.as_of)], config.as_of)

    sec_rows = sec.parse(sec.fetch(downloads, config.contact, config.sec_file, day)) if config.scope.sec else []
    figi = OpenFigi(config.cache_dir, USER_AGENT, load_openfigi_key(), timedelta(days=config.openfigi_max_age_days))
    log(f"OpenFIGI: {'keyed' if figi.keyed else 'keyless (slower rate limits)'}")
    gleif = GleifClient(config.cache_dir, USER_AGENT, timedelta(days=config.gleif_max_age_days))

    inputs = Inputs(config.as_of, config.scope, venues, admissions, transparency, sec_rows, figi.mic_codes())
    snap = build_snapshot(inputs, gleif.fetch, figi.map)
    snap.audit["firds_records"] = dict(sorted(record_counts.items()))
    snap.audit["fitrs_isins"] = len(transparency) if transparency is not None else None

    canaries = manifest.check_canaries(snap, manifest.default_canaries(config.scope))
    for result in canaries:
        log(f"canary {'ok' if result['ok'] else 'FAILED'}: {result['name']} {result['missing'] or ''}")
    failed = [c for c in canaries if not c["ok"]]
    if failed and config.gates:
        log("canary gate failed; no snapshot written (use --no-gates to inspect)")
        return 2

    sources = [r.manifest() | {"licence": manifest.licence(r.source)} for r in downloads.retrieved]
    if gleif.provenance():
        sources.append(gleif.provenance().manifest() | {"licence": manifest.licence("gleif_lei_records")})
    figi_meta = figi.provenance()
    sources.append({"source": "openfigi", "url": MAPPING_URL, "version": "v3", "retrieved_at": figi_meta["answers_to"] or started,
                    "sha256": None, "bytes": None, "licence": manifest.licence("openfigi")})
    sources = _unique_sources(sources)

    stamp = config.as_of.strftime("%Y%m%d")
    build_id = f"reference-{stamp}"
    meta = {"build_id": build_id, "schema_version": str(schema.SCHEMA_VERSION), "builder_version": BUILDER_VERSION,
            "as_of": config.as_of.isoformat(), "created_at": started, "scope": ",".join(config.scope.mics) + (",SEC" if config.scope.sec else "")}
    snapshot_path = config.out_dir / f"{build_id}.sqlite3"
    counts = writer.write(snap, snapshot_path, meta, sources)
    manifest.write_manifest(config.out_dir / "manifest.json", {
        "build_id": build_id,
        "schema_version": schema.SCHEMA_VERSION,
        "builder_version": BUILDER_VERSION,
        "as_of": config.as_of.isoformat(),
        "started_at": started,
        "finished_at": utc_now(),
        "wall_seconds": round(time.monotonic() - clock, 1),
        "scope": config.scope.describe() | {"firds_deltas": config.deltas, "fitrs": config.fitrs},
        "snapshot": writer.describe(snapshot_path),
        "tables": counts,
        "sources": sources,
        "openfigi": figi_meta,
        "gleif_api_calls": gleif.calls,
        "audit": snap.audit,
        "canaries": canaries,
    })
    log(f"wrote {snapshot_path} ({counts.get('listings', 0)} listings) in {time.monotonic() - clock:.0f}s")
    return 1 if failed else 0


def _unique_sources(sources: list[dict]) -> list[dict]:
    """A source with several files (FIRDS parts) is keyed per file version."""
    totals = Counter(s["source"] for s in sources)
    return [s | {"source": f"{s['source']}:{s.get('version') or i}"} if totals[s["source"]] > 1 else s for i, s in enumerate(sources)]


def main(argv: list[str] | None = None) -> int:
    return run(parse_args(sys.argv[1:] if argv is None else argv))
