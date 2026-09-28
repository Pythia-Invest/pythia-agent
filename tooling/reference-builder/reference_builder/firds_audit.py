"""FIRDS in the audit: its odd cases with counts and examples, and a shadow comparison of today's decisions
with what the FIRDS claims alone decide.

Nothing here changes the snapshot. For each field FIRDS speaks to, the claims give an outcome that depends only
on the claims, never on today's value:

- `decided`: the claims name the value;
- `co_primary`: the issuer requested admission in several countries;
- `unknown` plus a question: FIRDS speaks to the field but does not decide it;
- `conflict` plus a question: two FIRDS claims cannot both hold;
- `outside_firds`: FIRDS says nothing that could decide it; other sources must, and only what they leave open
  becomes a question.

Today's value is then compared with that outcome (agrees, differs, today empty, or today holding a value where
the claims do not decide). Where the evidence does not decide, the answer is unknown plus a question, never a
guess stored as fact.

- issuer: field 5 is the LEI of the issuer *or of the trading venue operator*; an LEI ISO 10383 lists for a
  venue's operating entity does not decide the issuer;
- primary: field 8 says which EEA admissions the issuer requested; the relevant venue is only the most liquid EU
  market, and field 8 on the segments in `firds.FIELD8_VENUE_HABIT` decides nothing;
- currency: field 13 is the instrument's notional currency and cannot decide a trading currency;
- receipt underlying: field 26.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field

from . import firds, source_drift
from .claims import Claims, Meaning, Venues, previous_good, read, requested
from .model import Snapshot, Venue
from .rules import EEA

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




def compare(claims: Claims, snap: Snapshot, venues: Venues, as_of: str) -> dict:
    """Per field: what the FIRDS claims alone give (outcome and question), against today's value."""
    fields = {name: Tally() for name in ("issuer", "primary", "currency", "receipt_underlying")}
    questions: dict[str, Counter] = defaultdict(Counter)
    underlying: dict[str, set[str]] = defaultdict(set)
    for relation in snap.relationships:
        if relation.relation == "depositary_receipt_of":
            underlying[relation.from_id].add(relation.to_id.split(":", 1)[1])

    def note(name: str, outcome: str, question: str | None, agreement: str, security, today, found) -> None:
        live = security.activity != "inactive"
        category = f"{outcome}{' + ' + question if question else ''} / {agreement}"
        fields[name].add(category, f"{claims.name(security.isin)}: today {_text(today)}, FIRDS {_text(found)}",
                         rank=security.rank, live=live)
        if question:
            questions[question]["count"] += 1
            questions[question]["live"] += live

    def versus(today, decided: set) -> str:
        return "today_none" if not today else "agrees" if today in decided else "differs"

    for security in snap.securities.values():
        isin = security.isin
        if security.source != firds.SOURCE or not isin or isin not in claims.isins:
            continue
        values, segments = claims.isins[isin], claims.admissions.get(isin, {})
        issuer = snap.issuers.get(security.issuer_id or "")
        today_lei = issuer.lei if issuer else None
        leis = values.get(Meaning.ISSUER_OR_VENUE_OPERATOR_LEI, set())
        if not leis:
            note("issuer", "outside_firds", None, "n/a", security, today_lei, None)
        elif len(leis) > 1:
            note("issuer", "conflict", "issuer_identity", "today_guess" if today_lei else "today_none", security, today_lei, leis)
        elif (lei := next(iter(leis))) in venues.operated:
            note("issuer", "unknown", "issuer_identity", "today_guess" if today_lei else "today_none", security, today_lei,
                 f"operator of {','.join(sorted(venues.operated[lei]))[:40]}")
        else:
            note("issuer", "decided", None, versus(today_lei, leis), security, today_lei, lei)
        _primary(note, versus, claims, venues, security, isin, segments, as_of)
        stated = values.get(Meaning.UNDERLYING_ISIN, set()) - {isin}
        today = underlying.get(security.security_id, set())
        if security.kind != "dr" and stated:  # the CFI says share, field 26 says receipt
            note("receipt_underlying", "conflict", "receipt_underlying", "today_none" if not today else "today_guess",
                 security, sorted(today), sorted(stated))
        elif security.kind == "dr":
            if len(stated) == 1:
                agreement = "today_none" if not today else "agrees" if today == stated else "differs"
                note("receipt_underlying", "decided", None, agreement, security, sorted(today), sorted(stated))
            else:
                outcome = "conflict" if stated else "unknown"
                note("receipt_underlying", outcome, "receipt_underlying", "today_guess" if today else "today_none",
                     security, sorted(today), sorted(stated) or None)
    pairs: Counter = Counter()
    for listing in snap.listings.values():
        security = snap.securities.get(listing.security_id or "")
        if listing.source != firds.SOURCE or not security or security.isin not in claims.isins:
            continue
        notional = claims.isins[security.isin].get(Meaning.NOTIONAL_CURRENCY, set())
        agreement = "today_is_the_notional" if listing.currency in notional else "today_other"
        pairs[(listing.country or "?", listing.currency or "?")] += agreement == "today_is_the_notional"
        fields["currency"].add(f"outside_firds / {agreement}",
                               f"{listing.mic}:{claims.name(security.isin)}: today {listing.currency}, notional {sorted(notional)}",
                               rank=security.rank, live=listing.status != "inactive")
    summary = {name: tally.summary() for name, tally in fields.items()}
    summary["questions"] = {name: dict(counts) for name, counts in sorted(questions.items())}
    summary["currency_by_venue_country"] = [[f"{country} {currency}", n] for (country, currency), n in pairs.most_common(15) if n]
    return summary


