import type {
  InstrumentDisplay,
  InstrumentPath,
  InstrumentStat,
} from "@pythia/ui";
// Invented symbols, sessions and values. Design examples, never product data.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Deterministic walk so every render shows the same synthetic path. */
function walk(count: number, start: number, seed: number) {
  let value = start;
  let state = seed;
  return Array.from({ length: count }, () => {
    state = (state * 16_807) % 2_147_483_647;
    value += (state / 2_147_483_647 - 0.49) * start * 0.004;
    return Number(value.toFixed(2));
  });
}
function bars(
  from: number,
  to: number,
  step: number,
  start: number,
  seed: number,
) {
  const count = Math.floor((to - from) / step) + 1;
  return walk(count, start, seed).map((value, i) => ({
    time: from + i * step,
    value,
  }));
}

const base: Omit<InstrumentDisplay, "path"> = {
  id: "synthetic-chart",
  ticker: "NORTH",
  name: "Synthetic Northwind N.V.",
  price: 101.84,
  unit: "EUR",
  status: "closed",
  activity: { session: "closed", data: "delayed", delayMinutes: 15 },
  statusLabel: "Market closed",
  description: "Synthetic design fixture; not an actual investment or quote",
  change: { absolute: 1.84, percent: 1.84, basis: "Since previous close" },
};

// A European regular session, 09:00–17:30 Amsterdam, complete.
const euOpen = Date.parse("2026-01-09T08:00:00Z");
const euClose = Date.parse("2026-01-09T16:30:00Z");
const euDay: InstrumentPath = {
  points: bars(euOpen, euClose - 5 * MINUTE, 5 * MINUTE, 100.4, 7),
  baseline: { value: 100, label: "Synthetic previous close" },
  label: "Synthetic 5-minute bars · regular session",
  intervalMs: 5 * MINUTE,
  session: { start: euOpen, end: euClose },
  regularSession: { start: euOpen, end: euClose },
  timeZone: "Europe/Amsterdam",
};

// A US day with pre-market 04:00, regular 09:30–16:00, post until 20:00 ET.
const usPre = Date.parse("2026-01-09T09:00:00Z");
const usOpen = Date.parse("2026-01-09T14:30:00Z");
const usClose = Date.parse("2026-01-09T21:00:00Z");
const usPostEnd = Date.parse("2026-01-10T01:00:00Z");
function usDay(until: number, seed: number): InstrumentPath {
  return {
    points: bars(usPre, until, 5 * MINUTE, 50.2, seed),
    baseline: { value: 50, label: "Synthetic previous close" },
    label: "Synthetic 5-minute bars · regular and extended hours",
    intervalMs: 5 * MINUTE,
    session: { start: usPre, end: usPostEnd },
    regularSession: { start: usOpen, end: usClose },
    timeZone: "America/New_York",
  };
}
const usBase = {
  ...base,
  ticker: "CEDAR",
  name: "Synthetic Cedar Corp.",
  price: 50.61,
  unit: "USD",
};

// Pre-market: the prior regular session, its omitted night, then today's pre.
const prevOpen = usOpen - DAY;
const prevClose = usClose - DAY;
const preNow = Date.parse("2026-01-09T12:40:00Z");
const preMarket: InstrumentPath = {
  points: [
    ...bars(prevOpen, prevClose - 5 * MINUTE, 5 * MINUTE, 50, 11),
    ...bars(usPre, preNow, 5 * MINUTE, 50.9, 12),
  ],
  baseline: { value: 49.7, label: "Synthetic close before the prior session" },
  label:
    "Synthetic prior regular session and today's pre-market; the closed night is omitted",
  intervalMs: 5 * MINUTE,
  session: { start: prevOpen, end: usOpen },
  regularSession: { start: prevOpen, end: prevClose },
  sessionGap: { start: prevClose, end: usPre },
  timeZone: "America/New_York",
};

