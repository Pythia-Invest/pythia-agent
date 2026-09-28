import { record } from "./yahoo.js";
/** Yahoo trading schedules and pre/post quotes, read from the source's own
 * periods; never assumed hours. */
export const number = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
export const stamp = (v: unknown) =>
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
export function lastSession(meta: Record<string, unknown>, now: number) {
  const all = schedules(meta, now);
  const current = all[0];
  // Before today's open, the last session precedes today's pre-market.
  const previous =
    current && now < current.regular.start
      ? all.find((p) => p.end <= current.start)
      : undefined;
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
    ...(previous
      ? {
          previous: {
            regular: {
              start: iso(previous.regular.start),
              end: iso(previous.regular.end),
            },
            extended: { start: iso(previous.start), end: iso(previous.end) },
          },
        }
      : {}),
  };
}
/** Yahoo's latest pre/post trade with its own time; the connector decides
 * whether it belongs to the displayed regular close. */
export function extendedQuote(q: Record<string, unknown>) {
  const pre = q.marketState === "PRE";
  const price = number(pre ? q.preMarketPrice : q.postMarketPrice);
  const time = stamp(pre ? q.preMarketTime : q.postMarketTime);
  if (price === null || time === null) return null;
  return {
    session: pre ? "pre" : "post",
    price,
    change: number(pre ? q.preMarketChange : q.postMarketChange),
    percent: number(pre ? q.preMarketChangePercent : q.postMarketChangePercent),
    time: new Date(time).toISOString(),
  };
}
export function equitySession(meta: Record<string, unknown>, now: number) {
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
export function sessionWindow(
  meta: Record<string, unknown>,
  points: { t: number }[],
) {
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
