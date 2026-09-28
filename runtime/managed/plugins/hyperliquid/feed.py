"""Hyperliquid websocket and info messages: strict parses with drift alarms (docs/sources/hyperliquid.md).

Every field read here has one documented meaning in the source record. A message
that contradicts the audited shape raises `Drift` and its part is dropped, never
coerced; an unexpected extra field is only reported (`Alarms.note`), because the
fields we read keep their meaning. Pure standard library.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable

COIN = re.compile(r"^[A-Z0-9]{1,20}\Z")  # a perp on the first perp dex ("BTC"); HIP-3 "dex:COIN" is out of scope
UNSIGNED = re.compile(r"^[0-9]{1,20}(\.[0-9]{1,20})?\Z")
SIGNED = re.compile(r"^-?[0-9]{1,20}(\.[0-9]{1,20})?\Z")
CHANNELS = {"subscriptionResponse", "l2Book", "trades", "activeAssetCtx", "pong", "error"}
BOOK_LEVELS = 5          # `fast: true` sends up to 5 levels per side (20 when slow, about every 5 s)
FUNDING_CAP = 0.04       # funding is capped at 4% an hour
CLOCK_SKEW_MS = 10 * 60_000
EARLIEST_TRADE_MS = 1_672_531_200_000  # 2023-01-01; a delisted coin's snapshot replays its last, old trade
CTX_REQUIRED = {"funding", "openInterest", "oraclePx", "markPx", "prevDayPx", "dayNtlVlm"}
CTX_OPTIONAL = {"midPx", "premium", "impactPxs", "dayBaseVlm"}
TRADE_KEYS = {"coin", "side", "px", "sz", "time", "hash", "tid", "users"}
SIDES = {"B": "buy", "A": "sell"}  # "Side is aggressing side for trades"
UNIVERSE_KEYS = {"name", "szDecimals", "maxLeverage", "marginTableId", "isDelisted", "onlyIsolated", "marginMode"}


class Drift(ValueError):
    """The source contradicts its documented and audited shape; `path` names where."""

    def __init__(self, path: str, detail: str):
        super().__init__(f"{path}: {detail}")
        self.path = path


@dataclass
class Alarms:
    """Counted drift, with the first example of each path; surfaced in snapshots and logged once."""

    counts: dict[str, int] = field(default_factory=dict)
    examples: dict[str, str] = field(default_factory=dict)
    log: Callable[[str], None] = lambda message: None

    def note(self, path: str, detail: str) -> None:
        if path not in self.counts:
            self.examples[path] = detail[:200]
            self.log(f"hyperliquid source drift at {path}: {detail[:200]}")
        self.counts[path] = self.counts.get(path, 0) + 1

    def issues(self) -> list[dict]:
        return [{"code": "source_drift", "severity": "warning",
                 "message": f"Hyperliquid sent something unexpected at {path} ({count}x): {self.examples[path]}"[:300]}
                for path, count in sorted(self.counts.items())][:10]


def _object(value: Any, path: str, required: set[str], optional: set[str], alarms: Alarms) -> dict:
    if not isinstance(value, dict):
        raise Drift(path, "object expected")
    missing = required - set(value)
    if missing:
        raise Drift(f"{path}.{sorted(missing)[0]}", "missing")
    for name in sorted(set(value) - required - optional):
        alarms.note(f"{path}.{name}", "unknown field, ignored")
    return value


def _decimal(value: Any, path: str, pattern: re.Pattern[str] = UNSIGNED) -> str:
    """Hyperliquid sends prices, sizes and rates as decimal strings (the docs type some as numbers)."""
    if not isinstance(value, str) or not pattern.match(value):
        raise Drift(path, f"a decimal string expected, got {type(value).__name__}")
    return value


def _positive(value: Any, path: str) -> str:
    text = _decimal(value, path)
    if float(text) <= 0:
        raise Drift(path, "must be positive")
    return text


def _time(value: Any, path: str, now_ms: int, earliest: int | None = None) -> int:
    if type(value) is not int or not (earliest or now_ms - CLOCK_SKEW_MS) <= value <= now_ms + CLOCK_SKEW_MS:
        raise Drift(path, "epoch milliseconds near the local clock expected")
    return value


def envelope(raw: Any, alarms: Alarms) -> tuple[str, Any]:
    """One websocket message: (channel, data). An unknown channel is drift."""
    body = _object(raw, "message", {"channel"}, {"data"}, alarms)
    channel = body["channel"]
    if channel not in CHANNELS:
        raise Drift("message.channel", f"unknown channel {str(channel)[:40]}")
    return channel, body.get("data")


def book(data: Any, coin: str, alarms: Alarms, now_ms: int | None = None) -> dict:
    """An `l2Book` message: a full snapshot of up to BOOK_LEVELS levels a side, as live_market `book`."""
    now_ms = now_ms or int(time.time() * 1000)
    body = _object(data, "l2Book", {"coin", "time", "levels"}, {"fast"}, alarms)
    if body["coin"] != coin:
        raise Drift("l2Book.coin", "another coin than subscribed")
    if body.get("fast", True) is not True:  # the fast book echoes its subscription flag (undocumented)
        raise Drift("l2Book.fast", "the fast book expected")
    levels = body["levels"]
    if not isinstance(levels, list) or len(levels) != 2:
        raise Drift("l2Book.levels", "[bids, asks] expected")
    sides = []
    for side, rows in zip(("bids", "asks"), levels):
        if not isinstance(rows, list) or len(rows) > BOOK_LEVELS:
            raise Drift(f"l2Book.{side}", f"at most {BOOK_LEVELS} levels expected")
        parsed = []
        for index, row in enumerate(rows):
            at = f"l2Book.{side}[{index}]"
            row = _object(row, at, {"px", "sz", "n"}, set(), alarms)
            if type(row["n"]) is not int or row["n"] < 1:
                raise Drift(f"{at}.n", "a positive order count expected")
            parsed.append([_positive(row["px"], f"{at}.px"), _positive(row["sz"], f"{at}.sz"), row["n"]])
        prices = [float(row[0]) for row in parsed]
        ordered = all(a > b for a, b in zip(prices, prices[1:])) if side == "bids" else all(
            a < b for a, b in zip(prices, prices[1:]))
        if not ordered:
            raise Drift(f"l2Book.{side}", "bids must fall and asks rise")
        sides.append(parsed)
    bids, asks = sides
    if bids and asks and float(bids[0][0]) >= float(asks[0][0]):
        raise Drift("l2Book.levels", "crossed book")
    return {"time": _time(body["time"], "l2Book.time", now_ms), "depth": "snapshot",
            "unit": {"kind": "coin", "code": coin}, "bids": bids, "asks": asks}


def trades(data: Any, coin: str, alarms: Alarms, now_ms: int | None = None) -> list[tuple[int, int, str, str, str]]:
    """A `trades` message as (time, tid, price, size, side) rows. Buyer and seller addresses are never kept."""
    now_ms = now_ms or int(time.time() * 1000)
    if not isinstance(data, list):
        raise Drift("trades", "a list expected")
    rows = []
    for index, item in enumerate(data):
        at = f"trades[{index}]"
        item = _object(item, at, TRADE_KEYS, set(), alarms)
        if item["coin"] != coin:
            raise Drift(f"{at}.coin", "another coin than subscribed")
        if item["side"] not in SIDES:
            raise Drift(f"{at}.side", "B or A expected")
        if type(item["tid"]) is not int or item["tid"] < 0:
            raise Drift(f"{at}.tid", "a trade id expected")
        rows.append((_time(item["time"], f"{at}.time", now_ms, EARLIEST_TRADE_MS), item["tid"],
                     _positive(item["px"], f"{at}.px"), _positive(item["sz"], f"{at}.sz"), SIDES[item["side"]]))
    return rows


def context(data: Any, coin: str, alarms: Alarms, received_ms: int) -> dict:
    """An `activeAssetCtx` message as live_market perp `context`. It carries no time: receipt time stands in."""
    body = _object(data, "activeAssetCtx", {"coin", "ctx"}, set(), alarms)
    if body["coin"] != coin:
        raise Drift("activeAssetCtx.coin", "another coin than subscribed")
    ctx = _object(body["ctx"], "activeAssetCtx.ctx", CTX_REQUIRED, CTX_OPTIONAL, alarms)
    funding = _decimal(ctx["funding"], "ctx.funding", SIGNED)
    if abs(float(funding)) > FUNDING_CAP:
        raise Drift("ctx.funding", "beyond the documented 4% an hour cap")
    hour = 3_600_000
    out = {"kind": "perp", "time": received_ms, "mark": _positive(ctx["markPx"], "ctx.markPx"),
           "oracle": _positive(ctx["oraclePx"], "ctx.oraclePx"),
           # Funding settles on the hour (measured on fundingHistory); `funding` is the rate for that settlement.
           "funding": {"rate_1h": funding, "next_time": (received_ms // hour + 1) * hour},
           "open_interest": _decimal(ctx["openInterest"], "ctx.openInterest"),
           "prev_day": _positive(ctx["prevDayPx"], "ctx.prevDayPx")}
    if ctx.get("midPx") is not None:  # null when the book is empty (a delisted market)
        out["mid"] = _positive(ctx["midPx"], "ctx.midPx")
    if ctx.get("dayBaseVlm") is not None:
        out["day_volume"] = _decimal(ctx["dayBaseVlm"], "ctx.dayBaseVlm")
    _decimal(ctx["dayNtlVlm"], "ctx.dayNtlVlm")  # read to detect drift; the schema has no notional volume
    return out


def candles(data: Any, coin: str, alarms: Alarms, now_ms: int) -> list[list]:
    """A 1m `candleSnapshot` as closed-minute [close time, close price] points; the running minute is left out."""
    if not isinstance(data, list):
        raise Drift("candleSnapshot", "a list expected")
    points = []
    for index, item in enumerate(data):
        at = f"candleSnapshot[{index}]"
        item = _object(item, at, {"t", "T", "s", "i", "o", "c", "h", "l", "v", "n"}, set(), alarms)
        if item["s"] != coin or item["i"] != "1m":
            raise Drift(at, "another coin or interval than requested")
        close = _time(item["T"], f"{at}.T", now_ms, EARLIEST_TRADE_MS)
        if close - _time(item["t"], f"{at}.t", now_ms, EARLIEST_TRADE_MS) != 59_999:
            raise Drift(at, "a one-minute candle expected")
        if close < now_ms:
            points.append([close, _positive(item["c"], f"{at}.c")])
    return sorted(points)


def market(universe_document: Any, coin: str, alarms: Alarms) -> str | None:
    """The `meta` answer for one coin: None when it trades, else why it cannot be watched."""
    body = _object(universe_document, "meta", {"universe"}, {"marginTables", "collateralToken"}, alarms)
    if not isinstance(body["universe"], list):
        raise Drift("meta.universe", "a list expected")
    for index, entry in enumerate(body["universe"]):
        entry = _object(entry, f"meta.universe[{index}]", {"name", "szDecimals", "maxLeverage"}, UNIVERSE_KEYS, alarms)
        if entry["name"] == coin:
            return "delisted" if entry.get("isDelisted") is True else None
    return "unknown_market"
