"""The truth-set audit's baseline, regression gate, report and command line (see `truth.py` for the checks)."""

from __future__ import annotations

import hashlib
import inspect
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

from . import invariants
from .schema import identity
from .truth import TRUTH_DIR, Audit, Reference, audit

def key_rule() -> str:
    """Core's subject-key rule as the audit ran it: its declared version, else a digest of `subject_id`'s source."""
    declared = getattr(identity, "KEY_RULE", None)
    if declared:
        return str(declared)
    source = inspect.getsource(identity.subject_id).encode()
    return f"unversioned:{hashlib.sha256(source).hexdigest()[:12]}"


def load_truth(path: Path | None = None) -> dict:
    return json.loads((path or TRUTH_DIR / "instruments.json").read_text(encoding="utf-8"))


def baseline_of(report: Audit) -> dict:
    return {"reference": report.reference, "scope": report.scope.label, "truth_version": report.truth_version,
            "key_rule": key_rule(),
            "passed": sorted({r.key for r in report.results if r.status == "pass"}),
            "ids": dict(sorted(report.ids.items()))}


def id_changes(report: Audit, baseline: dict | None, aliases: dict[str, str] | None = None) -> list[tuple[str, bool]]:
    """Subject IDs of truth entries that differ from the baseline's, each with whether an `id_aliases` row
    resolves the old ID to the new one."""
    aliases, found = aliases or {}, []
    for entry_id, old in (baseline or {}).get("ids", {}).items():
        new = report.ids.get(entry_id)
        if not new:
            continue
        pairs = [("security", old.get("security"), new.get("security")), ("issuer", old.get("issuer"), new.get("issuer"))]
        pairs += [(f"listing {label}", value, new["listings"].get(label)) for label, value in old.get("listings", {}).items()]
        for what, before, after in pairs:
            if before and after and before != after:
                found.append((f"{entry_id}:subject_id: {what} changed {before} -> {after}", aliases.get(before) == after))
    return found


def regressions(report: Audit, baseline: dict | None, aliases: dict[str, str] | None = None) -> list[str]:
    """Checks that passed in the baseline and fail now, and subject IDs that changed without an alias."""
    if not baseline:
        return []
    now = {r.key: r for r in report.results}
    found = [f"{key}: {now[key].reason}" for key in baseline.get("passed", [])
             if key in now and now[key].status == "fail"]
    return found + [f"{change} without an alias" for change, aliased in id_changes(report, baseline, aliases) if not aliased]


def format_report(report: Audit, regressed: list[str], *, top: int = 12, baseline: dict | None = None) -> str:
    lines = [f"Identity truth-set audit: {report.reference} (scope {report.scope.label or 'unknown'}) against truth set "
             f"{report.truth_version}: {report.in_scope} of {len(report.tags)} entries in scope",
             "", f"{'check':<12}{'pass':>6}{'fail':>6}{'n/a':>6}{'score':>8}"]
    total = Counter()
    for check, counts in report.scores().items():
        applicable = counts.get("pass", 0) + counts.get("fail", 0)
        if check != "subject_key":
            total.update(counts)
        score = f"{100 * counts.get('pass', 0) / applicable:.0f}%" if applicable else "-"
        lines.append(f"{check:<12}{counts.get('pass', 0):>6}{counts.get('fail', 0):>6}{counts.get('na', 0):>6}{score:>8}")
    applicable = total["pass"] + total["fail"]
    overall = f"{100 * total['pass'] / applicable:.0f}%" if applicable else "-"
    lines.append(f"{'all':<12}{total['pass']:>6}{total['fail']:>6}{total['na']:>6}{overall:>8}  (subject_key excluded)")
    lines.append(f"subject_key compares reference IDs with core's key rule {key_rule()} applied to the truth set's"
                 " identifiers: a difference means the key rule differs, not a defect.")
    if report.future:
        lines.append(f"Not scored, future subject kinds (M1): {', '.join(report.future)}")
    by_tag: dict[str, Counter] = defaultdict(Counter)
    for result in report.results:
        if result.status != "na" and result.check != "subject_key":
            for tag in report.tags.get(result.entry, []):
                by_tag[tag][result.status] += 1
    lines += ["", "Checks passing by instrument tag (subject_key excluded):"]
    lines += [f"  {tag:<20}{c['pass']:>5}/{c['pass'] + c['fail']:<5}{100 * c['pass'] / (c['pass'] + c['fail']):>4.0f}%"
              for tag, c in sorted(by_tag.items(), key=lambda item: item[1]["pass"] / (item[1]["pass"] + item[1]["fail"]))]
    patterns: dict[tuple[str, str], list[str]] = defaultdict(list)
    for result in report.results:
        if result.status == "fail":
            # Keep MICs, currencies and kinds in the pattern; drop per-entry values.
            reason = result.reason.split(":")[0] if result.reason.startswith(("folded_into:", "wrong:", "ticker:")) else result.reason
            if result.check == "subject_key":
                reason = f"key rule differs ({reason})"
            patterns[(result.check, reason)].append(result.entry)
    lines += ["", "Top failure patterns:"]
    for (check, reason), members in sorted(patterns.items(), key=lambda item: -len(item[1]))[:top]:
        examples = ", ".join(dict.fromkeys(members))
        lines.append(f"  {len(members):>4}  {check} / {reason}: {examples[:110]}{'...' if len(examples) > 110 else ''}")
    if baseline is not None:
        lines += ["", f"Regressions against the baseline ({baseline.get('reference', '?')}): {len(regressed) or 'none'}"]
        lines += [f"  {item}" for item in regressed]
    return "\n".join(lines)


