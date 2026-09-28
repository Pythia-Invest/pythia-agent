"""The `live_market` snapshot, schema version 1: core's result for the `market_data.live` operation (ADR 0040).

One bounded snapshot of a live market, the same for every provider, so the Live
view and the agent never learn which venue sent it. It fits a 20-level, signed
crypto perp book with funding context (Hyperliquid) and a one-level, unsigned,
single-venue stock feed with session context (EODHD's Cboe EDGX stream) alike.

- Times are integer milliseconds since the Unix epoch, UTC. Each part carries its
  own time; a part the source does not send is absent, never zero-filled.
- Prices and sizes stay decimal strings exactly as the provider sent them and are
  never negative; funding rates and changes may be. `prev_day` is the previous
  day's price, `day_volume` the day's volume in the book's unit, and
  `change.percent` is in percent (1.03 means 1.03%).
- `source.scope` is `venue` when the data comes from one venue only; a surface
  then labels it as such unless the subject is itself that venue's market.
- A delta-book venue keeps its book locally and still publishes a snapshot.
- Latest state, not lossless: trades that did not fit are counted in `dropped`.

Pure standard library; `validate_live_market` names the first bad path.
"""
from __future__ import annotations

import re
from decimal import Decimal
from typing import Any, Mapping

from .concepts import DELAY, SHORT

SCHEMA_VERSION = 1
MAX_LEVELS, MAX_TRADES, MAX_POINTS, MAX_GAPS, MAX_ISSUES = 100, 200, 3600, 100, 20
DECIMAL = re.compile(r"^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?\Z")
SUBJECT = re.compile(r"^[a-z]+:[^\s]{1,200}\Z")
CODE = re.compile(r"^[a-z][a-z0-9_]{0,63}\Z")
EARLIEST, LATEST = 10**12, 10**14  # 2001 to 5138 in milliseconds: seconds, microseconds and nanoseconds all fail


class LiveMarketError(ValueError):
    pass


def _fail(path: str, message: str) -> LiveMarketError:
    return LiveMarketError(f"{path}: {message}")


def _object(value: Any, path: str, required: set[str], optional: set[str] = frozenset()) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise _fail(path, "object required")
    for name in sorted(set(value) - required - optional):
        raise _fail(f"{path}.{name}", "unknown field")
    for name in sorted(required - set(value)):
        raise _fail(f"{path}.{name}", "required")
    return value


def _list(value: Any, path: str, limit: int) -> list:
    if not isinstance(value, list) or len(value) > limit:
        raise _fail(path, f"a list of at most {limit} items")
    return value


def _time(value: Any, path: str) -> int:
    if type(value) is not int or not EARLIEST <= value < LATEST:
        raise _fail(path, "epoch milliseconds")
    return value


def _decimal(value: Any, path: str) -> Decimal:
    if not isinstance(value, str) or len(value) > 40 or not DECIMAL.match(value):
        raise _fail(path, "a decimal string as the provider sent it")
    return Decimal(value)


def _amount(value: Any, path: str) -> Decimal:
    """A price, size, volume or open interest: never negative. Rates and changes use `_decimal`."""
    amount = _decimal(value, path)
    if amount < 0:
        raise _fail(path, "never negative")
    return amount


def _one_of(value: Any, path: str, *values: Any) -> Any:
    if value not in values:
        raise _fail(path, f"expected one of {', '.join(str(item) for item in values)}")
    return value


def _count(value: Any, path: str) -> int:
    if type(value) is not int or value < 0:
        raise _fail(path, "a count")
    return value


def _levels(value: Any, path: str, depth: str, descending: bool) -> None:
    rows = _list(value, path, 1 if depth == "top" else MAX_LEVELS)
    previous = None
    for index, row in enumerate(rows):
        at = f"{path}[{index}]"
        if not isinstance(row, list) or len(row) not in (2, 3):
            raise _fail(at, "[price, size] or [price, size, orders]")
        price, _size = _amount(row[0], f"{at}[0]"), _amount(row[1], f"{at}[1]")
        if len(row) == 3:
            _count(row[2], f"{at}[2]")
        if previous is not None and (price >= previous if descending else price <= previous):
            raise _fail(at, "bids fall and asks rise, one row per price")
        previous = price


