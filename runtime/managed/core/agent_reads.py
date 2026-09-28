"""pythia_prices and pythia_filings: core reads of one concept from the first source that serves the subject.

The first usable source in the investor's order is read; a named `source` reads only that one. Nothing falls back:
a failure names the alternatives, and every result lists the sources skipped with their reasons.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

from .agent_tools import (SOURCE, SUBJECT, choose, concept_sources, encode, failure, label, logger, plugins, run_tool,
                          source_key, unknown_source)
from .identity.page import Section
from .identity.schemes import Level

MARKET_DATA_TOOL = "pythia_market_data"  # the market-data feature's own (hidden) read backend
PRICES = {
    "name": "pythia_prices",
    "description": "Price of a stock, fund or crypto: quote, history, returns. The latest quote or price history for a "
                   "listing, security or crypto asset from the investor's connected market-data sources, with the "
                   "source, as-of time and delay. Without start it returns the latest "
                   "quote; with start (and optional end) it returns daily bars, or intraday bars with interval, plus a "
                   "summary with the first and last close and the percentage change over the returned bars. For a "
                   "period's return (1D to 5Y) pass period, which gives the same number every time. "
                   "For a company (issuer) it reads the primary listing.",
    "parameters": {"type": "object", "properties": {
        "subject_id": SUBJECT,
        "start": {"type": "string", "format": "date", "description": "First date (YYYY-MM-DD) for history."},
        "end": {"type": "string", "format": "date", "description": "Last date (YYYY-MM-DD); default today."},
        "interval": {"type": "string", "enum": ["1d", "1h", "30m", "5m", "1m"], "description": "Bar size; default 1d."},
        "period": {"type": "string", "enum": ["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y"],
                   "description": "Return over a standard period instead of start/end: from the close before the "
                                  "period's start to the latest close, the rule the Desk chart uses."},
        "points": {"type": "integer", "minimum": 0, "maximum": 400,
                   "description": "How many of the most recent bars to list (default 10); the summary covers all."},
        "source": SOURCE},
        "required": ["subject_id"], "additionalProperties": False},
}
FILINGS = {
    "name": "pythia_filings",
    "description": "Company filings: annual report, 10-K, 20-F, ESEF. Regulatory filings of a company, newest first, "
                   "from one connected source per filing authority "
                   "(SEC EDGAR; ESEF reports on filings.xbrl.org), with form, filing date, period end, document link "
                   "and source. Filter by form (10-K, 20-F, AFR…) and date. Pass any subject of the company. For "
                   "reported numbers inside a filing, run `pythia help` and use that source's facts or fundamentals.",
    "parameters": {"type": "object", "properties": {
        "subject_id": SUBJECT,
        "forms": {"type": "array", "maxItems": 8, "items": {"type": "string", "minLength": 1, "maxLength": 16},
                  "description": "Only these forms; an amendment (10-K/A) matches its form."},
        "since": {"type": "string", "format": "date", "description": "Only filings filed or ending on or after this date."},
        "limit": {"type": "integer", "minimum": 1, "maximum": 50},
        "source": SOURCE},
        "required": ["subject_id"], "additionalProperties": False},
}
PERIODS = ("1D", "5D", "1M", "6M", "YTD", "1Y", "5Y")
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


def _months_back(today: date, months: int) -> date:
    """The same day `months` earlier, rolling over as the Desk chart's Date.UTC does (31 Mar - 1M = 3 Mar)."""
    year, month = divmod(today.year * 12 + today.month - 1 - months, 12)
    return date(year, month + 1, 1) + timedelta(days=today.day - 1)


def period_start(period: str, today: date) -> date | None:
    """The first day of a chart period (packages/market-data chart-plan `periodStart`); 5D counts bars instead."""
    months = {"1M": 1, "6M": 6, "1Y": 12, "5Y": 60}
    if period == "YTD":
        return date(today.year, 1, 1)
    return _months_back(today, months[period]) if period in months else None


def _period_return(period: str, observations: list, start: date | None) -> dict | None:
    """From the close before the period's start (5D: five bars back) to the latest close."""
    closes = [(item.get("time", {}).get("value"), _number(item.get("close", item.get("value"))))
              for item in observations]
    closes = [(when, value) for when, value in closes if isinstance(when, str) and value is not None]
    if start is None:
        base = closes[-6] if len(closes) >= 6 else None
    else:
        base = next((row for row in reversed(closes) if row[0][:10] < start.isoformat()), None)
    if base is None or not base[1] or len(closes) < 2:
        return None
    last = closes[-1]
    return {"period": period, "from": {"t": base[0], "close": str(base[1])}, "to": {"t": last[0], "close": str(last[1])},
            "change_pct": str(((last[1] - base[1]) / base[1] * 100).quantize(Decimal("0.01"))),
            "basis": "close before the period's start to the latest close"}


def _unit(series: dict | None) -> dict:
    fields = (series or {}).get("fields", {})
    field = fields.get("value") or fields.get("close") or {}
    unit, adjustment = field.get("unit", {}), field.get("adjustment", {}).get("kind")
    return {key: value for key, value in (("currency", unit.get("code")), ("adjustment", adjustment)) if value}


