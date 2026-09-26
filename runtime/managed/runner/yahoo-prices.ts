import { record, symbol, symbols, type Client } from "./yahoo.js";
import { failedChart } from "./provider-errors.js";
const number = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const stamp = (v: unknown) =>
  v instanceof Date && Number.isFinite(v.getTime()) ? v.getTime() : null;
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const bounds = (v: unknown) => {
  const p = object(v);
  const epoch = (v: unknown) =>
    stamp(v) ?? (typeof v === "number" ? v * 1000 : NaN);
  const start = epoch(p.start),
    end = epoch(p.end);
  return Number.isFinite(start) && Number.isFinite(end) && end > start
    ? { start, end }
    : null;
};
/** Pair pre/regular/post by their actual boundaries, never by array position or
 * assumed US hours. The newest started schedule wins, even before its first bar. */
function schedules(meta: Record<string, unknown>, now: number) {
  const historical = meta.tradingPeriods,
    currentPeriods = object(meta.currentTradingPeriod);
  // Regular-only reads return one array of per-session groups; extended reads
  // return pre/regular/post groups.
  const periods = (kind: string) => {
    const groups = Array.isArray(historical)
      ? kind === "regular"
        ? historical
        : []
      : object(historical)[kind];
    return [
      ...(Array.isArray(groups) ? groups.flat() : []),
      currentPeriods[kind],
    ]
      .map(bounds)
      .filter((p): p is { start: number; end: number } => p !== null);
  };
  const pre = periods("pre"),
    post = periods("post");
  return periods("regular")
    .map((regular) => ({
      regular,
      start: pre.find((p) => p.end === regular.start)?.start ?? regular.start,
      end: post.find((p) => p.start === regular.end)?.end ?? regular.end,
    }))
    .filter((p) => p.start <= now)
    .sort((a, b) => b.start - a.start);
}
/** The current or last started session as contract session evidence: the
 * newest schedule whose pre-market or regular hours have begun. */
function lastSession(meta: Record<string, unknown>, now: number) {
  const current = schedules(meta, now)[0];
  const zone = meta.exchangeTimezoneName;
  if (!current || typeof zone !== "string" || !zone) return null;
  const iso = (t: number) => new Date(t).toISOString();
  return {
    date: new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(
      current.regular.start,
    ),
    timezone: zone,
    regular: {
      start: iso(current.regular.start),
      end: iso(current.regular.end),
    },
    extended: { start: iso(current.start), end: iso(current.end) },
  };
}
function equitySession(meta: Record<string, unknown>, now: number) {
  const all = schedules(meta, now);
  const current = all[0];
  if (!current) return undefined;
  if (now < current.regular.start) {
    const previous = all.find((p) => p.regular.end < current.start);
    if (!previous) return undefined;
    return {
      regular: previous.regular,
      start: previous.regular.start,
      end: current.regular.start,
      sessionDate: current.regular.start,
      gap: { start: previous.regular.end, end: current.start },
    };
  }
  return {
    regular: current.regular,
    start: current.regular.start,
    end: now < current.regular.end ? current.regular.end : current.end,
    sessionDate: current.regular.start,
    gap: undefined,
  };
}
/** The SDK converts currentTradingPeriod to Dates, but historical tradingPeriods
 * still arrive as epoch seconds in 4.0.2. Use the returned schedule, not inferred
 * hours or the first/last price. Each historical group describes one session. */