def _book(value: Any, path: str) -> None:
    book = _object(value, path, {"time", "depth", "unit", "bids", "asks"}, {"grouping"})
    _time(book["time"], f"{path}.time")
    depth = _one_of(book["depth"], f"{path}.depth", "top", "snapshot")
    unit = _object(book["unit"], f"{path}.unit", {"kind"}, {"code"})
    _one_of(unit["kind"], f"{path}.unit.kind", "coin", "shares", "contracts", "unknown")
    if "code" in unit and (not isinstance(unit["code"], str) or not SHORT.match(unit["code"])):
        raise _fail(f"{path}.unit.code", "a short code")
    if "grouping" in book:
        grouping = _object(book["grouping"], f"{path}.grouping", set(), {"n_sig_figs", "tick"})
        if len(grouping) != 1:
            raise _fail(f"{path}.grouping", "exactly one of n_sig_figs or tick")
        if "n_sig_figs" in grouping and (type(grouping["n_sig_figs"]) is not int or not 1 <= grouping["n_sig_figs"] <= 10):
            raise _fail(f"{path}.grouping.n_sig_figs", "1 to 10")
        if "tick" in grouping:
            _amount(grouping["tick"], f"{path}.grouping.tick")
    _levels(book["bids"], f"{path}.bids", depth, True)
    _levels(book["asks"], f"{path}.asks", depth, False)


def _trades(value: Any, path: str) -> None:
    trades = _object(value, path, {"items", "dropped"})
    for index, row in enumerate(_list(trades["items"], f"{path}.items", MAX_TRADES)):
        at = f"{path}.items[{index}]"
        if not isinstance(row, list) or len(row) != 4:
            raise _fail(at, "[time, price, size, side]")
        _time(row[0], f"{at}[0]")
        _amount(row[1], f"{at}[1]")
        _amount(row[2], f"{at}[2]")
        _one_of(row[3], f"{at}[3]", "buy", "sell", None)  # the aggressor side; null when the source sends none
    _count(trades["dropped"], f"{path}.dropped")


def _line(value: Any, path: str) -> None:
    line = _object(value, path, {"measure", "bucket_ms", "points"}, {"seeded_from"})
    _one_of(line["measure"], f"{path}.measure", "last_trade", "mid", "mark")
    if type(line["bucket_ms"]) is not int or not 50 <= line["bucket_ms"] <= 3_600_000:
        raise _fail(f"{path}.bucket_ms", "50 ms to one hour")
    if "seeded_from" in line and (not isinstance(line["seeded_from"], str) or not SHORT.match(line["seeded_from"])):
        raise _fail(f"{path}.seeded_from", "a short dataset name")
    for index, point in enumerate(_list(line["points"], f"{path}.points", MAX_POINTS)):
        if not isinstance(point, list) or len(point) != 2:
            raise _fail(f"{path}.points[{index}]", "[time, price]")
        _time(point[0], f"{path}.points[{index}][0]")
        _amount(point[1], f"{path}.points[{index}][1]")


PERP = {"mark", "oracle", "mid", "funding", "open_interest", "prev_day", "day_volume"}
EQUITY = {"session", "venue_status", "reference_close", "change"}


