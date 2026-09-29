"""FIRDS in the audit: its odd cases with counts and examples, drift against the last good build, and the
questions the build left open where the FIRDS claims do not decide (see `reconcile`).
"""

from __future__ import annotations

from collections import Counter, defaultdict

from . import firds, source_drift
from .claims import Claims, Venues, previous_good, read, requested
from .model import Snapshot, Venue

EXAMPLES = 5


class Tally:
    """Counts and a few examples per category, live and all."""

    def __init__(self):
        self.counts: dict[str, Counter] = defaultdict(Counter)
        self.examples: dict[str, list[tuple]] = defaultdict(list)

    def add(self, category: str, example: str, *, rank: int | None = None, live: bool = True) -> None:
        self.counts[category]["count"] += 1
        self.counts[category]["live"] += live
        self.examples[category].append((rank is None, rank or 0, example))

    def summary(self) -> dict:
        return {category: dict(counts) | {"examples": [e for *_, e in sorted(self.examples[category])[:EXAMPLES]]}
                for category, counts in sorted(self.counts.items(), key=lambda item: -item[1]["count"])}


def quirks(claims: Claims, venues: Venues, as_of: str) -> dict:
    """FIRDS odd cases: where a field does not mean what its name suggests, or the data departs from the definition."""
    tally, by_venue = Tally(), defaultdict(Counter)
    lei_isins: dict[str, list[str]] = defaultdict(list)
    for isin, values in sorted(claims.isins.items()):
        name, kind = claims.name(isin), (claims.one(isin, "cfi") or "")[:2]
        leis = values.get("issuer_or_venue_operator_lei", set())
        if not leis:
            tally.add("issuer_lei_missing", name)
        if len(values.get("instrument_full_name", ())) > 1:
            tally.add("full_name_differs_by_venue", f"{name}: {len(values['instrument_full_name'])} names")
        for meaning in ("issuer_or_venue_operator_lei", "notional_currency", "most_liquid_eu_market", "underlying_isin"):
            if len(values.get(meaning, ())) > 1:
                tally.add(f"{meaning}_two_values", f"{name}: {sorted(values[meaning])}")
        segments = claims.admissions.get(isin, {})
        for lei in leis:
            lei_isins[lei].append(isin)
            if lei in venues.operated:
                reporting = venues.operated[lei] & ({venues.op(s) for s in segments} | set(segments))
                tally.add("issuer_lei_is_venue_operator", f"{name}: {lei} operates {','.join(sorted(venues.operated[lei]))[:40]}")
                if reporting:
                    tally.add("issuer_lei_is_operator_of_a_reporting_venue", f"{name}: {lei} operates {','.join(sorted(reporting))}")
        asked = requested(claims, isin, as_of)
        wanted = {venues.op(m) for m in asked}
        relevant = venues.op(claims.one(isin, "most_liquid_eu_market"))
        if not relevant:
            tally.add("relevant_venue_missing", name)
        if len({venues.country(m) for m in wanted}) > 1:
            tally.add("issuer_requested_in_several_countries", f"{name}: {','.join(sorted(asked))}")
        if not wanted:
            tally.add("no_issuer_requested_eea_admission", f"{name} (relevant venue {relevant})")
        elif relevant in wanted:
            tally.add("relevant_venue_issuer_requested", name)
        else:
            tally.add("relevant_venue_not_requested_another_is", f"{name}: relevant {relevant}, requested {','.join(sorted(wanted))}")
        for segment, admission in segments.items():
            by_venue[segment][admission.get("issuer_requested_admission", "missing")] += 1
            end = admission.get("termination_date")
            if end and end <= as_of:
                tally.add("termination_date_past", f"{name} on {segment} ended {end}")
        if kind != "ED" and values.get("underlying_isin"):
            tally.add("underlying_stated_for_a_non_receipt", f"{name} ({claims.one(isin, 'cfi')})")
        if kind == "ED":
            underlying = values.get("underlying_isin", set())
            tally.add("receipt_with_underlying" if underlying - {isin} else "receipt_without_underlying", name)
            if isin in underlying:
                tally.add("receipt_underlying_is_itself", name)
            for target in underlying - {isin}:
                if target not in claims.isins:
                    tally.add("receipt_underlying_not_in_firds_scope", f"{name} -> {target}")
    for lei, isins in sorted(lei_isins.items()):
        funds = [i for i in isins if (claims.one(i, "cfi") or "").startswith("CE")]
        if len(funds) > 1 and lei not in venues.operated:
            tally.add("etf_subfund_lei_shared_by_classes", f"{lei}: {', '.join(claims.name(i) for i in funds[:2])}")
            tally.counts["etf_subfund_lei_shared_by_classes"]["isins"] += len(funds)
    report = tally.summary()
    # Field 8 per segment: Euronext answers true on every record, the German floors almost never.
    report["issuer_requested_by_venue"] = [[mic, c.get("true", 0), c.get("false", 0), c.get("missing", 0)] for mic, c in
                                           sorted(by_venue.items(), key=lambda item: (-sum(item[1].values()), item[0]))]
    always = {mic: by_venue[mic]["true"] for mic in claims.convention}
    report["issuer_requested_on_every_record"] = {"count": len(always), "records": sum(always.values()),
                                                  "examples": [f"{m} {n}" for m, n in sorted(always.items(), key=lambda i: -i[1])]}
    return report




