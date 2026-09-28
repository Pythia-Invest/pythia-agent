"""Latest state of one watched perp and its `live_market` snapshot. Never a tick archive."""
from __future__ import annotations

from collections import deque

from . import feed

WINDOW_MS = 15 * 60_000  # the trade line's rolling window
TAPE = 50                # recent trades per snapshot
SOURCE = {"plugin": "pythia-hyperliquid", "venue": "hyperliquid", "scope": "venue",
          "market_data_type": "realtime", "delay_seconds": 0}


class Market:
    """Latest state of one perp: book, recent trades, the 15-minute line and context. Never a tick archive."""

    def __init__(self, coin: str, alarms: feed.Alarms, shared: feed.Alarms | None = None):
        self.coin, self.alarms = coin, alarms  # this market's own drift
        self.shared = shared or feed.Alarms()   # the stream's, which no one market owns
        self.book: dict | None = None
        self.context: dict | None = None
        self.tape: list[tuple] = []                 # (time, tid, price, size, side), oldest first
        self.seen: deque = deque(maxlen=1000)       # trade keys, to drop a resubscription's replayed trades
        self.fresh: list[tuple[int, int]] = []      # trades added since the last publication
        self.buckets: dict[int, list] = {}          # second -> [time, price] of its last trade
        self.seed: list[list] = []                  # closed 1m candles before the first live trade
        self.gaps: list[dict] = []
        self.issues: dict[str, dict] = {}
        self.dirty = True

    def add_book(self, value: dict) -> None:
        if self.book and value["time"] < self.book["time"]:
            self.alarms.note("l2Book.time", "a book older than the previous one", dropped=True)
            return
        self.book, self.dirty = value, True
        self.flag("book_empty", not value["bids"] and not value["asks"], "info", "Hyperliquid's book is empty.")

    def add_trades(self, rows: list[tuple]) -> None:
        for row in rows:
            key = (row[0], row[1])
            if key in self.seen:
                continue
            self.seen.append(key)
            self.fresh.append(key)
            self.tape.append(row)
            bucket = self.buckets.get(row[0] // 1000)
            if bucket is None or row[0] >= bucket[0]:
                self.buckets[row[0] // 1000] = [row[0], row[2]]
            self.dirty = True
        self.tape = sorted(self.tape)[-TAPE:]

    def flag(self, code: str, on: bool, severity: str, message: str) -> None:
        if on != (code in self.issues):
            self.dirty = True
        if on:
            self.issues[code] = {"code": code, "severity": severity, "message": message}
        else:
            self.issues.pop(code, None)

    def snapshot(self, subject_id: str, now_ms: int) -> dict:
        start = now_ms - WINDOW_MS
        self.buckets = {second: point for second, point in self.buckets.items() if point[0] >= start}
        live = sorted(self.buckets.values())
        first = live[0][0] if live else now_ms
        points = [point for point in self.seed if start <= point[0] < first] + live
        self.gaps = [gap for gap in self.gaps if gap["end"] >= start]
        shown = {(row[0], row[1]) for row in self.tape}
        document = {
            "schema_version": 1, "subject": {"subject_id": subject_id}, "source": dict(SOURCE),
            "trades": {"items": [[row[0], row[2], row[3], row[4]] for row in self.tape],
                       "dropped": sum(1 for key in self.fresh if key not in shown)},
            "line": {"measure": "last_trade", "bucket_ms": 1000, "points": points,
                     **({"seeded_from": "candle_1m"} if points and points[0][0] < first else {})},
            "gaps": list(self.gaps), "issues": [*self.issues.values(), *self.alarms.issues(), *self.shared.issues()][:20],
            "retrieved_at": now_ms,
        }
        if self.book:
            document["book"] = self.book
        if self.context:
            document["context"] = self.context
        return document


def brief(answer: dict) -> dict:
    """A one-shot answer for the agent: the line at one point per minute (its last), with the full-resolution
    first, last, high and low beside it, so a 15-minute window stays about 16 points instead of up to 900."""
    document = answer.get("data") or {}
    points = (document.get("line") or {}).get("points") or []
    if not points:
        return answer
    minutes: dict[int, list] = {}
    for point in points:
        minutes[point[0] // 60_000] = point
    prices = [(float(point[1]), point) for point in points]
    line = {**document["line"], "bucket_ms": 60_000, "points": [minutes[key] for key in sorted(minutes)]}
    summary = {"from": points[0][0], "to": points[-1][0], "first": points[0][1], "last": points[-1][1],
               "high": max(prices)[1][1], "low": min(prices)[1][1], "points": len(points)}
    return {**answer, "data": {**document, "line": line}, "line_summary": summary}
