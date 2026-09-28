"""FIRDS in the audit: its odd cases with counts and examples, and a shadow comparison of today's decisions
with what the FIRDS claims decide or contradict.

Nothing here changes the snapshot. The comparison covers the fields FIRDS speaks to:

- issuer: field 5 is the LEI of the issuer *or of the trading venue operator*, so an LEI that ISO 10383
  lists as a venue operator's does not by itself name the issuer;
- currency: field 13 is the instrument's notional currency and cannot fill the trading-currency slot;
- primary: field 8 says which EEA admissions the issuer requested; the relevant venue is only the most
  liquid EU market;
- receipt underlying: field 26.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field

from . import drift
from .claims import previous_claims, stored
from .firds import READ_PATHS, SOURCE
from .model import Snapshot, Venue
from .rules import EEA

EXAMPLES = 5
# What a claims-based build would write for each comparison category. When the evidence does not decide, the
# answer is "unknown" plus a question, never a guess stored as fact; two claims that cannot both hold are a
# conflict. `decided` means FIRDS evidence names the value; `outside_firds` means FIRDS says nothing and other
# sources must decide. Judgement answers to these questions are suggestions until calibrated.
OUTCOME = {
    ("issuer", "no_firds_lei"): ("unknown", "issuer_identity"),
    ("issuer", "firds_leis_disagree"): ("conflict", "issuer_identity"),
    ("issuer", "venue_operator_lei_of_reporting_venue"): ("unknown", "issuer_identity"),
    ("issuer", "venue_operator_lei_of_other_venue"): ("unknown", "issuer_identity"),
    ("issuer", "today_differs"): ("conflict", "issuer_identity"),
    ("primary", "none_today_issuer_requested"): ("decided", None),
    ("primary", "co_primary_requested_in_several_countries"): ("co_primary", None),
    ("primary", "contradicted_issuer_requested_another"): ("conflict", "home_market"),
    ("primary", "no_issuer_request_on_any_eea_venue"): ("unknown", "home_market"),
    ("primary", "outside_eea_while_issuer_requested_eea"): ("conflict", "home_market"),
    ("primary", "outside_eea_no_eea_request"): ("outside_firds", None),
    ("currency", "notional_as_trading_currency"): ("unknown", "trading_currency"),
    ("currency", "no_notional_currency"): ("unknown", "trading_currency"),
    ("currency", "notional_currencies_disagree"): ("conflict", "trading_currency"),
    ("currency", "today_differs"): ("outside_firds", None),
    ("receipt_underlying", "no_firds_underlying"): ("unknown", "receipt_underlying"),
    ("receipt_underlying", "firds_underlyings_disagree"): ("conflict", "receipt_underlying"),
    ("receipt_underlying", "today_missing"): ("decided", None),
    ("receipt_underlying", "today_differs"): ("conflict", "receipt_underlying"),
    ("receipt_underlying", "stated_for_a_non_receipt"): ("decided", None),
}
INSTRUMENT = ("instrument_full_name", "cfi", "issuer_or_venue_operator_lei", "notional_currency", "underlying_isin",
              "most_liquid_eu_market", "admitted_to_trading")
ADMISSION = ("issuer_requested_admission", "termination_date")
# Segments that answer field 8 true on every one of at least this many records are listed and marked on the rows
# that rest on them: some are plausible (Euronext Amsterdam, growth markets), some look like a venue convention
# (WSE GlobalConnect, Vorvel). No ISO attribute tells them apart, so the audit shows them and decides nothing.
CONVENTION_MIN = 20


@dataclass
class Claims:
    """The build's FIRDS claims the audit needs, per ISIN."""

    isins: dict[str, dict[str, set[str]]] = field(default_factory=lambda: defaultdict(lambda: defaultdict(set)))
    admissions: dict[str, dict[str, dict[str, str]]] = field(default_factory=lambda: defaultdict(lambda: defaultdict(dict)))
    convention: set[str] = field(default_factory=set)  # segments whose field 8 is true on every record

    def one(self, isin: str, meaning: str) -> str | None:
        values = self.isins.get(isin, {}).get(meaning)
        return sorted(values)[0] if values else None

    def name(self, isin: str) -> str:
        return f"{isin} {self.one(isin, 'instrument_full_name') or ''}".strip()


