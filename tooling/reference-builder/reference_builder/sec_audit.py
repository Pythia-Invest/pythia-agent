"""SEC onboarding audit (`just reference-sec-audit`): draw the sample, fetch its evidence, label it.

The audit behind docs/sources/sec.md, section 3, as three steps over one cache
(`.local/reference-builder/sec-audit/raw/`, never committed):

- `fetch` (network) downloads the ticker files, EDGAR's quarterly `form.idx`, each sample filer's `submissions`
  and `companyfacts`, and for its latest annual report, latest 10-Q and three random filings the EDGAR
  submission header, and for periodic reports the XBRL instance. With `--current-feed` it also reads SEC's
  current feed and the submissions of its filers: same-day acceptance times can only be checked on the day.
- `draw` repeats the stratified draw from the cache and compares it with the committed sample.
- `label` compares every SEC field the audit covers with its primary source (the submission header, the filing's
  own XBRL instance, the current feed's offsets) and prints the counts with Wilson 95% bounds. With
  `--reference <snapshot>` it also labels the builder's CIK to LEI links against GLEIF, the LEI's registry.

`draw` and `label` make no request. Requests are paced under five a second with the User-Agent built from the
configured `sec_identity`, which is never printed.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import re
import sqlite3
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from .config import USER_AGENT, WORK_DIR, load_sec_identity, sec_user_agent
from .sec_evidence import PERIODIC, Fetcher, companyfacts, evidence, header, instance, submissions
from .sec_probe import SAMPLE, plugin

CACHE = WORK_DIR / "sec-audit" / "raw"
QUARTERS = ("2025_QTR3", "2025_QTR4", "2026_QTR1", "2026_QTR2", "2026_QTR3")
ANNUAL = ("10-K", "20-F", "40-F")
NAMED = [937966, 1039765, 1306965, 1094517, 1067983, 320193]  # ASML, ING, Shell, Toyota, Berkshire, Apple
EASTERN = ZoneInfo("America/New_York")


# The draw -----------------------------------------------------------------------------------------------------------

def draw(fetch: Fetcher, seed: int) -> dict[str, list[int]]:
    """The stratified draw of the committed sample (its `method`), from the ticker file and `form.idx`."""
    rows = json.loads(fetch.get("https://www.sec.gov/files/company_tickers_exchange.json", "company_tickers_exchange.json"))["data"]
    exchanges: dict[int, set] = defaultdict(set)
    for cik, _name, _ticker, exchange in rows:
        exchanges[cik].add(exchange)
    forms: dict[int, set] = defaultdict(set)
    for quarter in QUARTERS:
        index = fetch.get(f"https://www.sec.gov/Archives/edgar/full-index/{quarter.replace('_', '/')}/form.idx", f"form_{quarter}.idx")
        for line in index.decode("latin-1").splitlines():
            found = re.match(r"(\S.*?)\s{2,}.*?\s(\d{1,10})\s+(\d{4}-\d{2}-\d{2})\s+edgar/", line)
            if found and int(found.group(2)) in exchanges:
                forms[int(found.group(2))].add(found.group(1).strip())
    listed = lambda cik: exchanges[cik] & {"Nasdaq", "NYSE"}  # noqa: E731
    pool = {
        "20f_listed": sorted(c for c in exchanges if "20-F" in forms[c] and listed(c)),
        "20f_otc": sorted(c for c in exchanges if "20-F" in forms[c] and exchanges[c] == {"OTC"}),
        "40f": sorted(c for c in exchanges if "40-F" in forms[c]),
        "ipo": sorted(c for c in exchanges if "424B4" in forms[c] and listed(c) and forms[c] & {"S-1", "F-1", "S-1/A", "F-1/A"}),
        "10k": sorted(c for c in exchanges if "10-K" in forms[c]),
    }
    rng = random.Random(seed)
    strata = {"20f_listed": rng.sample(pool["20f_listed"], 8), "20f_otc": rng.sample(pool["20f_otc"], 2),
              "40f": rng.sample(pool["40f"], 6)}
    rng.sample(pool["ipo"], 6)  # the first draw of this stratum, kept so the 10-K strata stay the same
    operating, spacs = [], []
    for cik in random.Random(seed).sample(pool["ipo"], len(pool["ipo"])):
        recent = submissions(fetch, cik)
        if recent["filings"].get("files") or min(recent["filings"]["recent"]["filingDate"]) < "2025-01-01":
            continue  # an older registrant: a follow-on offering, not an IPO
        (spacs if recent.get("sic") == "6770" else operating).append(cik)
        if len(operating) >= 3 and len(spacs) >= 3:
            break
    strata["ipo"] = operating[:3] + spacs[:3]
    large, small, used = [], [], set(sum(strata.values(), []))
    for cik in rng.sample(pool["10k"], 60):
        if cik in used:
            continue
        category = submissions(fetch, cik).get("category") or ""
        if "Large accelerated" in category or ("Accelerated filer" in category and "Non" not in category):
            large += [cik] if len(large) < 10 else []
        elif len(small) < 10:
            small.append(cik)
        if len(large) == 10 and len(small) == 10:
            break
    strata["10k_accelerated"], strata["10k_small"], strata["named"] = large, small, NAMED
    return strata


# Labelling ----------------------------------------------------------------------------------------------------------

def wilson(hits: int, total: int, z: float = 1.96) -> str:
    if not total:
        return "n/a"
    p, d = hits / total, 1 + z * z / total
    centre, half = (p + z * z / (2 * total)) / d, z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / d
    return f"{100 * hits / total:.1f}% ({100 * (centre - half):.2f}–{100 * min(1.0, centre + half):.2f}%)"


def label(fetch: Fetcher, strata: dict[str, list[int]], read_at: str) -> Counter:
    """Counts of agreement between each audited SEC field and its primary source."""
    financials, filings = plugin("financials"), plugin("filings")
    read_eastern = financials.eastern(read_at)
    tickers = defaultdict(list)
    for cik, _name, ticker, exchange in json.loads(fetch.get("", "company_tickers_exchange.json"))["data"]:
        tickers[cik].append((ticker, exchange))
    operating = {"NASDAQ": "XNAS", "NYSE": "XNYS", "NYSEAMER": "XNYS", "NYSEArca": "XNYS", "CboeBZX": "XCBO"}
    sec_mics = {"Nasdaq": "XNAS", "NYSE": "XNYS", "CBOE": "XCBO"}
    count = Counter()
    for cik in (cik for ciks in strata.values() for cik in ciks):
        filer, facts = submissions(fetch, cik), companyfacts(fetch, cik)
        recent = filer["filings"]["recent"]
        position = {accession: i for i, accession in enumerate(recent["accessionNumber"])}
        count["ticker_file_equals_submissions"] += sorted(tickers[cik]) == sorted(zip(filer["tickers"], filer["exchanges"]))
        count["filers"] += 1
        state = financials.freshness(filer, facts, cik, read_at) if facts else None
        count[f"freshness_{state['status'] if state else 'none'}"] += 1
        cover_done = False
        for form, accession, xbrl in evidence(fetch, cik):
            i, head = position[accession], header(fetch, cik, accession)
            if head and head["accepted"]:
                count["headers"] += 1
                count["form_ok"] += head["type"] == recent["form"][i]
                count["filing_date_ok"] += head["filed"] == recent["filingDate"][i].replace("-", "")
                count["report_date_ok"] += (head["period"] or "") == (recent["reportDate"][i] or "").replace("-", "")
                truth = datetime.strptime(head["accepted"], "%Y%m%d%H%M%S").replace(tzinfo=EASTERN).astimezone(timezone.utc)
                read = financials.accepted_utc(recent["acceptanceDateTime"][i], recent["filingDate"][i], read_eastern)
                count["accepted_ok"] += read == truth.strftime("%Y-%m-%dT%H:%M:%SZ")
            if form not in PERIODIC or not xbrl:
                continue
            filed = instance(fetch, cik, accession)
            if filed is None:
                continue
            count["instances"] += 1
            dei = {f["concept"]: f["text"] for f in filed if f["taxonomy"] == "dei" and not f["dims"]}
            count["cik_ok"] += int(dei.get("EntityCentralIndexKey") or 0) == cik
            rows = [(taxonomy, concept, unit, row) for taxonomy, concepts in (facts or {}).get("facts", {}).items()
                    for concept, item in concepts.items() for unit, values in item["units"].items() for row in values
                    if row["accn"] == accession]
            focus = Counter((row.get("fy"), row.get("fp")) for *_, row in rows).most_common(1)
            count["fiscal_focus_ok"] += bool(focus) and str(focus[0][0][0]) == dei.get("DocumentFiscalYearFocus") and focus[0][0][1] == dei.get("DocumentFiscalPeriodFocus")
            values = defaultdict(set)
            for fact in filed:
                if fact["taxonomy"] != "ext" and not fact["dims"] and not fact["nil"] and fact["unit"]:
                    try:
                        values[(fact["taxonomy"], fact["concept"], fact["start"], fact["end"])].add(float(fact["text"]))
                    except ValueError:
                        pass
            one_day = {(f["taxonomy"], f["concept"], f["end"]) for f in filed if f["start"] and f["start"] == f["end"]}
            for taxonomy, concept, _unit, row in rows:
                found = values.get((taxonomy, concept, row.get("start"), row["end"]))
                if found is None:
                    count["facts_one_day_as_instant" if (taxonomy, concept, row["end"]) in one_day else "facts_not_in_instance"] += 1
                else:
                    count["facts_ok" if any(abs(v - row["val"]) <= abs(v) * 1e-12 for v in found) else "facts_differ"] += 1
            if not cover_done:  # the latest annual cover, else the latest 10-Q's: tickers and exchanges as filed
                cover_done = True
                lines = defaultdict(dict)
                for fact in filed:
                    if fact["taxonomy"] == "dei" and fact["concept"] in ("TradingSymbol", "SecurityExchangeName"):
                        lines[fact["context"]][fact["concept"]] = fact["text"]
                cover = [(re.sub(r"[^A-Z0-9]", "", (v.get("TradingSymbol") or "").upper()), v.get("SecurityExchangeName"))
                         for v in lines.values() if v.get("TradingSymbol")]
                for ticker, exchange in tickers[cik]:
                    if exchange not in sec_mics:
                        continue
                    same = [e for t, e in cover if t == re.sub(r"[^A-Z0-9]", "", ticker)]
                    root = [e for t, e in cover if t.startswith(ticker.split("-")[0])]
                    count["cover_lines"] += 1
                    count["cover_ticker_same" if same else "cover_ticker_spelled_otherwise" if root else "cover_ticker_absent"] += 1
                    if same or root:
                        count["cover_exchange_lines"] += 1
                        count["cover_exchange_ok"] += operating.get((same or root)[0]) == sec_mics[exchange]
        if facts:
            try:
                rows = financials.fundamentals(facts, cik, read_at, limit=50)["facts"]
            except ValueError:
                rows = []
            for row in rows:
                filed = instance(fetch, cik, row["accession"])
                if filed is None:
                    count["fundamentals_unchecked"] += 1
                    continue
                period = row["period"]
                found = {float(f["text"]) for f in filed if f["taxonomy"] == row["taxonomy"] and f["concept"] == row["concept"]
                         and not f["dims"] and not f["nil"] and f["end"] == period["end"] and f["start"] == period.get("start")}
                count["fundamentals"] += 1
                count["fundamentals_ok"] += any(abs(v - float(row["value"])) <= max(1.0, abs(v)) * 1e-9 for v in found)
    for cik in (cik for ciks in strata.values() for cik in ciks):  # what the plugin's filings read flags as drift
        for kind, values in (filings.filings(submissions(fetch, cik), cik, read_at, limit=10_000).get("drift") or {}).items():
            count[f"plugin_drift_{kind}"] += sum(values.values())
    return count


def same_day(fetch: Fetcher) -> Counter:
    """Filings of the current feeds cached by `fetch --current-feed`: the submissions value against the feed's offset."""
    count = Counter()
    for feed in sorted(fetch.cache.glob("current_*.atom")):
        stamp = feed.stem.split("_")[1]
        for link, updated in re.findall(r"<link[^>]*href=\"([^\"]+)\".*?<updated>(.*?)</updated>", feed.read_text(), re.S):
            found = re.search(r"/data/(\d+)/(\d{18})/", link)
            path = fetch.cache / f"today_sub_{found.group(1)}_{stamp}.json" if found else None
            if not path or not path.exists():
                continue
            recent = json.loads(path.read_text())["filings"]["recent"]
            accession = f"{found.group(2)[:10]}-{found.group(2)[10:12]}-{found.group(2)[12:]}"
            if accession in recent["accessionNumber"]:
                value = recent["acceptanceDateTime"][recent["accessionNumber"].index(accession)]
                count["same_day"] += 1
                count["same_day_eastern_labelled_z"] += value[:19] == updated[:19]
    return count


