"""One demand-owned Hyperliquid websocket for every watched perp, publishing `live_market` snapshots.

The socket opens with the first listener and closes with the last. It reconnects
on its own with a bounded backoff, because Hyperliquid disconnects without
announcement and the platform's own retry waits at least 15 s; each outage is
kept as a gap. After STALE_S without a connection it hands the retry to the
platform. Snapshots are latest state, published at most every PUBLISH_S.
"""
from __future__ import annotations

import json
import logging
import threading
import time
import urllib.request
import uuid
from typing import Any, Callable

from . import feed
from .market import WINDOW_MS, Market, brief

logger = logging.getLogger(__name__)
URL = "wss://api.hyperliquid.xyz/ws"
INFO = "https://api.hyperliquid.xyz/info"
PUBLISH_S = 0.25         # at most four snapshots a second
PING_S = 30              # the server closes a connection it has not heard from in 60 s
SILENT_S = 20            # no message for this long: the connection is dead
STALE_S = 20             # no connection for this long: stale, and the platform retries
REJECTED_S = 3           # a close this soon after a subscription, before any data, is Hyperliquid refusing it
MAX_BACKOFF_S = 30


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def info(body: dict, timeout: float = 10) -> Any:
    """One bounded POST to the public info endpoint: fixed origin, no redirects, at most 2 MB."""
    request = urllib.request.Request(INFO, data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json", "User-Agent": "pythia-hyperliquid"})
    with _opener.open(request, timeout=timeout) as response:
        data = response.read(2_000_001)
    if len(data) > 2_000_000:
        raise feed.Drift("info", "response larger than 2 MB")
    return json.loads(data)


def connect(url: str):
    from websockets.sync.client import connect as open_socket  # Hermes' pinned dependency; imported on first use
    return open_socket(url, open_timeout=10, close_timeout=2, max_size=1_000_000, ping_interval=None)


def _now() -> int:
    return int(time.time() * 1000)


class Streams:
    def __init__(self, validate: Callable[[Any], Any], *, open_socket=connect, read_info=info,
                 clock: Callable[[], float] = time.monotonic, log=logger.warning):
        self.validate, self.open_socket, self.read_info, self.clock = validate, open_socket, read_info, clock
        self.log = log
        self.alarms = feed.Alarms(log=log)  # drift no one market can own (message envelopes, `meta`, errors)
        self.lock = threading.RLock()
        self.listeners: dict[str, dict] = {}
        self.markets: dict[str, Market] = {}
        self.checked: dict[str, tuple[float, str | None]] = {}
        self.thread: threading.Thread | None = None
        self.closing = threading.Event()
        self.socket = None

    # ---- demand ---------------------------------------------------------------------------------------------------

    def subscribe(self, coin: str, subject_id: str, subscription) -> None:
        """Publish snapshots of one perp to a platform subscription until it closes."""
        if not feed.COIN.match(coin):
            raise ValueError("invalid_request")
        identifier = uuid.uuid4().hex
        with self.lock:
            if self.closing.is_set():
                raise ValueError("unavailable")
            self.listeners[identifier] = {"coin": coin, "subject_id": subject_id, "emit": subscription.emit}
            if coin in self.markets:
                self.markets[coin].dirty = True  # the new listener gets the current state at the next flush
            if self.thread is None:
                self.thread = threading.Thread(target=self.run, name="pythia-hyperliquid", daemon=True)
                self.thread.start()

        def stop():
            with self.lock:
                self.listeners.pop(identifier, None)
        subscription.on_close(stop)

    def snapshot(self, coin: str, subject_id: str, cancelled=None, timeout: float = 10) -> dict:
        """One snapshot for a one-shot read (the agent): join or open the stream, wait for book and context."""
        ready, result = threading.Event(), {}

        class Once:
            def __init__(self):
                self.stops = []

            def emit(self, event):
                data = (event.get("data") or {}).get("data") or {}
                if event.get("type") != "snapshot" or ("book" in data and "context" in data):
                    result["event"] = event
                    ready.set()

            def on_close(self, stop):
                self.stops.append(stop)
        once = Once()
        self.subscribe(coin, subject_id, once)
        try:
            deadline = time.monotonic() + timeout
            while not ready.wait(0.1):
                if (cancelled and cancelled()) or time.monotonic() > deadline:
                    break
        finally:
            for stop in once.stops:
                stop()
        event = result.get("event")
        if event and event.get("type") == "snapshot":
            return brief(event["data"])
        code = (event or {}).get("code") or ("cancelled" if cancelled and cancelled() else "timeout")
        return {"schema_version": 1, "outcome": "error", "data": None,
                "issues": [{"code": code, "severity": "error", "message": f"No Hyperliquid snapshot: {code}."}]}

    def close(self) -> None:
        self.closing.set()
        with self.lock:
            socket, listeners = self.socket, list(self.listeners.values())
            self.listeners.clear()
        if socket is not None:
            try:
                socket.close()
            except Exception:
                pass
        for listener in listeners:
            listener["emit"]({"type": "reset", "state": "unavailable", "code": "access_changed"})

    def _emit(self, coin: str | None, event: dict) -> None:
        with self.lock:
            targets = [row for row in self.listeners.values() if coin is None or row["coin"] == coin]
        for row in targets:
            row["emit"](event)

    # ---- the connection ------------------------------------------------------------------------------------------

    def _wanted(self) -> set[str]:
        with self.lock:
            return {row["coin"] for row in self.listeners.values()}

    def _prepare(self, coin: str) -> str | None:
        """Why the coin cannot be watched (unknown or delisted per `meta`, or `meta` drifted), else None; seeds the
        line once. A network failure raises: that is a connection problem, retried as one."""
        checked = self.checked.get(coin)
        if checked is None or self.clock() - checked[0] > (60 if checked[1] == "source_drift" else 600):
            try:
                reason = feed.market(self.read_info({"type": "meta"}), coin, self.alarms)
            except (feed.Drift, ValueError) as error:  # a changed or unreadable `meta` is drift, not a lost connection
                self.alarms.drift(error if isinstance(error, feed.Drift) else feed.Drift("meta", str(error)))
                reason = "source_drift"
            checked = (self.clock(), reason)
            self.checked[coin] = checked
        if checked[1] is not None:
            return checked[1]
        with self.lock:
            market = self.markets.setdefault(coin, Market(coin, feed.Alarms(log=self.log), self.alarms))
        if not market.seed and not market.buckets:
            now = _now()
            try:
                raw = self.read_info({"type": "candleSnapshot", "req": {"coin": coin, "interval": "1m",
                                                                        "startTime": now - WINDOW_MS, "endTime": now}})
                market.seed = feed.candles(raw, coin, market.alarms, now)
                market.flag("seed_unavailable", False, "info", "")
            except feed.Drift as drift:
                market.alarms.drift(drift)
            except (OSError, ValueError):
                market.flag("seed_unavailable", True, "info",
                            "The minutes before this view opened could not be read from Hyperliquid.")
        return None

    def run(self) -> None:
        backoff, down_since, stale_told = 1.0, None, False
        while not self.closing.is_set():
            with self.lock:
                if not self.listeners:
                    self.thread = None
                    self.markets.clear()
                    return
            subscribed_at, received = None, False
            try:
                for coin in sorted(self._wanted()):
                    reason = self._prepare(coin)
                    if reason:
                        self._refuse(coin, reason)
                socket = self.open_socket(URL)
                with self.lock:
                    self.socket = socket
                subscribed: set[str] = set()
                last_message = last_ping = last_flush = self.clock()
                while not self.closing.is_set():
                    wanted = self._wanted()
                    if not wanted:
                        break
                    for coin in sorted(wanted - subscribed):
                        reason = self._prepare(coin)
                        if reason:
                            self._refuse(coin, reason)
                            continue
                        for subscription in self._subscriptions(coin):
                            socket.send(json.dumps({"method": "subscribe", "subscription": subscription}))
                        subscribed.add(coin)
                        subscribed_at = self.clock()
                    for coin in sorted(subscribed - wanted):
                        for subscription in self._subscriptions(coin):
                            socket.send(json.dumps({"method": "unsubscribe", "subscription": subscription}))
                        subscribed.discard(coin)
                        with self.lock:
                            self.markets.pop(coin, None)
                    try:
                        raw = socket.recv(timeout=max(0.01, PUBLISH_S - (self.clock() - last_flush)))
                    except TimeoutError:
                        raw = None
                    now = self.clock()
                    if raw is not None:
                        last_message = now
                        if self._handle(raw) and not received:
                            received, backoff, stale_told = True, 1.0, False
                            if down_since is not None:
                                self._recovered(down_since)
                                down_since = None
                    if now - last_message > SILENT_S:
                        raise ConnectionError("silent")
                    if now - last_ping > PING_S:
                        socket.send(json.dumps({"method": "ping"}))
                        last_ping = now
                    if now - last_flush >= PUBLISH_S:
                        self._flush()
                        last_flush = now
                socket.close()
            except Exception as error:  # a lost connection, a refused subscription or a transport error
                if subscribed_at is not None and not received and self.clock() - subscribed_at < REJECTED_S:
                    # A guess (a drop soon after subscribing may be the network): logged, never shown.
                    self.alarms.note("subscription", f"Hyperliquid closed the connection after a subscription: {error}",
                                     shown=False)
                if down_since is None:
                    down_since = _now()
                    self._interrupted()
                if not stale_told and _now() - down_since > STALE_S * 1000:
                    stale_told = True
                    self._emit(None, {"type": "status", "state": "stale", "code": "connection_lost"})
                logger.info("hyperliquid connection lost (%s); reconnecting in %.0f s", type(error).__name__, backoff)
                self.closing.wait(backoff)
                backoff = min(MAX_BACKOFF_S, backoff * 2)
            finally:
                with self.lock:
                    self.socket = None
        with self.lock:
            self.thread = None

    @staticmethod
    def _subscriptions(coin: str) -> list[dict]:
        return [{"type": "l2Book", "coin": coin, "fast": True}, {"type": "trades", "coin": coin},
                {"type": "activeAssetCtx", "coin": coin}]

    def _refuse(self, coin: str, reason: str) -> None:
        """An unknown or delisted perp: its listeners get an explicit reset and leave; nothing is subscribed."""
        with self.lock:
            self.markets.pop(coin, None)
            refused = {key: row for key, row in self.listeners.items() if row["coin"] == coin}
            for key in refused:
                self.listeners.pop(key)
        for row in refused.values():
            row["emit"]({"type": "reset", "state": "unavailable", "code": reason})

    def _handle(self, raw: str | bytes) -> bool:
        """Apply one message; True when it carried market data."""
        try:
            channel, data = feed.envelope(json.loads(raw), self.alarms)
        except feed.Drift as error:
            self.alarms.drift(error)
            return False
        except ValueError as error:
            self.alarms.drift(feed.Drift("message", f"not JSON: {error}"))
            return False
        if channel == "error":
            self.alarms.note("error", str(data), dropped=True)
            return False
        if channel in ("pong", "subscriptionResponse"):
            return False
        coin = data.get("coin") if isinstance(data, dict) else (
            data[0].get("coin") if isinstance(data, list) and data and isinstance(data[0], dict) else None)
        with self.lock:
            market = self.markets.get(coin)
            if market is None:  # an unsubscribed coin, or an empty trade list
                return False
            try:
                if channel == "l2Book":
                    market.add_book(feed.book(data, market.coin, market.alarms))
                elif channel == "trades":
                    market.add_trades(feed.trades(data, market.coin, market.alarms))
                else:
                    market.context, market.dirty = feed.context(data, market.coin, market.alarms, _now()), True
                if channel == "l2Book":  # a timed part parsed: the clock agrees again (context carries no time)
                    market.flag("clock_off", False, "info", "")
            except feed.Drift as drift:  # the part is dropped, never coerced; the alarm says why
                market.alarms.drift(drift)
                if not drift.shown:  # not the source's drift, but the investor still sees why a part is missing
                    market.flag("clock_off", True, "info", "This computer's clock looks off, so Hyperliquid's times "
                                "cannot be checked and the affected parts are left out.")
                if channel == "l2Book":
                    market.book = None
                elif channel == "activeAssetCtx":
                    market.context = None
                market.dirty = True
        return True

    def _interrupted(self) -> None:
        with self.lock:
            for market in self.markets.values():
                market.flag("reconnecting", True, "warning", "Reconnecting to Hyperliquid; the last data is shown.")
        self._flush()

    def _recovered(self, since: int) -> None:
        with self.lock:
            for market in self.markets.values():
                market.gaps.append({"start": since, "end": _now()})
                market.flag("reconnecting", False, "warning", "")

    def _flush(self) -> None:
        now = _now()
        with self.lock:
            due = [(market, [row for row in self.listeners.values() if row["coin"] == market.coin])
                   for market in self.markets.values() if market.dirty]
            for market, _rows in due:
                market.dirty = False
            built = []
            for market, rows in due:
                for subject_id in {row["subject_id"] for row in rows}:
                    built.append((market, subject_id, market.snapshot(subject_id, now), rows))
                market.fresh = []
        for market, subject_id, document, rows in built:
            try:
                self.validate(document)
            except ValueError as error:  # our own output failed core's schema: report, never publish it
                self.alarms.note("live_market", str(error), dropped=True)
                continue
            event = {"type": "snapshot", "state": "ready",
                     "data": {"schema_version": 1, "outcome": "ok", "data": document, "issues": []}}
            for row in rows:
                if row["subject_id"] == subject_id:
                    row["emit"](event)
