"""pythia_prices and pythia_filings: core reads of one concept from the first source that serves the subject.

The first usable source in the investor's order is read; a named `source` reads only that one. Nothing falls back:
a failure names the alternatives, and every result lists the sources skipped with their reasons.
"""
from __future__ import annotations

import sqlite3
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

from . import identity_ops
from .agent_tools import SOURCE, SUBJECT, choose, concept_sources, encode, failure, label, logger, run_tool
from .identity.manifest import Section
from .identity.schemes import Level

MARKET_DATA_TOOL = "pythia_market_data"  # the market-data feature's own (hidden) read backend
PRICES = {
    "name": "pythia_prices",
    "description": "Latest quote or price history for a listing, security or crypto asset from the investor's connected "
                   "market-data sources, with the source, as-of time and delay. Without start it returns the latest "
                   "quote; with start (and optional end) it returns daily bars, or intraday bars with interval, plus a "
                   "summary with the first and last close and the percentage change over the returned bars. "
                   "For a company (issuer) it reads the primary listing.",
    "parameters": {"type": "object", "properties": {
        "subject_id": SUBJECT,
        "start": {"type": "string", "format": "date", "description": "First date (YYYY-MM-DD) for history."},
        "end": {"type": "string", "format": "date", "description": "Last date (YYYY-MM-DD); default today."},
        "interval": {"type": "string", "enum": ["1d", "1h", "30m", "5m", "1m"], "description": "Bar size; default 1d."},
        "points": {"type": "integer", "minimum": 0, "maximum": 400,
                   "description": "How many of the most recent bars to list (default 10); the summary covers all."},
        "source": SOURCE},
        "required": ["subject_id"], "additionalProperties": False},
}
FILINGS = {
    "name": "pythia_filings",
    "description": "Regulatory filings of a company from its filings source (ESEF reports on filings.xbrl.org, SEC EDGAR), "
                   "newest first, with form, filing date, period end and document link. Filter by form (10-K, 20-F, "
                   "AFR…) and date. Pass any subject of the company. For reported numbers inside a filing, run "
                   "`pythia help` and use that source's facts or fundamentals.",
    "parameters": {"type": "object", "properties": {
        "subject_id": SUBJECT,
        "forms": {"type": "array", "maxItems": 8, "items": {"type": "string", "minLength": 1, "maxLength": 16},
                  "description": "Only these forms; an amendment (10-K/A) matches its form."},
        "since": {"type": "string", "format": "date", "description": "Only filings filed or ending on or after this date."},
        "limit": {"type": "integer", "minimum": 1, "maximum": 50},
        "source": SOURCE},
        "required": ["subject_id"], "additionalProperties": False},
}
INTERVALS = {"1d": {"kind": "day", "count": 1}, "1h": {"kind": "hour", "count": 1},
             "30m": {"kind": "minute", "count": 30}, "5m": {"kind": "minute", "count": 5},
             "1m": {"kind": "minute", "count": 1}}
RETRY_CRITERIA = {"incompatible_series", "ambiguous_series"}


# ---- pythia_prices -------------------------------------------------------------------------------------------------

def _number(value: Any) -> Decimal | None:
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def _bar(observation: dict) -> dict:
    time = observation.get("time", {})
    row = {"t": time.get("value")}
    for key in ("open", "high", "low", "close", "volume", "value"):
        if key in observation:
            row[key[0] if key != "value" else "v"] = observation[key]
    return row


def _summary(observations: list) -> dict | None:
    closes = [(item.get("time", {}).get("value"), _number(item.get("close", item.get("value"))))
              for item in observations]
    closes = [(when, value) for when, value in closes if value is not None]
    if not closes:
        return None
    (first_at, first), (last_at, last) = closes[0], closes[-1]
    highs = [value for item in observations if (value := _number(item.get("high", item.get("value")))) is not None]
    lows = [value for item in observations if (value := _number(item.get("low", item.get("value")))) is not None]
    summary = {"first": {"t": first_at, "close": str(first)}, "last": {"t": last_at, "close": str(last)},
               "bars": len(observations), "high": str(max(highs)) if highs else None,
               "low": str(min(lows)) if lows else None}
    if first:
        summary["change_pct"] = str(((last - first) / first * 100).quantize(Decimal("0.01")))
    return summary


