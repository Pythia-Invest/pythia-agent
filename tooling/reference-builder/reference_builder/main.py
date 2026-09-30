"""Command line entry: download, parse, assemble, gate and write one snapshot."""

from __future__ import annotations

import argparse
import sys
import time
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from . import claims, fetch, firds, firds_audit, manifest, mic, schema, sec, source_drift, truth_report, writer
from .assemble import Inputs
from .config import BUILDER_VERSION, SOURCE_CORRECTIONS, USER_AGENT, BuildConfig, Scope, load_openfigi_key, load_sec_identity, parse_mics
from .fetch import Downloader, log, utc_now
from .gleif import GleifClient
from .openfigi import MAPPING_URL, OpenFigi
from .pipeline import build_snapshot
from .source_corrections import Table


def parse_args(argv: list[str]) -> BuildConfig:
    parser = argparse.ArgumentParser(prog="reference-builder", description="Build the open reference snapshot.")
    parser.add_argument("--mics", default="ALL", help="comma-separated operating MICs (default ALL: every EU/EEA venue in FIRDS)")
    parser.add_argument("--no-firds", action="store_true",
                        help="skip ESMA FIRDS: no EU/EEA lines, and so no FITRS or GLEIF (US lines only, with SEC)")
    parser.add_argument("--no-sec", action="store_true", help="skip US lines (SEC company and fund tickers)")
    parser.add_argument("--no-gleif", action="store_true",
                        help="skip GLEIF: issuers take FIRDS's names, with no entity status or EDGAR registration")
    parser.add_argument("--no-openfigi", action="store_true", help="skip OpenFIGI: no FIGIs, EU tickers or US ETFs")
    parser.add_argument("--as-of", type=date.fromisoformat, default=datetime.now(timezone.utc).date())
    parser.add_argument("--out", type=Path, help="output directory")
    parser.add_argument("--cache", type=Path, help="download cache directory")
    parser.add_argument("--deltas", action="store_true", help="also apply FIRDS daily deltas (DLTINS) since the weekly file")
    parser.add_argument("--no-fitrs", action="store_true", help="skip ESMA FITRS: no activity and turnover check")
    parser.add_argument("--sec-file", type=Path, help="use a downloaded company_tickers_exchange.json")
    parser.add_argument("--no-gates", action="store_true", help="write the snapshot even if a canary fails")
    parser.add_argument("--offline", action="store_true",
                        help="build from the download cache only, whatever its age; stop if something is not cached")
    args = parser.parse_args(argv)
    defaults = BuildConfig(scope=Scope(), as_of=args.as_of)
    return BuildConfig(
        scope=Scope(mics=parse_mics(args.mics), sec=not args.no_sec, firds=not args.no_firds),
        as_of=args.as_of,
        out_dir=args.out or defaults.out_dir,
        cache_dir=args.cache or defaults.cache_dir,
        deltas=args.deltas,
        fitrs=not args.no_fitrs,
        gleif=not args.no_gleif,
        openfigi=not args.no_openfigi,
        gates=not args.no_gates,
        contact=load_sec_identity() if not args.no_sec and not args.sec_file and not args.offline else None,
        sec_file=args.sec_file,
        offline=args.offline,
    )


