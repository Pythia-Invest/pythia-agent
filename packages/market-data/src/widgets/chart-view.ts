import type {
  InstrumentPath,
  InstrumentPeriodChange,
  InstrumentStat,
} from "@pythia/widget-sdk";
import type { ReadResult } from "../index";
import { decimalNumber, seriesField, seriesSemantics } from "./display";
import {
  DAY,
  MAX_POINTS,
  WORDS,
  intervalMs,
  periodStart,
  type ChartPeriod,
} from "./chart-plan";

/** Paths, period changes and statistics from supplied reads only. */
export type Point = { time: number; value: number };
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
export function periodPath(
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

export function periodChange(
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
export function statistics(
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
