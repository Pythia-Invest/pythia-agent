import type {
  InstrumentPath,
  InstrumentPeriodChange,
  InstrumentStat,
} from "@pythia/widget-sdk";
import type { ReadResult } from "../index";
import { decimalNumber, seriesField } from "./display";
import { DAY, WORDS, type ChartPeriod } from "./chart-plan";

/** Paths, period changes and statistics from supplied reads only. */
export type Point = { time: number; value: number };
/** A time's calendar date (YYYY-MM-DD) in a time zone, UTC when none. */
export function localDate(time: number, zone: string | null | undefined) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone ?? "UTC" }).format(
      time,
    );
  } catch {
    return undefined;
  }
}
export function points(
  result: ReadResult,
  field: "close" | "high" | "low" = "close",
) {
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

const DAY_MONTH = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

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
  // A source may leave the quote's session out of its daily bars until that
  // session settles (Yahoo sends its bar without a close), so the latest bar
  // can be an earlier session than the price: its values then name their date.
  const quoted = quote?.observations.at(-1)?.time;
  const quoteDay =
    quoted?.kind === "instant"
      ? localDate(
          Date.parse(quoted.value),
          quote?.series?.timezone ?? series?.timezone,
        )
      : quoted?.kind === "session_date"
        ? quoted.value
        : undefined;
  const earlier =
    bar?.time.kind === "session_date" &&
    quoteDay !== undefined &&
    bar.time.value < quoteDay
      ? ` (${DAY_MONTH.format(Date.parse(bar.time.value))})`
      : "";
  if (bar?.shape === "ohlc" && series) {
    const date = bar.time.kind === "unknown" ? "date unknown" : bar.time.value;
    const detail = `Daily bar for ${date} · ${series.dataset} · completion ${bar.completion.state}`;
    stats.push(
      {
        id: "open",
        label: `Open${earlier}`,
        value: decimalNumber(bar.open, scale),
        detail,
      },
      {
        id: "high",
        label: `High${earlier}`,
        value: decimalNumber(bar.high, scale),
        detail,
      },
      {
        id: "low",
        label: `Low${earlier}`,
        value: decimalNumber(bar.low, scale),
        detail,
      },
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
      label: `Volume${earlier}`,
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