def _context(value: Any, path: str) -> None:
    kind = _one_of(value.get("kind") if isinstance(value, Mapping) else None, f"{path}.kind", "perp", "equity_session")
    fields = PERP if kind == "perp" else EQUITY
    context = _object(value, path, {"kind", "time"}, fields)
    _time(context["time"], f"{path}.time")
    for name in ("mark", "oracle", "mid", "open_interest", "prev_day", "day_volume"):
        if name in context:
            _amount(context[name], f"{path}.{name}")
    if "funding" in context:
        funding = _object(context["funding"], f"{path}.funding", {"rate_1h"}, {"next_time"})
        _decimal(funding["rate_1h"], f"{path}.funding.rate_1h")
        if "next_time" in funding:
            _time(funding["next_time"], f"{path}.funding.next_time")
    if "session" in context:
        _one_of(context["session"], f"{path}.session", "pre", "regular", "post", "closed")
    if "venue_status" in context:
        _one_of(context["venue_status"], f"{path}.venue_status", "trading", "halted", "auction", "closed", "unknown")
    if "reference_close" in context:  # a separately sourced close, labelled with its own dataset and feed class
        close = _object(context["reference_close"], f"{path}.reference_close", {"value", "time", "dataset", "market_data_type"})
        _amount(close["value"], f"{path}.reference_close.value")
        _time(close["time"], f"{path}.reference_close.time")
        if not isinstance(close["dataset"], str) or not 0 < len(close["dataset"]) <= 120:
            raise _fail(f"{path}.reference_close.dataset", "the dataset the close came from")
        _one_of(close["market_data_type"], f"{path}.reference_close.market_data_type", *DELAY)
    if "change" in context:
        if "reference_close" not in context:
            raise _fail(f"{path}.change", "a change needs the reference_close it is measured against")
        change = _object(context["change"], f"{path}.change", {"absolute", "percent"})
        _decimal(change["absolute"], f"{path}.change.absolute")
        _decimal(change["percent"], f"{path}.change.percent")


def validate_live_market(document: Any) -> Mapping[str, Any]:
    """Validate one `live_market` snapshot; raise LiveMarketError naming the first bad path. Returns it unchanged."""
    body = _object(document, "live_market", {"schema_version", "subject", "source", "gaps", "issues", "retrieved_at"},
                   {"book", "trades", "line", "context"})
    if body["schema_version"] != SCHEMA_VERSION:
        raise _fail("live_market.schema_version", f"expected {SCHEMA_VERSION}")
    subject = _object(body["subject"], "subject", {"subject_id"})
    if not isinstance(subject["subject_id"], str) or not SUBJECT.match(subject["subject_id"]):
        raise _fail("subject.subject_id", "a subject ID")
    source = _object(body["source"], "source", {"plugin", "venue", "scope", "market_data_type"}, {"delay_seconds"})
    if not isinstance(source["plugin"], str) or not re.match(r"^[a-z][a-z0-9_-]{0,63}\Z", source["plugin"]):
        raise _fail("source.plugin", "a plugin id")
    if not isinstance(source["venue"], str) or not SHORT.match(source["venue"]):
        raise _fail("source.venue", "a short venue code")
    _one_of(source["scope"], "source.scope", "venue", "consolidated")
    _one_of(source["market_data_type"], "source.market_data_type", *DELAY)
    if "delay_seconds" in source:
        _count(source["delay_seconds"], "source.delay_seconds")
    if "book" in body:
        _book(body["book"], "book")
    if "trades" in body:
        _trades(body["trades"], "trades")
    if "line" in body:
        _line(body["line"], "line")
    if "context" in body:
        _context(body["context"], "context")
    for index, gap in enumerate(_list(body["gaps"], "gaps", MAX_GAPS)):
        gap = _object(gap, f"gaps[{index}]", {"start", "end"})
        if _time(gap["start"], f"gaps[{index}].start") > _time(gap["end"], f"gaps[{index}].end"):
            raise _fail(f"gaps[{index}]", "start after end")
    for index, issue in enumerate(_list(body["issues"], "issues", MAX_ISSUES)):
        issue = _object(issue, f"issues[{index}]", {"code"}, {"severity", "message"})
        if not isinstance(issue["code"], str) or not CODE.match(issue["code"]):
            raise _fail(f"issues[{index}].code", "a short code")
        if "severity" in issue:
            _one_of(issue["severity"], f"issues[{index}].severity", "error", "warning", "info")
        if "message" in issue and (not isinstance(issue["message"], str) or len(issue["message"]) > 300):
            raise _fail(f"issues[{index}].message", "at most 300 characters")
    _time(body["retrieved_at"], "retrieved_at")
    return document