def load(db) -> Claims:
    found = Claims()
    marks = ",".join("?" * len(INSTRUMENT + ADMISSION))
    for subject, meaning, value in db.execute(f"SELECT subject_key, meaning, value FROM claims WHERE source = ? AND meaning IN ({marks})",
                                              (SOURCE, *INSTRUMENT, *ADMISSION)):
        isin, _, segment = subject.removeprefix("isin:").partition("@")
        if segment:
            found.admissions[isin][segment][meaning] = value
        else:
            found.isins[isin][meaning].add(value)
    answers: dict[str, Counter] = defaultdict(Counter)
    for segments in found.admissions.values():
        for segment, admission in segments.items():
            answers[segment][admission.get("issuer_requested_admission", "missing")] += 1
    found.convention = {segment for segment, c in answers.items() if set(c) == {"true"} and c["true"] >= CONVENTION_MIN}
    return found


class Venues:
    def __init__(self, venues: dict[str, Venue]):
        self.venues = venues
        self.operated: dict[str, set[str]] = defaultdict(set)  # LEI -> MICs whose operating entity it is
        for venue in venues.values():
            if venue.lei:
                self.operated[venue.lei].add(venue.mic)

    def op(self, mic: str | None) -> str | None:
        venue = self.venues.get(mic or "")
        return venue.operating_mic if venue else mic

    def country(self, mic: str | None) -> str | None:
        venue = self.venues.get(mic or "")
        return venue.country if venue else None


def _live(admission: dict[str, str], as_of: str) -> bool:
    end = admission.get("termination_date")
    return not end or end > as_of


def requested(claims: Claims, isin: str, as_of: str) -> set[str]:
    """Segment MICs of the live EEA admissions the issuer requested (field 8)."""
    return {segment for segment, a in claims.admissions.get(isin, {}).items()
            if a.get("issuer_requested_admission") == "true" and _live(a, as_of)}


class Tally:
    """Counts and a few examples per category."""

    def __init__(self):
        self.counts: dict[str, Counter] = defaultdict(Counter)
        self.examples: dict[str, list[tuple]] = defaultdict(list)

    def add(self, category: str, example: str, *, rank: int | None = None, live: bool = True, kind: str | None = None) -> None:
        self.counts[category]["count"] += 1
        self.counts[category]["live"] += live
        if kind:
            self.counts[category][f"live_{kind}" if live else f"inactive_{kind}"] += 1
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