def prices(ctx: Any, arguments: dict, **context: Any) -> str:
    subject_id, wanted = str(arguments.get("subject_id") or ""), arguments.get("source")
    start, end = arguments.get("start"), arguments.get("end")
    interval, period = arguments.get("interval") or "1d", arguments.get("period")
    if interval not in INTERVALS or (end and not start):
        return encode(failure("invalid_request", "interval must be one of 1d, 1h, 30m, 5m, 1m; end needs start."))
    if period is not None and (period not in PERIODS or start or end or interval != "1d"):
        return encode(failure("invalid_request", f"period is one of {', '.join(PERIODS)} and replaces start, end "
                                                 "and interval."))
    anchor = None
    if period and period != "1D":  # daily closes from before the period's start; 5D needs six bars
        today = datetime.now(timezone.utc).date()
        anchor = period_start(period, today)
        start = ((anchor or today) - timedelta(days=14)).isoformat()
    try:
        for value in (start, end):
            if value:
                date.fromisoformat(value)
    except (TypeError, ValueError):
        return encode(failure("invalid_request", "start and end are dates written YYYY-MM-DD."))
    operation = "history" if start else "latest"
    try:
        infos = plugins()
        if wanted is not None and (wanted := source_key(wanted, infos)) is None:
            return encode(unknown_source(arguments.get("source"), infos))
        subject, ready, skipped, issue = concept_sources(subject_id, Section.CHART if start else Section.QUOTE, wanted,
                                                         infos)
    except (sqlite3.Error, OSError, RuntimeError):
        logger.warning("identity unavailable for pythia_prices", exc_info=True)
        return encode(failure("unavailable", "Pythia's reference data could not be read."))
    if subject is None:
        return encode(failure("unknown_subject", issue))
    chosen, error = choose(ready, skipped, wanted, "prices", infos)
    if error:
        return encode(error)
    target = subject["id"]
    if subject["level"] is Level.ISSUER:  # a company has no price: read its primary listing, as its page does
        target = subject["ids"].get(Level.LISTING)
        if not target:
            return encode(failure("no_listing", "This issuer has no listing in the reference; it has no price."))
    view_subject = chosen["binding"]  # read exactly the source core chose (or the one named), so the label is true
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
    source = {**label(chosen["plugin"], infos), "as_of": (result.get("freshness") or {}).get("as_of") or provenance.get("source_time"),
              "retrieved_at": result.get("retrieved_at"),
              "market_data_type": (result.get("freshness") or {}).get("market_data_type"),
              "selected": "named" if wanted else "first in order"}
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
        if period == "1D":
            out["period_return"] = {"period": "1D", "change_pct": (context_fields.get("change") or {}).get("percent"),
                                    "basis": "the source's change against the previous close"}
    elif period:
        out["period_return"] = _period_return(period, observations, anchor)
        if out["period_return"] is None:
            out["issues"] = [{"code": "no_period_base", "severity": "warning",
                              "message": f"The source's daily history does not reach back to the start of {period}."}]
    else:
        out["summary"] = _summary(observations)
        out["bars"] = [_bar(item) for item in observations[-points:]] if points else []
        coverage = result.get("coverage") or {}
        if coverage.get("status") not in (None, "complete") or coverage.get("gaps"):
            out["coverage"] = {key: coverage.get(key) for key in ("status", "gaps", "truncated")}
    out["alternatives"] = [label(answer["plugin"], infos) for answer in ready if answer is not chosen]
    out["skipped"] = skipped
    out["issues"] = [*out.get("issues", []), *result.get("issues", [])]
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
    """A thin front end over core's combined filings read: this tool adds the form/date filter and the bound."""
    from . import concept_ops
    subject_id, wanted = str(arguments.get("subject_id") or ""), arguments.get("source")
    forms = {str(item).upper() for item in arguments.get("forms") or []}
    since, limit = arguments.get("since"), max(1, min(int(arguments.get("limit") or 20), 50))
    infos = plugins()
    use = source_key(wanted, infos) if wanted is not None else None
    if wanted is not None and use is None:
        return encode(unknown_source(wanted, infos))
    if concept_ops.CURRENT is None:
        return encode(failure("unavailable", "Pythia's filings read is not loaded."))
    result = json.loads(concept_ops.CURRENT.filings({"subject_id": subject_id, **({"use": use} if use else {})}))
    data = result.get("data")
    if not isinstance(data, dict) or not isinstance(data.get("filings"), list):
        return encode(result)
    rows = [row for row in data["filings"] if isinstance(row, dict)]
    matched = [row for row in rows if _matches(row, forms, since)]
    keep = ("form", "filed_at", "period_end", "title", "url", "id", "authority", "source")
    outcome = result.get("outcome", "error")
    out = {"schema_version": 1, "outcome": "empty" if rows and not matched else outcome,
           "subject_id": data.get("subject_id", subject_id), "sources": data.get("sources", []),
           "filings": [{key: row[key] for key in keep if row.get(key) is not None} for row in matched[:limit]],
           "coverage": {"matched": len(matched), "scanned": len(rows)}, "partial": bool(data.get("partial")),
           "alternatives": data.get("alternatives", []), "skipped": data.get("skipped", []),
           "issues": result.get("issues", [])}
    out["next"] = ("Only the most recent filings of each source were searched; a named source (source) may list "
                   "others." if rows and not matched else
                   "Read a document through its url with web_extract; `pythia help` lists reported facts by source.")
    return encode(out)
