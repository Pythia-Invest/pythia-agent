import { expect, test } from "vitest";
import type { InstrumentDisplay } from "../src/market-widgets";
import { instrumentPathGeometry } from "../src/market-widgets/path-geometry";
const item: InstrumentDisplay = {
  id: "synthetic:one",
  ticker: "ONE",
  name: "Synthetic One",
  price: 42.5,
  status: "live",
  statusLabel: "Synthetic live quote",
  description: "Synthetic provider · USD · test timestamp",
  change: { percent: 2 },
  path: {
    label: "Synthetic price path",
    baseline: { label: "Same-feed previous close", value: 42 },
    intervalMs: 60,
    points: [
      { time: 0, value: 41 },
      { time: 60, value: 43 },
      { time: 240, value: 41 },
    ],
  },
};

test("rolling windows retain missing edges and sampling gaps independently of sessions", () => {
  const hour = 3600000;
  const window = { start: 0, end: 7 * 24 * hour };
  const path = {
    label: "Synthetic 7d samples",
    window,
    intervalMs: hour,
    points: [
      { time: hour, value: 10 },
      { time: 2 * hour, value: 12 },
      { time: 4 * hour, value: 9 },
    ],
  };
  const geometry = instrumentPathGeometry(path);
  expect(geometry?.last.x).toBeCloseTo(2 + (116 * 4) / 168);
  expect(geometry?.segments).toHaveLength(2);
  expect(instrumentPathGeometry({ ...path, session: window })).toBeNull();
});
test("extended sessions retain scheduled cutoffs and reject a regular window outside the chart", () => {
  const path = {
    label: "Synthetic pre-market",
    session: { start: 0, end: 1000 },
    regularSession: { start: 250, end: 750 },
    points: [{ time: 100, value: 10 }],
  };
  const geometry = instrumentPathGeometry(path);
  expect(geometry?.regularX).toEqual({ start: 31, end: 89 });
  expect(geometry?.last.x).toBeCloseTo(13.6);
  const continuation = instrumentPathGeometry({
    label: "Prior session then pre-market",
    session: { start: 0, end: 1000 },
    regularSession: { start: 0, end: 300 },
    sessionGap: { start: 300, end: 700 },
    intervalMs: 100,
    points: [
      { time: 0, value: 9 },
      { time: 300, value: 10 },
      { time: 700, value: 11 },
      { time: 800, value: 12 },
    ],
  });
  expect(continuation?.regularX).toEqual({ start: 0, end: 60 });
  expect(continuation?.last.x).toBeCloseTo(79.3333);
  expect(
    instrumentPathGeometry({ ...path, sessionGap: { start: 50, end: 200 } }),
  ).toBeNull();
  expect(
    instrumentPathGeometry({
      ...path,
      regularSession: { start: -1, end: 750 },
    }),
  ).toBeNull();
});
test("time geometry retains gaps, colors around an explicit baseline, and rejects malformed order", () => {
  const path = item.path;
  if (!path) throw Error();
  const geometry = instrumentPathGeometry(path);
  expect(geometry?.segments).toHaveLength(2);
  expect(geometry?.segments[0]?.endX).toBe(31);
  expect(geometry?.segments[1]?.startX).toBe(118);
  expect(geometry?.baselineY).toBe(17);
  expect(
    instrumentPathGeometry({ ...path, baseline: undefined })?.baselineY,
  ).toBeUndefined();
  expect(
    instrumentPathGeometry({
      ...path,
      points: [
        { time: 1, value: 3 },
        { time: 1, value: 4 },
      ],
    }),
  ).toBeNull();
});
test("minute timestamp jitter stays connected while an absent minute leaves a gap", () => {
  const point = (minute: string) => ({
    time: Date.parse(`2026-01-02T10:${minute}Z`),
    value: 42,
  });
  const path = {
    label: "Synthetic intraday observations",
    intervalMs: 60000,
    points: [point("11:00"), point("12:15")],
  };
  expect(instrumentPathGeometry(path)?.segments).toHaveLength(1);
  // Keep actual timestamps; do not round or move the final observation.
  expect(
    instrumentPathGeometry({
      ...path,
      points: [point("11:59"), point("13:00")],
    })?.segments,
  ).toHaveLength(2);
  expect(
    instrumentPathGeometry({
      ...path,
      points: [point("11:00"), point("13:15")],
    })?.segments,
  ).toHaveLength(2);
});
test("a partial session retains its time position as observations arrive, including the opening point", () => {
  const path = {
    label: "Synthetic session",
    session: { start: 0, end: 600 },
    baseline: { value: 42, label: "Previous close" },
    points: [
      { time: 0, value: 42 },
      { time: 60, value: 43 },
    ],
  };
  expect(instrumentPathGeometry(path)?.last.x).toBeCloseTo(13.6);
  const next = instrumentPathGeometry({
    ...path,
    points: [...path.points, { time: 120, value: 44 }],
  });
  expect(next?.last.x).toBeCloseTo(25.2);
  expect(next?.segments[0]?.path).toContain("L13.6,");
  expect(
    instrumentPathGeometry({ ...path, points: path.points.slice(0, 1) })?.last
      .x,
  ).toBe(2);
  expect(
    instrumentPathGeometry({ ...path, session: { start: 0, end: 30 } }),
  ).toBeNull();
  expect(
    instrumentPathGeometry({ ...path, session: { start: 600, end: 0 } }),
  ).toBeNull();
});