def run(config: BuildConfig) -> int:
    started, clock = utc_now(), time.monotonic()
    fetch.OFFLINE = config.cache_dir if config.offline else None  # offline, every request stops the build

    def max_age(days: int) -> timedelta:  # offline, any cached copy will do
        return timedelta.max if config.offline else timedelta(days=days)

    downloads = Downloader(config.cache_dir, USER_AGENT)
    day = max_age(config.listing_file_max_age_days)
    venues = mic.parse(mic.fetch(downloads, day))

    fingerprint = source_drift.Fingerprint(firds.SOURCE)
    admissions, record_counts = {}, Counter()
    if config.scope.firds:
        full_docs, delta_docs = firds.firds_files(USER_AGENT, config.as_of, config.deltas, config.scope.cfi_prefixes)
        full = [firds.download(downloads, "esma_firds", d) for d in full_docs]
        deltas = [firds.download(downloads, "esma_firds", d) for d in delta_docs]
        admissions, record_counts = firds.load_admissions(full, deltas, config.scope.cfi_prefixes, fingerprint)
    stamp = config.as_of.strftime("%Y%m%d")
    table = Table.read(SOURCE_CORRECTIONS.read_text(encoding="utf-8")) if config.scope.firds else Table()  # the fixes of FIRDS' own errors; a build without FIRDS reads none
    firds_claims = claims.load(claims.corrected(firds.claims(admissions), table), table)  # the claims the build decides from
    if config.scope.firds:
        firds.measure(fingerprint, firds_claims.isins)
    log(f"claims: {firds_claims.count} FIRDS claims")
    transparency = None
    if config.fitrs:
        transparency = firds.load_transparency([firds.download(downloads, "esma_fitrs", d) for d in firds.fitrs_files(USER_AGENT, config.as_of, config.scope.cfi_prefixes)], config.as_of)

    sec_files = {}
    if config.scope.sec:
        sec_files[sec.TICKERS] = sec.fetch(downloads, config.contact, config.sec_file, day)
        if not config.sec_file:
            sec_files[sec.FUNDS] = sec.fetch_funds(downloads, config.contact, day)
    sec_drift = {}  # each SEC file is fingerprinted before it is parsed: a broken file is never parsed
    for source, data in sec_files.items():
        found = sec.observe(source, data).to_dict()
        sec_drift[source] = (found, claims.drift(claims.record_path(config.out_dir, source, stamp), found, sec.READ[source]))
        report = sec_drift[source][1]
        for line in source_drift.format_alarms(report["alarms"], report["baseline"]):
            log(f"{source}{line}")
    sec_broken = [source for source, (_found, report) in sec_drift.items() if report["broken"]]
    if sec_broken and config.gates:
        log(f"SEC drift gate failed ({', '.join(sec_broken)}); no snapshot written (use --no-gates to inspect)")
        return 2
    sec_rows = sec.parse(sec_files[sec.TICKERS]) if sec.TICKERS in sec_files and sec.TICKERS not in sec_broken else []
    funds = sec.parse_funds(sec_files[sec.FUNDS]) if sec.FUNDS in sec_files and sec.FUNDS not in sec_broken else []
    figi = gleif = None  # a source the build leaves out is never opened
    if config.openfigi:
        figi = OpenFigi(config.cache_dir, USER_AGENT, load_openfigi_key(), max_age(config.openfigi_max_age_days))
        log(f"OpenFIGI: {'keyed' if figi.keyed else 'keyless (slower rate limits)'}")
    if config.gleif:
        gleif = GleifClient(config.cache_dir, USER_AGENT, max_age(config.gleif_max_age_days))

    inputs = Inputs(config.as_of, config.scope, venues, admissions, transparency, sec_rows, figi.mic_codes() if figi else set(),
                    funds, firds_claims, openfigi=figi is not None, gleif=gleif is not None)
    snap = build_snapshot(inputs, gleif.fetch if gleif else lambda _leis: {}, figi.map if figi else _unanswered)
    dropped = [f"{f.subject_id} ({f.flag.removeprefix('firds_underlying_')})" for f in snap.flags
               if f.flag in ("firds_underlying_inactive", "firds_underlying_outside_build")]
    if dropped:
        log(f"receipts whose FIRDS underlying is inactive or outside the build: {len(dropped)}: {', '.join(dropped[:10])}"
            f"{', ...' if len(dropped) > 10 else ''}")
    snap.audit["firds_records"] = dict(sorted(record_counts.items()))
    snap.audit["fitrs_isins"] = len(transparency) if transparency is not None else None

    canaries = manifest.check_canaries(snap, manifest.default_canaries(config.scope, funds=bool(funds), openfigi=config.openfigi))
    for result in canaries:
        log(f"canary {'ok' if result['ok'] else 'FAILED'}: {result['name']} {result['missing'] or ''}")
    failed = [c for c in canaries if not c["ok"]]
    record_path = claims.record_path(config.out_dir, "firds", stamp)
    baseline = claims.previous_good(record_path)  # the last good build's fingerprint, never a broken one
    firds_fingerprint = fingerprint.to_dict()
    firds_report = firds_audit.report(firds_claims, firds_fingerprint, snap, venues, config.as_of.isoformat(),
                                      baseline[1]["fingerprint"] if baseline else None) if config.scope.firds else None
    for line in source_drift.format_alarms(firds_report["alarms"], baseline[0].name if baseline else None) if firds_report else ():
        log(f"FIRDS{line}")
    firds_broken = bool(firds_report and firds_report["broken"])
    if (failed or firds_broken) and config.gates:
        log(f"{'canary' if failed else 'FIRDS drift'} gate failed; no snapshot written (use --no-gates to inspect)")
        return 2

    sources = [r.manifest() | {"licence": manifest.licence(r.source)} for r in downloads.retrieved]
    if gleif and gleif.provenance():
        sources.append(gleif.provenance().manifest() | {"licence": manifest.licence("gleif_lei_records")})
    figi_meta = figi.provenance() if figi else None
    if figi_meta:
        sources.append({"source": "openfigi", "url": MAPPING_URL, "version": "v3", "retrieved_at": figi_meta["answers_to"] or started,
                        "sha256": None, "bytes": None, "licence": manifest.licence("openfigi")})
    seed = writer.describe(schema.CORE / "canonical_assets.json")  # core's curated crypto table, in every build
    sources.append({"source": "canonical_assets", "url": None, "version": schema.identity.CANONICAL_ASSETS_RULE,
                    "retrieved_at": started, "sha256": seed["sha256"], "bytes": seed["bytes"],
                    "licence": manifest.licence("canonical_assets")})
    sources = _unique_sources(sources)
    included = list(dict.fromkeys(entry["source"].split(":")[0] for entry in sources))  # `package.json` lists them
    log(f"sources: {', '.join(included)}")

    build_id = f"reference-{stamp}"
    meta = {"build_id": build_id, "schema_version": str(schema.SCHEMA_VERSION), "builder_version": BUILDER_VERSION,
            "as_of": config.as_of.isoformat(), "created_at": started, "scope": config.scope.label(),
            "cfi_prefixes": ",".join(config.scope.cfi_prefixes)}
    snapshot_path = config.out_dir / f"{build_id}.sqlite3"
    counts = writer.write(snap, snapshot_path, meta, sources)
    questions_path = config.out_dir / f"questions-{stamp}.json"  # the package's `claims`: what the build left open
    claims.write(questions_path, {"build_id": build_id, "questions": schema.questions(snap)})
    truth_audit = truth_report.build_report(snapshot_path, config.scope.cfi_prefixes, log, snap.audit)  # a report, never a gate
    manifest.write_manifest(config.out_dir / "manifest.json", {
        "build_id": build_id,
        "schema_version": schema.SCHEMA_VERSION,
        "builder_version": BUILDER_VERSION,
        "as_of": config.as_of.isoformat(),
        "started_at": started,
        "finished_at": utc_now(),
        "wall_seconds": round(time.monotonic() - clock, 1),
        "scope": config.scope.describe() | {"firds_deltas": config.deltas, "fitrs": config.fitrs, "gleif": config.gleif,
                                            "openfigi": config.openfigi},
        "included_sources": included,
        "snapshot": writer.describe(snapshot_path),
        "tables": counts,
        "sources": sources,
        "openfigi": figi_meta,
        "gleif_api_calls": gleif.calls if gleif else None,
        "audit": snap.audit,
        "canaries": canaries,
        "truth_audit": truth_audit,
        "claims": writer.describe(questions_path) | {"questions": len(snap.questions)},
        "firds": {"record": record_path.name, "baseline": baseline[0].name if baseline else None} | firds_report if firds_report else None,
        "sec_drift": {source: report for source, (_found, report) in sec_drift.items()},
    })
    # Written last, beside a finished snapshot: a crashed build leaves no record to become the next baseline.
    if firds_report:
        claims.write(record_path, {"good": not firds_broken, "fingerprint": firds_fingerprint, "report": firds_report})
    for source, (found, report) in sec_drift.items():
        claims.write(claims.record_path(config.out_dir, source, stamp), {"good": not report["broken"], "fingerprint": found, "report": report})
    log(f"wrote {snapshot_path} ({counts.get('listings', 0)} listings) in {time.monotonic() - clock:.0f}s")
    return 1 if failed or firds_broken or sec_broken else 0


def _unanswered(jobs: list[dict]) -> list[dict]:
    """OpenFIGI's place in a build without it: no job has an answer."""
    return [{} for _ in jobs]


def _unique_sources(sources: list[dict]) -> list[dict]:
    """A source with several files (FIRDS parts) is keyed per file version."""
    totals = Counter(s["source"] for s in sources)
    return [s | {"source": f"{s['source']}:{s.get('version') or i}"} if totals[s["source"]] > 1 else s for i, s in enumerate(sources)]


def main(argv: list[str] | None = None) -> int:
    return run(parse_args(sys.argv[1:] if argv is None else argv))