def compare(claims: Claims, snap: Snapshot, venues: Venues, as_of: str) -> tuple[list[tuple], dict]:
    """Where today's decisions rest on, or are contradicted by, FIRDS claims. Returns diff rows and a summary."""
    rows: list[tuple] = []
    fields = {name: Tally() for name in ("issuer", "primary", "currency", "receipt_underlying")}
    underlying: dict[str, set[str]] = defaultdict(set)
    for relation in snap.relationships:
        if relation.relation == "depositary_receipt_of":
            underlying[relation.from_id].add(relation.to_id.removeprefix("isin:"))

    def note(name: str, category: str, security, today, found, detail: str = "", flag: str | None = None) -> None:
        example = f"{claims.name(security.isin)}: today {today}, FIRDS {found}" + (f" ({detail})" if detail else "")
        fields[name].add(category, example, rank=security.rank, live=security.activity != "inactive", kind=security.kind)
        if flag:
            fields[name].counts[category][flag] += 1
        rows.append((name, category, *OUTCOME[(name, category)], f"isin:{security.isin}", _text(today), _text(found), detail or None))

    for security in snap.securities.values():
        isin = security.isin
        if security.source != SOURCE or not isin or isin not in claims.isins:
            continue
        values = claims.isins[isin]
        issuer = snap.issuers.get(security.issuer_id or "")
        today_lei = issuer.lei if issuer else None
        leis = values.get("issuer_or_venue_operator_lei", set())
        segments = claims.admissions.get(isin, {})
        if not leis:
            note("issuer", "no_firds_lei", security, security.issuer_id, None)
        elif len(leis) > 1:
            note("issuer", "firds_leis_disagree", security, today_lei, sorted(leis))
        elif (lei := next(iter(leis))) in venues.operated:
            reporting = venues.operated[lei] & ({venues.op(s) for s in segments} | set(segments))
            asked = {s for s, a in segments.items() if a.get("issuer_requested_admission") == "true"}
            own = any(s in venues.operated[lei] or venues.op(s) in venues.operated[lei] for s in asked)
            category = "venue_operator_lei_of_reporting_venue" if reporting else "venue_operator_lei_of_other_venue"
            note("issuer", category, security, today_lei, f"operator of {','.join(sorted(venues.operated[lei]))[:40]}",
                 "issuer-requested on a venue it operates: may be its own share" if own
                 else "issuer-requested elsewhere" if asked else "no issuer-requested admission")
        elif lei != today_lei:
            note("issuer", "today_differs", security, today_lei, lei)
        _primary(note, claims, venues, security, isin, segments, as_of)
        stated = values.get("underlying_isin", set()) - {isin}
        today = underlying.get(security.security_id, set())
        if security.kind != "dr" and stated:
            note("receipt_underlying", "stated_for_a_non_receipt", security, f"{security.kind}, no relation",
                 sorted(stated), claims.one(isin, "cfi") or "")
        if security.kind == "dr":
            if not stated:
                note("receipt_underlying", "no_firds_underlying", security, sorted(today) or None, None,
                     "states itself" if isin in values.get("underlying_isin", set()) else "")
            elif len(stated) > 1:
                note("receipt_underlying", "firds_underlyings_disagree", security, sorted(today) or None, sorted(stated))
            elif not today:
                note("receipt_underlying", "today_missing", security, None, sorted(stated))
            elif today != stated:
                note("receipt_underlying", "today_differs", security, sorted(today), sorted(stated))
    pairs: Counter = Counter()
    for listing in snap.listings.values():
        security = snap.securities.get(listing.security_id or "")
        if listing.source != SOURCE or not security or security.isin not in claims.isins:
            continue
        notional = claims.isins[security.isin].get("notional_currency", set())
        category = ("no_notional_currency" if not notional else "notional_currencies_disagree" if len(notional) > 1
                    else "notional_as_trading_currency" if listing.currency in notional else "today_differs")
        pairs[(listing.country or "?", listing.currency or "?")] += category == "notional_as_trading_currency"
        example = f"{listing.mic}:{claims.name(security.isin)}: today {listing.currency}, FIRDS notional {sorted(notional)}"
        fields["currency"].add(category, example, rank=security.rank, live=listing.status != "inactive", kind=security.kind)
        rows.append(("currency", category, *OUTCOME[("currency", category)], f"isin:{security.isin}@{listing.mic}",
                     listing.currency, _text(sorted(notional)), None))
    summary = {name: {category: item | dict(zip(("outcome", "question"), OUTCOME[(name, category)]))
                      for category, item in tally.summary().items()} for name, tally in fields.items()}
    summary["currency_by_venue_country"] = [[f"{country} {currency}", n] for (country, currency), n in pairs.most_common(15) if n]
    return rows, summary


def _primary(note, claims: Claims, venues: Venues, security, isin: str, segments: dict, as_of: str) -> None:
    """Today's primary against field 8: the EEA admissions the issuer requested."""
    asked = requested(claims, isin, as_of)
    wanted = {venues.op(m) for m in asked}
    firds_venues = {venues.op(s) for s, a in segments.items() if _live(a, as_of)}
    today, rule = security.primary_mic, security.primary_rule
    relevant = venues.op(claims.one(isin, "most_liquid_eu_market"))
    shown = ",".join(sorted(asked)) or "none"
    detail = f"rule {rule}" + ("; today's primary is the most liquid EU market" if today and today == relevant else "")
    countries = {venues.country(m) for m in wanted}
    always = asked & claims.convention
    if always:
        detail += f"; field 8 is true on every record of {','.join(sorted(always))}"
    flag = "requested_only_on_always_true_segments" if asked and asked <= claims.convention else None
    if today is None:
        if wanted:
            note("primary", "none_today_issuer_requested", security, None, f"requested {shown}", detail, flag)
    elif today in wanted:
        if len(countries) > 1:
            note("primary", "co_primary_requested_in_several_countries", security, today, f"requested {shown}", detail, flag)
    elif today in firds_venues or venues.country(today) in EEA:
        category = "contradicted_issuer_requested_another" if wanted else "no_issuer_request_on_any_eea_venue"
        note("primary", category, security, today, f"requested {shown}", detail, flag)
    else:  # a primary outside FIRDS' coverage (LSE, SIX, a US exchange): FIRDS can only say what the issuer sought in the EEA
        category = "outside_eea_while_issuer_requested_eea" if wanted else "outside_eea_no_eea_request"
        note("primary", category, security, today, f"requested {shown}", detail, flag)


