import type { InstrumentPath } from "./types";
/** Time-scaled segments; gaps mean absent interval buckets, not timestamp jitter. */
export function instrumentPathGeometry(series: InstrumentPath) {
  const points = series.points;
  if (series.window && series.session) return null;
  const domain = series.window ?? series.session;
  const first = points[0],
    last = points.at(-1);
  if (
    !first ||
    !last ||
    (points.length < 2 && !domain) ||
    points.length > 2000 ||
    points.some(
      (p, i) =>
        !Number.isFinite(p.time) ||
        !Number.isFinite(p.value) ||
        (i > 0 && p.time <= (points[i - 1]?.time ?? Infinity)),
    )
  )
    return null;
  const baseline = series.baseline?.value;
  if (baseline !== undefined && !Number.isFinite(baseline)) return null;
  const interval = series.intervalMs;
  if (interval !== undefined && (!Number.isFinite(interval) || interval <= 0))
    return null;
  const start = domain?.start ?? first.time;
  const end = domain?.end ?? last.time;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    first.time < start ||
    last.time > end
  )
    return null;
  const values = points.map((p) => p.value);
  if (baseline !== undefined) values.push(baseline);
  const low = Math.min(...values),
    high = Math.max(...values);
  const closedGap = series.sessionGap;
  if (
    closedGap &&
    (!domain ||
      !Number.isFinite(closedGap.start) ||
      !Number.isFinite(closedGap.end) ||
      closedGap.start <= start ||
      closedGap.end >= end ||
      closedGap.end <= closedGap.start ||
      points.some((p) => p.time > closedGap.start && p.time < closedGap.end))
  )
    return null;
  const skipped = closedGap ? closedGap.end - closedGap.start : 0;
  const x = (time: number) =>
    2 +
    (116 *
      (time - start - (closedGap && time >= closedGap.end ? skipped : 0))) /
      (end - start - skipped);
  const regular = series.regularSession;
  if (
    regular &&
    (!domain ||
      !Number.isFinite(regular.start) ||
      !Number.isFinite(regular.end) ||
      regular.start < start ||
      regular.end > end ||
      regular.end <= regular.start)
  )
    return null;
  const y = (value: number) =>
    high === low ? 17 : 32 - (30 * (value - low)) / (high - low);
  const segments: { path: string; startX: number; endX: number }[] = [];
  for (const [i, p] of points.entries()) {
    const previous = points[i - 1];
    const gap =
      !previous ||
      (interval !== undefined &&
        Math.floor(p.time / interval) - Math.floor(previous.time / interval) >
          1);
    const segment = segments.at(-1);
    if (gap || !segment)
      segments.push({
        path: `M${x(p.time)},${y(p.value)}`,
        startX: x(p.time),
        endX: x(p.time),
      });
    else {
      segment.path += ` L${x(p.time)},${y(p.value)}`;
      segment.endX = x(p.time);
    }
  }
  const baselineY = baseline === undefined ? undefined : y(baseline);
  return {
    segments: segments.map((s) => ({
      ...s,
      area:
        baselineY === undefined
          ? undefined
          : `${s.path} L${s.endX},${baselineY} L${s.startX},${baselineY} Z`,
    })),
    baselineY,
    flat: high === low,
    last: { x: x(last.time), y: y(last.value), value: last.value },
    extendedX:
      series.extendedFrom === undefined
        ? undefined
        : Math.max(0, Math.min(120, x(series.extendedFrom))),
    regularX: regular
      ? {
          start: regular.start === start ? 0 : x(regular.start),
          end: regular.end === end ? 120 : x(regular.end),
        }
      : undefined,
  };
}