def links(reference: Path, fetch: Fetcher, gleif: Fetcher, strata: dict[str, list[int]]) -> Counter:
    """The builder's CIK to LEI links for the sample, against GLEIF: the LEI's legal name and jurisdiction, printed
    for a reader to judge, with the rule that made each link."""
    database = sqlite3.connect(f"file:{reference}?mode=ro", uri=True)
    count = Counter()
    for cik in (cik for ciks in strata.values() for cik in ciks):
        for subject, rule in database.execute("SELECT subject_id, source_record FROM assertions WHERE scheme = 'cik' AND value = ?",
                                              (f"{cik:010d}",)):
            if not subject.startswith("issuer:lei:"):
                continue
            lei = subject.removeprefix("issuer:lei:")
            record = gleif.json(f"https://api.gleif.org/api/v1/lei-records/{lei}", f"lei_{lei}.json")
            entity = (record or {}).get("data", {}).get("attributes", {}).get("entity", {})
            name = submissions(fetch, cik)["name"]
            print(f"  cik {cik} {name!r} -> {lei} {entity.get('legalName', {}).get('name')!r} ({entity.get('jurisdiction')}) by {rule}")
            count["links"] += 1
    return count


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    parser.add_argument("step", choices=("fetch", "draw", "label"))
    parser.add_argument("--cache", type=Path, default=CACHE)
    parser.add_argument("--sample", type=Path, default=SAMPLE)
    parser.add_argument("--current-feed", action="store_true", help="fetch: also read today's current feed")
    parser.add_argument("--read-at", help="label: when submissions were read (ISO, UTC); default the cache time")
    parser.add_argument("--reference", type=Path, help="label: a reference snapshot whose CIK to LEI links to label")
    args = parser.parse_args(argv)
    sample = json.loads(args.sample.read_text(encoding="utf-8"))
    strata = {name: [entry["cik"] for entry in entries] for name, entries in sample["strata"].items()}
    agent = sec_user_agent(load_sec_identity()) if args.step == "fetch" else None
    if args.step == "fetch" and agent is None:
        print("SEC requires a name and email in the User-Agent: set `sec_identity` in <config>/pythia/settings.json.")
        return 2
    fetch = Fetcher(args.cache, agent)
    try:
        if args.step == "fetch":
            fetch.get("https://www.sec.gov/files/company_tickers_exchange.json", "company_tickers_exchange.json")
            if draw(fetch, sample["seed"]) != strata:
                print("note: today's files draw a different sample; the committed one is fetched")
            for cik in (cik for ciks in strata.values() for cik in ciks):
                companyfacts(fetch, cik)
                for form, accession, xbrl in evidence(fetch, cik):
                    header(fetch, cik, accession)
                    if form in PERIODIC and xbrl:
                        instance(fetch, cik, accession)
                for row in financials_rows(fetch, cik):
                    instance(fetch, cik, row["accession"])
            if args.current_feed:
                stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M")
                feed = fetch.get("https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&output=atom&count=100",
                                 f"current_{stamp}.atom").decode()
                for cik in list(dict.fromkeys(int(c) for c in re.findall(r"/data/(\d+)/\d{18}/", feed)))[:12]:
                    fetch.json(f"https://data.sec.gov/submissions/CIK{cik:010d}.json", f"today_sub_{cik}_{stamp}.json")
            return 0
        if args.step == "draw":
            drawn = draw(fetch, sample["seed"])
            for name, ciks in strata.items():
                print(f"{name}: {'same' if drawn.get(name) == ciks else f'differs: {drawn.get(name)}'}")
            return 0 if drawn == strata else 1
        read_at = args.read_at or datetime.fromtimestamp((args.cache / f"sub_{NAMED[-1]}.json").stat().st_mtime, timezone.utc).isoformat()
        counts = label(fetch, strata, read_at) + same_day(fetch)
        pairs = [("form", "form_ok", "headers"), ("filingDate", "filing_date_ok", "headers"),
                 ("reportDate", "report_date_ok", "headers"), ("acceptanceDateTime read by the plugin", "accepted_ok", "headers"),
                 ("same-day acceptance time is Eastern labelled Z", "same_day_eastern_labelled_z", "same_day"),
                 ("CIK against dei", "cik_ok", "instances"), ("fy/fp against the dei focus", "fiscal_focus_ok", "instances"),
                 ("ticker file equals submissions", "ticker_file_equals_submissions", "filers"),
                 ("ticker file ticker on the cover (same spelling)", "cover_ticker_same", "cover_lines"),
                 ("ticker file exchange: cover operating MIC", "cover_exchange_ok", "cover_exchange_lines"),
                 ("plugin fundamentals against the instance", "fundamentals_ok", "fundamentals")]
        for text, hits, total in pairs:
            print(f"{text:<50} {counts[hits]:>6}/{counts[total]:<6} {wilson(counts[hits], counts[total])}")
        facts = counts["facts_ok"] + counts["facts_differ"]
        print(f"{'companyfacts rows against the instance':<50} {counts['facts_ok']:>6}/{facts:<6} {wilson(counts['facts_ok'], facts)}")
        print("other counts: " + ", ".join(f"{k} {v}" for k, v in sorted(counts.items()) if not k.endswith("_ok")))
        if args.reference:
            links(args.reference, fetch, Fetcher(args.cache.parent / "gleif", USER_AGENT), strata)
        return 0
    except LookupError as error:
        print(error)
        return 2


def financials_rows(fetch: Fetcher, cik: int) -> list[dict]:
    facts = companyfacts(fetch, cik)
    if not facts:
        return []
    try:
        return plugin("financials").fundamentals(facts, cik, datetime.now(timezone.utc).isoformat(), limit=50)["facts"]
    except ValueError:
        return []


if __name__ == "__main__":
    sys.exit(main())