def _primary(note, versus, claims: Claims, venues: Venues, security, isin: str, segments: dict, as_of: str) -> None:
    """Field 8: the EEA admissions the issuer requested. Segments whose field 8 is a venue habit decide nothing."""
    asked = requested(claims, isin, as_of)
    evidence = asked - firds.FIELD8_VENUE_HABIT
    markets = {venues.op(m) for m in evidence}
    today = security.primary_mic
    if not asked:
        note("primary", "outside_firds", None, "n/a", security, today, "no issuer-requested EEA admission")
    elif not evidence:
        note("primary", "unknown", "home_market", "today_guess" if today else "today_none", security, today,
             f"requested only on {','.join(sorted(asked))}")
    else:
        outcome = "co_primary" if len({venues.country(m) for m in markets}) > 1 else "decided"
        agreement = versus(today, markets)
        if agreement == "differs" and venues.country(today) not in EEA:
            agreement = "differs_today_outside_eea"
        note("primary", outcome, None, agreement, security, today, f"requested {','.join(sorted(evidence))}")


def _text(value) -> str | None:
    if value is None:
        return None
    return ",".join(sorted(value)) if isinstance(value, (list, set)) else str(value)


def report(claims: Claims, fingerprint: dict, snap: Snapshot, venues: dict[str, Venue], as_of: str,
           previous: dict | None) -> dict:
    """Quirks, the shadow comparison and drift alarms against the previous good build."""
    index = Venues(venues)
    alarms = source_drift.compare(previous, fingerprint, firds.READ_PATHS)
    return {"claims": claims.count, "quirks": quirks(claims, index, as_of), "diff": compare(claims, snap, index, as_of),
            "alarms": alarms, "broken": bool(source_drift.breaks(alarms)), "metrics": fingerprint.get("metrics", {})}


def format_section(path, reference_name: str) -> tuple[list[str], bool]:
    """The audit's FIRDS section from the record beside a snapshot, and whether drift broke the source."""
    record = read(path)
    if not record or not record.get("fingerprint") or not record.get("report"):
        return [f"FIRDS: no FIRDS record beside {reference_name} (built before claims, or by another builder)"], False
    found, baseline = record["report"], previous_good(path)
    alarms = source_drift.compare(baseline[1]["fingerprint"] if baseline else None, record["fingerprint"], firds.READ_PATHS)
    lines = [f"FIRDS claims ({found['claims']}; {path.name}{'' if record.get('good') else ', a broken build'});"
             " shadow mode: the snapshot is unchanged",
             *source_drift.format_alarms(alarms, baseline[0].name if baseline else None), "  odd cases:"]
    for name, item in found["quirks"].items():
        if "count" in item:
            lines.append(f"    {item['count']:>7}  {name}" + (f" ({item['isins']} ISINs)" if "isins" in item else "")
                         + (f": {'; '.join(item['examples'][:3])[:110]}" if item["examples"] else ""))
    lines.append("  field 8 (issuer requested) per segment, largest, true/false/missing: " + "; ".join(
        f"{mic} {true}/{false}/{missing}" for mic, true, false, missing in found["quirks"]["issuer_requested_by_venue"][:12]))
    lines.append("  FIRDS claims alone against today's decisions (live, all; outcome + question / today):")
    for name in ("issuer", "primary", "currency", "receipt_underlying"):
        for category, item in found["diff"][name].items():
            lines.append(f"    {name:<19}{item['live']:>7}{item['count']:>8}  {category}: {item['examples'][0][:80]}")
    lines.append("  questions the FIRDS claims leave open (live, all): " + ", ".join(
        f"{name} {c['live']}/{c['count']}" for name, c in found["diff"]["questions"].items()))
    lines.append("  lines whose trading currency is FIRDS' notional currency, by venue country: "
                 + ", ".join(f"{pair} {n}" for pair, n in found["diff"]["currency_by_venue_country"]))
    return lines, bool(source_drift.breaks(alarms))