// Five European sessions in calendar time and with the nights omitted.
const days = [5, 6, 7, 8, 9].map((d) => ({
  open: Date.parse(`2026-01-0${d}T08:00:00Z`),
  close: Date.parse(`2026-01-0${d}T16:30:00Z`),
}));
const fivePoints = days.flatMap((day, i) =>
  bars(day.open, day.close - 5 * MINUTE, 5 * MINUTE, 98 + i * 0.8, 20 + i),
);
const fiveWindow = {
  start: Date.parse("2026-01-04T12:00:00Z"),
  end: Date.parse("2026-01-09T18:00:00Z"),
};
const fiveCalendar: InstrumentPath = {
  points: fivePoints,
  baseline: {
    value: fivePoints[0]?.value ?? 98,
    label: "First observation in this period",
  },
  label: "Synthetic 5-minute bars · past 5 days, calendar time",
  intervalMs: 5 * MINUTE,
  window: fiveWindow,
  timeZone: "Europe/Amsterdam",
};
const fiveCompressed: InstrumentPath = {
  ...fiveCalendar,
  label:
    "Synthetic 5-minute bars · five sessions; closed nights and the weekend are omitted",
  window: undefined,
  session: { start: days[0]?.open ?? 0, end: days[4]?.close ?? 0 },
  sessionGaps: days
    .slice(1)
    .map((day, i) => ({ start: days[i]?.close ?? 0, end: day.open })),
};

// One year of daily closes as session dates (UTC midnights).
const yearStart = Date.UTC(2025, 0, 9);
const yearPoints = walk(365, 80, 3)
  .map((value, i) => ({ time: yearStart + i * DAY, value }))
  .filter((p) => ![0, 6].includes(new Date(p.time).getUTCDay()));
const year: InstrumentPath = {
  points: yearPoints,
  baseline: {
    value: yearPoints[0]?.value ?? 80,
    label: "First close in this period",
  },
  label: "Synthetic daily closes · session dates",
  window: { start: yearStart, end: Date.UTC(2026, 0, 9) },
  dates: true,
};

export const chartExamples = {
  euDay: { ...base, path: euDay },
  usOpen: {
    ...usBase,
    status: "live",
    activity: { session: "open", data: "current" },
    path: usDay(Date.parse("2026-01-09T17:05:00Z"), 5),
  },
  usPost: {
    ...usBase,
    status: "extended",
    activity: { session: "post", data: "delayed", delayMinutes: 15 },
    extended: {
      label: "After hours",
      price: 50.92,
      percent: 0.61,
      absolute: 0.31,
      time: "18:40",
    },
    path: { ...usDay(Date.parse("2026-01-09T23:40:00Z"), 6), live: true },
  },
  usPre: {
    ...usBase,
    status: "extended",
    activity: { session: "pre", data: "delayed", delayMinutes: 15 },
    extended: {
      label: "Pre-market",
      price: 51.1,
      percent: 0.97,
      absolute: 0.49,
      time: "07:40",
    },
    path: { ...preMarket, live: true },
  },
  fiveCalendar: { ...base, path: fiveCalendar },
  fiveCompressed: { ...base, path: fiveCompressed },
  year: { ...base, path: year },
  loading: { ...base, path: undefined, pathState: "loading" },
} satisfies Record<string, InstrumentDisplay>;

export const chartStats: InstrumentStat[] = [
  { id: "open", label: "Open", value: 100.52, detail: "Synthetic daily bar" },
  { id: "high", label: "High", value: 102.3, detail: "Synthetic daily bar" },
  { id: "low", label: "Low", value: 99.87, detail: "Synthetic daily bar" },
  {
    id: "previous-close",
    label: "Prev close",
    value: 100,
    detail: "Synthetic",
  },
  {
    id: "volume",
    label: "Volume",
    value: 1_284_311,
    format: "quantity",
    detail: "Synthetic daily bar volume",
  },
  {
    id: "range-52w",
    label: "52-week range",
    range: { low: 71.2, high: 108.45 },
    detail: "Synthetic daily highs and lows",
  },
];