# Build counts a reviewer should see beside the scores, from the manifest's audit: primaries a rule chose
# rather than a source, securities left without one, issuer links that look wrong, and every identifier or
# relation the schema rejected (`skipped_*`, e.g. a ticker core's grammar refuses). Never a gate.
ATTENTION = (
    ("us_exchange_no_home_line", ("securities", "by_primary_rule"), "US primary: a US exchange line and no line in the ISIN's country"),
    ("securities_without_primary", ("schema",), "live securities without a primary listing"),
    ("issuer_split_lei_cik", ("flags",), "CIK-only issuers named like a LEI issuer (one company split in two?)"),
    ("cik_link_suspect", ("flags",), "CIK links whose SEC title shares no word with the LEI's names"),
)


def attention(audit: dict) -> dict[str, int]:
    counts = {}
    for key, path, _label in ATTENTION:
        section = audit
        for step in path:
            section = section.get(step, {}) if isinstance(section, dict) else {}
        counts[key] = section.get(key, 0) if isinstance(section, dict) else 0
    schema = audit.get("schema", {}) if isinstance(audit.get("schema"), dict) else {}
    counts |= {key: schema[key] for key in sorted(schema) if key.startswith("skipped_")}
    counts.setdefault("skipped_ticker_mic", 0)
    return counts


def format_attention(counts: dict[str, int] | None) -> list[str]:
    if counts is None:
        return ["Build counts: no manifest.json for this reference beside it"]
    labels = {key: label for key, _path, label in ATTENTION}
    return ["Build counts (manifest audit):"] + [
        f"  {value:>6}  {labels.get(key) or 'rejected by the schema: ' + key.removeprefix('skipped_')}"
        for key, value in counts.items()]


def manifest_audit(reference: Path) -> dict | None:
    """The builder's audit counts, when the manifest beside the reference describes this file."""
    path = reference.parent / "manifest.json"
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("audit") if data.get("snapshot", {}).get("file") == reference.name else None


def load_baseline(path: Path | None = None) -> dict | None:
    path = path or TRUTH_DIR / "baseline.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def aliases_of(reference: Path) -> dict[str, str]:
    return {row[0]: row[1] for row in Reference(reference).all("SELECT old_id, new_id FROM id_aliases")}


def build_report(reference: Path, cfi: tuple[str, ...], log, build_audit: dict | None = None) -> dict:
    """The builder's non-blocking report: scores and regressions for the manifest, a summary in the log."""
    counts = attention(build_audit) if build_audit is not None else None
    for line in format_attention(counts) if counts is not None else []:
        log(line)
    try:  # first, so the manifest has the counts even when the truth-set audit fails
        checked = invariants.run(reference)
    except Exception as error:  # nor do the invariants
        log(f"invariants skipped: {error!r}")
        checked = []
    for result in checked:
        if result.mark != "ok":
            log(f"  invariant {result.name} ({result.severity}): {result.count} against the limit {result.limit}, {result.mark}")
    found = {"invariants": {r.name: r.count for r in checked}, "invariants_failed": [r.name for r in checked if r.failed]}
    try:
        report = audit(reference, load_truth(), cfi=cfi)
        regressed = regressions(report, load_baseline(), aliases_of(reference))
    except Exception as error:  # the report never fails a build
        log(f"truth-set audit skipped: {error!r}")
        return {"error": repr(error), "attention": counts} | found
    scores = report.scores()
    headline = [c for check, c in scores.items() if check != "subject_key"]
    passed = sum(c.get("pass", 0) for c in headline)
    applicable = passed + sum(c.get("fail", 0) for c in headline)
    log(f"truth-set audit: {passed}/{applicable} checks pass, {len(regressed)} regressions against the baseline"
        " (details: just reference-audit)")
    for item in regressed[:10]:
        log(f"  regression {item}")
    return {"truth_version": report.truth_version, "key_rule": key_rule(), "entries_in_scope": report.in_scope, "scores": scores,
            "regressions": len(regressed), "attention": counts} | found