function sessionWindow(meta: Record<string, unknown>, points: { t: number }[]) {
  const first = points[0]?.t,
    last = points.at(-1)?.t;
  if (first === undefined || last === undefined) return null;
  const periods = meta.tradingPeriods;
  const groups = Array.isArray(periods) ? periods : record(periods).regular;
  const candidates = Array.isArray(groups) ? [...groups] : [];
  candidates.push([record(meta.currentTradingPeriod).regular]);
  for (const group of candidates) {
    if (!Array.isArray(group) || !group.length) continue;
    const bounds = group.map((raw: unknown) => {
      const p = record(raw);
      const epoch = (v: unknown) =>
        stamp(v) ??
        (typeof v === "number" && Number.isFinite(v) ? v * 1000 : NaN);
      return { start: epoch(p.start), end: epoch(p.end) };
    });
    if (
      bounds.some(
        (p) =>
          !Number.isFinite(p.start) ||
          !Number.isFinite(p.end) ||
          p.end <= p.start,
      )
    )
      continue;
    const start = Math.min(...bounds.map((p) => p.start));
    const end = Math.max(...bounds.map((p) => p.end));
    if (points.some((p) => p.t >= start && p.t <= end)) return { start, end };
  }
  return null;
}
function metadata(raw: unknown, expected: string) {
  const q = record(raw);
  if (q.symbol !== expected) throw Error("binding_mismatch");
  return {
    symbol: expected,
    name: q.longName ?? q.shortName ?? expected,
    short_name: q.shortName ?? null,
    full_exchange_name: q.fullExchangeName ?? q.exchangeName ?? null,
    type: q.quoteType ?? q.instrumentType ?? null,
    currency: q.currency ?? null,
    exchange: q.exchange ?? q.exchangeName ?? null,
    timezone: q.exchangeTimezoneName ?? null,
    delay: number(q.exchangeDataDelayedBy),
    market_state: q.marketState ?? null,
  };
}
function quoteView(
  data: Record<string, unknown>[],
  list: string[],
  retrieved_at: string,
) {
  return {
    retrieved_at,
    quotes: list.map((s) => {
      const q = data.find((q) => q.symbol === s);
      return {
        symbol: s,
        price: number(q?.regularMarketPrice),
        change: number(q?.regularMarketChange),
        percent: number(q?.regularMarketChangePercent),
        timestamp: q ? (stamp(q.regularMarketTime) ?? 0) / 1000 : null,
        open: number(q?.regularMarketOpen),
        high: number(q?.regularMarketDayHigh),
        low: number(q?.regularMarketDayLow),
        metadata: q ? metadata(q, s) : null,
        extended:
          q &&
          ["PRE", "POST", "POSTPOST", "CLOSED", "PREPRE"].includes(
            String(q.marketState ?? ""),
          )
            ? {
                session: q.marketState === "PRE" ? "pre" : "post",
                price: number(
                  q.marketState === "PRE"
                    ? q.preMarketPrice
                    : q.postMarketPrice,
                ),
                percent: number(
                  q.marketState === "PRE"
                    ? q.preMarketChangePercent
                    : q.postMarketChangePercent,
                ),
                change: number(
                  q.marketState === "PRE"
                    ? q.preMarketChange
                    : q.postMarketChange,
                ),
                timestamp:
                  (stamp(
                    q.marketState === "PRE"
                      ? q.preMarketTime
                      : q.postMarketTime,
                  ) ?? 0) / 1000,
              }
            : null,
      };
    }),
  };
}
export async function yahooPrices(
  sdk: Client,
  operation: string,
  args: Record<string, unknown>,
) {
  const retrieved_at = new Date().toISOString();
  const latest = (q: Record<string, unknown>, s: string) => ({
    metadata: metadata(q, s),
    retrieved_at,
    rows: [{ time: q.regularMarketTime, value: number(q.regularMarketPrice) }],
    change: {
      absolute: number(q.regularMarketChange),
      percent: number(q.regularMarketChangePercent),
    },
    // The close the regular change is measured against.
    previous_close: number(q.regularMarketPreviousClose),
  });
  // Every quote read (metadata, latest, batches, quote dashboards) shares one
  // coalesced native quote call through quote_bundle.
  if (operation === "quote_bundle") {
    const list = symbols(args.symbols);
    const quotes = await sdk.quote(list);
    const result: Record<string, unknown> = {};
    for (const q of quotes) {
      const s = symbol(q.symbol);
      if (!list.includes(s) || s in result) throw Error("binding_mismatch");
      result[s] = latest(record(q), s);
    }
    // Missing quotes stay missing; the connector returns a per-item failure.
    return {
      common: result,
      display: quoteView(quotes.map(record), list, retrieved_at),
    };
  }
  if (operation === "dashboard") {
    if (args.kind !== "charts") throw Error("invalid_request");
    const list = symbols(args.symbols);
    const charts = await Promise.all(
      list.map(async (s) => {
        try {
          const d = await sdk.chart(s, {
            period1: new Date(Date.now() - 5 * 86400000),
            interval: "1m",
            includePrePost: true,
          });
          if (d.meta.symbol !== s) throw Error("binding_mismatch");
          const zone = d.meta.exchangeTimezoneName;
          const day = (t: number) =>
            new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(t);
          const points = d.quotes.flatMap((q) => {
            const t = stamp(q.date),
              c = number(q.close);
            return t !== null && c !== null ? [{ t, c }] : [];
          });
          const equity =
            d.meta.instrumentType === "EQUITY" ||
            d.meta.instrumentType === "ETF";
          // Continuous markets use elapsed time, not Yahoo's UTC daily bucket.
          const rolling =
            d.meta.instrumentType === "CRYPTOCURRENCY"
              ? {
                  start: Date.parse(retrieved_at) - 86400000,
                  end: Date.parse(retrieved_at),
                }
              : undefined;
          const schedule = equity
            ? equitySession(d.meta, Date.now())
            : undefined;
          const last = points.at(-1),
            session = schedule
              ? day(schedule.sessionDate)
              : last
                ? day(last.t)
                : null;
          const marketTime = stamp(d.meta.regularMarketTime);
          // previousClose belongs to the quote's session; chartPreviousClose
          // instead anchors the entire five-day request and is not this baseline.
          const baselineSession = marketTime !== null ? day(marketTime) : null;
          let selected = rolling
            ? points.filter((p) => p.t >= rolling.start && p.t <= rolling.end)
            : schedule
              ? points.filter(
                  (p) =>
                    p.t >= schedule.start &&
                    p.t <= schedule.end &&
                    (!schedule.gap ||
                      p.t <= schedule.gap.start ||
                      p.t >= schedule.gap.end),
                )
              : points.filter((p) => day(p.t) === session);
          const window = rolling
            ? null
            : schedule
              ? { start: schedule.start, end: schedule.end }
              : sessionWindow(d.meta, selected);
          // includePrePost also returns late index prints/corrections. Keep
          // non-equities on their regular schedule; these are not extended trades.
          if (!schedule && window)
            selected = selected.filter(
              (p) => p.t >= window.start && p.t <= window.end,
            );
          const previousClose =
            !rolling &&
            ((schedule &&
              marketTime !== null &&
              marketTime >= schedule.regular.start &&
              marketTime <= schedule.regular.end + 60_000) ||
              baselineSession === session)
              ? number(d.meta.previousClose)
              : null;
          if (
            selected.length > 2000 ||
            selected.some(
              (p, i) =>
                p.c <= 0 ||
                p.t > Date.now() ||
                p.t <= (selected[i - 1]?.t ?? 0),
            )
          )
            throw Error("invalid_response");
          return {
            symbol: s,
            session,
            points: selected,
            error: null,
            timezone: zone,
            previous_close: previousClose,
            baseline_session: previousClose !== null ? session : null,
            session_window: window,
            ...(rolling
              ? {
                  window: rolling,
                  range: "1d",
                  interval_ms: 60_000,
                  currency: d.meta.currency,
                }
              : {}),
            ...(schedule ? { regular_window: schedule.regular } : {}),
            ...(schedule?.gap ? { session_gap: schedule.gap } : {}),
          };
        } catch (error) {
          return failedChart(s, error);
        }
      }),
    );
    return { retrieved_at, charts };
  }
  if (operation !== "price_read") throw Error("invalid_request");
  const s = symbol(args.symbol),
    mode = String(args.mode);
  const intervals = {
    daily: "1d",
    adjusted: "1d",
    minute: "1m",
    five_minute: "5m",
    five_minute_extended: "5m",
    hour: "1h",
  } as const;
  if (!(mode in intervals)) throw Error("invalid_request");
  const interval = intervals[mode as keyof typeof intervals];
  const start = Date.parse(String(args.start)),
    end = Date.parse(String(args.end));
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end < start ||
    end - start > (interval === "1d" ? 3660 : 7) * 86400000
  )
    throw Error("invalid_window");
  const d = await sdk.chart(s, {
    // Date-only windows are exchange-local. Pad the transport window and let
    // the shared reader filter session dates, including sessions east of UTC.
    period1: new Date(start - (interval === "1d" ? 86400000 : 0)),
    period2: new Date(end + (interval === "1d" ? 86400000 : 1000)),
    interval,
    includePrePost: mode === "five_minute_extended",
    events: "div,splits",
  });
  const meta = metadata(d.meta, s);
  const day = (v: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: d.meta.exchangeTimezoneName,
    }).format(v);
  return {
    metadata: meta,
    retrieved_at,
    // Intraday equity reads carry the schedule of the current or last session;
    // continuous markets keep elapsed time, not Yahoo's UTC daily bucket.
    session:
      interval !== "1d" &&
      (d.meta.instrumentType === "EQUITY" || d.meta.instrumentType === "ETF")
        ? lastSession(record(d.meta), Date.parse(retrieved_at))
        : null,
    rows: d.quotes.map((q) => ({
      time: interval === "1d" ? day(q.date) : q.date,
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.volume,
      value: mode === "adjusted" ? q.adjclose : undefined,
    })),
  };
}
