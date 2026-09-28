import { z } from "zod";
import type { ReadInput, Series } from "../index";
import {
  bindingSchema,
  readResultSchema,
  seriesSchema,
  type FinancialRead,
  type FinancialSource,
} from "./contract";
import { seriesField } from "./display";
import type { WidgetQuery } from "./types";

/** Period and read planning for the page chart. */
export const PLUGIN = "pythia-market-data";
export const DAY = 86_400_000;
/** Drawing and request bound shared with the path renderer. */
export const MAX_POINTS = 2000;

export const CHART_PERIODS = [
  "1D",
  "5D",
  "1M",
  "6M",
  "YTD",
  "1Y",
  "5Y",
  "MAX",
] as const;
export type ChartPeriod = (typeof CHART_PERIODS)[number];
export const CHART_PERIOD_LABELS: Record<ChartPeriod, string> = {
  "1D": "1D",
  "5D": "5D",
  "1M": "1M",
  "6M": "6M",
  YTD: "YTD",
  "1Y": "1Y",
  "5Y": "5Y",
  MAX: "Max",
};
export const WORDS: Record<ChartPeriod, string> = {
  "1D": "Today",
  "5D": "Past 5 days",
  "1M": "Past month",
  "6M": "Past 6 months",
  YTD: "Year to date",
  "1Y": "Past year",
  "5Y": "Past 5 years",
  MAX: "Longest available history",
};

/** The page chart reads one listing through its explicit source address. */
export const chartInputSchema = z
  .object({
    subject: bindingSchema,
    symbol: z.string().max(64),
    name: z.string().min(1).max(256),
    period: z.enum(CHART_PERIODS),
  })
  .strict();
export type ChartWidgetInput = z.infer<typeof chartInputSchema>;

export type SeriesList = { series: Series[] };
export type ChartResult = FinancialRead | SeriesList;

/** A read the plan needs: one pinned series over one window. Reads of up to
 * 90 days use a rolling native window so keys stay stable; longer reads use
 * explicit session dates that move once a day. */
export type PlannedRead = { series: Series; days: number };

function priceSeries(series: Series) {
  const field = seriesField(series);
  return (
    series.read_support?.operations.includes("history") &&
    ["last_trade", "close", "aggregate_price", "ohlc", "midpoint"].includes(
      series.measurement,
    ) &&
    // Dividend-adjusted closes do not share the quote's price basis.
    field.adjustment.kind !== "split_dividend" &&
    ["minute", "hour", "day"].includes(series.interval.kind)
  );
}
function spanDays(series: Series) {
  return Math.floor((series.read_support?.max_span_seconds ?? 0) / 86_400);
}
export function intervalMs(series: Series) {
  const unit = { minute: 60_000, hour: 3_600_000, day: DAY }[
    series.interval.kind as "minute" | "hour" | "day"
  ];
  return unit ? unit * series.interval.count : 0;
}
/** Bar sizes in minutes, most suitable first, and the read's lookback in
 * days (it reaches the close before the period). About 200–800 bars per view. */
const INTRADAY: Partial<
  Record<ChartPeriod, { minutes: number[]; days: number; continuous: number }>
> = {
  "1D": { minutes: [2, 1, 5, 15, 30, 60], days: 4, continuous: 2 },
  "5D": { minutes: [5, 15, 2, 30, 60], days: 9, continuous: 6 },
  "1M": { minutes: [30, 60, 15], days: 35, continuous: 32 },
};
const minutes = (s: Series) => intervalMs(s) / 60_000;

export function periodStart(period: ChartPeriod, now: number) {
  const today = new Date(now);
  const y = today.getUTCFullYear(),
    m = today.getUTCMonth(),
    d = today.getUTCDate();
  switch (period) {
    case "1M":
      return Date.UTC(y, m - 1, d);
    case "6M":
      return Date.UTC(y, m - 6, d);
    case "YTD":
      return Date.UTC(y, 0, 1);
    case "1Y":
      return Date.UTC(y - 1, m, d);
    case "5Y":
      return Date.UTC(y - 5, m, d);
    default:
      return undefined;
  }
}

/**
 * Chooses bars for every period from the series the source declares. 1D
 * prefers bars that include pre/post-market; multi-day views use regular
 * sessions. 6M, YTD and 1Y share one year of daily bars, which also supply the
 * statistics; 5Y and Max prefer weekly bars. A period no series covers says why.
 */