def previous_reference(reference: Path) -> Path | None:
    """The next older snapshot beside `reference` (snapshots are named by build date)."""
    older = [p for p in sorted(reference.parent.glob("reference-*.sqlite3")) if p.name < reference.name]
    return older[-1] if older else None


def newest_reference(out_dir: Path) -> Path | None:
    found = sorted(out_dir.glob("reference-*.sqlite3"))
    return found[-1] if found else None


def main(argv: list[str] | None = None) -> int:
    import argparse
    import sys

    from .config import WORK_DIR

    parser = argparse.ArgumentParser(prog="reference-audit", description="Audit a reference snapshot against the identity truth set.")
    parser.add_argument("--reference", type=Path, help="reference-*.sqlite3 (default: newest in the builder's output directory)")
    parser.add_argument("--truth", type=Path, help="truth set JSON (default truth/instruments.json)")
    parser.add_argument("--baseline", type=Path, help="baseline JSON (default truth/baseline.json)")
    parser.add_argument("--write-baseline", action="store_true", help="record this run as the baseline")
    parser.add_argument("--accept-id-changes", action="store_true",
                        help="with --write-baseline: accept subject IDs that changed since the previous baseline")
    parser.add_argument("--failures", action="store_true", help="list every failing check")
    parser.add_argument("--json", type=Path, help="also write the full results as JSON")
    parser.add_argument("--previous", type=Path, help="reference to list new invariant rows against "
                        "(default: the next older reference-*.sqlite3 beside --reference)")
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)
    reference = args.reference or newest_reference(WORK_DIR / "out")
    if reference is None or not reference.exists():
        print("no reference snapshot found: build one with `just reference-snapshot` or pass --reference", file=sys.stderr)
        return 2
    report = audit(reference, load_truth(args.truth))
    baseline_path = args.baseline or TRUTH_DIR / "baseline.json"
    baseline = None if args.write_baseline else load_baseline(baseline_path)
    regressed = regressions(report, baseline, aliases_of(reference))
    print(format_report(report, regressed, baseline=baseline))
    build_audit = manifest_audit(reference)
    print("\n" + "\n".join(format_attention(attention(build_audit) if build_audit is not None else None)))
    checked = invariants.run(reference)
    previous = args.previous or previous_reference(reference)
    before = invariants.run(previous) if previous and any(r.over for r in checked) else None
    print("\n" + "\n".join(invariants.format_results(checked, before, previous.name if previous else "")))
    if args.failures:
        print("\nFailing checks:")
        print("\n".join(f"  {r.key}: {r.reason}" for r in report.results if r.status == "fail"))
    if args.json:
        args.json.write_text(json.dumps({"scores": report.scores(), "regressions": regressed,
                                         "results": [r.__dict__ for r in report.results],
                                         "invariants": [r.summary() for r in checked]}, indent=1) + "\n",
                             encoding="utf-8")
    if args.write_baseline:
        # A re-take never accepts a subject-ID change silently: it lists every change, and one that no
        # `id_aliases` row resolves needs --accept-id-changes and is kept in the baseline.
        previous = load_baseline(baseline_path) or {}
        changes = id_changes(report, previous, aliases_of(reference))
        unaliased = [change for change, aliased in changes if not aliased]
        if changes:
            print(f"\nSubject IDs changed since the previous baseline: {len(changes)}, {len(unaliased)} without an alias")
            print("\n".join(f"  {change} ({'resolves through id_aliases' if aliased else 'NO ALIAS'})"
                            for change, aliased in changes))
        if unaliased and not args.accept_id_changes:
            print("baseline not written: review the ID changes without an alias and pass --accept-id-changes",
                  file=sys.stderr)
            return 1
        accepted = list(dict.fromkeys([*previous.get("accepted_id_changes", []), *unaliased]))  # kept across re-takes
        data = baseline_of(report) | {"accepted_id_changes": accepted}
        baseline_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        print(f"\nwrote {baseline_path}")
    return 1 if regressed or any(r.failed for r in checked) else 0