def _unit(series: dict | None) -> dict:
    fields = (series or {}).get("fields", {})
    field = fields.get("value") or fields.get("close") or {}
    unit, adjustment = field.get("unit", {}), field.get("adjustment", {}).get("kind")
    return {key: value for key, value in (("currency", unit.get("code")), ("adjustment", adjustment)) if value}


def prices(ctx: Any, arguments: dict, **context: Any) -> str:
    subject_id, wanted = str(arguments.get("subject_id") or ""), arguments.get("source")
    start, end = arguments.get("start"), arguments.get("end")
    interval = arguments.get("interval") or "1d"
    if interval not in INTERVALS or (end and not start):
        return encode(failure("invalid_request", "interval must be one of 1d, 1h, 30m, 5m, 1m; end needs start."))
    try:
        for value in (start, end):
            if value:
                date.fromisoformat(value)
    except (TypeError, ValueError):
        return encode(failure("invalid_request", "start and end are dates written YYYY-MM-DD."))
    operation = "history" if start else "latest"
    try:
        subject, ready, skipped, issue = concept_sources(subject_id, Section.CHART if start else Section.QUOTE, wanted)
    except (sqlite3.Error, OSError, RuntimeError):
        logger.warning("identity unavailable for pythia_prices", exc_info=True)
        return encode(failure("unavailable", "Pythia's reference data could not be read."))
    if subject is None:
        return encode(failure("unknown_subject", issue))
    chosen, error = choose(ready, skipped, wanted, "prices")
    if error:
        return encode(error)
    kind, target = str(subject["level"]), subject["id"]
    if subject["level"] is Level.ISSUER:  # a company has no price: read its primary listing, as its page does
        kind, target = str(Level.LISTING), subject["ids"].get(Level.LISTING)
        if not target:
            return encode(failure("no_listing", "This issuer has no listing in the reference; it has no price."))
    view_subject = chosen["binding"] if wanted else {"kind": kind, "id": target}
    daily = INTERVALS[interval]["kind"] == "day"
    edge = (lambda value, _clock: {"kind": "session_date", "value": value}) if daily else (
        lambda value, clock: {"kind": "instant", "value": f"{value}T{clock}Z"})
    request = {"schema_version": 1, "operation": operation, "view": {"kind": "pythia", "subject": view_subject},
               "window": {"start": edge(start, "00:00:00") if start else None,
                          "end": edge(end, "23:59:59") if end else None},
               "limit": 5000 if start else 1,
               "requirements": {"freshness": "any", "completion": "any", "coverage": "any"}}
    attempts = [{}] if not start else [{"interval": INTERVALS[interval], "measurement": "ohlc"},
                                       {"interval": INTERVALS[interval]}]
    for criteria in attempts:
        result = run_tool(ctx, MARKET_DATA_TOOL, {"action": "read", "request": request, "criteria": criteria}, context)
        codes = {issue.get("code") for issue in result.get("issues", [])}
        if result.get("outcome") != "error" or not codes & RETRY_CRITERIA:
            break
    provenance = result.get("provenance") or {}
    used = provenance.get("provider")
    info = next((answer for answer in ready if label(answer["plugin"])["provider"] == used), chosen)
    source = {**label(info["plugin"]), "as_of": (result.get("freshness") or {}).get("as_of") or provenance.get("source_time"),
              "retrieved_at": result.get("retrieved_at"),
              "market_data_type": (result.get("freshness") or {}).get("market_data_type"),
              "selected": "named" if wanted else "investor order"}
    context_fields = result.get("price_context") or {}
    if "delay_seconds" in context_fields:
        source["delay_seconds"] = context_fields["delay_seconds"]
    observations = result.get("observations") or []
    points = arguments.get("points")
    points = 10 if points is None else max(0, min(int(points), 400))
    out = {"schema_version": 1, "outcome": result.get("outcome", "error"), "subject_id": target, "source": source,
           **_unit(result.get("series"))}
    if operation == "latest":
        out["quote"] = _bar(observations[-1]) if observations else None
        if context_fields.get("change"):
            out["change"] = context_fields["change"]
    else:
        out["summary"] = _summary(observations)
        out["bars"] = [_bar(item) for item in observations[-points:]] if points else []
        coverage = result.get("coverage") or {}
        if coverage.get("status") not in (None, "complete") or coverage.get("gaps"):
            out["coverage"] = {key: coverage.get(key) for key in ("status", "gaps", "truncated")}
    out["alternatives"] = [label(answer["plugin"]) for answer in ready if answer is not info]
    out["skipped"] = skipped
    out["issues"] = result.get("issues", [])
    if out["outcome"] == "error":
        out["next"] = "Name one of the alternatives as source to read it instead, and say that you did."
    return encode(out)


