import type { InstrumentPath } from "@pythia/widget-sdk";
import type { ReadResult } from "../index";
import { decimalNumber, seriesSemantics } from "./display";
import { DAY, intervalMs, periodStart, type ChartPeriod } from "./chart-plan";
import { points, type Point } from "./chart-view";

/** Most points a page chart draws; sources may return more. */
export const DRAW_POINTS = 800;

function localDate(time: number, zone: string | undefined) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone ?? "UTC" }).format(
      time,
    );
  } catch {
    return undefined;
  }
}

/** Largest-triangle-three-buckets: keeps real observations, including the
 * first and last, that best preserve the path's shape. */
export function downsample(list: readonly Point[], target = DRAW_POINTS) {
  if (list.length <= target) return [...list];
  const kept: Point[] = [list[0] as Point];
  const size = (list.length - 2) / (target - 2);
  let anchor = 0;
  for (let bucket = 0; bucket < target - 2; bucket++) {
    const from = Math.floor(bucket * size) + 1;
    const to = Math.min(Math.floor((bucket + 1) * size) + 1, list.length - 1);
    const next = list.slice(
      to,
      Math.min(Math.floor((bucket + 2) * size) + 1, list.length),
    );
    const avg = next.reduce(
      (sum, p) => ({
        time: sum.time + p.time / next.length,
        value: sum.value + p.value / next.length,
      }),
      { time: 0, value: 0 },
    );
    const a = list[anchor] as Point;
    let best = from,
      area = -1;
    for (let i = from; i < to; i++) {
      const p = list[i] as Point;
      const current = Math.abs(
        (a.time - avg.time) * (p.value - a.value) -
          (a.time - p.time) * (avg.value - a.value),
      );
      if (current > area) {
        area = current;
        best = i;
      }
    }
    kept.push(list[best] as Point);
    anchor = best;
  }
  kept.push(list.at(-1) as Point);
  return kept;
}

/** Downsampled paths cannot tell a missing bar from a dropped one. */
function bars(list: readonly Point[], bar: number) {
  const kept = downsample(list);
  return kept.length === list.length && bar > 0
    ? { points: kept, intervalMs: bar }
    : { points: kept };
}

/** Consecutive sessions joined into one line: the closed time between them
 * is omitted; a gap inside a session stays a gap. */
function compressed(groups: Point[][], bar: number) {
  const gaps: { start: number; end: number }[] = [];
  for (let i = 1; i < groups.length; i++) {
    const before = (groups[i - 1] as Point[]).at(-1) as Point;
    const after = (groups[i] as Point[])[0] as Point;
    const start = Math.min(before.time + bar, after.time - 1);
    if (after.time - start > bar) gaps.push({ start, end: after.time });
  }
  return gaps;
}

function sessions(list: readonly Point[], zone: string | undefined) {
  const groups = new Map<string, Point[]>();
  for (const p of list) {
    const key = localDate(p.time, zone) ?? "";
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.values()];
}

type Drawn = { path?: InstrumentPath; message?: string };

/** The previous close from the quote when it belongs to the drawn session. */
function sessionBaseline(
  result: ReadResult,
  quote: ReadResult | undefined,
  zone: string | undefined,
  date: string | undefined,
) {
  const close =
    result.price_context?.reference_close ??
    quote?.price_context?.reference_close;
  const observed = quote?.observations.at(-1)?.time;
  const same =
    result.price_context?.reference_close ||
    (observed?.kind === "instant" &&
      localDate(Date.parse(observed.value), zone) === date);
  const value =
    close && same ? decimalNumber(close.value, close.unit.scale) : null;
  return value !== null && close
    ? { value, label: `Previous close · ${close.dataset}` }
    : undefined;
}

/** 1D: the supplied session with pre/post-market; before the open, the prior
 * session, its closed night omitted, then today's pre-market. */
