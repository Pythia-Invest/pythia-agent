import { z } from "zod";
import type {
  InstrumentDisplay,
  InstrumentPath,
  InstrumentPeriodChange,
  InstrumentPeriodOption,
  InstrumentStat,
} from "@pythia/widget-sdk";
import type { ReadInput, ReadResult, Series } from "../index";
import { financialQueries } from "./binding";
import {
  bindingSchema,
  readResultSchema,
  seriesSchema,
  type FinancialRead,
  type FinancialSource,
} from "./contract";
import {
  decimalNumber,
  financialInstrument,
  seriesField,
  seriesSemantics,
} from "./display";
import type { WidgetBinding, WidgetQuery } from "./types";

const PLUGIN = "pythia-market-data";
const DAY = 86_400_000;
/** Drawing and request bound shared with the path renderer. */
const MAX_POINTS = 2000;

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
const WORDS: Record<ChartPeriod, string> = {
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

type SeriesList = { series: Series[] };
type ChartResult = FinancialRead | SeriesList;

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
function intervalMs(series: Series) {
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
function periodStart(period: ChartPeriod, now: number) {
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

function readQuery(read: PlannedRead, now: number): WidgetQuery<ChartResult> {
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
function seriesQuery(input: ChartWidgetInput): WidgetQuery<ChartResult> {
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
function quoteSource(input: ChartWidgetInput): FinancialSource {
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

type Point = { time: number; value: number };
function points(result: ReadResult, field: "close" | "high" | "low" = "close") {
  const scale = result.series ? seriesField(result.series).unit.scale : "1";
  return result.observations.flatMap((o) => {
    const time =
      o.time.kind === "unknown" ? Number.NaN : Date.parse(o.time.value);
    const value = decimalNumber(
      o.shape === "scalar" ? o.value : o[field],
      scale,
    );
    return Number.isFinite(time) && value !== null ? [{ time, value }] : [];
  });
}
function day(time: number) {
  return new Date(time).toISOString().slice(0, 10);
}
function localDate(time: number, zone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(time);
  } catch {
    return undefined;
  }
}
/** Keep real observations only: every k-th close plus the latest one. */
function thin(list: Point[]) {
  if (list.length <= MAX_POINTS) return { list, step: 1 };
  const step = Math.ceil(list.length / (MAX_POINTS - 1));
  const kept = list.filter((_, i) => (list.length - 1 - i) % step === 0);
  return { list: kept, step };
}

/** The selected period's path; session evidence narrows 1D to one session. */
function periodPath(
  period: ChartPeriod,
  result: ReadResult,
  quote: ReadResult | undefined,
  continuous: boolean,
): { path?: InstrumentPath; message?: string } {
  const series = result.series;
  if (!series || result.outcome === "error") return {};
  const all = points(result);
  const detail = `${seriesSemantics(series)} · ${result.coverage.status} coverage`;
  const quoteClose = quote?.price_context?.reference_close;
  if (series.interval.kind !== "day") {
    const interval = intervalMs(series);
    const end = Date.parse(
      result.request.window.end?.kind === "instant"
        ? result.request.window.end.value
        : result.retrieved_at,
    );
    const session = result.price_context?.session_window;
    const zone = session?.timezone;
    if (period === "1D" && session && !continuous) {
      const regular = {
        start: Date.parse(session.regular.start),
        end: Date.parse(session.regular.end),
      };
      const bounds =
        series.session === "regular"
          ? regular
          : {
              start: Date.parse(session.extended.start),
              end: Date.parse(session.extended.end),
            };
      const inSession = all.filter(
        (p) => p.time >= bounds.start && p.time <= bounds.end,
      );
      const close = result.price_context?.reference_close ?? quoteClose;
      const observed = quote?.observations.at(-1)?.time;
      // A quote's previous close is this session's baseline only when the
      // quote belongs to the same exchange-local session.
      const sameSession =
        result.price_context?.reference_close ||
        (observed?.kind === "instant" &&
          localDate(Date.parse(observed.value), session.timezone) ===
            session.date);
      const baseline =
        close && sameSession
          ? decimalNumber(close.value, close.unit.scale)
          : null;
      if (!inSession.length)
        return {
          message: `No trades yet in the ${session.date} session.`,
        };
      return {
        path: {
          points: inSession,
          label: `${detail} · Session ${session.date} (${session.timezone}), ${series.session === "regular" ? "regular" : "regular and extended"} hours`,
          session: bounds,
          regularSession: regular,
          intervalMs: interval,
          timeZone: zone,
          ...(baseline !== null && close
            ? {
                baseline: {
                  value: baseline,
                  label: `Previous close · ${close.dataset}`,
                },
              }
            : {}),
        },
      };
    }
    const days = period === "1D" ? 1 : 5;
    const window = { start: end - days * DAY, end };
    const inWindow = all.filter(
      (p) => p.time >= window.start && p.time <= window.end,
    );
    const first = inWindow[0];
    if (!first) return { message: "No observations in this period." };
    return {
      path: {
        points: inWindow,
        label: `${detail} · Past ${days === 1 ? "24 hours" : "5 days"}, calendar time`,
        window,
        intervalMs: interval,
        timeZone: zone,
        baseline: {
          value: first.value,
          label: "First observation in this period",
        },
      },
    };
  }
  const start = periodStart(period, Date.now());
  const selected = all.filter((p) => start === undefined || p.time >= start);
  const { list, step } = thin(selected);
  const first = list[0],
    last = list.at(-1);
  if (!first || !last) return { message: "No daily closes in this period." };
  const today = Date.parse(day(Date.now()));
  return {
    path: {
      points: list,
      label: `${detail} · Session dates${step > 1 ? ` · every ${step} closes shown` : ""}`,
      window: {
        start: start ?? first.time,
        end: Math.max(today, last.time),
      },
      dates: series.time_anchor === "session_date",
      baseline: {
        value: first.value,
        label: `First close in this period (${day(first.time)})`,
      },
    },
  };
}

function periodChange(
  period: ChartPeriod,
  path: InstrumentPath | undefined,
): InstrumentPeriodChange | undefined {
  if (period === "1D" || !path?.baseline) return undefined;
  const last = path.points.at(-1)?.value;
  const base = path.baseline.value;
  if (last === undefined || !(base > 0)) return undefined;
  return {
    absolute: last - base,
    percent: ((last - base) / base) * 100,
    label:
      period === "MAX"
        ? `Since ${new Date(path.points[0]?.time ?? 0).toISOString().slice(0, 10)}`
        : WORDS[period],
    basis: `Chart change from the ${path.baseline.label.toLowerCase()} to the latest chart observation`,
  };
}

/** Statistics only from fields the source supplies. Session values come from
 * the latest daily bar and carry its date; the 52-week range from daily bars. */
function statistics(
  quote: ReadResult | undefined,
  year: ReadResult | undefined,
  covered: boolean,
): InstrumentStat[] {
  const stats: InstrumentStat[] = [];
  const bar = year?.observations.at(-1);
  const series = year?.series;
  const scale = series ? seriesField(series).unit.scale : "1";
  if (bar?.shape === "ohlc" && series) {
    const date = bar.time.kind === "unknown" ? "date unknown" : bar.time.value;
    const detail = `Daily bar for ${date} · ${series.dataset} · completion ${bar.completion.state}`;
    stats.push(
      {
        id: "open",
        label: "Open",
        value: decimalNumber(bar.open, scale),
        detail,
      },
      {
        id: "high",
        label: "High",
        value: decimalNumber(bar.high, scale),
        detail,
      },
      { id: "low", label: "Low", value: decimalNumber(bar.low, scale), detail },
    );
  }
  const close = quote?.price_context?.reference_close;
  if (close)
    stats.push({
      id: "previous-close",
      label: "Prev close",
      value: decimalNumber(close.value, close.unit.scale),
      detail: `Previous close · ${close.dataset}`,
    });
  if (bar?.shape === "ohlc" && bar.volume !== undefined && series)
    stats.push({
      id: "volume",
      label: "Volume",
      value: decimalNumber(bar.volume),
      format: "quantity",
      detail: `Daily bar volume for ${bar.time.kind === "unknown" ? "unknown date" : bar.time.value} · ${series.dataset}`,
    });
  if (year && covered) {
    const cutoff = Date.now() - 365 * DAY;
    const within = (list: Point[]) => list.filter((p) => p.time >= cutoff);
    const highs = within(points(year, "high")).map((p) => p.value);
    const lows = within(points(year, "low")).map((p) => p.value);
    if (highs.length && lows.length)
      stats.push({
        id: "range-52w",
        label: "52-week range",
        range: { low: Math.min(...lows), high: Math.max(...highs) },
        detail: `${year.observations[0]?.shape === "ohlc" ? "Lowest low and highest high" : "Lowest and highest close"} of the past 52 weeks of daily bars · ${series?.dataset ?? "source"}`,
      });
  }
  return stats;
}

export type InstrumentChartData = {
  item: InstrumentDisplay;
  period: ChartPeriod;
  periods: InstrumentPeriodOption[];
  periodChange?: InstrumentPeriodChange | undefined;
  chartMessage?: string | undefined;
  chartLoading: boolean;
  stats: InstrumentStat[];
  statsLoading: boolean;
  quoteLoading: boolean;
  message?: string | undefined;
};

function isRead(value: ChartResult | undefined): value is FinancialRead {
  return Boolean(value && "result" in value);
}

/**
 * Page chart binding: a quote and the source's declared series first, then
 * the selected period's bars and one year of daily bars for the statistics.
 * The host owns the selected period; this adapter owns its financial meaning.
 */
export const chartBinding: WidgetBinding<
  ChartWidgetInput,
  ChartResult,
  InstrumentChartData
> = {
  queries(input) {
    const parsed = chartInputSchema.parse(input);
    const quote = financialQueries(quoteSource(parsed), "latest")[0];
    if (!quote) throw Error("No quote request is configured.");
    return [quote as WidgetQuery<ChartResult>, seriesQuery(parsed)];
  },
  deferred(input, [, list]) {
    const series = (list?.data as SeriesList | undefined)?.series;
    if (!series) return [];
    const now = Date.now();
    const plan = chartPlan(series, now);
    const selected = plan.reads.get(input.period);
    const reads = [selected, plan.year].map((read) =>
      read ? readQuery(read, now) : undefined,
    );
    // One query when the period is served by the year of daily bars.
    const [chart, year] = reads;
    return [
      ...(chart ? [chart] : []),
      ...(year && JSON.stringify(year.key) !== JSON.stringify(chart?.key)
        ? [year]
        : []),
    ];
  },
  render(input, [quoteQuery, listQuery], deferred, { formatTimestamp }) {
    const quoteRead = isRead(quoteQuery?.data)
      ? quoteQuery.data.result
      : undefined;
    const series = (listQuery?.data as SeriesList | undefined)?.series;
    const plan = series ? chartPlan(series, Date.now()) : undefined;
    const selected = plan?.reads.get(input.period);
    const chartQuery = selected ? deferred[0] : undefined;
    // Mirrors deferred(): the chart read first, then the year unless shared.
    const shared = selected === plan?.year;
    const yearQuery = !plan?.year
      ? undefined
      : shared || !selected
        ? deferred[0]
        : deferred[1];
    const chartRead = isRead(chartQuery?.data)
      ? chartQuery.data.result
      : undefined;
    const yearRead = isRead(yearQuery?.data)
      ? yearQuery.data.result
      : undefined;
    const item = financialInstrument(
      {
        subject: input.subject,
        symbol: input.symbol,
        name: input.name,
        price: { mode: "preferred", criteria: {} },
      },
      quoteRead,
      undefined,
      false,
      formatTimestamp,
    );
    const continuous =
      quoteRead?.price_context?.session?.state === "continuous";
    const drawn = chartRead
      ? periodPath(input.period, chartRead, quoteRead, continuous)
      : {};
    delete item.pathState;
    const failed = (query: typeof quoteQuery) =>
      Boolean(query?.error) ||
      (isRead(query?.data) && query.data.result.outcome === "error");
    const chartMessage =
      plan?.unavailable.get(input.period) ??
      (listQuery?.error
        ? "The source's price series could not be listed."
        : undefined) ??
      (failed(chartQuery) ? "This chart could not be loaded." : undefined) ??
      drawn.message;
    const quoteLoading = quoteQuery?.isPending ?? true;
    return {
      state: quoteLoading && !quoteQuery?.data ? "loading" : "ready",
      ...(failed(quoteQuery)
        ? { message: "The price could not be loaded." }
        : {}),
      data: {
        item: {
          ...item,
          ...(drawn.path
            ? { path: drawn.path }
            : { pathState: chartMessage ? "unavailable" : "loading" }),
        },
        period: input.period,
        periods: CHART_PERIODS.map((id) => ({
          id,
          label: CHART_PERIOD_LABELS[id],
          ...(plan?.unavailable.get(id)
            ? { unavailable: plan.unavailable.get(id) }
            : {}),
        })),
        periodChange: periodChange(input.period, drawn.path),
        chartMessage,
        chartLoading: !chartMessage && !drawn.path,
        stats: statistics(quoteRead, yearRead, (plan?.year?.days ?? 0) >= 365),
        statsLoading: Boolean(plan?.year && yearQuery?.isPending),
        quoteLoading,
      },
    };
  },
};