# ---- pythia_filings ------------------------------------------------------------------------------------------------

def _matches(row: dict, forms: set[str], since: str | None) -> bool:
    form = str(row.get("form") or "").upper()
    if forms and not any(form == wanted or form.startswith(wanted + "/") for wanted in forms):
        return False
    when = row.get("filed_at") or row.get("period_end")
    return not since or (isinstance(when, str) and when >= since)


def filings(ctx: Any, arguments: dict, **context: Any) -> str:
    subject_id, wanted = str(arguments.get("subject_id") or ""), arguments.get("source")
    forms = {str(item).upper() for item in arguments.get("forms") or []}
    since, limit = arguments.get("since"), max(1, min(int(arguments.get("limit") or 20), 50))
    try:
        subject, ready, skipped, issue = concept_sources(subject_id, Section.FILINGS, wanted)
    except (sqlite3.Error, OSError, RuntimeError):
        logger.warning("identity unavailable for pythia_filings", exc_info=True)
        return encode(failure("unavailable", "Pythia's reference data could not be read."))
    if subject is None:
        return encode(failure("unknown_subject", issue))
    chosen, error = choose(ready, skipped, wanted, "filings")
    if error:
        return encode(error)
    info = next(item for item in identity_ops.installed() if item.key == chosen["plugin"])
    result = run_tool(ctx, info.manifest.content[Section.FILINGS].tool, {"native_ref": chosen["binding"], "limit": 50}, context)
    data = result.get("data") if isinstance(result.get("data"), dict) else {}
    rows = [row for row in data.get("filings", []) if isinstance(row, dict)]
    matched = [row for row in rows if _matches(row, forms, since)]
    matched.sort(key=lambda row: row.get("filed_at") or row.get("period_end") or "", reverse=True)
    keep = ("form", "filed_at", "period_end", "title", "url", "accession", "report_id", "machine_readable")
    coverage = data.get("coverage") or {}
    out = {"schema_version": 1, "outcome": result.get("outcome", "error") if not rows else ("ok" if matched else "empty"),
           "subject_id": subject["id"],
           "source": {**label(chosen["plugin"]), "observed_at": data.get("observed_at"), "url": data.get("source_url")},
           "filings": [{key: row[key] for key in keep if row.get(key) is not None} for row in matched[:limit]],
           "coverage": {"matched": len(matched), "scanned": len(rows), "available": coverage.get("total_available"),
                        "scope": coverage.get("scope")},
           "alternatives": [label(answer["plugin"]) for answer in ready if answer is not chosen],
           "skipped": skipped, "issues": result.get("issues", [])}
    if rows and not matched and (coverage.get("total_available") or 0) > len(rows):
        out["next"] = (f"Only the {len(rows)} most recent filings were searched. Another source may list older ones; "
                       "name it as source to read it.")
    else:
        out["next"] = "Read a document through its url with web_extract; `pythia help` lists reported facts by source."
    return encode(out)