function oneDay(
  result: ReadResult,
  quote: ReadResult | undefined,
  all: Point[],
  detail: string,
): Drawn {
  const series = result.series;
  const session = result.price_context?.session_window;
  const bar = series ? intervalMs(series) : 0;
  if (!series || !session) {
    // No schedule: the last session as returned, with its own bounds.
    const last = sessions(all, undefined).at(-1);
    const first = last?.[0];
    if (!last || !first) return { message: "No trades in the last session." };
    const date = localDate(first.time, undefined);
    const baseline = sessionBaseline(result, quote, undefined, date);
    return {
      path: {
        ...bars(last, bar),
        label: `${detail} · Last session ${date} as returned; the source supplies no trading schedule`,
        session: { start: first.time, end: (last.at(-1) as Point).time + bar },
        ...(baseline ? { baseline } : {}),
      },
    };
  }
  const span = (b: { start: string; end: string }) => ({
    start: Date.parse(b.start),
    end: Date.parse(b.end),
  });
  const today = span(session.regular);
  const extended =
    series.session === "regular" ? today : span(session.extended);
  const previous = session.previous;
  const prior = previous
    ? series.session === "regular"
      ? span(previous.regular)
      : span(previous.extended)
    : undefined;
  const pre = prior && prior.end < extended.start ? prior : undefined;
  const bounds = pre ? { start: pre.start, end: today.start } : extended;
  const gap = pre ? { start: pre.end, end: extended.start } : undefined;
  const drawn = all.filter(
    (p) =>
      p.time >= bounds.start &&
      p.time <= bounds.end &&
      !(gap && p.time > gap.start && p.time < gap.end),
  );
  const date =
    pre && previous
      ? localDate(Date.parse(previous.regular.start), session.timezone)
      : session.date;
  if (!drawn.length)
    return { message: `No trades yet in the ${session.date} session.` };
  const baseline = sessionBaseline(result, quote, session.timezone, date);
  return {
    path: {
      ...bars(drawn, bar),
      label: pre
        ? `${detail} · Session ${date}, then pre-market ${session.date} (${session.timezone}); the time between them is omitted`
        : `${detail} · Session ${session.date} (${session.timezone}), ${series.session === "regular" ? "regular" : "regular and extended"} hours`,
      session: bounds,
      regularSession: pre && previous ? span(previous.regular) : today,
      ...(gap ? { sessionGap: gap } : {}),
      ...(baseline ? { baseline } : {}),
    },
  };
}

/**
 * The selected period's path. Multi-day views join regular sessions and omit
 * the closed time between them; a gap inside a session stays visible. The
 * baseline is the close before the period when the read reaches it.
 */
export function periodPath(
  period: ChartPeriod,
  result: ReadResult,
  quote: ReadResult | undefined,
  continuous: boolean,
  now = Date.now(),
): Drawn {
  const series = result.series;
  if (!series || result.outcome === "error") return {};
  const all = points(result);
  const detail = `${seriesSemantics(series)} · ${result.coverage.status} coverage`;
  const bar = intervalMs(series);
  const dates = series.time_anchor === "session_date";
  if (period === "1D" && !continuous) return oneDay(result, quote, all, detail);
  const before = (list: Point[], start: number) =>
    list.filter((p) => p.time < start).at(-1);
  const baseline = (prior: Point | undefined, first: Point) =>
    prior
      ? {
          value: prior.value,
          label: `Close before this period (${new Date(prior.time).toISOString().slice(0, 10)})`,
        }
      : { value: first.value, label: "First observation available" };
  if (continuous && !dates) {
    // Continuous markets have no closed time: elapsed time, rolling window.
    const days = period === "1D" ? 1 : period === "5D" ? 5 : 30;
    const window = { start: now - days * DAY, end: now };
    const inside = all.filter(
      (p) => p.time >= window.start && p.time <= window.end,
    );
    const first = inside[0];
    if (!first) return { message: "No observations in this period." };
    return {
      path: {
        ...bars(inside, bar),
        label: `${detail} · Past ${days === 1 ? "24 hours" : `${days} days`}`,
        window,
        baseline: baseline(before(all, window.start), first),
      },
    };
  }
  let groups: Point[][];
  if (dates) {
    const start = periodStart(period, now);
    groups = all
      .filter((p) => start === undefined || p.time >= start)
      .map((p) => [p]);
  } else {
    const zone = result.price_context?.session_window?.timezone;
    const all_sessions = sessions(all, zone);
    const start = periodStart(period, now);
    groups =
      period === "5D"
        ? all_sessions.slice(-5)
        : all_sessions.filter(
            (g) => start === undefined || (g.at(-1) as Point).time >= start,
          );
  }
  const drawn = groups.flat();
  const first = drawn[0];
  const last = drawn.at(-1);
  if (!first || !last) return { message: "No observations in this period." };
  const step = dates ? (series.interval.count === 7 ? 7 * DAY : DAY) : bar;
  // Weekly bars are consecutive; daily bars skip closed days.
  const gaps = compressed(groups, step);
  return {
    path: {
      ...bars(drawn, dates ? 0 : bar),
      label: `${detail} · ${dates ? "Session dates" : "Regular sessions"}; closed time between sessions omitted`,
      session: { start: first.time, end: last.time + step },
      ...(gaps.length ? { sessionGaps: gaps } : {}),
      ...(dates ? { dates: true } : {}),
      baseline: baseline(before(all, first.time), first),
    },
  };
}
