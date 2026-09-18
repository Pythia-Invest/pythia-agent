import type {
  InstrumentActivity,
  InstrumentDisplay,
  InstrumentPath,
} from "@pythia/ui";

// Invented symbols, values, timestamps and sessions. Never product data.
export const presentationExample: InstrumentDisplay = {
  id: "synthetic:north",
  ticker: "NORTH",
  name: "Synthetic North",
  price: 102,
  unit: "USD",
  status: "live",
  statusLabel: "Synthetic open market",
  activity: { session: "open", data: "current" },
  description: "Synthetic quote for component inspection; not an investment",
  change: { absolute: 2, percent: 2, basis: "Synthetic previous close" },
  path: {
    label: "Synthetic partial session",
    baseline: { value: 100, label: "Synthetic previous close" },
    intervalMs: 60,
    session: { start: 0, end: 600 },
    points: [
      { time: 0, value: 100 },
      { time: 60, value: 101 },
      { time: 120, value: 99 },
      { time: 180, value: 102 },
    ],
  },
};

export const activityExamples: readonly InstrumentActivity[] = [
  { session: "open", data: "current" },
  { session: "open", data: "delayed", delayMinutes: 15 },
  { session: "open", data: "delayed" },
  { session: "pre", data: "delayed", delayMinutes: 15 },
  { session: "post", data: "snapshot" },
  { session: "closed", data: "snapshot" },
  { session: "halted", data: "snapshot" },
  { session: "continuous", data: "snapshot", period: "24h" },
  { session: "continuous", data: "stale", period: "7d" },
  { session: "continuous", data: "unavailable" },
  { session: "unknown", data: "unknown" },
  { session: "not-applicable", data: "snapshot", period: "daily" },
];

export const pathExamples: readonly InstrumentPath[] = [
  {
    label: "Synthetic rolling week with absent leading and trailing samples",
    window: { start: 0, end: 168 },
    baseline: { value: 10, label: "Synthetic period baseline" },
    points: [
      { time: 24, value: 10 },
      { time: 72, value: 12 },
      { time: 120, value: 9 },
      { time: 144, value: 11 },
    ],
  },
  {
    label: "Synthetic regular session followed by post-market",
    session: { start: 0, end: 100 },
    regularSession: { start: 0, end: 60 },
    baseline: { value: 100, label: "Synthetic previous close" },
    points: [
      { time: 0, value: 99 },
      { time: 20, value: 101 },
      { time: 40, value: 102 },
      { time: 60, value: 101 },
      { time: 80, value: 102 },
    ],
  },
  {
    label:
      "Synthetic prior regular session and pre-market; closed interval omitted",
    session: { start: 0, end: 100 },
    regularSession: { start: 0, end: 40 },
    sessionGap: { start: 40, end: 80 },
    intervalMs: 20,
    baseline: { value: 100, label: "Synthetic prior-session baseline" },
    points: [
      { time: 0, value: 99 },
      { time: 20, value: 101 },
      { time: 40, value: 102 },
      { time: 80, value: 101 },
      { time: 90, value: 103 },
    ],
  },
  {
    label:
      "Synthetic samples with a missing interval and no comparable baseline",
    window: { start: 0, end: 100 },
    intervalMs: 20,
    points: [
      { time: 0, value: 99 },
      { time: 20, value: 101 },
      { time: 60, value: 100 },
      { time: 80, value: 102 },
    ],
  },
];
