import type { InstrumentPath } from "@pythia/widget-sdk";
import type { ReadResult } from "../index";
import { decimalNumber, seriesSemantics } from "./display";
import { DAY, intervalMs, periodStart, type ChartPeriod } from "./chart-plan";
import { localDate, points, type Point } from "./chart-view";

/** Most points a page chart draws; sources may return more. */
export const DRAW_POINTS = 800;

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

/** The kept points with the bar length the line breaks at. A downsampled
 * point stands for up to two buckets of bars, so only a longer pause breaks
 * a downsampled line. */
function bars(list: readonly Point[], bar: number) {
  const kept = downsample(list);
  if (!(bar > 0)) return { points: kept };
  const span =
    kept.length === list.length
      ? 1
      : Math.ceil((2 * list.length) / kept.length) + 1;
  return { points: kept, intervalMs: bar * span };
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

const HOUR = 3_600_000;

/** Sessions by the exchange's local date when its zone is known; otherwise
 * split where the data pauses (longer than three hours or four bars). */
function sessions(
  list: readonly Point[],
  zone: string | undefined,
  bar: number,
) {
  const groups: Point[][] = [];
  // Long enough that a midday break (Tokyo, Hong Kong) stays one session.
  const pause = Math.max(4 * bar, 3 * HOUR);
  let key: string | undefined;
  let previous: Point | undefined;
  for (const p of list) {
    const next = zone ? localDate(p.time, zone) : undefined;
    const split = zone
      ? next !== key
      : !previous || p.time - previous.time > pause;
    if (split || !groups.length) groups.push([]);
    (groups.at(-1) as Point[]).push(p);
    key = next;
    previous = p;
  }
  return groups;
}

/** Trades around the clock: the latest unbroken run lasts most of a day. */
function roundTheClock(list: readonly Point[], bar: number) {
  const last = sessions(list, undefined, bar).at(-1);
  return Boolean(
    last && (last.at(-1) as Point).time - (last[0] as Point).time >= 20 * HOUR,
  );
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

/** 1D on the instrument page (ADR 0041): the supplied session from
 * pre-market through after-hours; before the open, the prior session with
 * its extended hours, its closed night omitted, then today's pre-market.
 * A tile keeps the September tile window (docs/architecture/markets-overview.md;
 * ADR 0041 rejects it for the page): the regular session, followed by
 * after-hours once the close has passed; before the open, the prior regular
 * session, the closed time omitted, then today's pre-market. */
function oneDay(
  result: ReadResult,
  quote: ReadResult | undefined,
  all: Point[],
  detail: string,
  now: number,
  tile: boolean,
): Drawn {
  const series = result.series;
  const session = result.price_context?.session_window;
  const bar = series ? intervalMs(series) : 0;
  if (!series || !session) {
    // No schedule: the last session as returned. An unfinished session is
    // drawn at the length of the one before it, never stretched to fill.
    const groups = sessions(all, undefined, bar);
    const last = groups.at(-1);
    const first = last?.[0];
    if (!last || !first) return { message: "No trades in the last session." };
    const prior = groups.at(-2);
    const length = prior
      ? (prior.at(-1) as Point).time - (prior[0] as Point).time + bar
      : 0;
    const date = localDate(first.time, undefined);
    return {
      path: {
        ...bars(last, bar),
        label: `${detail} · Last session as returned; the source supplies no trading schedule`,
        session: {
          start: first.time,
          end: Math.max((last.at(-1) as Point).time + bar, first.time + length),
        },
        baseline: sessionBaseline(result, quote, undefined, date) ?? {
          value: first.value,
          label: "First observation in this series window",
        },
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
  // The source names the prior session only before today's open.
  const pre = previous
    ? tile || series.session === "regular"
      ? span(previous.regular)
      : span(previous.extended)
    : undefined;
  // Today's pre-market follows the omitted night when the series has it.
  const gap =
    pre && extended.start < today.start
      ? { start: pre.end, end: extended.start }
      : undefined;
  const bounds = pre
    ? { start: pre.start, end: gap ? today.start : pre.end }
    : tile
      ? {
          start: now < today.start ? extended.start : today.start,
          end: now < today.end ? today.end : extended.end,
        }
      : extended;
  const drawn = all.filter(
    (p) =>
      p.time >= bounds.start &&
      p.time <= bounds.end &&
      !(gap && p.time >= gap.start && p.time < gap.end),
  );
  const date =
    pre && previous
      ? localDate(Date.parse(previous.regular.start), session.timezone)
      : session.date;
  if (!drawn.length)
    return { message: `No trades yet in the ${session.date} session.` };
  const baseline = sessionBaseline(result, quote, session.timezone, date);
  const regular = pre && previous ? span(previous.regular) : today;
  const hours =
    bounds.start < regular.start || bounds.end > regular.end
      ? "regular and extended"
      : "regular";
  return {
    path: {
      ...bars(drawn, bar),
      label: gap
        ? `${detail} · Session ${date}, then pre-market ${session.date} (${session.timezone}); the time between them is omitted`
        : `${detail} · Session ${date} (${session.timezone}), ${hours} hours`,
      session: bounds,
      regularSession: regular,
      ...(gap ? { sessionGap: gap } : {}),
      ...(baseline ? { baseline } : {}),
    },
  };
}

/**
 * The selected period's path. Multi-day views join regular sessions and omit
 * the closed time between them; a gap inside a session stays visible. The
 * baseline is the close before the period when the read reaches it. `tile`
 * draws 1D as a tile does. A path from fresh pushed bars is live.
 */
export function periodPath(
  period: ChartPeriod,
  result: ReadResult,
  quote: ReadResult | undefined,
  continuous: boolean,
  now = Date.now(),
  tile = false,
): Drawn {
  const drawn = draw(period, result, quote, continuous, now, tile);
  if (
    drawn.path &&
    result.series?.read_support?.updates === "push" &&
    result.freshness.status === "fresh"
  )
    drawn.path.live = true;
  return drawn;
}

function draw(
  period: ChartPeriod,
  result: ReadResult,
  quote: ReadResult | undefined,
  continuous: boolean,
  now: number,
  tile: boolean,
): Drawn {
  const series = result.series;
  if (!series || result.outcome === "error") return {};
  const all = points(result);
  const detail = `${seriesSemantics(series)} · ${result.coverage.status} coverage`;
  const bar = intervalMs(series);
  const dates = series.time_anchor === "session_date";
  const daily = series.interval.kind === "day";
  // Sources without a schedule may still trade around the clock (crypto,
  // FX, futures on Yahoo): those use elapsed time like continuous markets.
  const clock =
    continuous ||
    (!daily &&
      !result.price_context?.session_window &&
      roundTheClock(all, bar));
  if (period === "1D" && !clock)
    return oneDay(result, quote, all, detail, now, tile);
  const before = (list: Point[], start: number) =>
    list.filter((p) => p.time < start).at(-1);
  const baseline = (prior: Point | undefined, first: Point) =>
    prior
      ? {
          value: prior.value,
          label: `Close before this period (${new Date(prior.time).toISOString().slice(0, 10)})`,
        }
      : { value: first.value, label: "First observation available" };
  if (clock && !daily) {
    // Continuous markets have no closed time: elapsed time, rolling window.
    const days = period === "1D" ? 1 : period === "5D" ? 5 : 30;
    // A market closed for the weekend (FX, futures) ends at its last trade.
    const latest = all.at(-1)?.time ?? now;
    const end = now - latest > 3 * HOUR ? latest : now;
    const window = { start: end - days * DAY, end };
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
  if (daily) {
    const start = periodStart(period, now);
    groups = all
      .filter((p) => start === undefined || p.time >= start)
      .map((p) => [p]);
  } else {
    const zone = result.price_context?.session_window?.timezone;
    const all_sessions = sessions(all, zone, bar);
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
  const step = daily ? series.interval.count * DAY : bar;
  // Weekly bars are consecutive; daily bars skip closed days.
  const gaps = compressed(groups, step);
  return {
    path: {
      ...bars(drawn, daily ? 0 : bar),
      label: `${detail} · ${daily ? "Daily or weekly bars" : "Regular sessions"}; closed time between sessions omitted`,
      session: { start: first.time, end: last.time + step },
      ...(gaps.length ? { sessionGaps: gaps } : {}),
      ...(dates ? { dates: true } : {}),
      baseline: baseline(before(all, first.time), first),
    },
  };
}