def primaries(snap: Snapshot) -> dict:
    """How FIRDS securities got their primary line (`reconcile._primary` rules), with examples."""
    tally = Tally()
    for security in snap.securities.values():
        if security.source == firds.SOURCE and security.primary_rule:
            tally.add(security.primary_rule, f"{security.isin} {security.name or ''}: {security.primary_mic}",
                      rank=security.rank, live=security.activity != "inactive")
    return tally.summary()


def asked(snap: Snapshot) -> dict:
    """The build's open questions per type, with examples."""
    tally = Tally()
    for question in snap.questions:
        security = snap.securities.get(question.subject_id)
        tally.add(question.question, f"{security.isin if security else question.subject_id} "
                  f"{(security.name if security else '') or ''} ({len(question.candidates)} candidates)",
                  rank=security.rank if security else None)
    return tally.summary()


def report(claims: Claims, fingerprint: dict, snap: Snapshot, venues: dict[str, Venue], as_of: str,
           previous: dict | None) -> dict:
    """Quirks, primaries, open questions and drift alarms against the previous good build."""
    alarms = source_drift.compare(previous, fingerprint, firds.READ_PATHS)
    return {"claims": claims.count, "quirks": quirks(claims, Venues(venues), as_of), "primaries": primaries(snap),
            "questions": asked(snap), "alarms": alarms, "broken": bool(source_drift.breaks(alarms)), "metrics": fingerprint.get("metrics", {})}


def format_section(path, reference_name: str) -> tuple[list[str], bool]:
    """The audit's FIRDS section from the record beside a snapshot, and whether drift broke the source."""
    record = read(path)
    if not record or not record.get("fingerprint") or not record.get("report"):
        return [f"FIRDS: no FIRDS record beside {reference_name} (built before claims, or by another builder)"], False
    found, baseline = record["report"], previous_good(path)
    alarms = source_drift.compare(baseline[1]["fingerprint"] if baseline else None, record["fingerprint"], firds.READ_PATHS)
    lines = [f"FIRDS claims ({found['claims']}; {path.name}{'' if record.get('good') else ', a broken build'})",
             *source_drift.format_alarms(alarms, baseline[0].name if baseline else None), "  odd cases:"]
    for name, item in found["quirks"].items():
        if "count" in item:
            lines.append(f"    {item['count']:>7}  {name}" + (f" ({item['isins']} ISINs)" if "isins" in item else "")
                         + (f": {'; '.join(item['examples'][:3])[:110]}" if item["examples"] else ""))
    lines.append("  field 8 (issuer requested) per segment, largest, true/false/missing: " + "; ".join(
        f"{mic} {true}/{false}/{missing}" for mic, true, false, missing in found["quirks"]["issuer_requested_by_venue"][:12]))
    for title, key in (("primary lines of FIRDS securities, by rule", "primaries"), ("open questions", "questions")):
        lines.append(f"  {title} (live, all):")
        lines += [f"    {item['live']:>7}{item['count']:>8}  {name}: {'; '.join(item['examples'][:2])[:100]}"
                  for name, item in found[key].items()]
    return lines, bool(source_drift.breaks(alarms))
