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
 * 90 days use a rolling native window so keys stay stable; longer daily reads
 * use explicit session dates that move once a day. */
type PlannedRead = {
  series: Series;
  days: number;
  role: "intraday" | "daily";
};

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
/** Finer bars first; then extended over regular hours, then OHLC over closes. */
function preference(a: Series, b: Series) {
  const rank = (s: Series) =>
    (s.session === "extended" || s.session === "all" ? 0 : 2) +
    (s.shape === "ohlc" ? 0 : 1);
  return intervalMs(a) - intervalMs(b) || rank(a) - rank(b);
}
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
 * Chooses bars for every period from the series the source declares: 1D and
 * 5D share the finest intraday series that covers five days within the point
 * bound; longer periods use daily bars. 1M–1Y share one year of daily bars,
 * which also supply the statistics. An unsupported period says why.
 */
export function chartPlan(list: readonly Series[], now: number) {
  const usable = list.filter(priceSeries);
  const intraday = usable
    .filter(
      (s) =>
        s.interval.kind !== "day" &&
        spanDays(s) >= 5 &&
        (5 * DAY) / intervalMs(s) <= MAX_POINTS,
    )
    .sort(preference)[0];
  const daily = usable
    .filter((s) => s.interval.kind === "day" && s.interval.count === 1)
    .sort(
      (a, b) =>
        spanDays(b) - spanDays(a) ||
        (a.shape === "ohlc" ? 0 : 1) - (b.shape === "ohlc" ? 0 : 1),
    )[0];
  const longest = daily ? spanDays(daily) : 0;
  const year: PlannedRead | undefined = daily
    ? { series: daily, days: Math.min(370, longest), role: "daily" }
    : undefined;
  const reads = new Map<ChartPeriod, PlannedRead>();
  const unavailable = new Map<ChartPeriod, string>();
  for (const period of CHART_PERIODS) {
    if (period === "1D" || period === "5D") {
      if (intraday)
        reads.set(period, { series: intraday, days: 5, role: "intraday" });
      else unavailable.set(period, "The source declares no intraday bars.");
      continue;
    }
    if (!daily || !year) {
      unavailable.set(period, "The source declares no daily history.");
      continue;
    }
    const start = periodStart(period, now);
    const needed =
      start === undefined ? longest : Math.ceil((now - start) / DAY) + 1;
    if (period === "MAX" || needed <= year.days)
      reads.set(
        period,
        period === "MAX" && longest > year.days
          ? { series: daily, days: longest, role: "daily" }
          : year,
      );
    else if (needed <= longest)
      reads.set(period, { series: daily, days: needed + 1, role: "daily" });
    else
      unavailable.set(
        period,
        `The source provides at most ${longest} days of daily history.`,
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
