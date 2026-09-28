import { record, symbol, symbols, type Client } from "./yahoo.js";
import { failedChart } from "./provider-errors.js";
import {
  equitySession,
  extendedQuote,
  lastSession,
  number,
  sessionWindow,
  stamp,
} from "./yahoo-sessions.js";
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
    extended: extendedQuote(q),
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
  // Yahoo interval and the longest window it serves that interval for, in days.
  const intervals = {
    daily: ["1d", 36600],
    adjusted: ["1d", 36600],
    weekly: ["1wk", 36600],
    minute: ["1m", 7],
    two_minute_extended: ["2m", 60],
    five_minute: ["5m", 60],
    thirty_minute: ["30m", 60],
    hour: ["1h", 730],
  } as const;
  if (!(mode in intervals)) throw Error("invalid_request");
  const [interval, days] = intervals[mode as keyof typeof intervals];
  const dated = interval === "1d" || interval === "1wk";
  const start = Date.parse(String(args.start)),
    end = Date.parse(String(args.end));
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end < start ||
    end - start > days * 86400000
  )
    throw Error("invalid_window");
  const d = await sdk.chart(s, {
    // Date-only windows are exchange-local. Pad the transport window and let
    // the shared reader filter session dates, including sessions east of UTC.
    period1: new Date(start - (dated ? 86400000 : 0)),
    period2: new Date(end + (dated ? 86400000 : 1000)),
    interval,
    includePrePost: mode.endsWith("_extended"),
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
      !dated &&
      (d.meta.instrumentType === "EQUITY" || d.meta.instrumentType === "ETF")
        ? lastSession(record(d.meta), Date.parse(retrieved_at))
        : null,
    rows: d.quotes.map((q) => ({
      time: dated ? day(q.date) : q.date,
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.volume,
      value: mode === "adjusted" ? q.adjclose : undefined,
    })),
  };
}