def _text(value) -> str | None:
    if value is None:
        return None
    return ",".join(value) if isinstance(value, list) else str(value)


def report(store, snap: Snapshot, venues: dict[str, Venue], as_of: str, fingerprint: dict, previous: dict | None) -> dict:
    """Quirks, the shadow comparison and drift alarms, stored in the claims file; returns them for the manifest."""
    claims, index = load(store.db), Venues(venues)
    rows, summary = compare(claims, snap, index, as_of)
    store.diff(rows)
    alarms = drift.compare(previous, fingerprint, READ_PATHS)
    found = {"claims": store.count(), "quirks": quirks(claims, index, as_of), "diff": summary, "alarms": alarms,
             "metrics": fingerprint.get("metrics", {}),
             "fingerprint": {key: value for key, value in fingerprint.items() if key != "examples"}}
    store.put("reports", SOURCE, found)
    return found


def format_section(claims_path, reference_name: str) -> tuple[list[str], bool]:
    """The audit's FIRDS section, read from the claims file beside a snapshot, and whether drift broke the source."""
    found = stored(claims_path, "reports", SOURCE)
    if found is None:
        return [f"FIRDS: no claims file beside {reference_name} (built before claims, or by another builder)"], False
    previous = previous_claims(claims_path)
    before = stored(previous, "fingerprints", SOURCE)
    alarms = drift.compare(before, stored(claims_path, "fingerprints", SOURCE) or {}, READ_PATHS)
    lines = [f"FIRDS claims ({found['claims']} in {claims_path.name}); shadow mode: the snapshot is unchanged",
             *drift.format_alarms(alarms, previous.name if before else None), "  odd cases:"]
    for name, item in found["quirks"].items():
        if "count" in item:
            lines.append(f"    {item['count']:>7}  {name}" + (f" ({item['isins']} ISINs)" if "isins" in item else "")
                         + (f": {'; '.join(item['examples'][:3])[:110]}" if item["examples"] else ""))
    lines.append("  field 8 (issuer requested) per segment, largest, true/false/missing: " + "; ".join(
        f"{mic} {true}/{false}/{missing}" for mic, true, false, missing in found["quirks"]["issuer_requested_by_venue"][:12]))
    lines.append("  today's decisions against FIRDS claims (live share/dr/etf, all; category -> what claims would write):")
    for name in ("issuer", "primary", "currency", "receipt_underlying"):
        for category, item in found["diff"][name].items():
            kinds = "/".join(str(item.get(f"live_{k}", 0)) for k in ("share", "dr", "etf"))
            outcome = item["outcome"] + (f" + {item['question']} question" if item.get("question") else "")
            if item.get("requested_only_on_always_true_segments"):
                outcome += f" ({item['requested_only_on_always_true_segments']} requested only on always-true segments)"
            lines.append(f"    {name:<19}{kinds:>17}{item['count']:>8}  {category} -> {outcome}: {item['examples'][0][:70]}")
    lines.append("  lines whose trading currency is FIRDS' notional currency, by venue country: "
                 + ", ".join(f"{pair} {n}" for pair, n in found["diff"]["currency_by_venue_country"]))
    return lines, bool(breaks(alarms))


def breaks(alarms: list[dict]) -> list[dict]:
    return [a for a in alarms if a["severity"] == "break"]
