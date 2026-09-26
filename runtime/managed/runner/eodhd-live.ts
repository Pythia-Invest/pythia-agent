/** Explicit Cboe EDGX subscriptions; never substituted for delayed REST prices. */
import { EODHDClient, type EODHDWebSocket, type WebSocketFeed } from "eodhd";
import { createInterface } from "node:readline";
import { budgetedFetch } from "./provider-budget.js";
import { StreamReference } from "./eodhd-stream-reference.js";

type Feed = "us" | "us-candles" | "us-quote" | "us-status";
type Row = Record<string, unknown>;
type Connection = {
  socket: EODHDWebSocket<WebSocketFeed>;
  symbols: string[];
  values: Map<string, Map<number, Row>>;
  gap: boolean;
  denied: boolean;
  failed: boolean;
  received: Map<string, number>;
  stale: Set<string>;
  started: number;
};
const feeds = new Map<Feed, Connection>();
const pending = new Map<string, unknown>();
let token = "",
  blocked = false,
  resumed = false;
const reference = new StreamReference(
  () => token,
  () => {
    for (const [feed, connection] of feeds)
      if (feed === "us" || feed === "us-candles")
        for (const symbol of connection.symbols)
          if (connection.values.get(symbol)?.size)
            feed === "us"
              ? publishTrade(symbol, connection)
              : publishBars(symbol, connection);
  },
);
function emit(key: string, value: unknown) {
  pending.set(key, value);
}
function flush() {
  if (blocked) return;
  for (const [key, value] of pending) {
    pending.delete(key);
    if (!process.stdout.write(`${JSON.stringify(value)}\n`)) {
      blocked = true;
      break;
    }
  }
}
process.stdout.on("drain", () => {
  blocked = false;
  flush();
});
function status(feed: Feed, state: string, code: string) {
  if (state === "unavailable" || code === "connection_lost")
    for (const key of pending.keys())
      if (key.startsWith(`${feed}:`)) pending.delete(key);
  emit(`${feed}:status`, { type: "status", feed, state, code });
}
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
function accept(feed: Feed, connection: Connection, value: Row) {
  if (
    connection.denied ||
    connection.failed ||
    feeds.get(feed) !== connection ||
    typeof value.s !== "string" ||
    !connection.symbols.includes(value.s) ||
    !finite(value.t) ||
    !Number.isSafeInteger(value.t) ||
    value.t <= 0 ||
    value.t > Date.now() + 1000
  )
    return;
  if (feed === "us-quote" || feed === "us-status") {
    if (
      feed === "us-quote" &&
      ["bp", "ap", "bs", "as"].some(
        (k) => !finite(value[k]) || Number(value[k]) < 0,
      )
    )
      return;
    if (
      feed === "us-status" &&
      (typeof value.h !== "string" ||
        value.h.length > 32 ||
        String(value.r ?? "").length > 128)
    )
      return;
    connection.failed = false;
    connection.values.set(value.s, new Map([[Number(value.t), value]]));
    const trades = feeds.get("us");
    const last = trades?.values.get(value.s);
    if (trades && last?.size) publishTrade(value.s, trades);
    return;
  }
  const fields = feed === "us" ? ["p", "v"] : ["o", "h", "l", "c", "v"];
  if (
    fields.some((key) => !finite(value[key]) || Number(value[key]) < 0) ||
    (feed === "us-candles" && value.i !== "1m")
  )
    return;
  const row: Row = { t: value.t, ...(feed === "us" ? { ms: value.ms } : {}) };
  for (const key of fields) row[key] = String(value[key]);
  const values = connection.values.get(value.s) ?? new Map<number, Row>();
  if (feed === "us") {
    const latest = Math.max(0, ...values.keys());
    if (value.t < latest) return;
    values.clear();
  }
  values.set(value.t, row); // Repeated candle timestamps replace, never add volume.
  while (values.size > 2000) values.delete(Math.min(...values.keys()));
  connection.values.set(value.s, values);
  connection.received.set(value.s, Date.now());
  connection.stale.delete(value.s);
  if (feed === "us") {
    publishTrade(value.s, connection);
    return;
  }
  publishBars(value.s, connection);
}
function publishBars(symbol: string, connection: Connection) {
  if (connection.failed) return;
  emit(`us-candles:${symbol}`, {
    type: "data",
    feed: "us-candles",
    symbol,
    reference: reference.get(symbol),
    rows: [...(connection.values.get(symbol)?.values() ?? [])].sort(
      (a, b) => Number(a.t) - Number(b.t),
    ),
    gap: connection.gap,
  });
}
function publishTrade(symbol: string, connection: Connection) {
  if (connection.failed) return;
  if (["us-quote", "us-status"].some((feed) => feeds.get(feed as Feed)?.failed))
    return;
  const latest = (feed: Feed) =>
    [...(feeds.get(feed)?.values.get(symbol)?.values() ?? [])].at(-1);
  emit(`us:${symbol}`, {
    type: "data",
    feed: "us",
    symbol,
    reference: reference.get(symbol),
    rows: [...(connection.values.get(symbol)?.values() ?? [])].map((row) => ({
      ...row,
      ...(latest("us-quote") ? { book: latest("us-quote") } : {}),
      ...(latest("us-status") ? { venue_status: latest("us-status") } : {}),
    })),
    gap: connection.gap,
  });
}
async function backfill(connection: Connection, symbol: string) {
  const url = new URL("https://ws.eodhistoricaldata.com/history");
  url.search = new URLSearchParams({
    market: "us",
    symbol,
    api_token: token,
  }).toString();
  try {
    const response = await budgetedFetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw Error();
    const data = await response.json();
    if (!Array.isArray(data) || data.length > 2000) throw Error();
    // Live updates received during backfill win over a closed-bar snapshot.
    const current = new Map(connection.values.get(symbol));
    for (const row of data)
      if (!current.has(row.t)) accept("us-candles", connection, row);
    for (const [time, row] of current)
      connection.values.get(symbol)?.set(time, row);
  } catch {
    status("us-candles", "stale", "backfill_unavailable");
  }
}
function configure(feed: Feed, symbols: string[]) {
  const previous = feeds.get(feed);
  if (JSON.stringify(previous?.symbols ?? []) === JSON.stringify(symbols))
    return;
  feeds.delete(feed);
  previous?.socket.close();
  for (const key of pending.keys())
    if (key.startsWith(`${feed}:`)) pending.delete(key);
  if (!symbols.length) return;
  const client = new EODHDClient({
    apiToken: token,
    maxRetries: 0,
    logger: { debug() {}, warn() {}, error() {} },
  });
  const socket = client.websocket(feed, symbols, { maxReconnectAttempts: 0 });
  const connection: Connection = {
    socket,
    symbols,
    values: new Map(),
    gap: resumed || previous !== undefined,
    denied: false,
    failed: false,
    received: new Map(),
    stale: new Set(),
    started: Date.now(),
  };
  feeds.set(feed, connection);
  socket.on("data", (row) => accept(feed, connection, { ...row }));
  socket.on("error", (error) => {
    if (feeds.get(feed) !== connection) return;
    const denied = /Authentication rejected|rejected.*\(40[134]\)/u.test(
      error.message,
    );
    connection.denied = denied;
    connection.failed = true;
    connection.gap = true;
    connection.values.clear();
    connection.received.clear();
    socket.close();
    status(
      feed === "us-quote" || feed === "us-status" ? "us" : feed,
      denied ? "unavailable" : "stale",
      denied ? "access_denied" : "connection_lost",
    );
  });
  socket.on("close", () => {
    if (feeds.get(feed) === connection && !connection.denied) {
      connection.failed = true;
      connection.gap = true;
      connection.values.clear();
      connection.received.clear();
      status(
        feed === "us-quote" || feed === "us-status" ? "us" : feed,
        "stale",
        "connection_lost",
      );
    }
  });
  if (feed === "us-candles") {
    // Bound actual history fan-out independently of the subscription count.
    void (async () => {
      for (const symbol of symbols) {
        if (feeds.get(feed) !== connection) return;
        await backfill(connection, symbol);
      }
    })();
  }
}
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  try {
    if (line.length > 65536) throw Error();
    const message = JSON.parse(line);
    if (!token) {
      if (
        typeof message.token !== "string" ||
        !message.token ||
        message.token.length > 4096
      )
        throw Error();
      token = message.token;
      resumed = message.resumed === true;
    }
    const wanted = message.subscriptions;
    if (
      !wanted ||
      Object.keys(wanted).some((feed) => !["us", "us-candles"].includes(feed))
    )
      throw Error();
    const all = [wanted.us ?? [], wanted["us-candles"] ?? []];
    if (
      all[0].length * 3 + all[1].length > 50 ||
      all.some(
        (list) =>
          !Array.isArray(list) ||
          new Set(list).size !== list.length ||
          list.some(
            (symbol: unknown) =>
              typeof symbol !== "string" ||
              !/^[A-Z][A-Z0-9.-]{0,15}$/u.test(symbol),
          ),
      )
    )
      throw Error();
    configure("us", all[0]);
    configure("us-quote", all[0]);
    configure("us-status", all[0]);
    configure("us-candles", all[1]);
    reference.configure([...all[0], ...all[1]]);
  } catch {
    emit("error", {
      type: "status",
      state: "unavailable",
      code: "invalid_request",
    });
  }
});
const timer = setInterval(() => {
  void reference.refresh();
  // A healthy browser heartbeat is not evidence of a current observation.
  // Quiet symbols remain subscribed; their next observation restores readiness.
  for (const [feed, connection] of feeds)
    if (feed === "us" || feed === "us-candles")
      for (const symbol of connection.symbols) {
        if (
          !connection.denied &&
          !connection.stale.has(symbol) &&
          Date.now() - (connection.received.get(symbol) ?? connection.started) >
            180_000
        ) {
          connection.stale.add(symbol);
          emit(`${feed}:${symbol}`, {
            type: "status",
            feed,
            symbol,
            state: "stale",
            code: "no_recent_observation",
          });
        }
      }
  flush();
}, 1000);
lines.on("close", () => {
  clearInterval(timer);
  for (const connection of feeds.values()) connection.socket.close();
  feeds.clear();
});