export function chartPlan(
  list: readonly Series[],
  now: number,
  continuous = false,
) {
  const usable = list.filter(priceSeries);
  const covers = (s: Series, days: number) => spanDays(s) >= days;
  const ohlc = (s: Series) => (s.shape === "ohlc" ? 0 : 1);
  const daily = usable
    .filter((s) => s.interval.kind === "day" && s.interval.count === 1)
    .sort((a, b) => spanDays(b) - spanDays(a) || ohlc(a) - ohlc(b))[0];
  const weekly = usable
    .filter((s) => s.interval.kind === "day" && s.interval.count === 7)
    .sort((a, b) => spanDays(b) - spanDays(a) || ohlc(a) - ohlc(b))[0];
  const year: PlannedRead | undefined = daily
    ? { series: daily, days: Math.min(380, spanDays(daily)) }
    : undefined;
  const reads = new Map<ChartPeriod, PlannedRead>();
  const unavailable = new Map<ChartPeriod, string>();
  for (const period of CHART_PERIODS) {
    const intraday = INTRADAY[period];
    if (intraday) {
      const days = continuous ? intraday.continuous : intraday.days;
      const session = (s: Series) =>
        (s.session === "extended" || s.session === "all") === (period === "1D")
          ? 0
          : 1;
      const bars = usable
        .filter(
          (s) =>
            (s.interval.kind === "minute" || s.interval.kind === "hour") &&
            intraday.minutes.includes(minutes(s)) &&
            covers(s, days),
        )
        .sort(
          (a, b) =>
            session(a) - session(b) ||
            intraday.minutes.indexOf(minutes(a)) -
              intraday.minutes.indexOf(minutes(b)) ||
            ohlc(a) - ohlc(b),
        )[0];
      if (bars) reads.set(period, { series: bars, days });
      else if (period === "1M" && year && covers(year.series, 35))
        reads.set(period, year);
      else unavailable.set(period, "The source declares no suitable bars.");
      continue;
    }
    const start = periodStart(period, now);
    const needed =
      start === undefined ? 0 : Math.ceil((now - start) / DAY) + 14;
    const long = period === "5Y" || period === "MAX" ? weekly : undefined;
    const series = long && covers(long, needed) ? long : daily;
    if (!series) {
      unavailable.set(period, "The source declares no daily history.");
      continue;
    }
    if (period === "MAX")
      reads.set(
        period,
        spanDays(series) <= (year?.days ?? 0) && year
          ? year
          : { series, days: spanDays(series) },
      );
    else if (series === daily && year && needed <= year.days)
      reads.set(period, year);
    else if (covers(series, needed))
      reads.set(period, { series, days: needed });
    else
      unavailable.set(
        period,
        `The source provides at most ${spanDays(series)} days of daily history.`,
      );
  }
  return { reads, unavailable, year };
}

export function readQuery(
  read: PlannedRead,
  now: number,
): WidgetQuery<ChartResult> {
  const series = read.series;
  const dates = series.read_support?.window_kind === "session_date";
  const rolling = read.days <= 90;
  const request = (at: number): ReadInput => {
    const end = dates ? at + DAY : Math.floor(at / 60_000) * 60_000;
    const start = end - read.days * DAY;
    const edge = (t: number) =>
      dates
        ? {
            kind: "session_date" as const,
            value: new Date(t).toISOString().slice(0, 10),
          }
        : { kind: "instant" as const, value: new Date(t).toISOString() };
    return {
      request: {
        schema_version: 1,
        operation: "history",
        view: { kind: "source", series_id: series.id },
        window: { start: edge(start), end: edge(end) },
        limit: Math.min(
          10_000,
          read.days * (dates ? 1 : Math.ceil(DAY / intervalMs(series))) + 10,
        ),
        requirements: { freshness: "any", completion: "any", coverage: "any" },
      },
      series,
    };
  };
  const input = request(now);
  if (rolling) input.request.window = { start: null, end: null };
  return {
    key: [
      "financial-chart",
      series.id,
      read.days,
      rolling ? null : input.request.window,
    ],
    resource: {
      plugin: PLUGIN,
      operation: "query",
      arguments: { action: "read_many", reads: [input] },
      ...(rolling
        ? { window: { kind: dates ? "sessions" : "rolling", days: read.days } }
        : {}),
    },
    enabled: true,
    readResource: () => ({
      plugin: PLUGIN,
      operation: "query",
      arguments: { action: "read_many", reads: [request(Date.now())] },
    }),
    decode: decodeRead,
  };
}
function decodeRead(value: unknown): FinancialRead {
  const raw = value as {
    outcome?: string;
    data?: unknown[];
    delivery?: { max_age_seconds?: number[] };
  };
  if (raw.outcome !== "ok" || raw.data?.length !== 1)
    throw Error("Invalid financial response.");
  return {
    result: readResultSchema.parse(raw.data[0]),
    refreshAfterSeconds: Math.max(15, raw.delivery?.max_age_seconds?.[0] ?? 60),
  };
}
export function seriesQuery(input: ChartWidgetInput): WidgetQuery<ChartResult> {
  return {
    key: ["financial-series", input.subject],
    resource: {
      plugin: PLUGIN,
      operation: "query",
      arguments: { action: "series", binding: input.subject },
    },
    enabled: true,
    readResource: () => ({
      plugin: PLUGIN,
      operation: "query",
      arguments: { action: "series", binding: input.subject },
    }),
    decode(value) {
      const raw = value as { outcome?: string; data?: unknown[] };
      if (!["ok", "partial"].includes(raw.outcome ?? "") || !raw.data)
        throw Error("Invalid series response.");
      return {
        series: raw.data.flatMap((item) => {
          const parsed = seriesSchema.safeParse(item);
          return parsed.success ? [parsed.data] : [];
        }),
      };
    },
  };
}
export function quoteSource(input: ChartWidgetInput): FinancialSource {
  return {
    feed: "prices",
    subjects: [
      {
        subject: input.subject,
        symbol: input.symbol,
        name: input.name,
        price: { mode: "preferred", criteria: {} },
      },
    ],
  };
}
