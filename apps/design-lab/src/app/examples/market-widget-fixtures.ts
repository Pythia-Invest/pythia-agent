import type { InstrumentDisplay, InstrumentStatus } from "@pythia/ui";
// Invented symbols and values. These are design examples, never product data.
const statuses: InstrumentStatus[] = [
  "live",
  "delayed",
  "extended",
  "closed",
  "halted",
  "unavailable",
  "unknown",
];
export const widgetExamples: InstrumentDisplay[] = statuses.map(
  (status, i) => ({
    id: `synthetic-${i}`,
    ticker:
      ["NORTH", "CEDAR", "LUMEN", "BIRCH", "ORBIT", "MISSING", "UNKNOWN"][i] ??
      "EXAMPLE",
    name: `Synthetic instrument ${i + 1}`,
    price: 100 + i,
    unit: "USD",
    status,
    ...(status === "delayed"
      ? {
          activity: {
            session: "open" as const,
            data: "delayed" as const,
            delayMinutes: 15,
          },
        }
      : status === "extended"
        ? { activity: { session: "pre" as const, data: "snapshot" as const } }
        : {}),
    statusLabel: `Synthetic ${status} status`,
    note:
      status === "live"
        ? undefined
        : status === "delayed"
          ? "15m delay"
          : status === "extended"
            ? "Close Fri"
            : status === "closed"
              ? "Closed 16:00"
              : status === "halted"
                ? "Halted 10:14"
                : status === "unavailable"
                  ? "No data"
                  : "Time unknown",
    description: "Synthetic design fixture; not an actual investment or quote",
    change: { absolute: 1.2, percent: 1.2, basis: "Synthetic previous close" },
    ohl: { open: 99, high: 107, low: 96 },
    path: {
      points: [100, 102, 99, 97, 98, 101, 103, 100, 99, 101, 102].map(
        (value, index) => ({ time: index * 60000, value }),
      ),
      baseline: { value: 100, label: "Synthetic previous close" },
      label: "Synthetic intraday path",
      intervalMs: 60000,
      session: { start: 0, end: (status === "closed" ? 10 : 30) * 60000 },
    },
    ...(status === "extended"
      ? {
          extended: { label: "Pre", price: 104.2, percent: 0.6, time: "07:42" },
        }
      : {}),
  }),
);
export const extraExamples: InstrumentDisplay[] = [
  {
    id: "synthetic-book",
    ticker: "NORTH",
    name: "Synthetic streaming equity",
    price: 100,
    unit: "USD",
    status: "live",
    statusLabel: "Market open",
    activity: { session: "open", data: "current" },
    description: "Synthetic venue-qualified streaming book",
    book: {
      bid: 99.98,
      ask: 100.02,
      bidSize: 120,
      askSize: 80,
      label: "Synthetic venue · sizes in shares",
    },
  },
  {
    ...(widgetExamples[2] as InstrumentDisplay),
    id: "after-hours",
    ticker: "DUSK",
    activity: { session: "post", data: "snapshot" },
    extended: {
      label: "Post",
      price: 103.2,
      absolute: 1.2,
      percent: 1.18,
      time: "17:42",
    },
    path: {
      label: "Synthetic after-hours path",
      session: { start: 0, end: 100 },
      regularSession: { start: 0, end: 75 },
      baseline: { value: 102, label: "Previous close" },
      points: [10, 20, 30, 40, 50, 60, 70, 75, 80, 85].map((time, i) => ({
        time,
        value: 101 + Math.sin(i) + i * 0.2,
      })),
    },
  },
  {
    ...(widgetExamples[2] as InstrumentDisplay),
    id: "pre-market",
    ticker: "DAWN",
    activity: { session: "pre", data: "snapshot" },
    extended: {
      label: "Pre",
      price: 103,
      absolute: 1,
      percent: 0.98,
      time: "08:10",
    },
    path: {
      label: "Synthetic pre-market path",
      session: { start: 0, end: 100 },
      regularSession: { start: 0, end: 40 },
      sessionGap: { start: 40, end: 80 },
      baseline: { value: 102, label: "Previous close" },
      points: [
        { time: 0, value: 102 },
        { time: 5, value: 102.5 },
        { time: 15, value: 101.1 },
        { time: 30, value: 101.4 },
        { time: 40, value: 102 },
        { time: 80, value: 102.5 },
        { time: 90, value: 103 },
      ],
    },
  },
  ...(["snapshot", "stale", "unknown", "unavailable"] as const).map(
    (data, i) => ({
      ...(widgetExamples[0] as InstrumentDisplay),
      id: `crypto-${data}`,
      ticker: "COIN",
      name: "Synthetic continuous market",
      status:
        data === "unavailable"
          ? ("unavailable" as const)
          : ("unknown" as const),
      activity: {
        session: "continuous" as const,
        data,
        period: i === 0 ? ("7d" as const) : ("24h" as const),
      },
      note: undefined,
      description: "Synthetic aggregate snapshot · 24/7 market, not streaming",
    }),
  ),
  {
    ...(widgetExamples[0] as InstrumentDisplay),
    id: "metric",
    ticker: "Market cap",
    name: "Synthetic published indicator",
    activity: { session: "not-applicable", data: "snapshot", period: "24h" },
    path: undefined,
  },
  {
    ...(widgetExamples[0] as InstrumentDisplay),
    id: "yield",
    ticker: "YIELD",
    name: "Synthetic yield",
    price: 4.062,
    precision: 3,
    priceSuffix: "%",
    unit: "yield",
    ohl: undefined,
    change: { absolute: 2.4, unit: "bp", basis: "Synthetic previous close" },
    path: undefined,
  },
  {
    ...(widgetExamples[0] as InstrumentDisplay),
    id: "fx",
    ticker: "FX/PAIR",
    name: "Synthetic currency pair",
    price: 1.1742,
    precision: 4,
    ohl: { open: 1.1763, high: 1.1771, low: 1.1728 },
    path: undefined,
  },
  {
    ...(widgetExamples[0] as InstrumentDisplay),
    id: "ipo",
    ticker: "NEW",
    name: "Synthetic IPO",
    change: undefined,
    status: "unknown",
    statusLabel: "IPO day; no previous close",
    note: "IPO day",
    path: undefined,
  },
  {
    ...(widgetExamples[3] as InstrumentDisplay),
    id: "nav",
    ticker: "FUND",
    name: "Synthetic fund",
    statusLabel: "Daily NAV",
    note: "NAV 12 Sep",
    path: {
      ...(widgetExamples[0]?.path as NonNullable<InstrumentDisplay["path"]>),
      period: "30D",
      session: undefined,
      label: "Synthetic 30-day NAV path",
    },
  },
];
